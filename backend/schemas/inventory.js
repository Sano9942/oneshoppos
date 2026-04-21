const { z } = require("zod");

// POST /api/transfers — single-record body (not array)
// 2-G.1 follow-up: optional variant_id routes the transfer through
// variant_outlet_stock instead of product-level outlet_stock.
const CreateTransferSchema = z.object({
  product_id: z.coerce.number().int().positive("product_id is required"),
  variant_id: z.coerce.number().int().positive().optional().nullable(),
  from_outlet_id: z.coerce.number().int().positive("from_outlet_id is required"),
  to_outlet_id: z.coerce.number().int().positive("to_outlet_id is required"),
  quantity: z.coerce.number().positive("quantity must be greater than zero"),
}).passthrough(); // preserve employee_id, note

// POST /api/adjustments — single-record body (not array)
// 2-G.1 follow-up: optional variant_id targets a specific variant's stock.
const CreateAdjustmentSchema = z.object({
  product_id: z.coerce.number().int().positive("product_id is required"),
  variant_id: z.coerce.number().int().positive().optional().nullable(),
  outlet_id: z.coerce.number().int().positive("outlet_id is required"),
  quantity_change: z.coerce.number(),
  reason: z.string().min(1, "reason is required"),
}).passthrough(); // preserve employee_id

module.exports = { CreateTransferSchema, CreateAdjustmentSchema };
