const mongoose = require('mongoose');
const LockerOffering = require('../models/LockerOffering');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { ensureUnits, countAvailable } = require('../services/lockerService');

const listOfferings = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;

  const canSeeInactive = req.query.includeInactive === 'true' && isStaffOrAdmin(req.user);
  const filter = canSeeInactive ? {} : { isActive: true };

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

  const [items, total] = await Promise.all([
    LockerOffering.find(filter)
      .sort('-createdAt')
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    LockerOffering.countDocuments(filter),
  ]);

  const withAvailability = await Promise.all(
    items.map(async (offering) => ({
      ...offering.toObject(),
      availableNow: await countAvailable({ offeringId: offering._id }),
    }))
  );

  res.json({
    items: withAvailability,
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

const getOffering = asyncHandler(async (req, res) => {
  const offering = await findOfferingOr404(req.params.id);
  const availableNow = await countAvailable({ offeringId: offering._id });
  res.json({ ...offering.toObject(), availableNow });
});

const createOffering = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  let offering;
  try {
    await session.withTransaction(async () => {
      const [created] = await LockerOffering.create(
        [{ ...req.body, ownerId: req.user.id }],
        { session }
      );
      offering = created;
      await ensureUnits({ offeringId: offering._id, capacity: offering.capacity, session });
    });
  } finally {
    await session.endSession();
  }
  res.status(201).json(offering);
});

const updateOffering = asyncHandler(async (req, res) => {
  const offering = await findOfferingOr404(req.params.id);
  assertCanManage(offering, req.user);

  Object.assign(offering, req.body);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await offering.save({ session });
      // A higher capacity provisions new units immediately so they're
      // bookable right away; a lower one is handled entirely by
      // ensureUnits's own no-op-if-already-enough check (see its comment on
      // why it never removes units).
      await ensureUnits({ offeringId: offering._id, capacity: offering.capacity, session });
    });
  } finally {
    await session.endSession();
  }

  res.json(offering);
});

const deleteOffering = asyncHandler(async (req, res) => {
  const offering = await findOfferingOr404(req.params.id);
  assertCanManage(offering, req.user);

  // Soft delete, same reasoning as Resource: existing rentals and their
  // history stay intact, the offering just stops appearing for new rentals.
  offering.isActive = false;
  await offering.save();
  res.status(204).send();
});

async function findOfferingOr404(id) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Locker offering not found');
  const offering = await LockerOffering.findById(id);
  if (!offering) throw new ApiError(404, 'Locker offering not found');
  return offering;
}

function isStaffOrAdmin(user) {
  return Boolean(user) && ['staff', 'admin'].includes(user.role);
}

/** Staff manage only what they own; admins manage everything. */
function assertCanManage(offering, user) {
  if (user.role === 'admin') return;
  if (offering.ownerId.toString() !== user.id) {
    throw new ApiError(403, 'You can only modify locker offerings you own');
  }
}

module.exports = { listOfferings, getOffering, createOffering, updateOffering, deleteOffering };
