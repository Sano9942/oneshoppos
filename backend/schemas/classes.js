const { z } = require("zod");

// F06 class sessions + bookings + waitlist. Contact fields mirror
// schemas/bookings.js conventions (staff-facing loose, public tight).

const createClassSessionSchema = z.object({
  service_id: z.number().int().positive(),
  employee_id: z.number().int().positive().optional().nullable(),
  outlet_id: z.number().int().positive().optional().nullable(),
  start_at: z.string().min(1),
  end_at: z.string().min(1),
  max_capacity: z.number().int().positive().max(1000).default(10),
  // 'weekly:1,3,5' (0=Sun..6=Sat) — occurrences materialized at save time.
  recurrence_rule: z.string().regex(/^weekly:[0-6](,[0-6])*$/).optional().nullable(),
  recurrence_weeks: z.number().int().min(1).max(12).optional(),
  price: z.number().min(0).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const updateClassSessionSchema = z.object({
  employee_id: z.number().int().positive().optional().nullable(),
  start_at: z.string().min(1).optional(),
  end_at: z.string().min(1).optional(),
  max_capacity: z.number().int().positive().max(1000).optional(),
  price: z.number().min(0).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  status: z.enum(["scheduled", "in_progress", "completed"]).optional(),
});

const cancelClassSessionSchema = z.object({
  reason: z.string().max(500).optional(),
  cascade_series: z.boolean().default(false),
});

// Admin booking — a known customer or raw contact (find-or-create).
const adminClassBookSchema = z.object({
  customer_id: z.number().int().positive().optional(),
  customer_name: z.string().max(200).optional(),
  customer_phone: z.string().max(50).optional(),
  customer_email: z.string().email().optional(),
}).superRefine((v, ctx) => {
  if (!v.customer_id && !v.customer_phone && !v.customer_email) {
    ctx.addIssue({ code: "custom", message: "customer_id or customer_phone/customer_email required" });
  }
});

// Public booking — contact required (tight, untrusted caller).
const publicClassBookSchema = z.object({
  class_session_id: z.number().int().positive(),
  customer_name: z.string().min(1).max(200),
  customer_phone: z.string().min(5).max(50),
  customer_email: z.string().email().optional(),
});

const publicClassWaitlistSchema = publicClassBookSchema;

const claimOfferSchema = z.object({
  token: z.string().min(16).max(200),
});

const adminWaitlistAddSchema = adminClassBookSchema;

module.exports = {
  createClassSessionSchema,
  updateClassSessionSchema,
  cancelClassSessionSchema,
  adminClassBookSchema,
  publicClassBookSchema,
  publicClassWaitlistSchema,
  claimOfferSchema,
  adminWaitlistAddSchema,
};
