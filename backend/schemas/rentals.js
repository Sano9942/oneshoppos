"use strict";

const { z } = require("zod");

const PAYMENT_POLICIES = ["upfront", "on_return"];
const RATE_TYPES = ["hourly", "daily", "weekly"];
const ASSET_STATUSES = ["available", "rented", "maintenance", "retired"];
const CONTRACT_STATUSES = [
  "reserved",
  "confirmed",
  "checked_out",
  "returned",
  "completed",
  "invoiced",
  "cancelled",
];

const createRentalItemSchema = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  outlet_id: z.number().int().positive().optional(),
  total_quantity: z.number().int().min(1).default(1),
  daily_rate: z.number().min(0),
  hourly_rate: z.number().min(0).nullable().optional(),
  weekly_rate: z.number().min(0).nullable().optional(),
  deposit_amount: z.number().min(0).default(0),
  payment_policy: z.enum(PAYMENT_POLICIES).default("upfront"),
  is_active: z.boolean().optional(),
});

const updateRentalItemSchema = createRentalItemSchema.partial();

const createRentalAssetSchema = z.object({
  serial_number: z.string().max(100).nullable().optional(),
  label: z.string().max(200).nullable().optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  condition_notes: z.string().max(2000).nullable().optional(),
});

const updateRentalAssetSchema = createRentalAssetSchema.partial();

const contractLineSchema = z.object({
  rental_item_id: z.number().int().positive(),
  rental_asset_id: z.number().int().positive().nullable().optional(),
  quantity: z.number().int().min(1).default(1),
  rate_type: z.enum(RATE_TYPES).default("daily"),
  duration_value: z.number().min(0.01),
});

const createContractSchema = z.object({
  customer_id: z.number().int().positive().nullable().optional(),
  outlet_id: z.number().int().positive().optional(),
  rental_start: z.string().min(1),
  expected_return: z.string().min(1),
  rental_end: z.string().nullable().optional(),
  payment_policy: z.enum(PAYMENT_POLICIES).default("upfront"),
  deposit_collected: z.number().min(0).default(0),
  deposit_method: z.string().max(50).nullable().optional(),
  discount_amount: z.number().min(0).default(0),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(contractLineSchema).min(1),
});

const updateContractSchema = z.object({
  customer_id: z.number().int().positive().nullable().optional(),
  expected_return: z.string().optional(),
  rental_end: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  discount_amount: z.number().min(0).optional(),
}).strict();

// V09 car-legal: per-line odometer/fuel readings captured at checkout/return.
const lineReadingSchema = z.object({
  line_id: z.number().int().positive(),
  odometer: z.number().min(0).nullable().optional(),
  fuel_pct: z.number().min(0).max(100).nullable().optional(),
});

const checkoutSchema = z.object({
  deposit_method: z.string().max(50).optional(),
  deposit_paid_at: z.string().optional(),
  actual_checkin: z.string().optional(),
  checkout_readings: z.array(lineReadingSchema).optional(),
});

const returnSchema = z.object({
  actual_return: z.string().optional(),
  condition_notes: z.string().max(2000).nullable().optional(),
  late_fee: z.number().min(0).optional(),
  late_fee_override: z.boolean().optional(),
  return_readings: z.array(lineReadingSchema).optional(),
  // F04: amount of the security-deposit hold to capture on return (damage/late
  // fee). Omit or 0 → release the hold. Capped at the authorized amount by the
  // deposit engine.
  deposit_capture_amount: z.number().min(0).optional(),
});

// V09 car-legal: driver record (PII — staff-only endpoints).
const driverSchema = z.object({
  name: z.string().min(1).max(200),
  cnic: z.string().max(50).nullable().optional(),
  license_number: z.string().max(100).nullable().optional(),
  license_expiry: z.string().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  document_photos: z.array(z.string().max(500)).optional(),
  is_primary: z.boolean().optional(),
});

// V09: condition inspection (checkout/return).
const inspectionSchema = z.object({
  phase: z.enum(["checkout", "return"]),
  rental_asset_id: z.number().int().positive().nullable().optional(),
  checklist: z.record(z.string(), z.any()).optional(),
  photos: z.array(z.string().max(500)).optional(),
  damage_notes: z.string().max(2000).nullable().optional(),
  damage_charge: z.number().min(0).nullable().optional(),
  customer_ack_signature: z.string().max(500).nullable().optional(),
});

// V09: staff-assisted / link e-sign of the rental agreement.
const agreementSignSchema = z.object({
  signature_data: z.string().min(1),
});

// V09: delivery & setup scheduling (furniture/party).
const deliverySchema = z.object({
  delivery_required: z.boolean().optional(),
  delivery_at: z.string().nullable().optional(),
  setup_notes: z.string().max(2000).nullable().optional(),
  delivery_status: z.enum(["pending", "scheduled", "dispatched", "delivered"]).nullable().optional(),
  delivery_crew: z.array(z.number().int().positive()).optional(),
});

// V09: maintenance log entry for an asset.
const maintenanceLogSchema = z.object({
  serviced_at: z.string().optional(),
  odometer: z.number().min(0).nullable().optional(),
  cost: z.number().min(0).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// F04: rental gateway deposit pre-auth. Amount optional — falls back to the
// contract's deposit_collected when omitted.
const depositPreauthSchema = z.object({
  amount: z.number().min(0).optional(),
  returnUrl: z.string().max(500).optional(),
  cancelUrl: z.string().max(500).optional(),
});

const cancelSchema = z.object({
  cancellation_reason: z.string().max(500).optional(),
});

const noteSchema = z.object({
  description: z.string().min(1).max(2000),
});

const availabilityQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

// V09 online booking (public, untrusted caller). Creates a 'reserved' contract
// pending staff confirmation — no deposit/discount/status fields exposed.
const publicReserveSchema = z.object({
  customer_name: z.string().min(1).max(200),
  customer_phone: z.string().max(50).optional(),
  customer_email: z.string().email().max(200).optional(),
  rental_start: z.string().min(1),
  expected_return: z.string().min(1),
  notes: z.string().max(2000).optional(),
  lines: z.array(z.object({
    rental_item_id: z.number().int().positive(),
    quantity: z.number().int().min(1).default(1),
    rate_type: z.enum(RATE_TYPES).default("daily"),
    duration_value: z.number().min(0.01),
  })).min(1),
});

module.exports = {
  createRentalItemSchema,
  updateRentalItemSchema,
  createRentalAssetSchema,
  updateRentalAssetSchema,
  contractLineSchema,
  createContractSchema,
  updateContractSchema,
  checkoutSchema,
  returnSchema,
  depositPreauthSchema,
  cancelSchema,
  noteSchema,
  availabilityQuerySchema,
  publicReserveSchema,
  lineReadingSchema,
  driverSchema,
  inspectionSchema,
  agreementSignSchema,
  deliverySchema,
  maintenanceLogSchema,
  PAYMENT_POLICIES,
  RATE_TYPES,
  ASSET_STATUSES,
  CONTRACT_STATUSES,
};
