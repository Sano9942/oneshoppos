const { z } = require("zod");

// POST /api/employees/validate-pin
const ValidatePinSchema = z.object({
  pin_code: z.string().min(1, "pin_code is required"),
}).passthrough();

// POST /api/employees — pin_code is required for new employees
const CreateEmployeeSchema = z.object({
  name: z.string().min(1, "name is required"),
  pin_code: z.string().regex(/^\d{4,10}$/, "PIN must be 4-10 digits"),
  role_id: z.coerce.number().int().positive("role_id is required"),
}).passthrough(); // email, monthly_salary, etc. are optional

// PUT /api/employees/:id/set-password
const SetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
}).passthrough();

// PUT /api/employees/:id/change-password — requires current_password OR pin
const ChangePasswordSchema = z.object({
  new_password: z.string().min(8, "New password must be at least 8 characters"),
  current_password: z.string().optional(),
  pin: z.string().optional(),
}).passthrough().refine(
  (d) => d.current_password || d.pin,
  { message: "current_password or pin is required for verification" }
);

// PUT /api/employees/:id/change-pin
const ChangePinSchema = z.object({
  current_pin: z.string().min(1, "current_pin is required"),
  new_pin: z.string().regex(/^\d{4,10}$/, "New PIN must be 4-10 digits"),
}).passthrough();

module.exports = { ValidatePinSchema, CreateEmployeeSchema, SetPasswordSchema, ChangePasswordSchema, ChangePinSchema };
