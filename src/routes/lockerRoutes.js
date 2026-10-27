const express = require('express');
const {
  listOfferings,
  getOffering,
  createOffering,
  updateOffering,
  deleteOffering,
} = require('../controllers/lockerController');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createLockerOfferingSchema, updateLockerOfferingSchema } = require('../schemas/lockerSchemas');

const router = express.Router();

/**
 * @openapi
 * /lockers:
 *   get:
 *     tags: [Lockers]
 *     summary: List active locker offerings
 *     security: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *       - in: query
 *         name: includeInactive
 *         schema: { type: boolean, default: false }
 *         description: Include deactivated offerings too. Staff/admin only; ignored otherwise.
 *     responses:
 *       200:
 *         description: A page of locker offerings, each with a live availableNow count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/LockerOffering' }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 */
router.get('/', optionalAuth, listOfferings);

/**
 * @openapi
 * /lockers/{id}:
 *   get:
 *     tags: [Lockers]
 *     summary: Get one locker offering, with how many units are free right now
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The offering
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/LockerOffering' }
 *       404: { description: Offering not found }
 */
router.get('/:id', getOffering);

/**
 * @openapi
 * /lockers:
 *   post:
 *     tags: [Lockers]
 *     summary: Create a locker offering (staff or admin)
 *     description: >
 *       Creating (or later raising) `capacity` provisions that many physical
 *       locker units immediately, so they're bookable right away.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/LockerOfferingInput' }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/LockerOffering' }
 *       403: { description: Requires staff or admin }
 */
router.post(
  '/',
  requireAuth,
  requireRole('staff', 'admin'),
  validate(createLockerOfferingSchema),
  createOffering
);

/**
 * @openapi
 * /lockers/{id}:
 *   patch:
 *     tags: [Lockers]
 *     summary: Update a locker offering you own (admins may update any)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/LockerOfferingInput' }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/LockerOffering' }
 *       403: { description: Not the owner }
 *       404: { description: Offering not found }
 */
router.patch(
  '/:id',
  requireAuth,
  requireRole('staff', 'admin'),
  validate(updateLockerOfferingSchema),
  updateOffering
);

/**
 * @openapi
 * /lockers/{id}:
 *   delete:
 *     tags: [Lockers]
 *     summary: Deactivate a locker offering you own (admins may deactivate any)
 *     description: >
 *       Soft delete — units and any in-progress rentals are untouched; the
 *       offering just stops appearing for new rentals.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204: { description: Deactivated }
 *       403: { description: Not the owner }
 *       404: { description: Offering not found }
 */
router.delete('/:id', requireAuth, requireRole('staff', 'admin'), deleteOffering);

module.exports = router;
