const mongoose = require('mongoose');

const LOCKER_BOOKING_STATUSES = ['pending', 'confirmed', 'cancelled', 'expired', 'completed'];
const PAYMENT_STATUSES = ['unpaid', 'paid', 'refunded'];

// A customer's rental of one locker unit for a fixed tier length. Mirrors
// Booking's shape and lifecycle closely (same statuses, same pending-holds-
// capacity-until-paid-or-expired design) but is kept as its own model rather
// than bolted onto Booking — a rental spans a date range on one specific
// unit, not a point-in-time slot on a resource, and forcing both shapes into
// one schema would mean every Booking query carrying fields that only make
// sense for one kind or the other.
const lockerBookingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    offeringId: { type: mongoose.Schema.Types.ObjectId, ref: 'LockerOffering', required: true },
    unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'LockerUnit', required: true },

    tier: { type: String, enum: ['day', 'month', 'year'], required: true },
    rentalStart: { type: Date, required: true },
    rentalEnd: { type: Date, required: true },

    status: { type: String, enum: LOCKER_BOOKING_STATUSES, default: 'pending' },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'unpaid' },

    // Captured at booking time, same reasoning as Booking.amount — a later
    // price change on the offering shouldn't rewrite history.
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'usd', lowercase: true },

    stripePaymentIntentId: { type: String, default: null },
    stripeRefundId: { type: String, default: null },

    expiresAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
  },
  { timestamps: true }
);

// "My rentals, newest first".
lockerBookingSchema.index({ userId: 1, createdAt: -1 });
// The expiry sweeper's query: pending rentals past their payment deadline.
lockerBookingSchema.index({ status: 1, expiresAt: 1 });
// The completion sweeper's query: confirmed rentals whose term has ended.
lockerBookingSchema.index({ status: 1, rentalEnd: 1 });
// Webhook lookups by payment intent.
lockerBookingSchema.index({ stripePaymentIntentId: 1 }, { sparse: true });

const LockerBooking = mongoose.model('LockerBooking', lockerBookingSchema);
LockerBooking.STATUSES = LOCKER_BOOKING_STATUSES;
LockerBooking.PAYMENT_STATUSES = PAYMENT_STATUSES;
LockerBooking.ACTIVE_STATUSES = ['pending', 'confirmed', 'completed'];

module.exports = LockerBooking;
