"use strict";

const { z } = require("zod");

const CHANNELS = ["email", "sms", "whatsapp"];

// Upsert a rule (keyed on event+channel via the DB UNIQUE constraint).
const ruleUpsertSchema = z.object({
  event: z.string().min(1).max(120),
  channel: z.enum(CHANNELS),
  template_key: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
});

// Partial edit of an existing rule.
const rulePatchSchema = z.object({
  enabled: z.boolean().optional(),
  template_key: z.string().min(1).max(120).optional(),
}).strict();

// Provider connectivity test.
const testSchema = z.object({
  channel: z.enum(["sms", "whatsapp"]).optional(),
}).strict();

module.exports = { ruleUpsertSchema, rulePatchSchema, testSchema, CHANNELS };
