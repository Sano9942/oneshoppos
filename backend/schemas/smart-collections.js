const { z } = require("zod");

const ruleSchema = z.object({
  field: z.enum(["category_id", "brand_id", "product_type", "vendor", "tags", "price", "stock", "status", "created_at"]),
  operator: z.enum(["equals", "not_equals", "greater_than", "less_than", "contains", "starts_with", "in"]),
  value: z.string().min(1),
});

const createCollectionSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  disjunctive: z.boolean().optional().default(false),
  sort_order: z.enum(["manual", "name_asc", "name_desc", "price_asc", "price_desc", "created_at_desc"]).optional().default("manual"),
  rules: z.array(ruleSchema).min(1).max(20),
});

const updateCollectionSchema = createCollectionSchema.partial().extend({
  is_active: z.boolean().optional(),
});

module.exports = { createCollectionSchema, updateCollectionSchema, ruleSchema };
