const mongoose = require('mongoose');

// One physical locker. `occupiedUntil` is the whole concurrency-safety
// mechanism — see lockerService.claimUnit for why this, not a counter, is
// what prevents two rentals overlapping on the same unit.
const lockerUnitSchema = new mongoose.Schema(
  {
    offeringId: { type: mongoose.Schema.Types.ObjectId, ref: 'LockerOffering', required: true },
    label: { type: String, required: true, trim: true },

    // null or in the past = free. In the future = occupied until then.
    // Deliberately not a boolean: a date is what lets a single atomic
    // conditional update ("claim me if I'm free") double as the capacity
    // check, the same role BookingSlot.bookedCount plays for classes — just
    // keyed on "is this instant before a deadline" instead of "is this count
    // under a limit", because a locker rental occupies a *span*, not a point.
    occupiedUntil: { type: Date, default: null },

    // Denormalized pointer to whichever LockerBooking currently holds this
    // unit, purely for admin/support visibility ("who has locker A-03").
    // Not used for any correctness logic — occupiedUntil alone does that.
    currentBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'LockerBooking', default: null },
  },
  { timestamps: true }
);

// The claim query filters on (offeringId, occupiedUntil) together.
lockerUnitSchema.index({ offeringId: 1, occupiedUntil: 1 });
lockerUnitSchema.index({ offeringId: 1, label: 1 }, { unique: true });

module.exports = mongoose.model('LockerUnit', lockerUnitSchema);
