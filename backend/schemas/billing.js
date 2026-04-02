const { z } = require("zod");

const RequestUpgradeSchema = z.object({
  plan: z.enum(["pro"]),
  cycle: z.enum(["monthly", "annual"]),
  message: z.string().optional(),
}).passthrough();

const CreateCheckoutSchema = z.object({
  cycle: z.enum(["monthly", "annual"]).default("monthly"),
}).passthrough();

module.exports = { RequestUpgradeSchema, CreateCheckoutSchema };
