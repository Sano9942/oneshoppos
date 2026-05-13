"use strict";

const { z } = require("zod");

const VISIT_OUTCOMES = ["ordered", "no_stock_needed", "shop_closed", "owner_away"];

// POST /api/field/check-in — rep at a shop, capturing GPS + selfie + outcome
// in a single submission. client_uuid is the offline-queue idempotency key:
// retries from the IndexedDB queue post the same UUID, the unique constraint
// on field_visits.client_uuid dedupes server-side.
const CheckInSchema = z
  .object({
    customer_id: z.coerce.number().int().positive(),
    outcome: z.enum(VISIT_OUTCOMES),
    lat: z.coerce.number().min(-90).max(90).nullable().optional(),
    lng: z.coerce.number().min(-180).max(180).nullable().optional(),
    gps_accuracy_m: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
    selfie_base64: z.string().max(2_000_000).nullable().optional(), // ~2MB compressed
    client_uuid: z.string().min(8).max(64),
    // If the rep is the first to visit and the customer has no lat/lng yet,
    // they can tag the shop's coordinates by sending tag_shop_location: true.
    // Server then upserts customers.lat/lng with the check-in coordinates.
    tag_shop_location: z.boolean().optional().default(false),
  })
  .passthrough();

// POST /api/admin/field-routes — owner seeds/updates a rep's weekly beat.
// Replace-all semantics for (employee_id, day_of_week): the API deletes
// existing route rows for that pair and inserts the new ordered list.
const SetRouteDaySchema = z
  .object({
    employee_id: z.coerce.number().int().positive(),
    day_of_week: z.coerce.number().int().min(0).max(6),
    customer_ids: z.array(z.coerce.number().int().positive()).max(50),
  })
  .passthrough();

module.exports = { CheckInSchema, SetRouteDaySchema, VISIT_OUTCOMES };
