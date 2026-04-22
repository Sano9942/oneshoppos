// 2-G.13 per-device POS registry schemas
const { z } = require("zod");

const RegisterDeviceSchema = z.object({
  device_uuid: z.string().min(8).max(200),
  outlet_id: z.coerce.number().int().positive().optional().nullable(),
  label: z.string().max(200).optional().nullable(),
}).passthrough();

const UpdateDeviceSchema = z.object({
  label: z.string().max(200).optional().nullable(),
  outlet_id: z.coerce.number().int().positive().optional().nullable(),
}).passthrough();

module.exports = { RegisterDeviceSchema, UpdateDeviceSchema };
