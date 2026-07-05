const { z } = require("zod");

// ── Field types & entity scopes (single source of truth) ─────────────
const FIELD_TYPES = [
  "text",
  "textarea",
  "select",
  "checkbox",
  "date",
  "number",
  "signature_ack",
];
const ENTITY_SCOPES = [
  "customer",
  "appointment",
  "service_ticket",
  "project",
  "membership",
  "patient_subject",
];
const SUBMITTED_VIA = ["portal", "public_link", "staff"];

// A single template field definition. `key` is the stable answer key.
const fieldSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_]+$/, "key must be alphanumeric/underscore"),
    label: z.string().min(1).max(200),
    type: z.enum(FIELD_TYPES),
    options: z.array(z.string().min(1).max(200)).optional(), // select only
    required: z.boolean().default(false),
    help: z.string().max(500).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === "select" && (!val.options || val.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `select field "${val.key}" needs at least one option`,
        path: ["options"],
      });
    }
  });

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  entity_scope: z.enum(ENTITY_SCOPES).default("customer"),
  fields: z.array(fieldSchema).min(1, "a form needs at least one field"),
  require_signature: z.boolean().default(false),
  auto_attach: z.string().max(64).nullable().optional(),
  is_active: z.boolean().default(true),
});

const updateTemplateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    entity_scope: z.enum(ENTITY_SCOPES).optional(),
    fields: z.array(fieldSchema).min(1).optional(),
    require_signature: z.boolean().optional(),
    auto_attach: z.string().max(64).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

// Send a template → creates a pending response (+ public token).
const sendFormSchema = z
  .object({
    customer_id: z.number().int().positive().nullable().optional(),
    patient_subject_id: z.number().int().positive().nullable().optional(),
    entity_type: z.string().max(40).nullable().optional(),
    entity_id: z.number().int().positive().nullable().optional(),
    // How to deliver the fill link. 'none' = just create the pending row.
    channel: z.enum(["email", "sms", "none"]).default("none"),
  })
  .passthrough();

// Answers submitted for a response. `answers` is a free-form object validated
// against the response's own fields_snapshot in the service layer — the shape
// here only guards the envelope. signature is base64 PNG (consent-style).
const submitResponseSchema = z
  .object({
    answers: z.record(z.string(), z.any()).default({}),
    signature_image_base64: z.string().nullable().optional(),
  })
  .passthrough();

module.exports = {
  FIELD_TYPES,
  ENTITY_SCOPES,
  SUBMITTED_VIA,
  createTemplateSchema,
  updateTemplateSchema,
  sendFormSchema,
  submitResponseSchema,
};
