const { z } = require("zod");

const createPlanSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  billing_interval: z.enum(["monthly", "quarterly", "yearly"]).default("monthly"),
  billing_interval_count: z.number().int().positive().default(1),
  trial_days: z.number().int().min(0).default(0),
});

const updatePlanSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  price: z.number().positive().optional(),
  is_active: z.boolean().optional(),
});

const createSubscriptionSchema = z.object({
  plan_id: z.number().int().positive(),
  customer_id: z.number().int().positive(),
  auto_charge: z.boolean().default(false),
});

module.exports = { createPlanSchema, updatePlanSchema, createSubscriptionSchema };
