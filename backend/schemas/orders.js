const { z } = require("zod");

const ORDER_STATUSES = ["open", "closed", "cancelled", "on_hold"];
const PAYMENT_STATUSES = ["pending", "authorized", "paid", "failed"];
const FULFILLMENT_STATUSES = ["unfulfilled", "partial", "fulfilled", "restocked"];

const BulkUpdateOrdersSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, "At least one order ID is required").max(100, "Cannot update more than 100 orders at once"),
  order_status: z.enum(ORDER_STATUSES).nullish(),
  payment_status: z.enum(PAYMENT_STATUSES).nullish(),
  fulfillment_status: z.enum(FULFILLMENT_STATUSES).nullish(),
}).refine(
  (d) => d.order_status || d.payment_status || d.fulfillment_status,
  { message: "At least one status field is required" },
);

const MarkCompleteSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, "At least one order ID is required").max(100, "Cannot update more than 100 orders at once"),
  set_paid: z.boolean().optional(),
});

module.exports = { BulkUpdateOrdersSchema, MarkCompleteSchema, ORDER_STATUSES, PAYMENT_STATUSES, FULFILLMENT_STATUSES };
