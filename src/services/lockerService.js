const LockerUnit = require('../models/LockerUnit');

/**
 * Claims one free unit from an offering's pool, or returns null if every
 * unit is currently occupied.
 *
 * This is the concurrency-safety primitive for the whole locker feature,
 * playing the same role slotService.reserveSlot plays for classes: a single
 * atomic conditional update on one document, which is what MongoDB actually
 * guarantees can't race — not a transaction, and not a "count free units,
 * then pick one" read-then-write (two concurrent requests could both read
 * the same free unit before either claims it).
 *
 * The condition is a date instead of a counter because a rental occupies a
 * *span*, not an instant: "is this unit free" means "is occupiedUntil in the
 * past (or unset)", not "is some count below a limit". `findOneAndUpdate`
 * matches and updates whichever one qualifying document MongoDB finds first
 * in a single atomic step — if two requests race for the last free unit,
 * only one update actually matches it; the other gets null and (in the
 * caller) tries again or reports no availability.
 */
async function claimUnit({ offeringId, until, session, now = new Date() }) {
  return LockerUnit.findOneAndUpdate(
    {
      offeringId,
      $or: [{ occupiedUntil: null }, { occupiedUntil: { $lte: now } }],
    },
    { $set: { occupiedUntil: until } },
    { new: true, session, sort: { _id: 1 } }
  );
}

/** Attaches the booking that claimed a unit — purely informational, see LockerUnit.currentBookingId. */
async function attachBooking({ unitId, bookingId, session }) {
  await LockerUnit.updateOne({ _id: unitId }, { $set: { currentBookingId: bookingId } }, { session });
}

/**
 * Frees a unit immediately (cancellation / early termination). Natural
 * expiry needs no equivalent call — claimUnit's own `occupiedUntil <= now`
 * condition already treats a lapsed rental as free without anything having
 * to reset it.
 */
async function releaseUnit({ unitId, session }) {
  await LockerUnit.updateOne(
    { _id: unitId },
    { $set: { occupiedUntil: null, currentBookingId: null } },
    { session }
  );
}

/**
 * Tops up an offering's unit pool to `capacity`. Never removes units: if an
 * admin lowers capacity below the number of units that already exist (some
 * possibly mid-rental), the extra units are simply left in the pool rather
 * than deleted or orphaning an active booking — real capacity stays at or
 * above what's advertised, never below it.
 */
async function ensureUnits({ offeringId, capacity, session }) {
  const query = LockerUnit.countDocuments({ offeringId });
  if (session) query.session(session);
  const existing = await query;
  if (existing >= capacity) return { created: 0 };

  const toCreate = [];
  for (let i = existing + 1; i <= capacity; i += 1) {
    toCreate.push({ offeringId, label: `Locker ${String(i).padStart(2, '0')}` });
  }
  await LockerUnit.insertMany(toCreate, { session });
  return { created: toCreate.length };
}

/** How many units in an offering are free right now — for display, not for the claim decision itself. */
async function countAvailable({ offeringId, now = new Date() }) {
  return LockerUnit.countDocuments({
    offeringId,
    $or: [{ occupiedUntil: null }, { occupiedUntil: { $lte: now } }],
  });
}

/**
 * Adds one tier's length to `from`, calendar-aware. Plain millisecond math
 * works for 'day' but is simply wrong for 'month' and 'year' — months and
 * years aren't a fixed number of milliseconds, and shortchanging February or
 * a leap year by using a flat 30/365-day approximation is the kind of bug
 * that only shows up as a customer complaint months later.
 */
function addTierDuration(from, tier) {
  const result = new Date(from);
  switch (tier) {
    case 'day':
      result.setUTCDate(result.getUTCDate() + 1);
      break;
    case 'month':
      result.setUTCMonth(result.getUTCMonth() + 1);
      break;
    case 'year':
      result.setUTCFullYear(result.getUTCFullYear() + 1);
      break;
    default:
      throw new Error(`Unknown locker tier: ${tier}`);
  }
  return result;
}

module.exports = {
  claimUnit,
  attachBooking,
  releaseUnit,
  ensureUnits,
  countAvailable,
  addTierDuration,
};
