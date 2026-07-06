const { z } = require("zod");

/**
 * V07 gym member check-in schemas. Two-tier public/staff split (per the
 * schemas convention): the PUBLIC kiosk schemas never accept a raw customer_id
 * — the lobby caller must identify by the unguessable member_code or phone, so
 * nobody can check in an arbitrary member by counting up integer ids. The STAFF
 * schemas (authed front desk) may pass a customer_id resolved from a prior
 * authenticated lookup.
 */

const memberCode = z.string().trim().min(1).max(32);
const phone = z.string().trim().min(4).max(32);

// ── Public (kiosk) — code/phone only ────────────────────────────────────
const publicMemberLookupSchema = z
  .object({
    member_code: memberCode.optional(),
    phone: phone.optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.member_code && !val.phone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "member_code or phone is required", path: ["member_code"] });
    }
  });

const publicMemberCheckinSchema = z
  .object({
    member_code: memberCode.optional(),
    phone: phone.optional(),
    class_session_id: z.coerce.number().int().positive().optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.member_code && !val.phone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "member_code or phone is required", path: ["member_code"] });
    }
  });

// ── Staff (authed front desk) — customer_id allowed ─────────────────────
const staffMemberLookupSchema = z
  .object({
    member_code: memberCode.optional(),
    phone: phone.optional(),
    customer_id: z.coerce.number().int().positive().optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.member_code && !val.phone && !val.customer_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "member_code, phone, or customer_id is required", path: ["member_code"] });
    }
  });

const staffMemberCheckinSchema = z
  .object({
    member_code: memberCode.optional(),
    phone: phone.optional(),
    customer_id: z.coerce.number().int().positive().optional(),
    outlet_id: z.coerce.number().int().positive().optional(),
    class_session_id: z.coerce.number().int().positive().optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.member_code && !val.phone && !val.customer_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "member_code, phone, or customer_id is required", path: ["member_code"] });
    }
  });

module.exports = {
  publicMemberLookupSchema,
  publicMemberCheckinSchema,
  staffMemberLookupSchema,
  staffMemberCheckinSchema,
};
