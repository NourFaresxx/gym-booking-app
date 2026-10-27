// Manual mock used by `jest.mock('../src/services/notificationService')`.
// Records what would have been sent so tests can assert on notifications
// without a mail server, and keeps the real service's console output out of
// test logs.

const sent = [];

function record(kind) {
  return jest.fn(async (payload) => {
    sent.push({ kind, ...payload });
    return { delivered: true, mocked: true };
  });
}

const send = record('send');
const bookingConfirmed = record('bookingConfirmed');
const bookingCancelled = record('bookingCancelled');
const bookingExpired = record('bookingExpired');
const lockerBookingConfirmed = record('lockerBookingConfirmed');
const lockerBookingCancelled = record('lockerBookingCancelled');
const lockerBookingExpired = record('lockerBookingExpired');

const isSmtpConfigured = jest.fn(() => false);

const ALL_MOCKS = [
  send,
  bookingConfirmed,
  bookingCancelled,
  bookingExpired,
  lockerBookingConfirmed,
  lockerBookingCancelled,
  lockerBookingExpired,
  isSmtpConfigured,
];

function resetNotifications() {
  sent.length = 0;
  for (const fn of ALL_MOCKS) fn.mockClear();
}

/** Everything "sent" so far, optionally filtered by notification kind. */
function sentNotifications(kind) {
  return kind ? sent.filter((entry) => entry.kind === kind) : [...sent];
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
  resetNotifications,
  sentNotifications,
};
