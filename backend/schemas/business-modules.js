"use strict";
const { z } = require("zod");

// POST /api/business-modules/:key/toggle — the key travels in the URL; the
// body carries only the direction and the dependency-cascade consent.
const ToggleModuleSchema = z.object({
  enabled: z.boolean(),
  // Only meaningful on disable: consent to also disable enabled dependents
  // (the UI shows them first via GET /:key/impact).
  cascade: z.boolean().optional().default(false),
});

// POST /api/business-modules/:key/outlet-toggle (PLAN-V2 Step 8) — one of two
// mutually-exclusive shapes, the key travels in the URL:
//   { outlet_id, enabled: true|false|null }  — set/clear ONE outlet's override
//       (enabled:null clears it so the outlet re-inherits the card default)
//   { default_outlet_enabled: bool }         — set the card's default for
//       unlisted / future outlets
// enabled is nullable (null = clear) and must be present when outlet_id is set;
// it must NOT accompany default_outlet_enabled.
const OutletToggleSchema = z
  .object({
    outlet_id: z.coerce.number().int().positive().optional(),
    enabled: z.boolean().nullable().optional(),
    default_outlet_enabled: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    const hasOutlet = val.outlet_id !== undefined;
    const hasDefault = val.default_outlet_enabled !== undefined;
    if (hasOutlet && hasDefault) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Send either {outlet_id, enabled} or {default_outlet_enabled}, not both",
        path: [],
      });
      return;
    }
    if (!hasOutlet && !hasDefault) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Send {outlet_id, enabled} or {default_outlet_enabled}",
        path: [],
      });
      return;
    }
    if (hasOutlet && val.enabled === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "enabled is required (true, false, or null to clear) when outlet_id is set",
        path: ["enabled"],
      });
    }
    if (hasDefault && val.enabled !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "enabled must not be sent with default_outlet_enabled",
        path: ["enabled"],
      });
    }
  });

module.exports = { ToggleModuleSchema, OutletToggleSchema };
