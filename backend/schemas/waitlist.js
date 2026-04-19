const { z } = require("zod");

// 2-R.4 — Walk-in waitlist.
//
// position is server-assigned (max+1 among active entries); the client
// cannot influence ordering. Reordering happens implicitly when a
// guest is seated or removed.

const waitlistCreateSchema = z.object({
  customer_name: z.string().min(1).max(200),
  phone: z.string().max(40).optional().nullable(),
  party_size: z.coerce.number().int().positive().max(50),
  outlet_id: z.coerce.number().int().positive().optional().nullable(),
  quoted_wait_minutes: z.coerce.number().int().nonnegative().max(240).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
}).passthrough();

const waitlistSeatSchema = z.object({
  table_id: z.coerce.number().int().positive().optional().nullable(),
}).passthrough();

module.exports = { waitlistCreateSchema, waitlistSeatSchema };
