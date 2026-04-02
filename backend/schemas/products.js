const { z } = require("zod");

const CreateProductSchema = z.object({
  name: z.string().min(1, "name is required"),
  price: z.coerce.number().positive("price must be greater than 0"),
}).passthrough(); // many optional fields: barcode, sku, cost_price, category_id, etc.

const BulkDeleteSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, "No product IDs provided."),
});

const BulkStatusSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, "No product IDs provided."),
  status: z.enum(["active", "inactive"], { message: "status must be 'active' or 'inactive'." }),
});

module.exports = { CreateProductSchema, BulkDeleteSchema, BulkStatusSchema };
