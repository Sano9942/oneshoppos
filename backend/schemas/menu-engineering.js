const { z } = require("zod");

/**
 * Phase 2-R Wave C (2-R.10) — menu engineering (Boston Matrix) report.
 *
 * Query-string schema for `GET /api/reports/menu-engineering`. All fields
 * optional so the caller can hit the endpoint with no filters to see a
 * tenant-wide snapshot.
 */
const menuEngineeringQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  outlet_id: z.union([z.string(), z.number()]).optional(),
  category_id: z.union([z.string(), z.number()]).optional(),
});

module.exports = { menuEngineeringQuerySchema };
