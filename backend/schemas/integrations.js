const { z } = require("zod");

const connectProviderSchema = z.object({
  provider: z.string().min(1),
  store_url: z.string().url().optional(),
  api_key: z.string().min(1).optional(),
  api_secret: z.string().min(1).optional(),
  oauth_token: z.string().min(1).optional(),
  oauth_refresh_token: z.string().optional(),
  config_json: z.string().optional(),
});

const disconnectProviderSchema = z.object({
  provider: z.string().min(1),
});

module.exports = { connectProviderSchema, disconnectProviderSchema };
