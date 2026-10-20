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
  // F3b 3b: kiosk camera photo (data URL, ~100 KB). Optional: a failed camera never blocks the press.
  photo_base64: z.string().max(2_100_000).optional().nullable(),
});

const VALID_BREAK_REASONS = ["lunch", "prayer", "bathroom", "personal", "other"];
const PinCheckoutSchema = z.object({
  pin_code: z.string().min(1, "pin_code is required").max(20),
  break_reason: z.enum(VALID_BREAK_REASONS).nullable().optional(),
  outlet_id: z.coerce.number().int().positive().optional().nullable(),
  photo_base64: z.string().max(2_100_000).optional().nullable(),
});

const VALID_STATUSES = ["present", "checked_out", "absent", "late"];
const AttendanceCreateSchema = z.object({
  employee_id: z.coerce.number().int().positive("employee_id is required"),
  outlet_id: z.coerce.number().int().positive("outlet_id is required"),
  check_in: z.string().min(1, "check_in is required"),
  check_out: z.string().optional().nullable(),
  status: z.enum(VALID_STATUSES).optional().nullable(),
  comment: z.string().max(2000).optional().nullable(),
});

module.exports = {
  PinStatusSchema,
  PinCheckinSchema,
  PinCheckoutSchema,
  AttendanceCreateSchema,
};
