// Phase 2-R Wave B — 2-R.6 schedules.

const { z } = require("zod");

const timeStr = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Expected HH:MM or HH:MM:SS");

const scheduleCreateSchema = z
  .object({
    name: z.string().min(1).max(120),
    outlet_id: z.number().int().positive().nullable().optional(),
    day_of_week: z.number().int().min(0).max(6).nullable().optional(),
    start_time: timeStr,
    end_time: timeStr,
    timezone: z.string().max(80).nullable().optional(),
    is_active: z.boolean().optional(),
    product_ids: z.array(z.number().int().positive()).default([]),
  })
  .refine((v) => v.start_time !== v.end_time, {
    message: "start_time and end_time must differ",
    path: ["end_time"],
  });

const scheduleUpdateSchema = scheduleCreateSchema.partial();

module.exports = { scheduleCreateSchema, scheduleUpdateSchema };
