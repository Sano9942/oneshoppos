const { z } = require("zod");

const ReturnItemSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive(),
  refund_price: z.coerce.number(),
}).passthrough(); // preserve variant_id, name, etc.

// POST /api/returns
const CreateReturnSchema = z.object({
  outlet_id: z.coerce.number().int().positive("outlet_id is required"),
  total_refund: z.coerce.number(),
  refund_method: z.string().min(1, "refund_method is required"),
  items: z.array(ReturnItemSchema).min(1, "Return must have at least one item"),
}).passthrough(); // preserve original_sale_id, employee_id, customer_id, reason

module.exports = { CreateReturnSchema };
