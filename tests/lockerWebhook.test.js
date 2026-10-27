jest.mock('../src/services/paymentService');
jest.mock('../src/services/notificationService');

const { app, request, makeUser, makeLockerOffering, as } = require('./helpers');
const LockerBooking = require('../src/models/LockerBooking');
const LockerUnit = require('../src/models/LockerUnit');
const WebhookEvent = require('../src/models/WebhookEvent');
const payments = require('../src/services/paymentService');
const notifications = require('../src/services/notificationService');

beforeEach(() => {
  payments.resetPaymentMocks();
  notifications.resetNotifications();
});

let eventCounter = 0;

function lockerIntentEvent(type, intent, { eventId } = {}) {
  eventCounter += 1;
  return {
    id: eventId || `evt_locker_test_${eventCounter}`,
    type,
    data: { object: { object: 'payment_intent', ...intent } },
  };
}

function postWebhook(event) {
  return request(app)
    .post('/api/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', 't=1,v1=fake')
    .send(JSON.stringify(event));
}

async function pendingRental({ capacity = 2, tier = 'month' } = {}) {
  const offering = await makeLockerOffering({ capacity });
  const customer = await makeUser();

  const res = await as(customer.token)
    .post('/api/locker-bookings')
    .send({ offeringId: offering._id.toString(), tier });

  expect(res.status).toBe(201);
  return {
    offering,
    customer,
    booking: res.body.booking,
    intentId: res.body.booking.stripePaymentIntentId,
  };
}

function unitOccupied(unitId) {
  return LockerUnit.findById(unitId).then((u) => Boolean(u.occupiedUntil && u.occupiedUntil > new Date()));
}

describe('payment_intent.succeeded (locker)', () => {
  it('confirms the rental and marks it paid', async () => {
    const { booking, intentId } = await pendingRental();

    const res = await postWebhook(
      lockerIntentEvent('payment_intent.succeeded', {
        id: intentId,
        metadata: { bookingId: booking._id, bookingType: 'locker' },
      })
    );

    expect(res.status).toBe(200);
    const stored = await LockerBooking.findById(booking._id);
    expect(stored.status).toBe('confirmed');
    expect(stored.paymentStatus).toBe('paid');
    expect(stored.expiresAt).toBeNull();
    expect(notifications.lockerBookingConfirmed).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a replayed event without acting twice', async () => {
    const { booking, intentId } = await pendingRental();
    const event = lockerIntentEvent('payment_intent.succeeded', {
      id: intentId,
      metadata: { bookingId: booking._id, bookingType: 'locker' },
    });

    await postWebhook(event).expect(200);
    const replay = await postWebhook(event);

    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(notifications.lockerBookingConfirmed).toHaveBeenCalledTimes(1);
  });

  it('refunds a payment that lands after the rental has already expired', async () => {
    const { booking, intentId } = await pendingRental({ capacity: 1 });
    await LockerBooking.findByIdAndUpdate(booking._id, { status: 'expired', expiresAt: null });

    const res = await postWebhook(
      lockerIntentEvent('payment_intent.succeeded', {
        id: intentId,
        metadata: { bookingId: booking._id, bookingType: 'locker' },
      })
    );

    expect(res.status).toBe(200);
    expect(payments.refundPaymentIntent).toHaveBeenCalledTimes(1);
    const stored = await LockerBooking.findById(booking._id);
    expect(stored.status).toBe('expired');
    expect(stored.paymentStatus).toBe('refunded');
  });
});

describe('payment_intent.payment_failed (locker)', () => {
  it('cancels the rental and releases the unit', async () => {
    const { booking, intentId } = await pendingRental({ capacity: 1 });
    expect(await unitOccupied(booking.unitId)).toBe(true);

    const res = await postWebhook(
      lockerIntentEvent('payment_intent.payment_failed', {
        id: intentId,
        metadata: { bookingId: booking._id, bookingType: 'locker' },
      })
    );

    expect(res.status).toBe(200);
    expect((await LockerBooking.findById(booking._id)).status).toBe('cancelled');
    expect(await unitOccupied(booking.unitId)).toBe(false);
  });

  it('lets the freed unit be rented by someone else', async () => {
    const { offering, booking, intentId } = await pendingRental({ capacity: 1 });
    const next = await makeUser();
    const body = { offeringId: offering._id.toString(), tier: 'day' };

    await as(next.token).post('/api/locker-bookings').send(body).expect(409);

    await postWebhook(
      lockerIntentEvent('payment_intent.payment_failed', {
        id: intentId,
        metadata: { bookingId: booking._id, bookingType: 'locker' },
      })
    ).expect(200);

    await as(next.token).post('/api/locker-bookings').send(body).expect(201);
  });

  it('does not release a second unit when the event is redelivered', async () => {
    const { offering, booking, intentId } = await pendingRental({ capacity: 2 });
    const other = await makeUser();

    await as(other.token)
      .post('/api/locker-bookings')
      .send({ offeringId: offering._id.toString(), tier: 'day' })
      .expect(201);

    const failure = lockerIntentEvent('payment_intent.payment_failed', {
      id: intentId,
      metadata: { bookingId: booking._id, bookingType: 'locker' },
    });

    await postWebhook(failure).expect(200);
    await postWebhook({ ...failure, id: 'evt_locker_redelivered' }).expect(200);

    const occupiedCount = await LockerUnit.countDocuments({
      offeringId: offering._id,
      occupiedUntil: { $gt: new Date() },
    });
    expect(occupiedCount).toBe(1);
  });
});

describe('charge.refunded (locker)', () => {
  it('cancels and releases the unit for a refund issued outside the API', async () => {
    const { booking, intentId } = await pendingRental({ capacity: 1 });
    await LockerBooking.findByIdAndUpdate(booking._id, {
      status: 'confirmed',
      paymentStatus: 'paid',
      expiresAt: null,
    });

    const res = await postWebhook({
      id: 'evt_locker_charge_refund',
      type: 'charge.refunded',
      data: { object: { object: 'charge', id: 'ch_locker_test_1', payment_intent: intentId } },
    });

    expect(res.status).toBe(200);
    const stored = await LockerBooking.findById(booking._id);
    expect(stored.paymentStatus).toBe('refunded');
    expect(stored.status).toBe('cancelled');
    expect(await unitOccupied(booking.unitId)).toBe(false);
  });

  it("doesn't interfere with class-booking charge refunds (tried first, unaffected)", async () => {
    // A refund for a payment intent that matches neither collection should
    // just be acknowledged, not throw.
    const res = await postWebhook({
      id: 'evt_charge_refund_unknown',
      type: 'charge.refunded',
      data: { object: { object: 'charge', payment_intent: 'pi_does_not_exist' } },
    });
    expect(res.status).toBe(200);
  });
});

describe('idempotency across types', () => {
  it('500s and drops its dedupe claim so a retry really retries', async () => {
    const { booking, intentId } = await pendingRental();
    notifications.lockerBookingConfirmed.mockRejectedValueOnce(new Error('mail blew up'));

    const event = lockerIntentEvent('payment_intent.succeeded', {
      id: intentId,
      metadata: { bookingId: booking._id, bookingType: 'locker' },
    });

    const failed = await postWebhook(event);
    expect(failed.status).toBe(500);
    expect(await WebhookEvent.countDocuments({ eventId: event.id })).toBe(0);

    const retry = await postWebhook(event);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBeUndefined();
  });
});
