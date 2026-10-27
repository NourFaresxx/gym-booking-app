const mongoose = require('mongoose');

const LOCKER_TIERS = ['day', 'month', 'year'];

// A "product" — e.g. "Storage Lockers" — backed by a pool of interchangeable
// physical units (see LockerUnit). Customers don't pick a specific unit; one
// is assigned automatically from whichever are free. Capacity here is a
// target count of units, not a live count — see lockerService.ensureUnits.
const lockerOfferingSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    capacity: { type: Number, required: true, min: 1 },
    // One price per rental length. All three required — the whole point of
    // this model is offering day/month/year on the same pool of lockers.
    pricing: {
      day: { type: Number, required: true, min: 0 }, // cents
      month: { type: Number, required: true, min: 0 },
      year: { type: Number, required: true, min: 0 },
    },
    currency: { type: String, default: 'usd', lowercase: true, trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

lockerOfferingSchema.index({ isActive: 1, createdAt: -1 });

const LockerOffering = mongoose.model('LockerOffering', lockerOfferingSchema);
LockerOffering.TIERS = LOCKER_TIERS;

module.exports = LockerOffering;
