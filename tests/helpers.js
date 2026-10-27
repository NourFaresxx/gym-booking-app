const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const User = require('../src/models/User');
const Resource = require('../src/models/Resource');
const Trainer = require('../src/models/Trainer');
const LockerOffering = require('../src/models/LockerOffering');
const { ensureUnits } = require('../src/services/lockerService');
const { signAccessToken } = require('../src/utils/tokens');

let uniqueCounter = 0;

function uniqueEmail(prefix = 'user') {
  uniqueCounter += 1;
  return `${prefix}-${Date.now()}-${uniqueCounter}@test.local`;
}

/** Creates a user directly in the database and returns them with a usable token. */
async function makeUser({ role = 'customer', password = 'password123', name = 'Test User' } = {}) {
  const email = uniqueEmail(role);
  const user = await User.create({
    name,
    email,
    // Cost 4 rather than the production 12: these hashes are created on almost
    // every test and bcrypt cost is deliberately expensive.
    passwordHash: await bcrypt.hash(password, 4),
    role,
  });
  return { user, email, password, token: signAccessToken(user) };
}

async function makeResource({ ownerId, ...overrides } = {}) {
  const owner = ownerId || (await makeUser({ role: 'staff' })).user._id;
  return Resource.create({
    name: 'Morning Yoga',
    description: 'A gentle start to the day',
    capacity: 3,
    price: 2500,
    currency: 'usd',
    durationMinutes: 60,
    ownerId: owner,
    ...overrides,
  });
}

async function makeTrainer(overrides = {}) {
  return Trainer.create({
    name: 'Test Trainer',
    title: 'Certified Instructor',
    bio: 'A trainer created for tests, with a bio long enough to pass validation.',
    specialties: ['Testing'],
    yearsExperience: 5,
    ...overrides,
  });
}

/** Creates a locker offering and provisions its units, ready to rent. */
async function makeLockerOffering({ ownerId, capacity = 3, ...overrides } = {}) {
  const owner = ownerId || (await makeUser({ role: 'staff' })).user._id;
  const offering = await LockerOffering.create({
    name: 'Storage Lockers',
    description: 'A locker offering created for tests.',
    capacity,
    pricing: { day: 500, month: 4000, year: 35000 },
    currency: 'usd',
    ownerId: owner,
    ...overrides,
  });
  await ensureUnits({ offeringId: offering._id, capacity: offering.capacity });
  return offering;
}

/** An agent with the Authorization header pre-applied. */
function as(token) {
  const authed = (method) => (url) =>
    request(app)[method](url).set('Authorization', `Bearer ${token}`);
  return {
    get: authed('get'),
    post: authed('post'),
    patch: authed('patch'),
    put: authed('put'),
    delete: authed('delete'),
  };
}

/** An ISO timestamp on the next occurrence of a UTC hour, `days` ahead. */
function futureSlot({ days = 2, hourUtc = 10 } = {}) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date;
}

module.exports = {
  app,
  request,
  makeUser,
  makeResource,
  makeTrainer,
  makeLockerOffering,
  as,
  futureSlot,
  uniqueEmail,
};
