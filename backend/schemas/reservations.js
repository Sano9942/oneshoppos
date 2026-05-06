const { z } = require("zod");

// 2-R.4 — Reservations.
//
// Reservation_start must be an ISO timestamp in the future-ish (server
// does not strictly enforce — a past time is a valid backfill), reservation_end
// is optional (default = 2h after start). outlet_id + table_id are optional
// for walk-in style "staff blocks a timeslot generically" rows; a reservation
// can be pinned to a specific table or left floating.

const reservationCreateSchema = z.object({
  customer_name: z.string().min(1).max(200),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  party_size: z.coerce.number().int().positive().max(50),
  reservation_start: z.string().datetime(),
  reservation_end: z.string().datetime().optional().nullable(),
  outlet_id: z.coerce.number().int().positive().optional().nullable(),
  table_id: z.coerce.number().int().positive().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  source: z.enum(["staff", "web", "phone"]).optional(),
}).passthrough();

const reservationUpdateSchema = z.object({
  customer_name: z.string().min(1).max(200).optional(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  party_size: z.coerce.number().int().positive().max(50).optional(),
  reservation_start: z.string().datetime().optional(),
  reservation_end: z.string().datetime().optional().nullable(),
  table_id: z.coerce.number().int().positive().optional().nullable(),
  status: z.enum([
    "pending", "confirmed", "seated", "completed", "no_show", "cancelled", "waitlisted",
  ]).optional(),
  notes: z.string().max(1000).optional().nullable(),
}).passthrough();

const reservationSmsSchema = z.object({
  template: z.enum(["confirmation", "reminder", "cancellation"]),
}).passthrough();

const reservationSeatSchema = z.object({
  table_id: z.coerce.number().int().positive(),
  server_id: z.coerce.number().int().positive().optional().nullable(),
  guest_count: z.coerce.number().int().positive().max(50).optional(),
}).strict();

// Public booking — tight; the browser can't be trusted with status/source.
const publicReservationCreateSchema = z.object({
  customer_name: z.string().min(1).max(200),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  party_size: z.coerce.number().int().positive().max(20),
  reservation_start: z.string().datetime(),
  notes: z.string().max(500).optional().nullable(),
}).passthrough();

module.exports = {
  reservationCreateSchema,
  reservationUpdateSchema,
  reservationSmsSchema,
  reservationSeatSchema,
  publicReservationCreateSchema,
};
