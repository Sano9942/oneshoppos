/**
 * Zod schemas for the Tier 1.4 manufacturer portal.
 * Used with middleware/validate.js on every mutation endpoint.
 *
 * Two surface areas:
 *   1. Manufacturer-facing  — /api/manufacturer-portal/*
 *   2. Distributor-admin    — /api/admin/manufacturer-partners
 *
 * Exports camelCase to match the customer-portal precedent.
 */

const { z } = require("zod");

const emailSchema = z.string().trim().toLowerCase().email("Invalid email");
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password too long");
const signupTokenSchema = z
  .string()
  .min(16, "Invalid setup token")
  .max(256);

// ── Manufacturer-facing auth ─────────────────────────────────────────

const setupSchema = z.object({
  token: signupTokenSchema,
  password: passwordSchema,
});

const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

const forgotPasswordSchema = z.object({
  email: emailSchema,
});

// ── Distributor-admin CRUD on manufacturer_partners ──────────────────

const brandIdListSchema = z
  .array(z.number().int().positive())
  .min(1, "At least one brand must be selected")
  .max(50, "Too many brands");

const createPartnerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  contact_name: z.string().trim().max(200).optional().nullable(),
  email: emailSchema,
  brand_ids: brandIdListSchema,
});

const updatePartnerSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    contact_name: z.string().trim().max(200).optional().nullable(),
    email: emailSchema.optional(),
    status: z.enum(["invited", "active", "suspended"]).optional(),
    brand_ids: brandIdListSchema.optional(),
  })
  .strict();

module.exports = {
  setupSchema,
  loginSchema,
  forgotPasswordSchema,
  createPartnerSchema,
  updatePartnerSchema,
};
