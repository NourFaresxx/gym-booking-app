const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Rehab Sporting Club Gym API',
      version: '1.1.0',
      description: [
        'REST API for booking time-limited resources, with JWT auth, role-based',
        'access, Stripe payments and overbooking-safe capacity handling.',
        '',
        'All money values are integers in the minor currency unit (cents).',
      ].join('\n'),
    },
    servers: [{ url: '/api' }],
    tags: [
      { name: 'Auth', description: 'Registration, login and token rotation' },
      { name: 'Resources', description: 'Bookable resources and their availability' },
      { name: 'Trainers', description: 'Trainer profiles and the classes they teach' },
      { name: 'Bookings', description: 'Creating, listing and cancelling bookings' },
      { name: 'Lockers', description: 'Locker offerings and day/month/year rentals' },
      { name: 'Analytics', description: 'Booking and revenue reporting' },
      { name: 'Webhooks', description: 'Stripe event receiver' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 42 },
            pages: { type: 'integer', example: 3 },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Resource not found' },
            details: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string', example: 'price' },
                  message: { type: 'string', example: 'Expected number, received string' },
                },
              },
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string', example: 'Nour Fares' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['admin', 'staff', 'customer'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        AuthResponse: {
          type: 'object',
          properties: {
            user: { $ref: '#/components/schemas/User' },
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
          },
        },
        OpeningHour: {
          type: 'object',
          required: ['dayOfWeek', 'start', 'end'],
          properties: {
            dayOfWeek: { type: 'integer', minimum: 0, maximum: 6, description: '0 = Sunday' },
            start: { type: 'string', example: '09:00' },
            end: { type: 'string', example: '17:00' },
          },
        },
        ResourceInput: {
          type: 'object',
          required: ['name', 'capacity', 'price', 'durationMinutes'],
          properties: {
            name: { type: 'string', example: 'Morning Yoga' },
            description: { type: 'string' },
            category: {
              type: 'string',
              enum: ['classes', 'self-care'],
              default: 'classes',
              description: 'Which browse page this shows up on',
            },
            capacity: { type: 'integer', minimum: 1, example: 12 },
            price: { type: 'integer', minimum: 0, description: 'Cents', example: 2500 },
            currency: { type: 'string', example: 'usd' },
            durationMinutes: { type: 'integer', minimum: 5, example: 60 },
            openingHours: {
              type: 'array',
              items: { $ref: '#/components/schemas/OpeningHour' },
              description: 'Recurring weekly windows; empty means open 24/7',
            },
            timezone: { type: 'string', example: 'Europe/Berlin' },
            isActive: { type: 'boolean' },
            trainerId: {
              type: 'string',
              nullable: true,
              description: 'Who teaches this class, if anyone',
            },
          },
        },
        TrainerInput: {
          type: 'object',
          required: ['name', 'bio'],
          properties: {
            name: { type: 'string', example: 'Sarah Chen' },
            title: { type: 'string', example: 'Certified Pilates Instructor' },
            bio: { type: 'string', example: '10+ years teaching mat and reformer Pilates...' },
            specialties: {
              type: 'array',
              items: { type: 'string' },
              example: ['Pilates', 'Core Strength', 'Rehab'],
            },
            photoUrl: { type: 'string', format: 'uri' },
            yearsExperience: { type: 'integer', minimum: 0, example: 10 },
            isActive: { type: 'boolean' },
          },
        },
        Trainer: {
          allOf: [
            { $ref: '#/components/schemas/TrainerInput' },
            {
              type: 'object',
              properties: {
                _id: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
                updatedAt: { type: 'string', format: 'date-time' },
              },
            },
          ],
        },
        Resource: {
          allOf: [
            { $ref: '#/components/schemas/ResourceInput' },
            {
              type: 'object',
              properties: {
                _id: { type: 'string' },
                ownerId: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
                updatedAt: { type: 'string', format: 'date-time' },
              },
            },
          ],
        },
        AvailabilitySlot: {
          type: 'object',
          properties: {
            start: { type: 'string', format: 'date-time' },
            end: { type: 'string', format: 'date-time' },
            capacity: { type: 'integer' },
            booked: { type: 'integer' },
            remaining: { type: 'integer' },
            bookable: { type: 'boolean', description: 'Seats left, in the future, resource active' },
          },
        },
        Booking: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            userId: { type: 'string' },
            resourceId: { type: 'string' },
            slotStart: { type: 'string', format: 'date-time' },
            slotEnd: { type: 'string', format: 'date-time' },
            status: {
              type: 'string',
              enum: ['pending', 'confirmed', 'cancelled', 'completed', 'expired'],
            },
            paymentStatus: { type: 'string', enum: ['unpaid', 'paid', 'refunded'] },
            amount: { type: 'integer', description: 'Cents, captured at booking time' },
            currency: { type: 'string', example: 'usd' },
            stripePaymentIntentId: { type: 'string', nullable: true },
            stripeRefundId: { type: 'string', nullable: true },
            expiresAt: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              description: 'Payment deadline while pending',
            },
            cancelledAt: { type: 'string', format: 'date-time', nullable: true },
            cancelReason: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        LockerPricing: {
          type: 'object',
          required: ['day', 'month', 'year'],
          properties: {
            day: { type: 'integer', minimum: 0, description: 'Cents', example: 500 },
            month: { type: 'integer', minimum: 0, description: 'Cents', example: 4000 },
            year: { type: 'integer', minimum: 0, description: 'Cents', example: 35000 },
          },
        },
        LockerOfferingInput: {
          type: 'object',
          required: ['name', 'capacity', 'pricing'],
          properties: {
            name: { type: 'string', example: 'Storage Lockers' },
            description: { type: 'string' },
            capacity: {
              type: 'integer',
              minimum: 1,
              example: 30,
              description: 'Number of physical units; raising this provisions new ones immediately',
            },
            pricing: { $ref: '#/components/schemas/LockerPricing' },
            currency: { type: 'string', example: 'usd' },
            isActive: { type: 'boolean' },
          },
        },
        LockerOffering: {
          allOf: [
            { $ref: '#/components/schemas/LockerOfferingInput' },
            {
              type: 'object',
              properties: {
                _id: { type: 'string' },
                ownerId: { type: 'string' },
                availableNow: { type: 'integer', description: 'Free units at this instant' },
                createdAt: { type: 'string', format: 'date-time' },
                updatedAt: { type: 'string', format: 'date-time' },
              },
            },
          ],
        },
        LockerBooking: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            userId: { type: 'string' },
            offeringId: { type: 'string' },
            unitId: { type: 'string' },
            tier: { type: 'string', enum: ['day', 'month', 'year'] },
            rentalStart: { type: 'string', format: 'date-time' },
            rentalEnd: { type: 'string', format: 'date-time' },
            status: {
              type: 'string',
              enum: ['pending', 'confirmed', 'cancelled', 'expired', 'completed'],
            },
            paymentStatus: { type: 'string', enum: ['unpaid', 'paid', 'refunded'] },
            amount: { type: 'integer', description: 'Cents, captured at booking time' },
            currency: { type: 'string', example: 'usd' },
            stripePaymentIntentId: { type: 'string', nullable: true },
            stripeRefundId: { type: 'string', nullable: true },
            expiresAt: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              description: 'Payment deadline while pending',
            },
            cancelledAt: { type: 'string', format: 'date-time', nullable: true },
            cancelReason: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  // Absolute so the spec builds the same regardless of the process's cwd, and
  // forward-slashed because the glob matcher treats `\` as an escape — a
  // Windows-style path silently matches nothing and yields a spec with no
  // paths at all.
  apis: [path.join(__dirname, '..', 'routes', '*.js').replace(/\\/g, '/')],
};

module.exports = swaggerJsdoc(options);
