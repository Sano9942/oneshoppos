const { z } = require("zod");

// POST /api/sales — cartItems uses `id` (not product_id), `price` (not unit_price)
// M5: quantity allows decimals for weight/length-based items (kg, g, lb, m, cm).
// Optional gross_weight / tare_weight persist audit trail for weighted sales.
const CartItemSchema = z.object({
  id: z.coerce.number().int().positive(),
  price: z.coerce.number(),
  quantity: z.coerce.number().positive(),
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
}).passthrough(); // preserve employee_id, customer_id, shift_id, discount_amount, staff_id, room_id, plan_id, etc.

// PUT /api/sales/:id/void
const VoidSaleSchema = z.object({
  void_reason: z.string().min(1, "void_reason is required"),
}).passthrough();

module.exports = { CartItemSchema, PaymentLineSchema, CreateSaleSchema, VoidSaleSchema };
