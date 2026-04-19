const { z } = require("zod");

// 2-R.3 — Pay-at-table.
//
// Staff initiates a payment session on an open dine-in check. The only
// input is an optional tip in pesos (tips are captured by the guest in
// the public pay page too; this parameter lets staff pre-fill service
// charges when policy dictates). Non-negative, two-decimal currency.

const paymentSessionCreateSchema = z.object({
  tip_amount: z.coerce.number().nonnegative().max(100000).optional().nullable(),
}).passthrough();

module.exports = { paymentSessionCreateSchema };
