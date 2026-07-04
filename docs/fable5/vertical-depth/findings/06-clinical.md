# Clinical (Clinic · Dental · Veterinary · Physiotherapy)

**Presets:** `clinic`, `dental_clinic`, `veterinary`, `physiotherapy` — grouped because the three `clinical_treatment` presets share one code stack (`treatment_plans` + `appointments` modes, per-preset `clinical_config` chart presets — `industry-config.js:575-691`), and the generic `clinic` preset's defining finding is precisely that it is **excluded** from that stack (`modes: ["appointments"]` only — `industry-config.js:144`).
**Modes/flags:** `phase4_treatment_plans`, `phase4_appointments` (`mode-registry.js:65,22`)
**Surfaces:** POS (visit checkout) · public booking · portal (treatments/appointments/invoices) · admin
**Owned wiring plan:** [completion 08-treatment-plans.md](../../completion/plans/08-treatment-plans.md) (clinical stack) + [03-appointments-commissions.md](../../completion/plans/03-appointments-commissions.md) (booking surface)

## What's built today (from code)

The clinical stack is unexpectedly deep — the fullest of the "phase 4" verticals:

- Patient subjects: self/dependent/**pet** with species, breed, dob, sex, weight, identifier, photo — `patient_subjects` (`schema-pg.sql:4427-4444`), `/api/patient-subjects` CRUD (`routes/treatment-plans.js:56-78`) — works
- Treatment plans: lifecycle (draft→active→hold→complete/discontinue), diagnosis code/notes, sessions planned/completed, estimated total — `routes/treatment-plans.js:88-158`, `services/treatment-plan-service.js` — works
- Plan templates with default activities — `routes/treatment-plan-templates.js`, `treatment_plan_templates` (`schema-pg.sql:4485`) — works
- Sessions with **SOAP notes** (subjective/objective/assessment/plan), chief complaint, start/complete/no-show/cancel, appointment linkage (`treatment_sessions.appointment_id` — `schema-pg.sql:4508`) — works
- **Vital signs** per session: BP, HR, RR, temp, SpO₂, weight/height, pain score, custom JSONB — `vital_signs` (`schema-pg.sql:4530-4545`) — works
- Charting: chart areas with per-preset presets (`dental`, `vet_body`, `body` — `industry-config.js:609,648,687`), session chart entries — `/api/chart-areas`, `/api/treatment-plans/:id/chart` (`routes/treatment-plans.js:222-253`) — works
- **Prescriptions**: medication/strength/dosage/frequency/duration/refills per session — `prescriptions` (`schema-pg.sql:4548`), `/api/treatment-sessions/:id/prescriptions` — works
- Lab orders with results — `/api/treatment-plans/:id/lab-orders` (`routes/treatment-plans.js:263-285`) — works
- Consent forms from per-preset templates (dental: anaesthesia/extraction/implant; vet: surgery/euthanasia) — `consent_forms`, `industry-config.js:611,650` — works
- Clinical documents upload (raster+PDF, no-SVG filter — `middleware/upload-validation.js:clinicalDocFileFilter`) — works
- Financial: treatment folios (lines, attach-sale, settle → invoice), **gateway deposit pre-auth captured on settle** — `services/treatment-plan-deposits.js`, `routes/treatment-plans.js:405-445` — works
- Reminders/overdue: session-reminder + overdue-plan worker — `workers/treatment-plan-worker-boss.js`, `getUpcomingSessionsNeedingReminder` — works
- Clinical reports + dashboard widgets (active plans, overdue sessions) — `reports/clinical.js`, `industry-config.js:601` — works
- Portal: patients see treatment plans — `routes/customer-portal/treatments.js` — works

## What this industry needs (domain + research)

- Scheduling + charting + SOAP + billing in one — Jane's pitch verbatim ("scheduling, charting, billing, payments"); Cliniko: appointments, treatment notes, invoicing — source: [Jane features](https://jane.app/us/features), [Medesk Cliniko review](https://www.medesk.net/en/blog/cliniko-review/) — **largely met**
- **Recall / continuing care** — Dentrix's retention engine: recurring recall intervals (6-month hygiene), lists of overdue patients, automated outreach; "the forgotten patients" problem — source: [Dentrix continuing care](https://magazine.dentrix.com/customizing-recall-for-your-patients-in-dentrix/)
- **Structured medical history**: allergies, current medications, alerts shown at every encounter — patient-safety basics in every EMR (Jane chart templates, Dentrix health history) — source: [Jane features](https://jane.app/us/features) + domain reasoning
- Vet: **vaccination/reminder schedules** per animal — the retention loop of small-animal practice; ezyVet leads with automated variable-driven reminders — source: [ezyVet features](https://www.ezyvet.com/features)
- Physio: home-exercise programs / patient handouts — Jane/Cliniko ecosystem standard — domain reasoning
- Intake forms filled by the patient before the visit — Jane patient portal standard — source: [Jane features](https://jane.app/us/features)
- Insurance claims — Dentrix eClaims; largely N/A for PK cash practices — source: [Dentrix insurance](https://www.dentrix.com/resources/pdf/Dentrix_Insurance%20Management-eBook.pdf)

## Gap analysis (ranked)

| Requirement | Built? | Evidence (code) | Impact tier | Note |
|---|---|---|---|---|
| Generic `clinic` preset gets ANY clinical records | **no** | `industry-config.js:144` — `clinic.modes = ["appointments"]`; every clinical route above is `requireFeature("phase4_treatment_plans")`-gated, so a GP tenant has no charting, prescriptions, vitals, or patient records — it is functionally the salon preset with "Patient" labels | **P0 (clinic)** | cheapest P0 in the audit: the stack exists one flag away; decide whether `clinic` should enable `treatment_plans` (or a lighter "encounters" skin of it) |
| Recall / continuing-care system (recurring intervals, overdue-patient list, outreach) | no | reminder worker covers upcoming **sessions of active plans** only (`workers/treatment-plan-worker-boss.js`); nothing recalls a *completed* patient at +6 months — no recall table/columns in schema | **P0 (dental), P1 (vet/physio)** | dentistry's revenue engine; a Dentrix-aware dentist asks for this by name |
| Structured allergies / medical alerts / medication history | no | `patient_subjects` has only free-text `notes` (`schema-pg.sql:4440`); no allergy/alert entity; nothing surfaces at session start | P1 (all four) | patient-safety expectation; free-text notes don't flag "penicillin allergy" at prescribe time |
| Vaccination schedules + reminders (vet) | no | grep `vaccin` backend → 0 files | **P0 (veterinary)** | ~the small-animal retention loop; plan templates could fake one course but there's no per-animal recurring schedule |
| Patient intake forms (self-service, pre-visit) | no | portal (`customer-portal/treatments.js`) is read/book only; no form-builder entity | P1 | comparison doc §5 rates intake 🟡 (clinical doc capture ≠ patient-filled forms) |
| Home-exercise programs / handouts (physio) | no | no exercise/handout entity; `clinical_documents` upload could carry PDFs manually | P1 (physio) | |
| Tooth-level dental charting w/ numbering + status history | partial | chart preset `dental` + `session_chart_entries` exist (`routes/treatment-plans.js:222-253`); whether areas = individual numbered teeth with status colors needs a walkthrough | P1 (dental) | **confirm live** before ranking harder |
| Insurance claim management | no | no claim/insurer entity in schema | P2 | PK practices are overwhelmingly cash-pay; revisit for corporate-panel clinics |
| SOAP, vitals, prescriptions, labs, consents, folios, deposits, templates, portal | yes | files above | — | this is the strongest phase-4 stack in the codebase |

## Readiness verdict

**Dental / Physiotherapy: Competitive** — the plan-session-SOAP-folio spine genuinely rivals lightweight practice systems; recall automation is the gap to category-leading. **Veterinary: Minimum-viable** — pet subjects and consents are right, but no vaccination scheduling is a demo-stopper for small-animal practice. **Clinic: Not-viable as a clinical product** — it's the appointments engine wearing patient labels; enabling the existing treatment-plans stack for it is the highest-leverage single decision in this audit.
