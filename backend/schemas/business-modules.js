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

module.exports = { ToggleModuleSchema };
