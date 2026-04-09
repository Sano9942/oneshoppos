const { z } = require("zod");

const createTemplateSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(["email", "sms"]).default("email"),
  subject: z.string().optional(),
  body_html: z.string().optional(),
  body_text: z.string().optional(),
});

const createCampaignSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(["email", "sms"]).default("email"),
  template_id: z.number().int().positive().optional(),
  subject: z.string().optional(),
  body_html: z.string().optional(),
  audience_filters: z
    .array(
      z.object({
        filter_type: z.string().min(1),
        filter_value: z.string().min(1),
      })
    )
    .optional(),
});

const scheduleCampaignSchema = z.object({
  scheduled_at: z.string().min(1),
});

module.exports = { createTemplateSchema, createCampaignSchema, scheduleCampaignSchema };
