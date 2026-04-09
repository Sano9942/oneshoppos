const { z } = require("zod");

const createContractSchema = z.object({
  project_id: z.number().int().positive().optional(),
  customer_id: z.number().int().positive().optional(),
  template_id: z.number().int().positive().optional(),
  title: z.string().min(1),
  body_html: z.string().optional(),
  expires_at: z.string().optional(),
  signers: z.array(z.object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    role: z.string().default("signer"),
  })).optional(),
});

const updateContractSchema = z.object({
  title: z.string().min(1).optional(),
  body_html: z.string().optional(),
  status: z.enum(["draft", "sent", "viewed", "signed", "countersigned", "expired", "cancelled"]).optional(),
  expires_at: z.string().optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1),
  body_html: z.string().min(1),
  variables: z.array(z.string()).optional(),
});

const signContractSchema = z.object({
  signer_id: z.number().int().positive(),
  signature_data: z.string().min(1),
});

module.exports = {
  createContractSchema, updateContractSchema,
  createTemplateSchema, signContractSchema,
};
