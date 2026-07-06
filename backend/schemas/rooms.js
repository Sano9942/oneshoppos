"use strict";

const { z } = require("zod");

const OCCUPANCY_STATUSES = ["vacant", "occupied", "reserved"];
const HOUSEKEEPING_STATUSES = ["clean", "dirty", "inspected", "out_of_order"];
const BOOKING_STATUSES = [
  "reserved",
  "confirmed",
  "checked_in",
  "checked_out",
  "completed",
  "invoiced",
  "cancelled",
  "no_show",
];
const FOLIO_LINE_TYPES = ["room_night", "pos_sale", "manual_charge", "discount", "tax"];
const DEPOSIT_STATUSES = ["pending", "authorized", "captured", "released", "failed"];

// ── Room types ─────────────────────────────────────────────────────
const createRoomTypeSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  outlet_id: z.number().int().positive().optional(),
  capacity: z.number().int().min(1).default(2),
  base_rate: z.number().min(0),
  deposit_required: z.number().min(0).default(0),
  amenities: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
});
const updateRoomTypeSchema = createRoomTypeSchema.partial();

// ── Rate overrides ────────────────────────────────────────────────
const createRateOverrideSchema = z
  .object({
    from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from_date must be YYYY-MM-DD"),
    to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to_date must be YYYY-MM-DD"),
    rate: z.number().min(0),
    label: z.string().max(200).nullable().optional(),
  })
  .refine((d) => d.from_date <= d.to_date, { message: "from_date must be <= to_date" });

const updateRateOverrideSchema = z.object({
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rate: z.number().min(0).optional(),
  label: z.string().max(200).nullable().optional(),
});

// ── Rooms ─────────────────────────────────────────────────────────
const roomBaseSchema = z.object({
  // Optional when parent_room_id is set — a bed inherits the dorm's type (V10).
  room_type_id: z.number().int().positive().optional(),
  parent_room_id: z.number().int().positive().nullable().optional(),
  outlet_id: z.number().int().positive().optional(),
  room_number: z.string().min(1).max(50),
  floor: z.string().max(50).nullable().optional(),
  occupancy_status: z.enum(OCCUPANCY_STATUSES).optional(),
  housekeeping_status: z.enum(HOUSEKEEPING_STATUSES).optional(),
  notes: z.string().max(2000).nullable().optional(),
  is_active: z.boolean().optional(),
});
const createRoomSchema = roomBaseSchema.superRefine((d, ctx) => {
  if (!d.room_type_id && !d.parent_room_id) {
    ctx.addIssue({ code: "custom", path: ["room_type_id"], message: "room_type_id required (unless the room is a bed with parent_room_id)" });
  }
});
const updateRoomSchema = roomBaseSchema.partial();

const housekeepingSchema = z.object({
  housekeeping_status: z.enum(HOUSEKEEPING_STATUSES),
  notes: z.string().max(2000).nullable().optional(),
});

// ── Bookings ──────────────────────────────────────────────────────
const createBookingSchema = z
  .object({
    customer_id: z.number().int().positive().nullable().optional(),
    outlet_id: z.number().int().positive().optional(),
    room_id: z.number().int().positive().nullable().optional(),
    room_type_id: z.number().int().positive(),
    check_in_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "check_in_date must be YYYY-MM-DD"),
    check_out_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "check_out_date must be YYYY-MM-DD"),
    deposit_collected: z.number().min(0).default(0),
    deposit_method: z.string().max(50).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((d) => d.check_out_date > d.check_in_date, {
    message: "check_out_date must be after check_in_date",
  });

const updateBookingSchema = z
  .object({
    customer_id: z.number().int().positive().nullable().optional(),
    room_id: z.number().int().positive().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

const cancelBookingSchema = z.object({
  cancellation_reason: z.string().max(500).optional(),
});

// V10 guest registration — guests captured at the desk during check-in.
const bookingGuestSchema = z.object({
  name: z.string().min(1).max(200),
  cnic_passport: z.string().max(100).nullable().optional(),
  nationality: z.string().max(100).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  document_photos: z.array(z.string().max(500)).max(10).optional(),
  is_primary: z.boolean().optional(),
});

const checkInSchema = z.object({
  actual_checkin: z.string().optional(),
  room_id: z.number().int().positive().optional(),
  guests: z.array(bookingGuestSchema).max(20).optional(),
  skip_registration: z.boolean().optional(),
});

const checkOutSchema = z.object({
  actual_checkout: z.string().optional(),
});

// ── Folio lines ───────────────────────────────────────────────────
const addFolioLineSchema = z.object({
  line_type: z.enum(["manual_charge", "discount"]).default("manual_charge"),
  description: z.string().min(1).max(500),
  quantity: z.number().min(0.001).default(1),
  unit_price: z.number(),
  tax_id: z.number().int().positive().nullable().optional(), // V10 folio-tax
});

const attachSaleSchema = z.object({
  sale_id: z.number().int().positive(),
});

const settleFolioSchema = z.object({
  capture_deposit: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// ── Deposit preauth ───────────────────────────────────────────────
const depositPreAuthSchema = z.object({
  amount: z.number().min(0).optional(),
  return_url: z.string().url().optional(),
  cancel_url: z.string().url().optional(),
});

// ── V10: group bookings ───────────────────────────────────────────
const createBookingGroupSchema = z.object({
  name: z.string().min(1).max(200),
  customer_id: z.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  bookings: z
    .array(
      z.object({
        room_type_id: z.number().int().positive(),
        room_id: z.number().int().positive().nullable().optional(),
        customer_id: z.number().int().positive().nullable().optional(),
        check_in_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        check_out_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notes: z.string().max(2000).nullable().optional(),
      }).refine((d) => d.check_out_date > d.check_in_date, {
        message: "check_out_date must be after check_in_date",
      })
    )
    .min(1)
    .max(50),
});

// ── V10: iCal channel feeds ───────────────────────────────────────
const createChannelFeedSchema = z
  .object({
    direction: z.enum(["export", "import"]),
    name: z.string().min(1).max(200),
    channel_name: z.string().max(100).nullable().optional(), // "Booking.com", "Airbnb"…
    room_id: z.number().int().positive().nullable().optional(),
    room_type_id: z.number().int().positive().nullable().optional(),
    url: z.string().url().max(1000).optional(), // import source URL
    is_active: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.direction === "import" && !d.url) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "import feeds need the OTA calendar URL" });
    }
    if (d.direction === "import" && !d.room_id) {
      ctx.addIssue({ code: "custom", path: ["room_id"], message: "import feeds map to one room" });
    }
  });

const updateChannelFeedSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  channel_name: z.string().max(100).nullable().optional(),
  url: z.string().url().max(1000).optional(),
  is_active: z.boolean().optional(),
});

// ── V10: night audit ──────────────────────────────────────────────
const nightAuditRunSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // default: yesterday
});

// ── V10: public booking engine (untrusted caller — tight) ─────────
const publicRoomBookSchema = z
  .object({
    room_type_id: z.number().int().positive(),
    check_in_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    check_out_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    guest_name: z.string().min(1).max(200),
    guest_phone: z.string().max(50).nullable().optional(),
    guest_email: z.string().email().max(200).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .refine((d) => d.check_out_date > d.check_in_date, {
    message: "check_out_date must be after check_in_date",
  })
  .refine((d) => d.guest_phone || d.guest_email, {
    message: "phone or email required so we can confirm your booking",
  });

module.exports = {
  OCCUPANCY_STATUSES,
  HOUSEKEEPING_STATUSES,
  BOOKING_STATUSES,
  FOLIO_LINE_TYPES,
  DEPOSIT_STATUSES,
  createRoomTypeSchema,
  updateRoomTypeSchema,
  createRateOverrideSchema,
  updateRateOverrideSchema,
  createRoomSchema,
  updateRoomSchema,
  housekeepingSchema,
  createBookingSchema,
  updateBookingSchema,
  cancelBookingSchema,
  checkInSchema,
  checkOutSchema,
  addFolioLineSchema,
  attachSaleSchema,
  settleFolioSchema,
  depositPreAuthSchema,
  // V10
  bookingGuestSchema,
  createBookingGroupSchema,
  createChannelFeedSchema,
  updateChannelFeedSchema,
  nightAuditRunSchema,
  publicRoomBookSchema,
};
