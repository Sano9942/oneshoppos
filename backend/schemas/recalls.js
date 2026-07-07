"use strict";

/**
 * Zod schemas for V05 recall / continuing-care + vet vaccinations.
 * Consumed by routes/recalls.js via validate(schema).
 */

const { z } = require("zod");

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const createRecallSchema = z
  .object({
    customer_id: z.coerce.number().int().positive(),
    patient_subject_id: z.coerce.number().int().positive().nullable().optional(),
    recall_type: z.string().min(1).max(80).optional(),
    interval_months: z.coerce.number().int().min(1).max(120).nullable().optional(),
    due_date: dateStr.optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => v.due_date || v.interval_months, {
    message: "due_date or interval_months required",
  });

const bookRecallSchema = z
  .object({
    appointment_id: z.coerce.number().int().positive().optional(),
    scheduled_at: z.string().min(10).max(40).optional(),
    employee_id: z.coerce.number().int().positive().nullable().optional(),
  })
  .refine((v) => v.appointment_id || v.scheduled_at, {
    message: "appointment_id or scheduled_at required",
  });

const dismissRecallSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
});

const administerVaccinationSchema = z.object({
  patient_subject_id: z.coerce.number().int().positive(),
  vaccine_name: z.string().min(1).max(120),
  administered_at: dateStr.optional(),
  treatment_session_id: z.coerce.number().int().positive().nullable().optional(),
  next_due: dateStr.nullable().optional(),
  batch_number: z.string().max(80).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

module.exports = {
  createRecallSchema,
  bookRecallSchema,
  dismissRecallSchema,
  administerVaccinationSchema,
};
