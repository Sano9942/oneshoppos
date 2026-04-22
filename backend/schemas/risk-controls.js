const { z } = require("zod");

// PUT /api/risk/config
const UpdateRiskConfigSchema = z.object({
  refund_approval_threshold: z.coerce.number().min(0).optional(),
  variance_approval_threshold: z.coerce.number().min(0).optional(),
  anomaly_z_score_threshold: z.coerce.number().min(0).max(10).optional(),
});

// POST /api/risk/no-sale
const NoSaleEventSchema = z.object({
  reason_code: z.string().min(1, "reason_code is required"),
  note: z.string().max(500).optional().nullable(),
  outlet_id: z.coerce.number().int().positive().optional(),
});

// PUT /api/risk/anomaly-flags/:id/review
const ReviewAnomalyFlagSchema = z.object({
  review_note: z.string().max(1000).optional().nullable(),
});

module.exports = {
  UpdateRiskConfigSchema,
  NoSaleEventSchema,
  ReviewAnomalyFlagSchema,
};
