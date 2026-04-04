const { z } = require("zod");

// POST /api/customers
const CreateCustomerSchema = z.object({
  name: z.string().min(1, "Customer name is required"),
}).passthrough(); // preserve mobile, email, address, cnic, occupation, balance, ntn_cnic

// PUT /api/customers/:id
const UpdateCustomerSchema = z.object({
  name: z.string().min(1, "Customer name is required"),
}).passthrough(); // preserve mobile, email, address, cnic, occupation, balance, ntn_cnic

module.exports = { CreateCustomerSchema, UpdateCustomerSchema };
