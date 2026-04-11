const { z } = require("zod");

const PRODUCT_FIELDS = [
  "price",
  "cost_price",
  "compare_at_price",
  "stock",
  "status",
  "min_qty",
  "max_qty",
  "tags",
  "vendor",
  "product_type",
];

const VARIANT_FIELDS = [
  "price",
  "cost_price",
  "compare_at_price",
  "stock",
  "barcode",
  "weight",
];

// Must match the DB CHECK constraint on scheduled_catalog_changes.change_type.
// See schema-pg.sql:2124. Adding a new value here without updating the CHECK
// (and migrating existing tenants) will cause 500 on INSERT.
const CHANGE_TYPES = ["price", "visibility", "status", "tax"];

const createScheduledChangeSchema = z.object({
  change_type: z.enum(CHANGE_TYPES),
  entity_type: z.enum(["product", "variant"]),
  entity_id: z.coerce.number().int().positive(),
  field_name: z.string().min(1),
  new_value: z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v)),
  scheduled_at: z.string().datetime().refine(
    (s) => new Date(s) > new Date(),
    { message: "scheduled_at must be in the future" }
  ),
  notes: z.string().max(2000).optional().nullable(),
}).passthrough().superRefine((d, ctx) => {
  // Cross-field allowlist: field_name must be valid for the given entity_type.
  // Uses superRefine (not refine) because Zod 4 dropped the function-form second
  // argument to refine(), so we need ctx.addIssue to emit a dynamic message
  // that includes the rejected field_name in the error response body.
  const allowed =
    d.entity_type === "product" ? PRODUCT_FIELDS :
    d.entity_type === "variant" ? VARIANT_FIELDS :
    null;
  if (!allowed || !allowed.includes(d.field_name)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `field_name "${d.field_name}" is not allowed for entity_type "${d.entity_type}"`,
      path: ["field_name"],
    });
  }
});

const updateScheduledChangeSchema = z.object({
  new_value: z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v)).optional(),
  scheduled_at: z.string().datetime().optional(),
  notes: z.string().max(2000).optional().nullable(),
  status: z.enum(["cancelled"]).optional(),
}).passthrough();

module.exports = {
  createScheduledChangeSchema,
  updateScheduledChangeSchema,
  PRODUCT_FIELDS,
  VARIANT_FIELDS,
};
