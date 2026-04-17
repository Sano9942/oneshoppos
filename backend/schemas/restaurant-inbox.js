const { z } = require("zod");

// Phase 2.1 B2 — online ordering inbox. Accept converts a web_order into a
// restaurant draft_order. order_context defaults to 'online' but the manager
// can override (e.g. "this WhatsApp order is actually dine_in — customer is
// here"). outlet_id overrides whatever the web_order carried.
const acceptInboxSchema = z.object({
  order_context: z.enum(["online", "takeout", "delivery", "dine_in"]).default("online"),
  outlet_id: z.number().int().positive().optional(),
});

const rejectInboxSchema = z.object({
  reason: z.string().min(1).max(500),
});

module.exports = { acceptInboxSchema, rejectInboxSchema };
