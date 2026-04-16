"use strict";
const { z } = require("zod");

const PinStatusSchema = z.object({
  pin_code: z.string().min(1, "pin_code is required").max(20),
  outlet_id: z.coerce.number().int().positive().optional().nullable(),
});

const PinCheckinSchema = z.object({
  pin_code: z.string().min(1, "pin_code is required").max(20),
  outlet_id: z.coerce.number().int().positive("outlet_id is required"),
  latitude: z.coerce.number().optional().nullable(),
  longitude: z.coerce.number().optional().nullable(),
});

const VALID_BREAK_REASONS = ["lunch", "prayer", "bathroom", "personal", "other"];
const PinCheckoutSchema = z.object({
  pin_code: z.string().min(1, "pin_code is required").max(20),
  break_reason: z.enum(VALID_BREAK_REASONS).nullable().optional(),
  outlet_id: z.coerce.number().int().positive().optional().nullable(),
});

module.exports = {
  PinStatusSchema,
  PinCheckinSchema,
  PinCheckoutSchema,
};
