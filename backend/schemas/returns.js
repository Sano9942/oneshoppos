const { z } = require("zod");

const ReturnItemSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive(),
  refund_price: z.coerce.number(),
  // 2-G.6: optional serial ids returned with this line + per-line
  // warranty_claim flag that routes the serial into warranty_claim status
  // instead of the default 'returned'.
  serials: z.array(z.coerce.number().int().positive()).optional(),
  warranty_claim: z.coerce.boolean().optional(),
  // 2-G.7: per-line restock toggle + reason code. Only honored when
  // phase2g_per_line_restock is enabled; otherwise the route ignores both
  // and defaults to the legacy restock-everything behavior.
  restock_flag: z.coerce.boolean().optional(),
  reason_code_id: z.coerce.number().int().positive().optional().nullable(),
}).passthrough(); // preserve variant_id, name, etc.

// POST /api/returns
const CreateReturnSchema = z.object({
  outlet_id: z.coerce.number().int().positive("outlet_id is required"),
  total_refund: z.coerce.number(),
  refund_method: z.string().min(1, "refund_method is required"),
  items: z.array(ReturnItemSchema).min(1, "Return must have at least one item"),
}).passthrough(); // preserve original_sale_id, employee_id, customer_id, reason

module.exports = { CreateReturnSchema };
