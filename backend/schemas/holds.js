// 2-G.9 layaway / hold / special-order schemas
const { z } = require("zod");

const HoldItemSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  variant_id: z.coerce.number().int().positive().optional().nullable(),
  quantity: z.coerce.number().positive(),
  price_at_hold: z.coerce.number().nonnegative(),
}).passthrough();

const CreateHoldSchema = z.object({
  outlet_id: z.coerce.number().int().positive(),
  customer_id: z.coerce.number().int().positive().optional().nullable(),
  customer_phone: z.string().max(64).optional().nullable(),
  customer_name: z.string().max(200).optional().nullable(),
  items: z.array(HoldItemSchema).min(1, "Hold must contain at least one item"),
  total_amount: z.coerce.number().nonnegative(),
  deposit_amount: z.coerce.number().nonnegative().optional(),
  deposit_method: z.string().max(64).optional(),
  hold_until: z.string().datetime().optional().nullable(),
  hold_days: z.coerce.number().int().positive().optional(),
  notes: z.string().max(2000).optional().nullable(),
}).passthrough();

const AddPaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  method: z.string().min(1).max(64),
  gateway_ref: z.string().max(200).optional().nullable(),
}).passthrough();

const CompleteHoldSchema = z.object({
  // Tender lines settle the remaining balance — same shape POS uses for sales.
  payments: z.array(
    z.object({
      method: z.string().min(1).max(64),
      amount: z.coerce.number().positive(),
      reference: z.string().max(500).optional(),
    }).passthrough(),
  ).min(0).optional(),
  employee_id: z.coerce.number().int().positive().optional(),
}).passthrough();

const CancelHoldSchema = z.object({
  reason: z.string().max(500).optional().nullable(),
  forfeit_deposit: z.coerce.boolean().optional(),
}).passthrough();

module.exports = {
  CreateHoldSchema,
  AddPaymentSchema,
  CompleteHoldSchema,
  CancelHoldSchema,
};
