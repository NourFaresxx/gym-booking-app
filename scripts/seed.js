// Populates a database with demo accounts, trainers, and bookable resources
// so the API (and frontend) can be clicked through immediately.
//
// Usage: node scripts/seed.js [--reset]
//   --reset  delete existing users, trainers, resources, bookings and slot
//            counters first
//
// Refuses to run against NODE_ENV=production.

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const {
  User,
  Resource,
  Trainer,
  Booking,
  BookingSlot,
  LockerOffering,
  LockerUnit,
  LockerBooking,
} = require('../src/models');
const { ensureUnits } = require('../src/services/lockerService');

const PASSWORD = 'password123';

const ACCOUNTS = [
  { name: 'Ada Admin', email: 'admin@example.com', role: 'admin' },
  { name: 'Sam Staff', email: 'staff@example.com', role: 'staff' },
  { name: 'Casey Customer', email: 'customer@example.com', role: 'customer' },
];

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

// Each trainer is keyed by a short id so resources below can reference them
// without a database round trip in between.
const TRAINERS = [
  {
    key: 'sarah',
    name: 'Sarah Chen',
    title: 'Certified Pilates & Mat Instructor',
    bio:
      'Sarah has taught mat and reformer Pilates for over a decade, with a focus ' +
      'on core strength and post-injury rehab. Classes are low-impact and ' +
      'beginner-friendly, with modifications offered for every exercise.',
    specialties: ['Pilates', 'Core Strength', 'Rehab'],
    yearsExperience: 11,
  },
  {
    key: 'marcus',
    name: 'Marcus Webb',
    title: 'CrossFit Level 2 Coach',
    bio:
      'Marcus coaches high-intensity functional fitness, scaling every workout to ' +
      'the athlete in front of him — first-timers and competitive lifters train ' +
      'in the same class without either being short-changed.',
    specialties: ['CrossFit', 'Olympic Lifting', 'Conditioning'],
    yearsExperience: 7,
  },
  {
    key: 'elena',
    name: 'Elena Osei',
    title: 'Contemporary & Hip Hop Dance Instructor',
    bio:
      'Elena trained with dance companies in Accra and New York before moving into ' +
      'teaching. Her classes range from sharp, musical hip hop choreography to ' +
      'flowing contemporary technique — no dance background required, just a ' +
      'willingness to move.',
    specialties: ['Dance', 'Hip Hop', 'Contemporary'],
    yearsExperience: 9,
  },
  {
    key: 'dave',
    name: 'Dave Okafor',
    title: 'Strength & Conditioning Coach',
    bio:
      'Dave runs small-group strength sessions focused on compound lifts and ' +
      'progressive overload. He programs every block himself and checks form on ' +
      'every rep — this is coached gym time, not just open floor access.',
    specialties: ['Strength Training', 'Powerlifting', 'Form Coaching'],
    yearsExperience: 13,
  },
  {
    key: 'priya',
    name: 'Priya Nair',
    title: 'Certified Yoga Instructor (RYT-500)',
    bio:
      'Priya teaches a grounded, breath-led vinyasa practice. Morning classes are ' +
      'gentler and slower-paced — a good entry point if you’re new to yoga or ' +
      'easing into a morning routine.',
    specialties: ['Yoga', 'Vinyasa', 'Breathwork'],
    yearsExperience: 8,
  },
];

// `trainer` references a TRAINERS[].key, resolved to an ObjectId at seed
// time. `category` defaults to 'classes' on the schema, but is written
// explicitly here anyway — the upsert below uses raw $set, which bypasses
// Mongoose's schema defaults (those only apply when a document is
// hydrated/created through the app, not to a server-side query filter
// against the raw stored document).
const RESOURCES = [
  {
    name: 'Morning Yoga',
    description: 'A gentle 60-minute flow to start the day.',
    category: 'classes',
    capacity: 12,
    price: 2500,
    durationMinutes: 60,
    timezone: 'Europe/Berlin',
    trainer: 'priya',
    openingHours: WEEKDAYS.map((dayOfWeek) => ({ dayOfWeek, start: '07:00', end: '10:00' })),
  },
  {
    name: 'Pilates Fundamentals',
    description: 'Mat Pilates focused on core strength and control. All levels welcome.',
    category: 'classes',
    capacity: 10,
    price: 2800,
    durationMinutes: 50,
    timezone: 'Europe/Berlin',
    trainer: 'sarah',
    openingHours: WEEKDAYS.map((dayOfWeek) => ({ dayOfWeek, start: '10:00', end: '13:00' })),
  },
  {
    name: 'CrossFit WOD',
    description: 'Coached workout of the day — scaled for every fitness level.',
    category: 'classes',
    capacity: 14,
    price: 3200,
    durationMinutes: 60,
    timezone: 'Europe/Berlin',
    trainer: 'marcus',
    openingHours: WEEKDAYS.map((dayOfWeek) => ({ dayOfWeek, start: '17:00', end: '20:00' })),
  },
  {
    name: 'Hip Hop Dance',
    description:
      'High-energy choreography set to hip hop beats - no experience needed, just ' +
      'bring energy.',
    category: 'classes',
    capacity: 20,
    price: 2200,
    durationMinutes: 55,
    timezone: 'Europe/Berlin',
    trainer: 'elena',
    openingHours: WEEKEND.map((dayOfWeek) => ({ dayOfWeek, start: '11:00', end: '14:00' })),
  },
  {
    name: 'Contemporary Dance',
    description:
      'A flowing, floor-based class blending technique with free movement - open to ' +
      'all levels.',
    category: 'classes',
    capacity: 16,
    price: 2400,
    durationMinutes: 60,
    timezone: 'Europe/Berlin',
    trainer: 'elena',
    openingHours: WEEKEND.map((dayOfWeek) => ({ dayOfWeek, start: '15:00', end: '17:00' })),
  },
  {
    name: 'Kickboxing',
    description:
      'High-energy pad and bag work with coached technique - a full-body cardio and ' +
      'strength session for all levels.',
    category: 'classes',
    capacity: 8,
    price: 3000,
    durationMinutes: 75,
    timezone: 'Europe/Berlin',
    trainer: 'dave',
    openingHours: WEEKDAYS.map((dayOfWeek) => ({ dayOfWeek, start: '06:00', end: '09:00' })),
  },
  {
    name: 'Spa',
    description:
      'Full access to the pool, steam room, and relaxation lounge for the day.',
    category: 'self-care',
    capacity: 15,
    price: 3500,
    durationMinutes: 90,
    timezone: 'Europe/Berlin',
    trainer: null,
    openingHours: [
      { dayOfWeek: 0, start: '10:00', end: '20:00' },
      { dayOfWeek: 1, start: '10:00', end: '20:00' },
      { dayOfWeek: 2, start: '10:00', end: '20:00' },
      { dayOfWeek: 3, start: '10:00', end: '20:00' },
      { dayOfWeek: 4, start: '10:00', end: '20:00' },
      { dayOfWeek: 5, start: '10:00', end: '20:00' },
      { dayOfWeek: 6, start: '10:00', end: '20:00' },
    ],
  },
  {
    name: 'Sauna',
    description: 'Traditional Finnish sauna session, towels provided.',
    category: 'self-care',
    capacity: 8,
    price: 2000,
    durationMinutes: 45,
    timezone: 'Europe/Berlin',
    trainer: null,
    openingHours: [
      { dayOfWeek: 0, start: '10:00', end: '20:00' },
      { dayOfWeek: 1, start: '10:00', end: '20:00' },
      { dayOfWeek: 2, start: '10:00', end: '20:00' },
      { dayOfWeek: 3, start: '10:00', end: '20:00' },
      { dayOfWeek: 4, start: '10:00', end: '20:00' },
      { dayOfWeek: 5, start: '10:00', end: '20:00' },
      { dayOfWeek: 6, start: '10:00', end: '20:00' },
    ],
  },
  {
    name: 'Massage',
    description: 'One-on-one therapeutic massage with a certified therapist.',
    category: 'self-care',
    capacity: 1,
    price: 6000,
    durationMinutes: 60,
    timezone: 'Europe/Berlin',
    trainer: null,
    openingHours: WEEKDAYS.map((dayOfWeek) => ({ dayOfWeek, start: '09:00', end: '18:00' })),
  },
];

const LOCKER_OFFERINGS = [
  {
    name: 'Storage Lockers',
    description: 'A secure personal locker for your bag, valuables, or gym kit.',
    capacity: 20,
    pricing: { day: 500, month: 4000, year: 35000 },
  },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed a production database.');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to ${mongoose.connection.name}`);

  try {
    if (process.argv.includes('--reset')) {
      await Promise.all([
        User.deleteMany({}),
        Trainer.deleteMany({}),
        Resource.deleteMany({}),
        Booking.deleteMany({}),
        BookingSlot.deleteMany({}),
        LockerOffering.deleteMany({}),
        LockerUnit.deleteMany({}),
        LockerBooking.deleteMany({}),
      ]);
      console.log('Cleared existing data');
    }

    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    const users = {};

    for (const account of ACCOUNTS) {
      // Upsert so re-running the seed doesn't collide on the unique email.
      const user = await User.findOneAndUpdate(
        { email: account.email },
        { $set: { ...account }, $setOnInsert: { passwordHash } },
        { new: true, upsert: true }
      );
      users[account.role] = user;
      console.log(`  user     ${user.email.padEnd(24)} ${user.role}`);
    }

    const trainerIdByKey = {};
    for (const { key, ...definition } of TRAINERS) {
      const trainer = await Trainer.findOneAndUpdate(
        { name: definition.name },
        { $set: { ...definition, isActive: true } },
        { new: true, upsert: true }
      );
      trainerIdByKey[key] = trainer._id;
      console.log(`  trainer  ${trainer.name.padEnd(24)} ${trainer.specialties.join(', ')}`);
    }

    for (const { trainer, ...definition } of RESOURCES) {
      const resource = await Resource.findOneAndUpdate(
        { name: definition.name },
        {
          $set: {
            ...definition,
            ownerId: users.staff._id,
            trainerId: trainer ? trainerIdByKey[trainer] : null,
            isActive: true,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      const schedule =
        resource.openingHours.length === 0
          ? 'any time'
          : `${resource.openingHours.length} weekly window(s)`;
      console.log(
        `  ${resource.category.padEnd(10)}${resource.name.padEnd(24)} cap ${String(resource.capacity).padStart(2)}  ` +
          `${(resource.price / 100).toFixed(2)} ${resource.currency.toUpperCase()}  ${schedule}`
      );
    }

    for (const offering of LOCKER_OFFERINGS) {
      const stored = await LockerOffering.findOneAndUpdate(
        { name: offering.name },
        { $set: { ...offering, ownerId: users.staff._id, isActive: true } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      const { created } = await ensureUnits({ offeringId: stored._id, capacity: stored.capacity });
      console.log(
        `  locker    ${stored.name.padEnd(24)} cap ${String(stored.capacity).padStart(2)}  ` +
          `${(stored.pricing.day / 100).toFixed(2)}/${(stored.pricing.month / 100).toFixed(2)}/` +
          `${(stored.pricing.year / 100).toFixed(2)} ${stored.currency.toUpperCase()}  ` +
          `(${created} unit(s) newly provisioned)`
      );
    }

    console.log(`\nAll seeded accounts use the password: ${PASSWORD}`);
    console.log(
      'Try: GET /api/resources, GET /api/trainers, GET /api/lockers, then GET /api/resources/<id>/availability'
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
