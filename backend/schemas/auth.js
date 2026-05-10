const { z } = require("zod");

// POST /api/auth/login — accepts password OR pin (dual auth)
const LoginSchema = z.object({
  username: z.string().min(1, "username is required"),
  password: z.string().optional(),
  pin: z.string().optional(),
  outlet_id: z.coerce.number().int().positive().optional(),
}).passthrough().refine(
  (d) => d.password || d.pin,
  { message: "username and password (or pin) are required" }
);

// POST /api/auth/mt-login — multi-tenant login
const MtLoginSchema = z.object({
  tenant_slug: z.string().min(1, "tenant_slug is required"),
  username: z.string().min(1, "username is required"),
  password: z.string().optional(),
  pin: z.string().optional(),
}).passthrough().refine(
  (d) => d.password || d.pin,
  { message: "tenant_slug, username, and password (or pin) are required" }
);

// POST /api/auth/kiosk-login (MT only — tenant_slug always required)
const KioskLoginSchema = z.object({
  pin: z.string().min(1, "pin is required"),
  tenant_slug: z.string().min(1, "tenant_slug is required"),
}).passthrough();

// POST /api/auth/forgot-password
const ForgotPasswordSchema = z.object({
  username: z.string().min(1, "username is required"),
}).passthrough();

// POST /api/auth/reset-password
const ResetPasswordSchema = z.object({
  token: z.string().min(1, "token is required"),
  new_password: z.string().min(8, "Password must be at least 8 characters"),
  store_code: z.string().optional(),
}).passthrough();

// POST /api/auth/signup (self-service) — Free-forever; no plan field
const SignupSchema = z.object({
  store_name: z.string().min(1, "store_name is required"),
  owner_name: z.string().min(1, "owner_name is required"),
  email: z.string().email("Valid email is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  tos_accepted: z.literal(true, {
    message: "You must agree to the Terms of Service and Privacy Policy",
  }),
  tos_version: z.string().min(1).optional(),
  privacy_version: z.string().min(1).optional(),
}).passthrough();

module.exports = { LoginSchema, MtLoginSchema, KioskLoginSchema, ForgotPasswordSchema, ResetPasswordSchema, SignupSchema };
