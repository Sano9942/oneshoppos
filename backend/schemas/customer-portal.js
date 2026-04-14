/**
 * Zod schemas for the M8 customer portal.
 * Used with middleware/validate.js on every mutation endpoint.
 */

const { z } = require("zod");

const emailSchema = z.string().trim().toLowerCase().email("Invalid email");
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password too long");
const otpCodeSchema = z.string().regex(/^\d{6}$/, "OTP must be 6 digits");

const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1, "Name is required").max(120),
  mobile: z.string().trim().max(32).optional().nullable(),
});

const requestOtpSchema = z.object({
  email: emailSchema,
  purpose: z.enum(["login", "email_verify", "password_reset"]).default("login"),
});

const verifyOtpSchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
  purpose: z.enum(["login", "email_verify", "password_reset"]).default("login"),
});

const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

const resetPasswordSchema = z.object({
  token: z.string().min(16, "Invalid reset token").max(256),
  password: passwordSchema,
});

const verifyEmailSchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
});

// ── Profile & data mutations ────────────────────────────────────────

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  mobile: z.string().trim().max(32).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  date_of_birth: z.string().trim().optional().nullable(),
  gender: z.enum(["male", "female", "other"]).optional().nullable(),
  email_consent: z.boolean().optional(),
  sms_consent: z.boolean().optional(),
  whatsapp_consent: z.boolean().optional(),
  preferred_contact: z.enum(["email", "sms", "whatsapp", "phone"]).optional().nullable(),
});

const addressSchema = z.object({
  label: z.string().trim().max(40).optional().nullable(),
  line1: z.string().trim().min(1, "Address line 1 is required").max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  region: z.string().trim().max(80).optional().nullable(),
  postal_code: z.string().trim().max(20).optional().nullable(),
  country: z.string().trim().max(80).optional().nullable(),
  is_default: z.boolean().optional(),
});

// ── Appointment flows ───────────────────────────────────────────────

const bookAppointmentSchema = z.object({
  service_id: z.number().int().positive(),
  employee_id: z.number().int().positive().optional().nullable(),
  outlet_id: z.number().int().positive().optional().nullable(),
  start_at: z.string().min(1, "start_at is required"),
  notes: z.string().trim().max(500).optional().nullable(),
});

const rescheduleAppointmentSchema = z.object({
  start_at: z.string().min(1, "start_at is required"),
  employee_id: z.number().int().positive().optional().nullable(),
});

const cancelAppointmentSchema = z.object({
  reason: z.string().trim().max(200).optional().nullable(),
});

module.exports = {
  loginSchema,
  signupSchema,
  requestOtpSchema,
  verifyOtpSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  updateProfileSchema,
  addressSchema,
  bookAppointmentSchema,
  rescheduleAppointmentSchema,
  cancelAppointmentSchema,
};
