jest.mock('../src/services/paymentService');
jest.mock('../src/services/notificationService');

const { app, request, makeUser, makeLockerOffering, as } = require('./helpers');
const LockerOffering = require('../src/models/LockerOffering');
const LockerUnit = require('../src/models/LockerUnit');
const LockerBooking = require('../src/models/LockerBooking');
const payments = require('../src/services/paymentService');
const notifications = require('../src/services/notificationService');
const maintenance = require('../src/jobs/bookingMaintenance');
const { addTierDuration } = require('../src/services/lockerService');

beforeEach(() => {
  payments.resetPaymentMocks();
  notifications.resetNotifications();
});

// Deliberately not `async` — returning the supertest Test object directly
// (rather than a Promise wrapping it) keeps it chainable, so callers can do
// either `await rent(...)` or `await rent(...).expect(201)`.
function rent(token, offering, tier) {
  return as(token).post('/api/locker-bookings').send({ offeringId: offering._id.toString(), tier });
}

describe('addTierDuration', () => {
  it('adds a calendar day, month, and year — not a flat millisecond offset', () => {
    const start = new Date('2026-01-31T10:00:00.000Z');
    expect(addTierDuration(start, 'day').toISOString()).toBe('2026-02-01T10:00:00.000Z');
    // Jan 31 + 1 month: JS Date normalizes to the next valid date (Mar 3 in
    // a non-leap year) rather than erroring — documented behavior, not a bug
    // to work around, since no tier offering needs exact month-end precision.
    expect(addTierDuration(start, 'month').getUTCMonth()).toBe(2); // March (0-indexed)
    expect(addTierDuration(start, 'year').toISOString()).toBe('2027-01-31T10:00:00.000Z');
  });

  it('handles a leap-year February correctly', () => {
    const start = new Date('2028-02-29T00:00:00.000Z'); // 2028 is a leap year
    expect(addTierDuration(start, 'year').getUTCFullYear()).toBe(2029);
  });
});

describe('GET /api/lockers', () => {
  it('is public, hides deactivated offerings, and reports live availability', async () => {
    const visible = await makeLockerOffering({ capacity: 5 });
    await makeLockerOffering({ capacity: 2, isActive: false, name: 'Hidden' });

    const res = await request(app).get('/api/lockers');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ _id: visible._id.toString(), availableNow: 5 });
  });

  it('reflects a rented unit in availableNow', async () => {
    const offering = await makeLockerOffering({ capacity: 2 });
    const customer = await makeUser();
    await rent(customer.token, offering, 'month').expect(201);

    const res = await request(app).get('/api/lockers');
    expect(res.body.items[0].availableNow).toBe(1);
  });
});

describe('POST /api/lockers', () => {
  const validBody = { name: 'New Lockers', capacity: 10, pricing: { day: 500, month: 4000, year: 35000 } };

  it('requires authentication and staff/admin role', async () => {
    expect((await request(app).post('/api/lockers').send(validBody)).status).toBe(401);

    const customer = await makeUser();
    expect((await as(customer.token).post('/api/lockers').send(validBody)).status).toBe(403);
  });

  it('provisions exactly `capacity` units on creation', async () => {
    const staff = await makeUser({ role: 'staff' });
    const res = await as(staff.token).post('/api/lockers').send(validBody);

    expect(res.status).toBe(201);
    const units = await LockerUnit.find({ offeringId: res.body._id });
    expect(units).toHaveLength(10);
    expect(units.map((u) => u.label).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `Locker ${String(i + 1).padStart(2, '0')}`)
    );
  });

  it('rejects an offering missing a pricing tier', async () => {
    const staff = await makeUser({ role: 'staff' });
    const res = await as(staff.token)
      .post('/api/lockers')
      .send({ name: 'X', capacity: 5, pricing: { day: 500, month: 4000 } });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/lockers/:id', () => {
  it('raising capacity provisions additional units without touching existing ones', async () => {
    const offering = await makeLockerOffering({ capacity: 3 });
    const staff = await makeUser({ role: 'staff' });
    // Reassign ownership isn't being tested here — use admin to bypass ownership.
    const admin = await makeUser({ role: 'admin' });

    const before = await LockerUnit.find({ offeringId: offering._id }).sort('label');

    const res = await as(admin.token).patch(`/api/lockers/${offering._id}`).send({ capacity: 5 });
    expect(res.status).toBe(200);

    const after = await LockerUnit.find({ offeringId: offering._id }).sort('label');
    expect(after).toHaveLength(5);
    // The original 3 units are untouched (same ids), not recreated.
    expect(after.slice(0, 3).map((u) => u._id.toString())).toEqual(
      before.map((u) => u._id.toString())
    );
  });

  it('lowering capacity does not delete existing units', async () => {
    const offering = await makeLockerOffering({ capacity: 5 });
    const admin = await makeUser({ role: 'admin' });

    await as(admin.token).patch(`/api/lockers/${offering._id}`).send({ capacity: 2 });

    const units = await LockerUnit.find({ offeringId: offering._id });
    expect(units).toHaveLength(5);
  });

  it("refuses staff editing another owner's offering", async () => {
    const owner = await makeUser({ role: 'staff' });
    const intruder = await makeUser({ role: 'staff' });
    const offering = await makeLockerOffering({ ownerId: owner.user._id });

    const res = await as(intruder.token).patch(`/api/lockers/${offering._id}`).send({ capacity: 9 });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/lockers/:id', () => {
  it('soft-deletes and leaves units and bookings intact', async () => {
    const offering = await makeLockerOffering({ capacity: 2 });
    const customer = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const created = await rent(customer.token, offering, 'day').expect(201);

    const res = await as(admin.token).delete(`/api/lockers/${offering._id}`);
    expect(res.status).toBe(204);

    const stored = await LockerOffering.findById(offering._id);
    expect(stored.isActive).toBe(false);
    const booking = await LockerBooking.findById(created.body.booking._id);
    expect(booking.status).toBe('pending');
  });
});

describe('concurrent rentals', () => {
  it('never exceeds capacity when requests arrive simultaneously', async () => {
    const offering = await makeLockerOffering({ capacity: 3 });
    const customers = await Promise.all(Array.from({ length: 8 }, () => makeUser()));

    const results = await Promise.all(customers.map(({ token }) => rent(token, offering, 'month')));

    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);

    const occupied = await LockerUnit.countDocuments({
      offeringId: offering._id,
      occupiedUntil: { $gt: new Date() },
    });
    expect(occupied).toBe(3);
  });

  it('holds for capacity of one, where the race window is widest', async () => {
    const offering = await makeLockerOffering({ capacity: 1 });
    const customers = await Promise.all(Array.from({ length: 10 }, () => makeUser()));

    const results = await Promise.all(customers.map(({ token }) => rent(token, offering, 'day')));

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
  });

  it('lets a freed unit be rented by someone else', async () => {
    const offering = await makeLockerOffering({ capacity: 1 });
    const first = await makeUser();
    const second = await makeUser();

    const created = await rent(first.token, offering, 'day').expect(201);
    await rent(second.token, offering, 'day').expect(409);

    await as(first.token).patch(`/api/locker-bookings/${created.body.booking._id}/cancel`).expect(200);

    await rent(second.token, offering, 'day').expect(201);
  });
});

describe('POST /api/locker-bookings', () => {
  it('creates a pending rental with the correct tier price and end date', async () => {
    const offering = await makeLockerOffering({ capacity: 2 });
    const customer = await makeUser();

    const res = await rent(customer.token, offering, 'month');

    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ status: 'pending', paymentStatus: 'unpaid', amount: 4000, tier: 'month' });
    expect(res.body.clientSecret).toBeTruthy();

    const start = new Date(res.body.booking.rentalStart);
    const end = new Date(res.body.booking.rentalEnd);
    expect(end.getUTCMonth()).toBe((start.getUTCMonth() + 1) % 12);
  });

  it('assigns a real unit and records it on the booking', async () => {
    const offering = await makeLockerOffering({ capacity: 1 });
    const customer = await makeUser();

    const res = await rent(customer.token, offering, 'day');
    const unit = await LockerUnit.findById(res.body.booking.unitId);
    expect(unit.currentBookingId.toString()).toBe(res.body.booking._id);
    expect(unit.occupiedUntil.toISOString()).toBe(res.body.booking.rentalEnd);
  });

  it('404s for an inactive offering', async () => {
    const offering = await makeLockerOffering({ isActive: false });
    const customer = await makeUser();
    expect((await rent(customer.token, offering, 'day')).status).toBe(404);
  });

  it('rejects an invalid tier', async () => {
    const offering = await makeLockerOffering();
    const customer = await makeUser();
    const res = await as(customer.token)
      .post('/api/locker-bookings')
      .send({ offeringId: offering._id.toString(), tier: 'week' });
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const offering = await makeLockerOffering();
    const res = await request(app)
      .post('/api/locker-bookings')
      .send({ offeringId: offering._id.toString(), tier: 'day' });
    expect(res.status).toBe(401);
  });

  it('releases the unit when the payment provider cannot start a payment', async () => {
    const offering = await makeLockerOffering({ capacity: 1 });
    const customer = await makeUser();
    payments.createPaymentIntent.mockRejectedValueOnce(new Error('Stripe is down'));

    const res = await rent(customer.token, offering, 'day');
    expect(res.status).toBe(502);

    const occupied = await LockerUnit.countDocuments({
      offeringId: offering._id,
      occupiedUntil: { $gt: new Date() },
    });
    expect(occupied).toBe(0);

    const other = await makeUser();
    await rent(other.token, offering, 'day').then((r) => expect(r.status).toBe(201));
  });

  it('keys the payment intent on the booking with bookingType=locker', async () => {
    const offering = await makeLockerOffering();
    const customer = await makeUser();

    const res = await rent(customer.token, offering, 'day');

    expect(payments.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `locker_booking_${res.body.booking._id}`,
        metadata: expect.objectContaining({ bookingType: 'locker' }),
      })
    );
  });
});

describe('GET /api/locker-bookings', () => {
  it('lists only your own rentals on /me', async () => {
    const offering = await makeLockerOffering({ capacity: 5 });
    const mine = await makeUser();
    const theirs = await makeUser();
    await rent(mine.token, offering, 'day');
    await rent(theirs.token, offering, 'day');

    const res = await as(mine.token).get('/api/locker-bookings/me');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].userId).toBe(mine.user._id.toString());
  });

  it('refuses a customer on the staff-wide listing, allows staff', async () => {
    const offering = await makeLockerOffering({ capacity: 2 });
    const customer = await makeUser();
    const staff = await makeUser({ role: 'staff' });
    await rent(customer.token, offering, 'day');

    expect((await as(customer.token).get('/api/locker-bookings')).status).toBe(403);
    const res = await as(staff.token).get('/api/locker-bookings');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('lets the owner fetch one rental but not a stranger', async () => {
    const offering = await makeLockerOffering({ capacity: 2 });
    const owner = await makeUser();
    const stranger = await makeUser();
    const created = await rent(owner.token, offering, 'day');
    const id = created.body.booking._id;

    expect((await as(owner.token).get(`/api/locker-bookings/${id}`)).status).toBe(200);
    expect((await as(stranger.token).get(`/api/locker-bookings/${id}`)).status).toBe(403);
  });
});

describe('PATCH /api/locker-bookings/:id/cancel', () => {
  it('releases the unit and notifies the customer', async () => {
    const offering = await makeLockerOffering({ capacity: 2 });
    const customer = await makeUser();
    const created = await rent(customer.token, offering, 'day');

    const res = await as(customer.token).patch(`/api/locker-bookings/${created.body.booking._id}/cancel`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    const unit = await LockerUnit.findById(created.body.booking.unitId);
    expect(unit.occupiedUntil).toBeNull();
    expect(unit.currentBookingId).toBeNull();
    expect(notifications.lockerBookingCancelled).toHaveBeenCalledTimes(1);
  });

  it('refunds a paid rental, voids an unpaid one', async () => {
    const offering = await makeLockerOffering({ capacity: 2 });
    const customer = await makeUser();
    const created = await rent(customer.token, offering, 'day');
    const id = created.body.booking._id;

    await as(customer.token).patch(`/api/locker-bookings/${id}/cancel`).expect(200);
    expect(payments.cancelPaymentIntent).toHaveBeenCalledWith(created.body.booking.stripePaymentIntentId);
    expect(payments.refundPaymentIntent).not.toHaveBeenCalled();

    // A second, paid rental.
    const created2 = await rent(customer.token, offering, 'day');
    await LockerBooking.findByIdAndUpdate(created2.body.booking._id, {
      status: 'confirmed',
      paymentStatus: 'paid',
    });
    await as(customer.token).patch(`/api/locker-bookings/${created2.body.booking._id}/cancel`).expect(200);
    expect(payments.refundPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('is idempotent', async () => {
    const offering = await makeLockerOffering({ capacity: 2 });
    const customer = await makeUser();
    const created = await rent(customer.token, offering, 'day');
    const id = created.body.booking._id;

    await as(customer.token).patch(`/api/locker-bookings/${id}/cancel`).expect(200);
    await as(customer.token).patch(`/api/locker-bookings/${id}/cancel`).expect(200);

    const unit = await LockerUnit.findById(created.body.booking.unitId);
    expect(unit.occupiedUntil).toBeNull();
  });

  it("refuses a stranger cancelling someone else's rental", async () => {
    const offering = await makeLockerOffering({ capacity: 2 });
    const customer = await makeUser();
    const stranger = await makeUser();
    const created = await rent(customer.token, offering, 'day');

    const res = await as(stranger.token).patch(`/api/locker-bookings/${created.body.booking._id}/cancel`);
    expect(res.status).toBe(403);
  });
});

describe('locker maintenance sweeper', () => {
  it('releases the unit held by an abandoned checkout', async () => {
    const offering = await makeLockerOffering({ capacity: 1 });
    const customer = await makeUser();
    const created = await rent(customer.token, offering, 'day');
    const id = created.body.booking._id;

    await LockerBooking.findByIdAndUpdate(id, { expiresAt: new Date(Date.now() - 1000) });

    const result = await maintenance.expirePendingLockerBookings();

    expect(result.lockersExpired).toBe(1);
    expect((await LockerBooking.findById(id)).status).toBe('expired');
    const unit = await LockerUnit.findById(created.body.booking.unitId);
    expect(unit.occupiedUntil).toBeNull();
    expect(notifications.lockerBookingExpired).toHaveBeenCalledTimes(1);
  });

  it('never expires a confirmed rental', async () => {
    const offering = await makeLockerOffering({ capacity: 1 });
    const customer = await makeUser();
    const created = await rent(customer.token, offering, 'day');
    await LockerBooking.findByIdAndUpdate(created.body.booking._id, {
      status: 'confirmed',
      paymentStatus: 'paid',
      expiresAt: new Date(Date.now() - 1000),
    });

    await maintenance.expirePendingLockerBookings();

    expect((await LockerBooking.findById(created.body.booking._id)).status).toBe('confirmed');
  });

  it('marks a finished rental completed', async () => {
    const offering = await makeLockerOffering({ capacity: 1 });
    const customer = await makeUser();
    const created = await rent(customer.token, offering, 'day');
    await LockerBooking.findByIdAndUpdate(created.body.booking._id, {
      status: 'confirmed',
      paymentStatus: 'paid',
      rentalEnd: new Date(Date.now() - 1000),
    });

    const result = await maintenance.completePastLockerRentals();

    expect(result.lockersCompleted).toBe(1);
    expect((await LockerBooking.findById(created.body.booking._id)).status).toBe('completed');
  });
});
