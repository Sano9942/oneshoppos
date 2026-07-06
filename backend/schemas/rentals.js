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

const checkoutSchema = z.object({
  deposit_method: z.string().max(50).optional(),
  deposit_paid_at: z.string().optional(),
  actual_checkin: z.string().optional(),
});

const returnSchema = z.object({
  actual_return: z.string().optional(),
  condition_notes: z.string().max(2000).nullable().optional(),
  late_fee: z.number().min(0).optional(),
  late_fee_override: z.boolean().optional(),
  // F04: amount of the security-deposit hold to capture on return (damage/late
  // fee). Omit or 0 → release the hold. Capped at the authorized amount by the
  // deposit engine.
  deposit_capture_amount: z.number().min(0).optional(),
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
  PAYMENT_POLICIES,
  RATE_TYPES,
  ASSET_STATUSES,
  CONTRACT_STATUSES,
};
