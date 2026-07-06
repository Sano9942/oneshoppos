const { z } = require("zod");

const createServiceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  duration_minutes: z.number().int().positive(),
  padding_minutes: z.number().int().min(0).default(0),
  price: z.number().min(0).default(0),
  outlet_id: z.number().int().positive().optional(),
  requires_confirmation: z.boolean().default(false),
  max_advance_days: z.number().int().positive().default(90),
  // F06 — POS product representing this service at checkout (prefill line).
  product_id: z.number().int().positive().optional().nullable(),
  staff_ids: z.array(z.number().int().positive()).optional(),
});

const updateServiceSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  duration_minutes: z.number().int().positive().optional(),
  padding_minutes: z.number().int().min(0).optional(),
  price: z.number().min(0).optional(),
  is_active: z.boolean().optional(),
  requires_confirmation: z.boolean().optional(),
  product_id: z.number().int().positive().optional().nullable(),
  staff_ids: z.array(z.number().int().positive()).optional(),
});

const createAppointmentSchema = z.object({
  service_id: z.number().int().positive(),
  variant_id: z.number().int().positive().optional(),
  customer_id: z.number().int().positive().optional(),
  employee_id: z.number().int().positive().optional(),
  outlet_id: z.number().int().positive().optional(),
  start_at: z.string().min(1),
  customer_name: z.string().optional(),
  customer_phone: z.string().optional(),
  customer_email: z.string().email().optional(),
  notes: z.string().optional(),
  // F06 segments — EXTRA services after the primary (color+cut = primary cut
  // + one segment). Windows run sequentially from start_at.
  segments: z.array(z.object({
    service_id: z.number().int().positive(),
    employee_id: z.number().int().positive().optional(),
  })).max(9).optional(),
});

const rescheduleSchema = z.object({
  start_at: z.string().min(1),
  employee_id: z.number().int().positive().optional(),
});

const cancelSchema = z.object({
  reason: z.string().optional(),
});

const availabilityQuerySchema = z.object({
  service_id: z.string().min(1),
  employee_id: z.string().optional(),
  date: z.string().min(1),
  outlet_id: z.string().optional(),
});

// F06 resources — salon chairs, physio beds, studio bays.
const createResourceSchema = z.object({
  name: z.string().min(1),
  outlet_id: z.number().int().positive(),
  resource_type: z.string().min(1).default("room"),
  capacity: z.number().int().positive().default(1),
  is_active: z.boolean().default(true),
});

const updateResourceSchema = z.object({
  name: z.string().min(1).optional(),
  outlet_id: z.number().int().positive().optional(),
  resource_type: z.string().min(1).optional(),
  capacity: z.number().int().positive().optional(),
  is_active: z.boolean().optional(),
});

// Full-replace of a service's resource mapping (mirrors staff_ids handling).
const setServiceResourcesSchema = z.object({
  resource_ids: z.array(z.number().int().positive()).max(50),
});

const publicBookingSchema = z.object({
  service_id: z.number().int().positive(),
  employee_id: z.number().int().positive().optional(),
  start_at: z.string().min(1),
  customer_name: z.string().min(1),
  customer_phone: z.string().min(1),
  customer_email: z.string().email().optional(),
  notes: z.string().optional(),
});

module.exports = {
  createServiceSchema, updateServiceSchema,
  createAppointmentSchema, rescheduleSchema, cancelSchema,
  availabilityQuerySchema, publicBookingSchema,
  createResourceSchema, updateResourceSchema, setServiceResourcesSchema,
};
