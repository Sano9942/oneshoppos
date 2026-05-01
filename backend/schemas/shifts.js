"use strict";
const { z } = require("zod");

const DenominationSchema = z.object({
  denomination: z.coerce.number().positive(),
  count: z.coerce.number().int().min(0),
});

const OpenShiftSchema = z.object({
  outlet_id: z.coerce.number().int().positive("outlet_id is required"),
  employee_id: z.coerce.number().int().positive().optional().nullable(),
  opening_float: z.coerce.number().min(0, "opening_float is required"),
  denominations: z.array(DenominationSchema).optional(),
});

const CloseShiftSchema = z.object({
  closing_cash: z.coerce.number().min(0, "closing_cash is required"),
  notes: z.string().max(2000).nullable().optional(),
  variance_reason: z.string().max(500).nullable().optional(),
  variance_approved_by: z.string().max(200).nullable().optional(),
  // Manager PIN supplied when phase2g_risk_controls is on AND the variance
  // exceeds the tenant threshold. The route resolves this via verifyManagerPin
  // and stores the manager's employee_id in variance_approved_by. Without
  // this declaration the PIN was stripped by Zod and the close 400'd with
  // "Manager PIN required" even when one was provided.
  variance_approved_by_pin: z.string().max(20).nullable().optional(),
  denominations: z.array(DenominationSchema).optional(),
});

const VarianceApproveSchema = z.object({
  approved_by: z.string().min(1).max(200),
  approval_note: z.string().max(500).optional(),
});

module.exports = {
  OpenShiftSchema,
  CloseShiftSchema,
  VarianceApproveSchema,
  DenominationSchema,
};
