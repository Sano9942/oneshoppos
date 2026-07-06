const { z } = require("zod");

const connectProviderSchema = z.object({
  provider: z.string().min(1),
  category: z.enum(["marketplace", "social", "messaging", "feeds", "payment", "sms"]).optional(),
  store_url: z.string().url().optional(),
  api_key: z.string().min(1).optional(),
  api_secret: z.string().min(1).optional(),
  oauth_token: z.string().min(1).optional(),
  oauth_refresh_token: z.string().optional(),
  // HMAC secret the platform signs inbound webhooks with (foodpanda/Careem,
  // Shopify-style). Stored encrypted; verified in routes/webhooks.js.
  webhook_secret: z.string().min(1).optional(),
  config_json: z.string().optional(),
});

const disconnectProviderSchema = z.object({
  provider: z.string().min(1),
});

module.exports = { connectProviderSchema, disconnectProviderSchema };
