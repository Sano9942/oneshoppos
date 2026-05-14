const { z } = require("zod");

// POST /api/sales — cartItems uses `id` (not product_id), `price` (not unit_price)
// M5: quantity allows decimals for weight/length-based items (kg, g, lb, m, cm).
// Optional gross_weight / tare_weight persist audit trail for weighted sales.
// 2-G.5: optional price_override captures the audit trail for a cashier price
// override. approval_event_id is mandatory when the cashier lacks the
// `override_price` permission (validated in sales.js, not here).
const PriceOverrideSchema = z.object({
  original_price: z.coerce.number().nonnegative(),
  reason_id: z.coerce.number().int().positive().optional().nullable(),
  approval_event_id: z.coerce.number().int().positive().optional().nullable(),
}).passthrough();

const CartItemSchema = z.object({
  id: z.coerce.number().int().positive(),
  price: z.coerce.number(),
  quantity: z.coerce.number().positive(),
  price_override: PriceOverrideSchema.optional().nullable(),
}).passthrough(); // preserve name, cost_price, tax, gst, barcode, variant_id, gross_weight, tare_weight, unit, etc.

// Payment line — split-tender support. Method is free-form (Cash, Card, Wallet,
// JazzCash, EasyPaisa, BankTransfer, etc. — tenant-configurable). Passthrough
// preserves denomination breakdown, gateway response blob, and other provider
// metadata captured by the POS.
const PaymentLineSchema = z.object({
  method: z.string().min(1, "payment method is required").max(100),
  amount: z.coerce.number().min(0, "payment amount cannot be negative"),
  reference: z.string().max(500).optional(),
  change: z.coerce.number().optional(),
}).passthrough();

const CreateSaleSchema = z.object({
  cartItems: z.array(CartItemSchema).min(1, "Cart is empty"),
  outlet_id: z.coerce.number().int().positive("Outlet ID is required for checkout"),
  payments: z.array(PaymentLineSchema).optional(),
  paymentMethod: z.string().max(100).optional(),
  // Tier 1.2 wholesale field sales: when a sale originates from the field rep
  // app's check-in → order flow, the rep app passes the visit id so the sale
  // links back to the visit it came from. field_visit_uuid is the offline-
  // friendly alternative — rep app uses the same uuid it gave the check-in
  // (which becomes field_visits.client_uuid), and the route resolves it to an
  // id at insert time. Pass either, not both.
  field_visit_id: z.coerce.number().int().positive().optional().nullable(),
  field_visit_uuid: z.string().min(8).max(200).optional().nullable(),
  // Tier 1.3 wholesale schemes — applied promotions audit snapshot from
  // /api/promotions/quote. Passthrough on each entry preserves extra fields
  // the evaluator may add later (priority, tier, etc.).
  applied_promotions: z
    .array(
      z.object({
        promotion_id: z.coerce.number().int().positive(),
        name: z.string().max(200).optional(),
        type: z.string().max(50).optional(),
        discount: z.coerce.number().nonnegative(),
      }).passthrough(),
    )
    .optional(),
}).passthrough(); // preserve employee_id, customer_id, shift_id, discount_amount, staff_id, room_id, plan_id, etc.

// PUT /api/sales/:id/void
const VoidSaleSchema = z.object({
  void_reason: z.string().min(1, "void_reason is required"),
}).passthrough();

module.exports = { CartItemSchema, PriceOverrideSchema, PaymentLineSchema, CreateSaleSchema, VoidSaleSchema };
