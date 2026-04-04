const { z } = require("zod");

const POItemSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive(),
  cost_price: z.coerce.number(),
}).passthrough();

// POST /api/purchase-orders
const CreatePOSchema = z.object({
  supplier_id: z.coerce.number().int().positive("supplier_id is required"),
  items: z.array(POItemSchema).min(1, "Purchase order must have at least one item"),
}).passthrough(); // preserve total_cost, due_date, outlet_id

module.exports = { CreatePOSchema };
