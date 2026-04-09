const { z } = require("zod");

const sendMessageSchema = z.object({
  content: z.string().min(1),
  message_type: z.enum(["text", "image", "document", "template"]).default("text"),
});

const updateThreadSchema = z.object({
  status: z.enum(["open", "closed", "snoozed"]).optional(),
  assigned_to: z.number().int().positive().nullable().optional(),
});

module.exports = { sendMessageSchema, updateThreadSchema };
