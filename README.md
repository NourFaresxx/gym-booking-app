# Rehab Sporting Club Gym

A REST API for booking time-limited resources (classes, rooms, equipment) with
JWT authentication, role-based access control, Stripe payments, and
concurrency-safe booking that cannot overbook a slot.

## Features

- **Auth**: JWT access + refresh tokens (rotated on refresh), bcrypt password hashing, rate-limited credential endpoints
- **RBAC**: `admin` / `staff` / `customer` roles, plus per-resource ownership checks
- **Resources**: CRUD with text search, price filtering, pagination, and allow-listed sorting
- **Recurring availability**: weekly opening hours in the resource's own timezone, expanded into bookable slots on demand — no pre-created slot rows
- **Bookings**: capacity-safe booking, automatic release of abandoned checkouts, refund on cancellation
- **Payments**: Stripe PaymentIntents with an idempotent webhook that reconciles bookings against payment outcomes
- **Analytics**: bookings, revenue, refunds and seat utilisation, scoped by resource ownership
- **Notifications**: confirmation / cancellation / expiry emails over SMTP, logged instead when SMTP isn't configured
- **Validation**: Zod schemas on every write endpoint
- **Docs**: OpenAPI 3 at `/api/docs`, raw spec at `/api/openapi.json`
- **Lockers**: day/month/year rentals from a pool of interchangeable physical units, race-free on a different mechanism than class booking (see "Why this exists")
- **Tests**: 196 Jest + Supertest tests, including concurrency, webhook idempotency and capacity-release coverage

## Stack

Node.js, Express, MongoDB/Mongoose, JWT, Stripe, Zod, Jest.

## Getting started

```bash
npm install
cp .env.example .env    # fill in MongoDB URI, two JWT secrets, Stripe keys
npm run seed            # optional: demo users and resources
npm run dev
```

API docs: `http://localhost:5000/api/docs`

The seed script creates `admin@example.com`, `staff@example.com` and
`customer@example.com`, all with the password `password123`.

To change someone's role:

```bash
npm run promote -- someone@example.com staff
```

### Running tests

```bash
npm test
```

The suite spins up one in-memory MongoDB replica set for the whole run
(`mongodb-memory-server`) — no external database needed. A replica set rather
than a standalone server, because transactions require one.

## Why this exists

Most CRUD-API portfolio projects skip the parts that actually come up in
backend interviews: race conditions, payment reconciliation, and token
handling. This project exists to have working, tested code for those.

### Overbooking is prevented by a counter, not by a transaction

The obvious approach — count active bookings, insert if under capacity, wrap
it in a transaction — **does not work**, and the reason is worth knowing.
MongoDB transactions detect a conflict only when two transactions touch the
*same document*. Two concurrent requests each inserting a brand-new `Booking`
never collide, so every request reads the same pre-insert count and they all
pass the capacity check. The transaction provides no protection at all.

Instead, capacity lives as a counter on a single `BookingSlot` document per
`(resource, slotStart)`. Reserving a seat is one conditional update:

```js
BookingSlot.findOneAndUpdate(
  { resourceId, slotStart, $expr: { $lt: ['$bookedCount', '$capacity'] } },
  { $inc: { bookedCount: 1 } }
)
```

Single-document updates are atomic in MongoDB, so the check and the increment
cannot interleave. `tests/booking.concurrency.test.js` fires simultaneous
requests at a 3-seat and a 1-seat slot and asserts the counts hold.

One consequence worth noting: the slot counter document must be created
*outside* the transaction. Inside one, losing the create race raises a
duplicate-key error that aborts the whole transaction — and an aborted
transaction can't be continued, even though the error itself is harmless.

### Every seat release is exactly-once

A seat is freed on cancellation, on payment failure, and on checkout expiry —
and Stripe delivers webhooks at least once, so each of those can arrive twice.
Every release is therefore gated on a conditional status transition:

```js
Booking.findOneAndUpdate({ _id, status: 'pending' }, { status: 'cancelled' })
```

Only the caller whose update actually matched goes on to decrement the
counter. A redelivered event finds the booking already moved and does nothing,
so the counter can't drift. Webhook event ids are also recorded in a
deduplication collection, and the `$gt: 0` guard on the decrement is a final
backstop against a negative count.

### Abandoned checkouts don't leak capacity

A booking starts as `pending` and holds a seat. If payment is never completed,
that seat would be held forever — every abandoned checkout permanently
shrinking the slot. Pending bookings carry an `expiresAt`, and a sweeper
(`src/jobs/bookingMaintenance.js`) expires them and returns the seat.

The sweeper's transition is conditional too, so a payment that confirms in the
same moment is never expired out from under the customer. And if a payment
lands *after* expiry, the webhook refunds it rather than confirming a booking
whose seat may already have been resold.

### Payment reconciliation

Stripe can't participate in a MongoDB transaction, so bookings are created
first and confirmed only when the webhook reports success — never
optimistically. The one case that needs undoing by hand is a payment intent
that can't be created at all: there the booking is cancelled and the seat
released explicitly, because there is no webhook coming to reconcile it.

### Refresh token rotation (and why bcrypt was wrong for it)

Each refresh invalidates the previous refresh token: the stored hash is
compared, then replaced.

The stored hash is SHA-256, not bcrypt, which matters more than it looks.
bcrypt ignores everything past the first 72 bytes of its input, and a JWT's
first 72 bytes are the fixed header plus the beginning of `{"sub":"<user id>`
— byte-identical for every token that user will ever be issued. bcrypt
therefore could not distinguish one of a user's refresh tokens from another,
and rotation silently failed to invalidate anything. bcrypt is also simply the
wrong tool: its cost exists to slow brute force against low-entropy human
passwords, while a signed JWT already carries full-strength HMAC entropy.
Passwords still use bcrypt, capped at 72 bytes so nothing is truncated.

`tests/tokens.test.js` demonstrates the bcrypt collision directly.

### Recurring availability

Slots are generated from weekly opening hours rather than stored, so a
resource's schedule is four rows instead of thousands of slot documents.
Opening hours are wall-clock times in the resource's own IANA timezone, so
"Mondays 09:00" stays 09:00 local across a DST change instead of drifting by
an hour. `src/utils/timezone.js` does this with `Intl` alone, no date library.

Booking validates the requested `slotStart` against the same generator, so an
arbitrary timestamp can't be booked on a resource that isn't open then.

### Trainers

A `Trainer` is a staff-managed profile (bio, specialties, photo) a client
reads to decide who to book with — deliberately not tied to a `User` account,
since not every listed trainer needs a login. A `Resource` optionally links to
one via `trainerId` ("Pilates Fundamentals" taught by Sarah Chen); booking
itself is unchanged — "signing up for a trainer" means booking one of their
classes through the same availability/payment flow every other resource uses,
not a separate booking subsystem. `GET /api/trainers/:id` returns the profile
plus their active classes in one response, so the frontend's trainer page
doesn't have to filter the full resource list client-side.

### Lockers: a different overbooking problem, a different fix

A class booking reserves a point in time (a slot); a locker rental reserves a
*span* — a day, a month, or a year, starting whenever the customer checks
out. That's not a smaller version of the slot problem, it's a different one,
and `BookingSlot`'s counter-per-exact-timestamp trick doesn't apply: there's
no shared instant for two rentals to collide on.

The fix is the same *idea* as `BookingSlot` — one atomic conditional update
is what actually prevents the race, not a transaction — aimed at a different
condition. Each physical locker is its own `LockerUnit` document carrying
`occupiedUntil`. Claiming one is:

```js
LockerUnit.findOneAndUpdate(
  { offeringId, $or: [{ occupiedUntil: null }, { occupiedUntil: { $lte: now } }] },
  { $set: { occupiedUntil: rentalEnd } }
)
```

"Is this unit free" is "is its occupied-until date in the past", not "is a
counter under a limit" — but it's still one atomic update on one document, so
two concurrent rentals racing for the last free unit still can't both win.
`tests/lockers.test.js` fires simultaneous rentals at a 3-unit and a 1-unit
pool, same shape as the class-booking concurrency test.

Everything downstream reuses what classes already built rather than
duplicating it: the same pending → confirmed/expired → completed lifecycle,
the same Stripe webhook endpoint (routed by a `bookingType: 'locker'` tag in
the payment intent's metadata, with the class-booking code paths completely
unmodified), the same maintenance sweeper, the same cancellation/refund
logic. `LockerBooking` is still its own model rather than extra fields bolted
onto `Booking` — a rental's shape (`unitId`, `tier`, `rentalStart`/`rentalEnd`)
doesn't overlap cleanly with a class booking's (`resourceId`, `slotStart`),
and conflating them would mean every query on one carries fields that only
make sense for the other.

## Project structure

```
src/
  config/       # db connection, OpenAPI spec
  controllers/  # route handlers
  jobs/         # pending-booking expiry and completion sweeper
  middleware/   # auth, validation, error handling
  models/       # Mongoose schemas
  routes/       # Express routers + OpenAPI annotations
  schemas/      # Zod validation schemas
  services/     # slots, availability, payments, notifications
  utils/        # tokens, timezone maths
scripts/        # seed, promoteUser
tests/
frontend/       # React + Vite customer web app (see below)
```

## Frontend

`frontend/` is a React + Vite app covering both sides of the product:

- **Customer flow**: register/log in, browse resources and trainers, pick an
  available slot, pay with Stripe Elements, and view/cancel bookings. Browse
  (`/`) and Self Care (`/self-care`) are the same `Resource` collection split
  by a `category` field (`classes` vs. `self-care`) — a spa session and a
  CrossFit class are the same document shape, just grouped differently.
- **Lockers** (`/lockers`): day/month/year rentals, same checkout flow as a
  class, under `My bookings → Lockers`.
- **Admin flow** (`/admin`, staff/admin only — the nav link only appears for
  those roles, and the route redirects anyone else back to Classes): a
  dashboard (bookings, revenue, refunds, seat utilisation, top classes by
  revenue), and CRUD for classes, trainers, and locker offerings, including
  reactivating something you'd previously deactivated. Locker revenue isn't
  in the dashboard yet — see Notes and limitations.

The admin UI's "show inactive" toggle depends on a backend addition that
isn't obvious from the API routes alone: `GET /resources` and `GET
/trainers` accept an `includeInactive=true` query param, but it's silently
ignored unless the caller is authenticated as staff/admin — a public/
customer request to that same URL with that same query string always gets
active-only results, regardless of what it asks for.

```bash
cd frontend
npm install
cp .env.example .env    # API URL + Stripe PUBLISHABLE key
npm run dev              # http://localhost:5173
```

Also set `CLIENT_URL=http://localhost:5173` in the API's own `.env` so CORS
allows the dev server to call it.

Notes:

- The access token lives in memory only (never `localStorage`); only the
  refresh token is persisted, and the client transparently refreshes once on
  a 401. A reload always costs one 401-then-refresh round trip by design —
  there's no way to know the in-memory token is stale without trying it, and
  persisting it to survive reloads would mean keeping it somewhere an XSS
  payload could read it.
- `VITE_STRIPE_PUBLISHABLE_KEY` must be the publishable key from the *same*
  Stripe account as the API's `STRIPE_SECRET_KEY`, or Stripe Elements will
  mount but silently fail to render actual payment fields.

## API overview

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/api/auth/register` | public |
| `POST` | `/api/auth/login` | public |
| `POST` | `/api/auth/refresh` | public |
| `GET` | `/api/auth/me` | authenticated |
| `POST` | `/api/auth/logout` | authenticated |
| `GET` | `/api/resources` | public |
| `GET` | `/api/resources/:id` | public |
| `GET` | `/api/resources/:id/availability` | public |
| `POST` | `/api/resources` | staff, admin |
| `PATCH` | `/api/resources/:id` | owner, admin |
| `DELETE` | `/api/resources/:id` | owner, admin |
| `GET` | `/api/trainers` | public |
| `GET` | `/api/trainers/:id` | public |
| `POST` | `/api/trainers` | staff, admin |
| `PATCH` | `/api/trainers/:id` | staff, admin |
| `DELETE` | `/api/trainers/:id` | staff, admin |
| `POST` | `/api/bookings` | authenticated |
| `GET` | `/api/bookings/me` | authenticated |
| `GET` | `/api/bookings/:id` | owner, staff, admin |
| `PATCH` | `/api/bookings/:id/cancel` | owner, staff, admin |
| `GET` | `/api/bookings` | staff, admin |
| `GET` | `/api/lockers` | public |
| `GET` | `/api/lockers/:id` | public |
| `POST` | `/api/lockers` | staff, admin |
| `PATCH` | `/api/lockers/:id` | owner, admin |
| `DELETE` | `/api/lockers/:id` | owner, admin |
| `POST` | `/api/locker-bookings` | authenticated |
| `GET` | `/api/locker-bookings/me` | authenticated |
| `GET` | `/api/locker-bookings/:id` | owner, staff, admin |
| `PATCH` | `/api/locker-bookings/:id/cancel` | owner, staff, admin |
| `GET` | `/api/locker-bookings` | staff, admin |
| `GET` | `/api/analytics/overview` | staff, admin |
| `POST` | `/api/webhooks/stripe` | Stripe signature |
| `GET` | `/health` | public |

All money values are integers in the minor currency unit (cents).

### Booking flow

1. `GET /api/resources/:id/availability` → pick a slot with `bookable: true`
2. `POST /api/bookings` with that slot's `start` → `pending` booking + `clientSecret` + `expiresAt`
3. Confirm the payment client-side with the `clientSecret`
4. Stripe calls `POST /api/webhooks/stripe` → booking becomes `confirmed`

If step 3 never happens, the sweeper expires the booking and frees the seat.

### Local webhook testing

```bash
stripe listen --forward-to localhost:5000/api/webhooks/stripe
```

Put the printed `whsec_...` value in `STRIPE_WEBHOOK_SECRET`.

## Deployment

`render.yaml` is a [Render Blueprint](https://render.com/docs/blueprint-spec)
that deploys the API and the frontend together, both on Render's free tier —
no credit card required, $0 unless you blow far past the generous
free bandwidth/build-minute limits. The only cost of "free" is a ~1 minute
cold start if the service has had no traffic in the last 15 minutes.

1. On [render.com](https://render.com), **New → Blueprint**, select this
   repo. Render finds `render.yaml` automatically and shows two services:
   `rehab-sporting-club-api` and `rehab-sporting-club-web`.
2. Fill in the prompted secrets (these are typed into Render's dashboard,
   never committed to the repo):
   - `MONGODB_URI` — same Atlas connection string as local
   - `STRIPE_SECRET_KEY` — your `sk_test_...` key
   - `STRIPE_WEBHOOK_SECRET` — a placeholder for now (e.g. `whsec_pending`);
     production needs its own webhook endpoint, set up in step 5
   - `CLIENT_URL` on the API, and `VITE_API_URL` on the frontend — also
     placeholders for now (e.g. `https://pending.example.com`); neither
     service's real `onrender.com` URL exists until it has deployed once,
     so this is a chicken-and-egg problem solved by step 4
   - `VITE_STRIPE_PUBLISHABLE_KEY` — your real `pk_test_...` key (safe to
     set correctly now; it's meant to be public)
   - `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` are generated for you
3. Deploy. Both services build; note their real URLs once live
   (`https://rehab-sporting-club-api.onrender.com`,
   `https://rehab-sporting-club-web.onrender.com` — Render appends a random
   suffix instead if either name is already taken).
4. Go back and fix the two placeholders with the real URLs:
   - API's `CLIENT_URL` → the frontend's URL
   - Frontend's `VITE_API_URL` → the API's URL + `/api`

   Then redeploy both manually. This matters most for the frontend: Vite
   bakes `VITE_*` values in at *build* time, so a stale `VITE_API_URL`
   silently keeps pointing at the placeholder until the next build, not just
   the next restart.
5. **MongoDB Atlas network access**: Render's free tier has no fixed
   outbound IP, so add `0.0.0.0/0` under Atlas → Network Access (same fix as
   the "IP not whitelisted" error in local dev, just permanent this time
   since the IP genuinely varies).
6. **Production Stripe webhook**: `stripe listen` is dev-only. In the
   [Stripe Dashboard](https://dashboard.stripe.com/test/webhooks), add an
   endpoint for `https://<your-api>.onrender.com/api/webhooks/stripe`
   listening for `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_intent.canceled`, and `charge.refunded` — the same four events
   `src/controllers/webhookController.js` handles. Copy the endpoint's
   signing secret into `STRIPE_WEBHOOK_SECRET` on Render, replacing the
   placeholder, and redeploy the API.

## Notes and limitations

- **Transactions need a replica set.** MongoDB Atlas provides one; a bare
  local `mongod` does not.
- **One refresh token per user.** Logging in on a second device invalidates the
  first. Supporting concurrent sessions means storing a set of token hashes.
- **The maintenance sweeper assumes a single process.** Several instances
  behind a load balancer would each sweep. That stays *correct*, because every
  transition is a conditional update, but it duplicates work; a real
  deployment should elect one scheduler or take a lock.
- **Overnight opening hours** must be entered as two same-day windows.
- **Analytics utilisation** is measured over slots that saw at least one
  booking, not over every slot the opening hours imply.
- **Locker revenue isn't in `/api/analytics/overview`.** That endpoint
  aggregates `Booking` only; folding in `LockerBooking` means unioning two
  collections with different shapes, deferred rather than rushed.
- **Lowering a locker offering's `capacity` never removes units**, even ones
  that were never rented. Real capacity can end up higher than what's
  advertised, but never lower than what's already been committed to a
  customer — see `lockerService.ensureUnits`.
- **A locker rental starts immediately** (now, not a future date) and is full
  price with no proration on early cancellation — same simplicity tradeoff
  class bookings make.
- **Graceful shutdown relies on POSIX signals**, so it is inert on Windows,
  where the process is terminated outright. It works on any Linux deployment.

## Possible extensions

- Per-session refresh tokens so multiple devices can stay logged in
- Waitlists: offer a freed seat to the next person in line
- Recurring bookings ("every Monday for 8 weeks")
- Move the sweeper to a locked or external scheduler for multi-instance deploys
