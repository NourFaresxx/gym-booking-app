// Registers every model in one place. Importing this guarantees all schemas
// (and so all index definitions) are known to mongoose before anything tries
// to build or sync indexes.
module.exports = {
  User: require('./User'),
  Resource: require('./Resource'),
  Trainer: require('./Trainer'),
  Booking: require('./Booking'),
  BookingSlot: require('./BookingSlot'),
  LockerOffering: require('./LockerOffering'),
  LockerUnit: require('./LockerUnit'),
  LockerBooking: require('./LockerBooking'),
  WebhookEvent: require('./WebhookEvent'),
};
