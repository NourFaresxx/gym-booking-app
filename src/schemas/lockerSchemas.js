const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id');

const createLockerOfferingSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  capacity: z.number().int().min(1).max(1000),
  pricing: z.object({
    day: z.number().int().min(0),
    month: z.number().int().min(0),
    year: z.number().int().min(0),
  }),
  currency: z.string().length(3).toLowerCase().optional(),
  isActive: z.boolean().optional(),
});

const updateLockerOfferingSchema = createLockerOfferingSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'No fields to update' });

const createLockerBookingSchema = z.object({
  offeringId: objectId,
  tier: z.enum(['day', 'month', 'year']),
});

module.exports = {
  createLockerOfferingSchema,
  updateLockerOfferingSchema,
  createLockerBookingSchema,
};
