const { z } = require("zod");

// POST /api/tips/pools — open a pool for an outlet on a given business_date.
// Idempotent: if one is already open, the route returns it.
const openPoolSchema = z.object({
  outlet_id: z.coerce.number().int().positive(),
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required"),
}).passthrough();

// POST /api/tips/pools/:id/close — no body needed beyond req.employee.
const closePoolSchema = z.object({}).passthrough();

// POST /api/tips/pools/:id/distribute — rule_id is optional; omit to use
// the outlet's default rule.
const distributePoolSchema = z.object({
  rule_id: z.coerce.number().int().positive().optional(),
}).passthrough();

// POST /api/tips/pools/:id/void — require a short reason (audit trail).
const voidPoolSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
}).passthrough();

// POST /api/tips/distribution-rules.
const createDistributionRuleSchema = z.object({
  outlet_id: z.coerce.number().int().positive(),
  name: z.string().min(1).max(100),
  strategy: z.enum(["equal_share", "hours_weighted", "role_weighted", "points"]),
  config_jsonb: z.record(z.any()).optional(),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
}).passthrough();

const updateDistributionRuleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  strategy: z.enum(["equal_share", "hours_weighted", "role_weighted", "points"]).optional(),
  config_jsonb: z.record(z.any()).optional(),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
}).passthrough();

module.exports = {
  openPoolSchema,
  closePoolSchema,
  distributePoolSchema,
  voidPoolSchema,
  createDistributionRuleSchema,
  updateDistributionRuleSchema,
};
