// Booking notifications. Sends real email when SMTP is configured and
// otherwise logs the message, so local development and tests need no mail
// server and no credentials.
//
// Every send is wrapped so a mail failure can never fail the HTTP request
// that triggered it — a confirmed booking with an undelivered receipt is a
// far better outcome than a 500 on a booking that actually succeeded.

let transportPromise;

function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

async function getTransport() {
  if (!transportPromise) {
    transportPromise = (async () => {
      // Required lazily so the dependency is only loaded when actually used.
      const nodemailer = require('nodemailer');
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || '') === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
          : undefined,
      });
    })();
  }
  return transportPromise;
}

async function send({ to, subject, text }) {
  if (!to) return { delivered: false, reason: 'no recipient' };

  if (!isSmtpConfigured()) {
    console.log(`[mail:skipped] to=${to} subject="${subject}"`);
    return { delivered: false, reason: 'smtp not configured' };
  }

  try {
    const transport = await getTransport();
    await transport.sendMail({ from: process.env.MAIL_FROM, to, subject, text });
    return { delivered: true };
  } catch (err) {
    console.error(`[mail:failed] to=${to} subject="${subject}": ${err.message}`);
    return { delivered: false, reason: err.message };
  }
}

function formatMoney(amount, currency = 'usd') {
  return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

function formatSlot(booking) {
  return `${new Date(booking.slotStart).toUTCString()} – ${new Date(booking.slotEnd).toUTCString()}`;
}

function bookingConfirmed({ user, booking, resourceName }) {
  return send({
    to: user?.email,
    subject: `Booking confirmed: ${resourceName}`,
    text: [
      `Hi ${user?.name || 'there'},`,
      '',
      `Your booking for ${resourceName} is confirmed.`,
      `When: ${formatSlot(booking)}`,
      `Paid: ${formatMoney(booking.amount, booking.currency)}`,
      '',
      `Booking reference: ${booking._id}`,
    ].join('\n'),
  });
}

function bookingCancelled({ user, booking, resourceName, refunded }) {
  return send({
    to: user?.email,
    subject: `Booking cancelled: ${resourceName}`,
    text: [
      `Hi ${user?.name || 'there'},`,
      '',
      `Your booking for ${resourceName} on ${formatSlot(booking)} has been cancelled.`,
      refunded
        ? `A refund of ${formatMoney(booking.amount, booking.currency)} is on its way back to your original payment method.`
        : 'No payment was captured, so there is nothing to refund.',
      '',
      `Booking reference: ${booking._id}`,
    ].join('\n'),
  });
}

function bookingExpired({ user, booking, resourceName }) {
  return send({
    to: user?.email,
    subject: `Booking expired: ${resourceName}`,
    text: [
      `Hi ${user?.name || 'there'},`,
      '',
      `We held your ${resourceName} slot on ${formatSlot(booking)} but payment wasn't completed in time, so it's been released.`,
      'You can book again if the slot is still open.',
      '',
      `Booking reference: ${booking._id}`,
    ].join('\n'),
  });
}

function formatRentalPeriod(booking) {
  return `${new Date(booking.rentalStart).toUTCString()} – ${new Date(booking.rentalEnd).toUTCString()}`;
}

function lockerBookingConfirmed({ user, booking, offeringName, unitLabel }) {
  return send({
    to: user?.email,
    subject: `Locker rental confirmed: ${offeringName}`,
    text: [
      `Hi ${user?.name || 'there'},`,
      '',
      `Your ${booking.tier}ly rental of ${offeringName} is confirmed.`,
      unitLabel ? `Your locker: ${unitLabel}` : null,
      `Rental period: ${formatRentalPeriod(booking)}`,
      `Paid: ${formatMoney(booking.amount, booking.currency)}`,
      '',
      `Booking reference: ${booking._id}`,
    ]
      .filter((line) => line !== null)
      .join('\n'),
  });
}

function lockerBookingCancelled({ user, booking, offeringName, unitLabel, refunded }) {
  return send({
    to: user?.email,
    subject: `Locker rental cancelled: ${offeringName}`,
    text: [
      `Hi ${user?.name || 'there'},`,
      '',
      `Your rental of ${offeringName}${unitLabel ? ` (${unitLabel})` : ''} has been cancelled.`,
      refunded
        ? `A refund of ${formatMoney(booking.amount, booking.currency)} is on its way back to your original payment method.`
        : 'No payment was captured, so there is nothing to refund.',
      '',
      `Booking reference: ${booking._id}`,
    ].join('\n'),
  });
}

function lockerBookingExpired({ user, booking, offeringName }) {
  return send({
    to: user?.email,
    subject: `Locker hold expired: ${offeringName}`,
    text: [
      `Hi ${user?.name || 'there'},`,
      '',
      `We held a locker from ${offeringName} but payment wasn't completed in time, so it's been released.`,
      'You can rent again if lockers are still available.',
      '',
      `Booking reference: ${booking._id}`,
    ].join('\n'),
  });
}

module.exports = {
  send,
  isSmtpConfigured,
  bookingConfirmed,
  bookingCancelled,
  bookingExpired,
  lockerBookingConfirmed,
  lockerBookingCancelled,
  lockerBookingExpired,
};
