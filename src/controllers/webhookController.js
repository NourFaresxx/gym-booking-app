const Booking = require('../models/Booking');
const Resource = require('../models/Resource');
const User = require('../models/User');
const WebhookEvent = require('../models/WebhookEvent');
const LockerBooking = require('../models/LockerBooking');
const LockerOffering = require('../models/LockerOffering');
const LockerUnit = require('../models/LockerUnit');
const { releaseSlot } = require('../services/slotService');
const { releaseUnit } = require('../services/lockerService');
const notifications = require('../services/notificationService');
const { constructWebhookEvent, refundPaymentIntent } = require('../services/paymentService');

/**
 * Stripe webhook endpoint. Receives the raw body (mounted with express.raw()
 * before express.json() in app.js) because signature verification runs over
 * the exact bytes Stripe signed.
 *
 * Responses are deliberate: 400 for a bad signature (never retry), 500 for a
 * handler failure (do retry), 200 once the event is durably handled.
 */
async function handleStripeWebhook(req, res) {
  let event;
  try {
    event = constructWebhookEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Claim the event before handling it. The unique index means a duplicate
  // delivery loses this insert and returns early, so no handler runs twice.
  try {
    await WebhookEvent.create({ eventId: event.id, type: event.type });
  } catch (err) {
    if (err.code === 11000) {
      return res.json({ received: true, duplicate: true });
    }
    throw err;
  }

  try {
    await dispatch(event);
  } catch (err) {
    // Drop the claim so Stripe's retry gets a real second attempt rather than
    // being deduplicated against this failed one.
    await WebhookEvent.deleteOne({ eventId: event.id }).catch(() => {});
    console.error(`Webhook handler failed for ${event.type} (${event.id}):`, err);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }

  res.json({ received: true });
}

async function dispatch(event) {
  switch (event.type) {
    case 'payment_intent.succeeded':
      return onPaymentSucceeded(event.data.object);
    case 'payment_intent.payment_failed':
      return onPaymentFailed(event.data.object, 'payment_failed');
    case 'payment_intent.canceled':
      return onPaymentFailed(event.data.object, 'payment_intent_canceled');
    case 'charge.refunded':
      return onChargeRefunded(event.data.object);
    default:
      return undefined; // Unsubscribed event types are acknowledged and ignored.
  }
}

function isLockerIntent(intent) {
  return intent.metadata?.bookingType === 'locker';
}

async function onPaymentSucceeded(intent) {
  if (isLockerIntent(intent)) return onLockerPaymentSucceeded(intent);

  const booking = await findBooking(intent);
  if (!booking) return;

  // Only a booking still holding its seat can be confirmed. Conditioning the
  // update on `pending` also makes a replayed event a no-op.
  const confirmed = await Booking.findOneAndUpdate(
    { _id: booking._id, status: 'pending' },
    {
      status: 'confirmed',
      paymentStatus: 'paid',
      stripePaymentIntentId: intent.id,
      expiresAt: null,
    },
    { new: true }
  );

  if (confirmed) {
    const { user, resourceName } = await loadContext(confirmed);
    await notifications.bookingConfirmed({ user, booking: confirmed, resourceName });
    return;
  }

  // The payment landed on a booking that no longer holds a seat — the expiry
  // sweeper or a cancellation got there first. The seat is already gone, so
  // the only correct action is to give the money back rather than confirm a
  // booking whose capacity has been resold.
  if (['expired', 'cancelled'].includes(booking.status) && booking.paymentStatus !== 'refunded') {
    try {
      const refund = await refundPaymentIntent({
        paymentIntentId: intent.id,
        idempotencyKey: `refund_${booking._id}`,
      });
      await Booking.findByIdAndUpdate(booking._id, {
        paymentStatus: 'refunded',
        stripeRefundId: refund.id,
      });
      console.warn(
        `Refunded late payment for ${booking.status} booking ${booking._id} (intent ${intent.id})`
      );
    } catch (err) {
      // Rethrow so the endpoint 500s and Stripe retries: money is involved,
      // and silently acknowledging would lose the obligation entirely.
      throw new Error(`Failed to refund late payment for booking ${booking._id}: ${err.message}`);
    }
  }
}

async function onPaymentFailed(intent, reason) {
  if (isLockerIntent(intent)) return onLockerPaymentFailed(intent, reason);

  const booking = await findBooking(intent);
  if (!booking) return;

  // The seat is released only if this update matched, which is what keeps a
  // retried delivery from decrementing the counter a second time and handing
  // out capacity that was never freed.
  const cancelled = await Booking.findOneAndUpdate(
    { _id: booking._id, status: 'pending' },
    {
      status: 'cancelled',
      paymentStatus: 'unpaid',
      cancelledAt: new Date(),
      cancelReason: reason,
      expiresAt: null,
    },
    { new: true }
  );
  if (!cancelled) return;

  await releaseSlot({ resourceId: cancelled.resourceId, slotStart: cancelled.slotStart });

  const { user, resourceName } = await loadContext(cancelled);
  await notifications.bookingCancelled({ user, booking: cancelled, resourceName, refunded: false });
}

async function onChargeRefunded(charge) {
  const paymentIntentId = charge.payment_intent;
  if (!paymentIntentId) return;

  // Covers refunds issued from the Stripe dashboard, which this API never
  // saw. Tried against class bookings first (unchanged from before lockers
  // existed), then locker rentals — the lookup is just "which of our own
  // collections has this payment intent id", not something the charge
  // itself tells us.
  const booking = await Booking.findOneAndUpdate(
    { stripePaymentIntentId: paymentIntentId, paymentStatus: 'paid' },
    { paymentStatus: 'refunded' },
    { new: true }
  );
  if (booking) {
    // A dashboard refund implies the booking shouldn't stand, so release the
    // seat too — again conditioned on the transition to keep it exactly-once.
    const cancelled = await Booking.findOneAndUpdate(
      { _id: booking._id, status: { $in: ['pending', 'confirmed'] } },
      { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'refunded', expiresAt: null },
      { new: true }
    );
    if (!cancelled) return;

    await releaseSlot({ resourceId: cancelled.resourceId, slotStart: cancelled.slotStart });

    const { user, resourceName } = await loadContext(cancelled);
    await notifications.bookingCancelled({ user, booking: cancelled, resourceName, refunded: true });
    return;
  }

  return onLockerChargeRefunded(paymentIntentId);
}

/** Prefers the id we stored, falling back to the metadata Stripe echoes back. */
async function findBooking(intent) {
  const byIntent = await Booking.findOne({ stripePaymentIntentId: intent.id });
  if (byIntent) return byIntent;

  const bookingId = intent.metadata?.bookingId;
  if (!bookingId) {
    console.warn(`Webhook intent ${intent.id} has no bookingId metadata`);
    return null;
  }
  return Booking.findById(bookingId);
}

async function loadContext(booking) {
  const [user, resource] = await Promise.all([
    User.findById(booking.userId).select('name email'),
    Resource.findById(booking.resourceId).select('name'),
  ]);
  return { user, resourceName: resource?.name || 'your booking' };
}

// --- Locker rentals ---
// Mirrors the class-booking handlers above field-for-field (same
// conditional-transition-for-exactly-once reasoning, same late-payment
// refund logic), adapted to LockerBooking's shape: a unit instead of a slot,
// and releaseUnit instead of releaseSlot.

async function onLockerPaymentSucceeded(intent) {
  const booking = await findLockerBooking(intent);
  if (!booking) return;

  const confirmed = await LockerBooking.findOneAndUpdate(
    { _id: booking._id, status: 'pending' },
    { status: 'confirmed', paymentStatus: 'paid', stripePaymentIntentId: intent.id, expiresAt: null },
    { new: true }
  );

  if (confirmed) {
    const context = await loadLockerContext(confirmed);
    await notifications.lockerBookingConfirmed({ ...context, booking: confirmed });
    return;
  }

  // Same situation as a late class-booking payment: the unit this rental
  // held has already been released (expired or cancelled), so it may have
  // been rented out again — confirming now would double-book it. Refund
  // instead of confirming.
  if (['expired', 'cancelled'].includes(booking.status) && booking.paymentStatus !== 'refunded') {
    try {
      const refund = await refundPaymentIntent({
        paymentIntentId: intent.id,
        idempotencyKey: `locker_refund_${booking._id}`,
      });
      await LockerBooking.findByIdAndUpdate(booking._id, {
        paymentStatus: 'refunded',
        stripeRefundId: refund.id,
      });
      console.warn(
        `Refunded late payment for ${booking.status} locker rental ${booking._id} (intent ${intent.id})`
      );
    } catch (err) {
      throw new Error(
        `Failed to refund late payment for locker rental ${booking._id}: ${err.message}`
      );
    }
  }
}

async function onLockerPaymentFailed(intent, reason) {
  const booking = await findLockerBooking(intent);
  if (!booking) return;

  const cancelled = await LockerBooking.findOneAndUpdate(
    { _id: booking._id, status: 'pending' },
    {
      status: 'cancelled',
      paymentStatus: 'unpaid',
      cancelledAt: new Date(),
      cancelReason: reason,
      expiresAt: null,
    },
    { new: true }
  );
  if (!cancelled) return;

  await releaseUnit({ unitId: cancelled.unitId });

  const context = await loadLockerContext(cancelled);
  await notifications.lockerBookingCancelled({ ...context, booking: cancelled, refunded: false });
}

async function onLockerChargeRefunded(paymentIntentId) {
  const booking = await LockerBooking.findOneAndUpdate(
    { stripePaymentIntentId: paymentIntentId, paymentStatus: 'paid' },
    { paymentStatus: 'refunded' },
    { new: true }
  );
  if (!booking) return;

  const cancelled = await LockerBooking.findOneAndUpdate(
    { _id: booking._id, status: { $in: ['pending', 'confirmed'] } },
    { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'refunded', expiresAt: null },
    { new: true }
  );
  if (!cancelled) return;

  await releaseUnit({ unitId: cancelled.unitId });

  const context = await loadLockerContext(cancelled);
  await notifications.lockerBookingCancelled({ ...context, booking: cancelled, refunded: true });
}

async function findLockerBooking(intent) {
  const byIntent = await LockerBooking.findOne({ stripePaymentIntentId: intent.id });
  if (byIntent) return byIntent;

  const bookingId = intent.metadata?.bookingId;
  if (!bookingId) {
    console.warn(`Webhook intent ${intent.id} has no bookingId metadata`);
    return null;
  }
  return LockerBooking.findById(bookingId);
}

async function loadLockerContext(booking) {
  const [user, offering, unit] = await Promise.all([
    User.findById(booking.userId).select('name email'),
    LockerOffering.findById(booking.offeringId).select('name'),
    LockerUnit.findById(booking.unitId).select('label'),
  ]);
  return { user, offeringName: offering?.name || 'your locker rental', unitLabel: unit?.label };
}

module.exports = { handleStripeWebhook };
