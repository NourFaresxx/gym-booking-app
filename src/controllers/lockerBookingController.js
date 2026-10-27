const mongoose = require('mongoose');
const LockerBooking = require('../models/LockerBooking');
const LockerOffering = require('../models/LockerOffering');
const LockerUnit = require('../models/LockerUnit');
const User = require('../models/User');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { claimUnit, attachBooking, releaseUnit, addTierDuration } = require('../services/lockerService');
const notifications = require('../services/notificationService');
const {
  createPaymentIntent,
  cancelPaymentIntent,
  refundPaymentIntent,
} = require('../services/paymentService');

const PENDING_TTL_MINUTES = Number(process.env.PENDING_BOOKING_TTL_MINUTES || 15);

/**
 * Rents one locker unit from an offering's pool for a chosen tier.
 *
 * Capacity safety works the same way booking a class does — a single atomic
 * conditional update (claimUnit) is what actually prevents two rentals
 * landing on the same unit; the transaction around it only keeps the unit
 * claim and the LockerBooking record consistent with each other. See
 * lockerService.claimUnit and bookingController.createBooking for the fuller
 * version of this reasoning.
 */
const createLockerBooking = asyncHandler(async (req, res) => {
  const { offeringId, tier } = req.body;

  const offering = await LockerOffering.findById(offeringId);
  if (!offering || !offering.isActive) throw new ApiError(404, 'Locker offering not found');

  const rentalStart = new Date();
  const rentalEnd = addTierDuration(rentalStart, tier);
  const amount = offering.pricing[tier];

  const session = await mongoose.startSession();
  let booking;
  try {
    await session.withTransaction(async () => {
      const unit = await claimUnit({ offeringId, until: rentalEnd, session });
      if (!unit) throw new ApiError(409, 'No lockers are available right now');

      const [created] = await LockerBooking.create(
        [
          {
            userId: req.user.id,
            offeringId,
            unitId: unit._id,
            tier,
            rentalStart,
            rentalEnd,
            status: 'pending',
            amount,
            currency: offering.currency || 'usd',
            expiresAt: new Date(Date.now() + PENDING_TTL_MINUTES * 60_000),
          },
        ],
        { session }
      );
      booking = created;

      await attachBooking({ unitId: unit._id, bookingId: booking._id, session });
    });
  } finally {
    await session.endSession();
  }

  // Same pattern as class bookings: committed first, reconciled by webhook.
  // If the payment intent can't even be created, undo the claim by hand
  // rather than leaving a unit held by a rental that can never be paid.
  let paymentIntent;
  try {
    paymentIntent = await createPaymentIntent({
      amount: booking.amount,
      currency: booking.currency,
      metadata: {
        bookingId: booking._id.toString(),
        bookingType: 'locker',
        userId: req.user.id,
      },
      idempotencyKey: `locker_booking_${booking._id}`,
    });
  } catch (err) {
    await LockerBooking.findByIdAndUpdate(booking._id, {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: 'payment_setup_failed',
      expiresAt: null,
    });
    await releaseUnit({ unitId: booking.unitId });
    throw new ApiError(502, `Could not start payment for this rental: ${err.message}`);
  }

  booking.stripePaymentIntentId = paymentIntent.id;
  await booking.save();

  res.status(201).json({
    booking,
    clientSecret: paymentIntent.client_secret,
    expiresAt: booking.expiresAt,
  });
});

const listMyLockerBookings = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

  const filter = { userId: req.user.id };
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    LockerBooking.find(filter)
      .populate('offeringId', 'name')
      .populate('unitId', 'label')
      .sort('-createdAt')
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    LockerBooking.countDocuments(filter),
  ]);

  res.json({
    items,
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

const listAllLockerBookings = asyncHandler(async (req, res) => {
  const { status, offeringId, page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

  const filter = {};
  if (status) filter.status = status;
  if (offeringId) {
    if (!mongoose.isValidObjectId(offeringId)) throw new ApiError(400, 'Invalid offeringId');
    filter.offeringId = offeringId;
  }

  const [items, total] = await Promise.all([
    LockerBooking.find(filter)
      .populate('userId', 'name email')
      .populate('offeringId', 'name')
      .populate('unitId', 'label')
      .sort('-createdAt')
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    LockerBooking.countDocuments(filter),
  ]);

  res.json({
    items,
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

const getLockerBooking = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Locker rental not found');

  const booking = await LockerBooking.findById(req.params.id)
    .populate('offeringId', 'name')
    .populate('unitId', 'label');
  if (!booking) throw new ApiError(404, 'Locker rental not found');
  if (!canManage(booking, req.user)) throw new ApiError(403, 'Not allowed to view this rental');

  res.json(booking);
});

const cancelLockerBooking = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Locker rental not found');

  const existing = await LockerBooking.findById(req.params.id);
  if (!existing) throw new ApiError(404, 'Locker rental not found');
  if (!canManage(existing, req.user)) throw new ApiError(403, 'Not allowed to cancel this rental');

  if (['cancelled', 'expired'].includes(existing.status)) return res.json(existing);
  if (existing.status === 'completed') {
    throw new ApiError(409, 'This rental has already ended');
  }

  // Conditional transition keeps a double-click or a race with the expiry
  // sweeper from releasing the unit twice.
  const booking = await LockerBooking.findOneAndUpdate(
    { _id: existing._id, status: { $in: ['pending', 'confirmed'] } },
    {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason:
        ['staff', 'admin'].includes(req.user.role) && existing.userId.toString() !== req.user.id
          ? 'staff_cancelled'
          : 'user_cancelled',
      expiresAt: null,
    },
    { new: true }
  );
  if (!booking) {
    return res.json(await LockerBooking.findById(existing._id));
  }

  await releaseUnit({ unitId: booking.unitId });

  const refunded = await settlePaymentForCancellation(booking);
  await notifyCancelled(booking, refunded);

  res.json(booking);
});

/** Same tradeoff as the class-booking equivalent: logs rather than throws, since the cancellation has already committed. */
async function settlePaymentForCancellation(booking) {
  if (!booking.stripePaymentIntentId) return false;

  try {
    if (booking.paymentStatus === 'paid') {
      const refund = await refundPaymentIntent({
        paymentIntentId: booking.stripePaymentIntentId,
        idempotencyKey: `locker_refund_${booking._id}`,
      });
      await LockerBooking.findByIdAndUpdate(booking._id, {
        paymentStatus: 'refunded',
        stripeRefundId: refund.id,
      });
      booking.paymentStatus = 'refunded';
      return true;
    }
    await cancelPaymentIntent(booking.stripePaymentIntentId);
  } catch (err) {
    console.error(
      `Payment settlement failed for cancelled locker rental ${booking._id}: ${err.message}`
    );
  }
  return false;
}

async function notifyCancelled(booking, refunded) {
  const [user, offering, unit] = await Promise.all([
    User.findById(booking.userId).select('name email'),
    LockerOffering.findById(booking.offeringId).select('name'),
    LockerUnit.findById(booking.unitId).select('label'),
  ]);
  await notifications.lockerBookingCancelled({
    user,
    booking,
    offeringName: offering?.name || 'your locker rental',
    unitLabel: unit?.label,
    refunded,
  });
}

function canManage(booking, user) {
  return booking.userId.toString() === user.id || ['staff', 'admin'].includes(user.role);
}

module.exports = {
  createLockerBooking,
  listMyLockerBookings,
  listAllLockerBookings,
  getLockerBooking,
  cancelLockerBooking,
};
