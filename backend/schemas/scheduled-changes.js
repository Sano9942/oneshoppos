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

const CHANGE_TYPES = ["field_update", "price", "status", "stock"];

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
}).passthrough().refine(
  (d) => d.entity_type === "product"
    ? PRODUCT_FIELDS.includes(d.field_name)
    : VARIANT_FIELDS.includes(d.field_name),
  (d) => ({
    message: `field_name "${d.field_name}" is not allowed for entity_type "${d.entity_type}"`,
    path: ["field_name"],
  })
);

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
