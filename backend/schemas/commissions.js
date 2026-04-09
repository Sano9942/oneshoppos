const { z } = require("zod");

const ruleSchema = z.object({
  scope_type: z.enum(["all", "category", "product", "brand"]).default("all"),
  scope_id: z.number().int().positive().nullable().optional(),
  rate: z.number().min(0).max(100),
  min_threshold: z.number().min(0).optional().default(0),
  max_cap: z.number().min(0).nullable().optional(),
  priority: z.number().int().min(0).optional().default(0),
});

const createPlanSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  type: z.enum(["percentage", "fixed_per_sale", "fixed_per_item", "tiered"]).default("percentage"),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().optional(),
  rules: z.array(ruleSchema).min(1).max(50),
});

const updatePlanSchema = createPlanSchema.partial().extend({
  is_active: z.boolean().optional(),
});

module.exports = { createPlanSchema, updatePlanSchema };
