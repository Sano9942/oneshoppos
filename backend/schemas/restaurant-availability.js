const { z } = require("zod");

// 2-R.1 — 86'd items (menu availability).
//
// Admins mark a product/variant sold-out with a short reason and an
// optional auto-clear timestamp. Reason is free text for Wave A; 2-R.2
// will swap in a reason-code table shared with void/comp adjustments.

const soldOutSetSchema = z.object({
  reason: z.string().min(1).max(200),
  until: z.string().datetime().nullable().optional(),
}).passthrough();

module.exports = { soldOutSetSchema };
