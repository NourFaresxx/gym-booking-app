const Booking = require('../models/Booking');
const Resource = require('../models/Resource');
const User = require('../models/User');
const LockerBooking = require('../models/LockerBooking');
const LockerOffering = require('../models/LockerOffering');
const { releaseSlot } = require('../services/slotService');
const { releaseUnit } = require('../services/lockerService');
const notifications = require('../services/notificationService');
const { cancelPaymentIntent } = require('../services/paymentService');

const DEFAULT_INTERVAL_MS = 60_000;
const BATCH_SIZE = 200;

/**
 * Releases seats held by checkouts that were never completed.
 *
 * Without this, every abandoned checkout permanently removes a seat from a
 * slot: the booking stays `pending` forever, so the BookingSlot counter is
 * never decremented and the capacity is leaked.
 */
async function expirePendingBookings(now = new Date()) {
  const candidates = await Booking.find({
    status: 'pending',
    expiresAt: { $ne: null, $lte: now },
  }).limit(BATCH_SIZE);

  let expired = 0;
  for (const candidate of candidates) {
    // Conditional transition: if payment confirmed in the gap between the
    // query and this update, the webhook already moved it to `confirmed` and
    // this match fails — so a paid booking is never expired out from under it.
    const booking = await Booking.findOneAndUpdate(
      { _id: candidate._id, status: 'pending', expiresAt: { $ne: null, $lte: now } },
      { status: 'expired', cancelReason: 'payment_not_completed', expiresAt: null },
      { new: true }
    );
    if (!booking) continue;

    await releaseSlot({ resourceId: booking.resourceId, slotStart: booking.slotStart });
    expired += 1;

    if (booking.stripePaymentIntentId) {
      // Stop the abandoned intent from being paid after the seat is resold.
      try {
        await cancelPaymentIntent(booking.stripePaymentIntentId);
      } catch (err) {
        // Non-fatal: the succeeded-webhook path refunds a late payment on an
        // expired booking, so this is belt-and-braces rather than the guard.
        console.warn(
          `Could not cancel payment intent for expired booking ${booking._id}: ${err.message}`
        );
      }
    }

    await notifyExpired(booking);
  }

  return { expired, scanned: candidates.length };
}

/** Moves finished bookings out of `confirmed` so reporting can tell them apart. */
async function completePastBookings(now = new Date()) {
  const result = await Booking.updateMany(
    { status: 'confirmed', slotEnd: { $lt: now } },
    { status: 'completed' }
  );
  return { completed: result.modifiedCount };
}

/** Same purpose as expirePendingBookings, for locker rentals: releases a unit held by checkout that was never completed. */
async function expirePendingLockerBookings(now = new Date()) {
  const candidates = await LockerBooking.find({
    status: 'pending',
    expiresAt: { $ne: null, $lte: now },
  }).limit(BATCH_SIZE);

  let expired = 0;
  for (const candidate of candidates) {
    const booking = await LockerBooking.findOneAndUpdate(
      { _id: candidate._id, status: 'pending', expiresAt: { $ne: null, $lte: now } },
      { status: 'expired', cancelReason: 'payment_not_completed', expiresAt: null },
      { new: true }
    );
    if (!booking) continue;

    await releaseUnit({ unitId: booking.unitId });
    expired += 1;

    if (booking.stripePaymentIntentId) {
      try {
        await cancelPaymentIntent(booking.stripePaymentIntentId);
      } catch (err) {
        console.warn(
          `Could not cancel payment intent for expired locker rental ${booking._id}: ${err.message}`
        );
      }
    }

    await notifyLockerExpired(booking);
  }

  return { lockersExpired: expired };
}

/** Moves finished rentals out of `confirmed` so reporting can tell them apart, same as completePastBookings. */
async function completePastLockerRentals(now = new Date()) {
  const result = await LockerBooking.updateMany(
    { status: 'confirmed', rentalEnd: { $lt: now } },
    { status: 'completed' }
  );
  return { lockersCompleted: result.modifiedCount };
}

async function runOnce(now = new Date()) {
  const expiry = await expirePendingBookings(now);
  const completion = await completePastBookings(now);
  const lockerExpiry = await expirePendingLockerBookings(now);
  const lockerCompletion = await completePastLockerRentals(now);
  return { ...expiry, ...completion, ...lockerExpiry, ...lockerCompletion };
}

let timer = null;

/**
 * Runs maintenance on an interval. `unref()` keeps the timer from holding the
 * event loop open, so the process can still exit on its own.
 *
 * Single-process scheduling: with several instances behind a load balancer
 * they would each sweep, which stays correct because every transition is a
 * conditional update, but duplicates the work. A real deployment should move
 * this to one scheduler or take a lock.
 */
function start({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (timer) return timer;
  timer = setInterval(() => {
    runOnce().catch((err) => console.error('Booking maintenance failed:', err));
  }, intervalMs);
  timer.unref();
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function notifyExpired(booking) {
  const [user, resource] = await Promise.all([
    User.findById(booking.userId).select('name email'),
    Resource.findById(booking.resourceId).select('name'),
  ]);
  await notifications.bookingExpired({
    user,
    booking,
    resourceName: resource?.name || 'your booking',
  });
}

async function notifyLockerExpired(booking) {
  const [user, offering] = await Promise.all([
    User.findById(booking.userId).select('name email'),
    LockerOffering.findById(booking.offeringId).select('name'),
  ]);
  await notifications.lockerBookingExpired({
    user,
    booking,
    offeringName: offering?.name || 'your locker rental',
  });
}

module.exports = {
  start,
  stop,
  runOnce,
  expirePendingBookings,
  completePastBookings,
  expirePendingLockerBookings,
  completePastLockerRentals,
};
