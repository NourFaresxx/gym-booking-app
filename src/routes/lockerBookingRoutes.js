const express = require('express');
const {
  createLockerBooking,
  listMyLockerBookings,
  listAllLockerBookings,
  getLockerBooking,
  cancelLockerBooking,
} = require('../controllers/lockerBookingController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createLockerBookingSchema } = require('../schemas/lockerSchemas');

const router = express.Router();

// All locker-booking routes require a logged-in user — unlike resource
// browsing, there's no anonymous view of "my rentals".
router.use(requireAuth);

/**
 * @openapi
 * /locker-bookings:
 *   post:
 *     tags: [Lockers]
 *     summary: Rent a locker and start payment
 *     description: >
 *       Claims one free unit from the offering's pool for the chosen tier
 *       and returns a Stripe `clientSecret` to complete payment with. The
 *       rental is created as `pending` and becomes `confirmed` only once
 *       Stripe's webhook reports the payment succeeded — same reconciliation
 *       pattern as class bookings. If payment isn't completed before
 *       `expiresAt`, the unit is released automatically.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [offeringId, tier]
 *             properties:
 *               offeringId: { type: string }
 *               tier: { type: string, enum: [day, month, year] }
 *     responses:
 *       201:
 *         description: Unit claimed, payment pending
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 booking: { $ref: '#/components/schemas/LockerBooking' }
 *                 clientSecret: { type: string }
 *                 expiresAt: { type: string, format: date-time }
 *       404: { description: Offering not found }
 *       409: { description: No lockers available right now }
 *       502: { description: Payment provider could not start a payment }
 */
router.post('/', validate(createLockerBookingSchema), createLockerBooking);

/**
 * @openapi
 * /locker-bookings/me:
 *   get:
 *     tags: [Lockers]
 *     summary: List your own locker rentals
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, confirmed, cancelled, expired, completed]
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: A page of your locker rentals
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/LockerBooking' }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 */
router.get('/me', listMyLockerBookings);

/**
 * @openapi
 * /locker-bookings:
 *   get:
 *     tags: [Lockers]
 *     summary: List all locker rentals (staff or admin)
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, confirmed, cancelled, expired, completed]
 *       - in: query
 *         name: offeringId
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200: { description: A page of locker rentals }
 *       403: { description: Requires staff or admin }
 */
router.get('/', requireRole('staff', 'admin'), listAllLockerBookings);

/**
 * @openapi
 * /locker-bookings/{id}:
 *   get:
 *     tags: [Lockers]
 *     summary: Get one locker rental (owner, staff, or admin)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The rental
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/LockerBooking' }
 *       403: { description: Not your rental }
 *       404: { description: Rental not found }
 */
router.get('/:id', getLockerBooking);

/**
 * @openapi
 * /locker-bookings/{id}/cancel:
 *   patch:
 *     tags: [Lockers]
 *     summary: End a locker rental early and release the unit
 *     description: >
 *       Idempotent — cancelling an already-cancelled rental returns it
 *       unchanged. A paid rental is refunded in full (no proration for
 *       unused time); an unpaid one has its payment intent voided.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The cancelled rental
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/LockerBooking' }
 *       403: { description: Not your rental }
 *       404: { description: Rental not found }
 *       409: { description: Already completed }
 */
router.patch('/:id/cancel', cancelLockerBooking);

module.exports = router;
