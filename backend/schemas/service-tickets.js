"use strict";

const { z } = require("zod");

const STATUSES = ["intake", "approved", "in_progress", "on_hold", "completed", "invoiced", "cancelled"];

// ── Device intake (V06) ──────────────────────────────────────────
// checklist is a free-form {label: true|false|null} map (null = not yet
// checked); accessories/photos are string arrays (photos hold R2 keys).
const deviceInputSchema = z.object({
  device_type: z.string().max(100).optional(),
  brand: z.string().max(100).optional(),
  model: z.string().max(150).optional(),
  serial_number: z.string().max(150).optional(),
  imei: z.string().max(50).optional(),
  passcode: z.string().max(100).optional(),
  condition_notes: z.string().max(2000).optional(),
  accessories: z.array(z.string().max(100)).optional(),
  checklist: z.record(z.string(), z.union([z.boolean(), z.null()])).optional(),
  photos: z.array(z.string().max(500)).optional(),
});
// Update reuses the same all-optional shape (passcode "" clears it).
const updateDeviceSchema = deviceInputSchema;

// ── Repair-type checklist templates (V06) ────────────────────────
const createTicketTypeSchema = z.object({
  name: z.string().min(1).max(150),
  checklist_template: z.array(z.string().min(1).max(200)).optional(),
  default_warranty_days: z.number().int().min(0).nullable().optional(),
  sort_order: z.number().int().optional(),
  active: z.boolean().optional(),
});
const updateTicketTypeSchema = createTicketTypeSchema.partial();

const createTicketSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  customer_id: z.number().int().positive().optional(),
  outlet_id: z.number().int().positive().optional(),
  assigned_to: z.number().int().positive().optional(),
  ticket_type_id: z.number().int().positive().optional(),
  expected_completion: z.string().optional(),
  deposit_amount: z.number().min(0).optional(),
  deposit_method: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
  // Optional one-page intake: attach devices with the ticket in one call.
  devices: z.array(deviceInputSchema).optional(),
});

const updateTicketSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).optional(),
  customer_id: z.number().int().positive().nullable().optional(),
  outlet_id: z.number().int().positive().nullable().optional(),
  assigned_to: z.number().int().positive().nullable().optional(),
  ticket_type_id: z.number().int().positive().nullable().optional(),
  expected_completion: z.string().nullable().optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(STATUSES).optional(),
}).strict();

const addNoteSchema = z.object({
  description: z.string().min(1).max(2000),
});

// ── Parts / labor / fee lines (V06) ──────────────────────────────
// For a `part` with product_id, description/unit_price/unit_cost default from
// the product; for labor/fee the service requires description + unit_price.
const addItemSchema = z.object({
  item_type: z.enum(["part", "labor", "fee"]),
  product_id: z.number().int().positive().optional(),
  variant_id: z.number().int().positive().optional(),
  product_serial_id: z.number().int().positive().optional(),
  description: z.string().max(300).optional(),
  quantity: z.number().positive().optional(),
  unit_price: z.number().min(0).optional(),
  unit_cost: z.number().min(0).optional(),
});

module.exports = {
  createTicketSchema,
  updateTicketSchema,
  addNoteSchema,
  deviceInputSchema,
  updateDeviceSchema,
  createTicketTypeSchema,
  updateTicketTypeSchema,
  addItemSchema,
  STATUSES,
};
