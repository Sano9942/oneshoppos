const { z } = require("zod");

const RequestUpgradeSchema = z.object({
  plan: z.enum(["pro"]),
  cycle: z.enum(["monthly", "quarterly", "semi_annual", "annual"]),
  message: z.string().optional(),
}).passthrough();

const CreateCheckoutSchema = z.object({
  cycle: z.enum(["monthly", "quarterly", "semi_annual", "annual"]).default("monthly"),
}).passthrough();

module.exports = { RequestUpgradeSchema, CreateCheckoutSchema };
