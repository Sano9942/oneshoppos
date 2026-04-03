const { z } = require("zod");

// POST /api/admin/tenants
const CreateTenantSchema = z.object({
  slug: z.string().min(3, "slug is required (min 3 chars)"),
  name: z.string().min(1, "name is required"),
  pin: z.union([z.string(), z.number()]).transform(String),
}).passthrough(); // preserve owner_email, timezone, plan

// PUT /api/admin/tenants/:id
const UpdateTenantSchema = z.object({}).passthrough(); // all fields optional — validate in handler

// POST /api/admin/announcements
const CreateAnnouncementSchema = z.object({
  message: z.string().min(1, "message is required"),
}).passthrough(); // preserve type, ends_at

// PUT /api/admin/announcements/:id
const UpdateAnnouncementSchema = z.object({}).passthrough();

// POST /api/admin/tax-rates
const CreateTaxRateSchema = z.object({
  hs_code: z.string().min(1, "hs_code is required"),
  description_en: z.string().min(1, "description_en is required"),
}).passthrough(); // preserve description_ur, federal_gst, punjab_pra, sindh_srb, etc.

// PUT /api/admin/tax-rates/:id
const UpdateTaxRateSchema = z.object({}).passthrough();

module.exports = {
  CreateTenantSchema,
  UpdateTenantSchema,
  CreateAnnouncementSchema,
  UpdateAnnouncementSchema,
  CreateTaxRateSchema,
  UpdateTaxRateSchema,
};
