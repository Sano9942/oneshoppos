const { z } = require("zod");

// POST /api/sales — cartItems uses `id` (not product_id), `price` (not unit_price)
const CartItemSchema = z.object({
  id: z.coerce.number().int().positive(),
  price: z.coerce.number(),
  quantity: z.coerce.number().int().positive(),
}).passthrough(); // preserve name, cost_price, tax, gst, barcode, variant_id, etc.

const CreateSaleSchema = z.object({
  cartItems: z.array(CartItemSchema).min(1, "Cart is empty"),
  outlet_id: z.coerce.number().int().positive("Outlet ID is required for checkout"),
}).passthrough(); // preserve paymentMethod, payments, employee_id, customer_id, shift_id, discount_amount, etc.

// PUT /api/sales/:id/void
const VoidSaleSchema = z.object({
  void_reason: z.string().min(1, "void_reason is required"),
}).passthrough();

module.exports = { CreateSaleSchema, VoidSaleSchema };
