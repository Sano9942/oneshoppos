"use strict";

const { z } = require("zod");

const SUBJECT_TYPES = ["self", "dependent", "pet"];
const PLAN_STATUSES = ["draft", "active", "on_hold", "completed", "discontinued", "invoiced"];
const SESSION_STATUSES = ["scheduled", "in_progress", "completed", "no_show", "cancelled"];
const CONDITION_CODES = [
  "healthy", "caries", "restoration", "extraction", "crown",
  "root_canal", "missing", "implant", "mobility", "plaque",
  "gingivitis", "custom",
];
const SEVERITY_LEVELS = ["mild", "moderate", "severe"];
const LAB_STATUSES = ["ordered", "in_transit", "received", "completed", "cancelled"];
const CONSENT_RELATIONS = ["self", "parent", "guardian", "owner", "next_of_kin"];
const DOCUMENT_TYPES = [
  "lab_report", "imaging_xray", "imaging_ct", "imaging_mri",
  "photo", "referral_letter", "discharge_summary", "other",
];
const FOLIO_LINE_TYPES = [
  "session_fee", "pos_sale", "lab_cost", "manual_charge", "discount", "tax",
];

// ── Patient subjects (pets / dependents) ─────────────────────────────

const createPatientSubjectSchema = z.object({
  customer_id: z.number().int().positive(),
  subject_type: z.enum(SUBJECT_TYPES).default("self"),
  name: z.string().min(1).max(200),
  species: z.string().max(100).nullable().optional(),
  breed: z.string().max(100).nullable().optional(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sex: z.string().max(20).nullable().optional(),
  weight_kg: z.number().min(0).nullable().optional(),
  identifier: z.string().max(200).nullable().optional(),
  photo_url: z.string().max(2000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  is_active: z.boolean().optional(),
  // V05 — structured safety data (string arrays; free text entries).
  allergies: z.array(z.string().min(1).max(200)).max(100).optional(),
  medical_alerts: z.array(z.string().min(1).max(200)).max(100).optional(),
  current_medications: z.array(z.string().min(1).max(200)).max(100).optional(),
});

const updatePatientSubjectSchema = createPatientSubjectSchema.partial();

// ── Plans ────────────────────────────────────────────────────────────

const createPlanSchema = z.object({
  customer_id: z.number().int().positive(),
  subject_id: z.number().int().positive().nullable().optional(),
  outlet_id: z.number().int().positive().optional(),
  provider_id: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).max(500),
  diagnosis_code: z.string().max(100).nullable().optional(),
  diagnosis_notes: z.string().max(5000).nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  expected_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  total_sessions_planned: z.number().int().min(1).default(1),
  estimated_total: z.number().min(0).default(0),
  deposit_collected: z.number().min(0).default(0),
  deposit_method: z.string().max(50).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  // V05 — recall config + folio-tax source (copied from template or set directly).
  recall_interval_months: z.number().int().min(1).max(120).nullable().optional(),
  recall_type: z.string().min(1).max(80).optional(),
  tax_id: z.number().int().positive().nullable().optional(),
});

const updatePlanSchema = z.object({
  subject_id: z.number().int().positive().nullable().optional(),
  provider_id: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).max(500).optional(),
  diagnosis_code: z.string().max(100).nullable().optional(),
  diagnosis_notes: z.string().max(5000).nullable().optional(),
  expected_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  total_sessions_planned: z.number().int().min(1).optional(),
  estimated_total: z.number().min(0).optional(),
  notes: z.string().max(5000).nullable().optional(),
  recall_interval_months: z.number().int().min(1).max(120).nullable().optional(),
  recall_type: z.string().min(1).max(80).optional(),
  tax_id: z.number().int().positive().nullable().optional(),
}).strict();

const planStatusTransitionSchema = z.object({
  reason: z.string().max(500).optional(),
});

const planNoteSchema = z.object({
  description: z.string().min(1).max(5000),
});

// ── Sessions ─────────────────────────────────────────────────────────

const createSessionSchema = z.object({
  scheduled_at: z.string().min(1).nullable().optional(),
  provider_id: z.number().int().positive().nullable().optional(),
  chief_complaint: z.string().max(2000).nullable().optional(),
  create_appointment: z.boolean().optional(),
});

const updateSessionSchema = z.object({
  scheduled_at: z.string().nullable().optional(),
  provider_id: z.number().int().positive().nullable().optional(),
  chief_complaint: z.string().max(2000).nullable().optional(),
  next_session_notes: z.string().max(2000).nullable().optional(),
}).strict();

// Captures SOAP + optional vitals + prescriptions + chart entries — one tx
const vitalSignInputSchema = z.object({
  blood_pressure_sys: z.number().int().nullable().optional(),
  blood_pressure_dia: z.number().int().nullable().optional(),
  heart_rate: z.number().int().nullable().optional(),
  respiratory_rate: z.number().int().nullable().optional(),
  temperature_c: z.number().nullable().optional(),
  oxygen_saturation: z.number().nullable().optional(),
  weight_kg: z.number().nullable().optional(),
  height_cm: z.number().nullable().optional(),
  pain_score: z.number().int().min(0).max(10).nullable().optional(),
  custom_vitals: z.record(z.any()).optional(),
});

const prescriptionInputSchema = z.object({
  medication_name: z.string().min(1).max(200),
  strength: z.string().max(100).nullable().optional(),
  dosage: z.string().max(200).nullable().optional(),
  frequency: z.string().max(200).nullable().optional(),
  duration: z.string().max(200).nullable().optional(),
  instructions: z.string().max(2000).nullable().optional(),
  refills_remaining: z.number().int().min(0).default(0),
});

const chartEntryInputSchema = z.object({
  area_code: z.string().min(1).max(100),
  condition_code: z.enum(CONDITION_CODES),
  severity: z.enum(SEVERITY_LEVELS).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  color_marker: z.string().max(50).nullable().optional(),
});

const completeSessionSchema = z.object({
  soap_subjective: z.string().max(5000).nullable().optional(),
  soap_objective: z.string().max(5000).nullable().optional(),
  soap_assessment: z.string().max(5000).nullable().optional(),
  soap_plan: z.string().max(5000).nullable().optional(),
  next_session_notes: z.string().max(2000).nullable().optional(),
  session_fee: z.number().min(0).optional(),
  vitals: z.array(vitalSignInputSchema).optional(),
  prescriptions: z.array(prescriptionInputSchema).optional(),
  chart_entries: z.array(chartEntryInputSchema).optional(),
});

// ── Chart ────────────────────────────────────────────────────────────

const addChartEntrySchema = chartEntryInputSchema;

const updateChartEntrySchema = z.object({
  condition_code: z.enum(CONDITION_CODES).optional(),
  severity: z.enum(SEVERITY_LEVELS).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  color_marker: z.string().max(50).nullable().optional(),
}).strict();

// ── Lab orders ───────────────────────────────────────────────────────

const createLabOrderSchema = z.object({
  session_id: z.number().int().positive().nullable().optional(),
  lab_vendor: z.string().max(200).nullable().optional(),
  test_name: z.string().min(1).max(500),
  test_code: z.string().max(100).nullable().optional(),
  cost: z.number().min(0).default(0),
  notes: z.string().max(2000).nullable().optional(),
});

const updateLabOrderSchema = z.object({
  status: z.enum(LAB_STATUSES).optional(),
  lab_vendor: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  shared_with_patient: z.boolean().optional(),
}).strict();

const recordLabResultSchema = z.object({
  result_summary: z.string().max(5000),
  result_document_id: z.number().int().positive().nullable().optional(),
  shared_with_patient: z.boolean().optional(),
});

// ── Consent ──────────────────────────────────────────────────────────

const signConsentSchema = z.object({
  form_template_key: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  body_markdown: z.string().min(1),
  signed_by_name: z.string().min(1).max(200),
  signed_by_relation: z.enum(CONSENT_RELATIONS).default("self"),
  signature_image_base64: z.string().optional(),
  session_id: z.number().int().positive().nullable().optional(),
  witnessed_by_id: z.number().int().positive().nullable().optional(),
});

// ── Clinical documents ───────────────────────────────────────────────

const uploadClinicalDocumentSchema = z.object({
  document_type: z.enum(DOCUMENT_TYPES),
  title: z.string().min(1).max(500),
  session_id: z.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  shared_with_patient: z.boolean().optional(),
});

// ── Prescriptions (standalone) ───────────────────────────────────────

const createPrescriptionSchema = prescriptionInputSchema;

// ── Folio ────────────────────────────────────────────────────────────

const addFolioLineSchema = z.object({
  line_type: z.enum(["manual_charge", "discount", "lab_cost"]).default("manual_charge"),
  description: z.string().min(1).max(500),
  quantity: z.number().min(0.001).default(1),
  unit_price: z.number(),
  // V05 folio-tax — explicit tax for taxable manual/lab charges.
  tax_id: z.number().int().positive().nullable().optional(),
});

const attachSaleToFolioSchema = z.object({
  sale_id: z.number().int().positive(),
});

const settleFolioSchema = z.object({
  apply_deposit: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

module.exports = {
  SUBJECT_TYPES,
  PLAN_STATUSES,
  SESSION_STATUSES,
  CONDITION_CODES,
  SEVERITY_LEVELS,
  LAB_STATUSES,
  CONSENT_RELATIONS,
  DOCUMENT_TYPES,
  FOLIO_LINE_TYPES,
  createPatientSubjectSchema,
  updatePatientSubjectSchema,
  createPlanSchema,
  updatePlanSchema,
  planStatusTransitionSchema,
  planNoteSchema,
  createSessionSchema,
  updateSessionSchema,
  completeSessionSchema,
  addChartEntrySchema,
  updateChartEntrySchema,
  createLabOrderSchema,
  updateLabOrderSchema,
  recordLabResultSchema,
  signConsentSchema,
  uploadClinicalDocumentSchema,
  createPrescriptionSchema,
  addFolioLineSchema,
  attachSaleToFolioSchema,
  settleFolioSchema,
};
