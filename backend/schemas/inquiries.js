const { z } = require("zod");

// V08 — public inquiry form body. Tighter than staff-facing lead CRUD: the
// caller is untrusted, so no stage/priority/assigned_to fields. turnstile_token
// rides through for the captcha guard (verified in the route, not here).
const publicInquirySchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().email().max(160).optional().or(z.literal("")),
    event_date: z.string().trim().max(40).optional(),
    event_type: z.string().trim().max(80).optional(),
    message: z.string().trim().max(2000).optional(),
    turnstile_token: z.string().optional(),
  })
  .passthrough();

module.exports = { publicInquirySchema };
