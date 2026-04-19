// Phase 2-R Wave B — 2-R.2 void/comp request schemas.

const { z } = require("zod");

const voidCompAdjustSchema = z.object({
  adjustment_type: z.enum(["void", "comp"]),
  reason_code: z.string().min(1).max(64),
  reason_note: z.string().max(500).nullable().optional(),
  amount: z.number().positive(),
  manager_pin: z.string().regex(/^\d{4,8}$/, "PIN must be 4-8 digits"),
});

const voidReasonUpdateSchema = z.object({
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
  label: z.string().min(1).max(120).optional(),
});

module.exports = { voidCompAdjustSchema, voidReasonUpdateSchema };
