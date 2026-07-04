# 08 — Treatment plans mode (clinical)

**Covers:** mode `treatment_plans` + presets `dental_clinic`, `veterinary`, `physiotherapy` (their appointments surface is covered by plan 03; this plan owns the clinical stack)
**Modes/flags in scope:** `phase4_treatment_plans` (+ `phase4_appointments` interplay)
**Surfaces touched:** admin app · POS (session checkout / folio) · customer portal (treatments tab) · reports (Clinical group)
**Branch strategy:** backend/wiring off `main`.

---

## Call-path map + verification checklist

| Flow | Screen / component | API call | Route → service | "Wired correctly = …" | Status |
|---|---|---|---|---|---|
| Patient subject | `CustomersRedesign` clinical fields / `treatment/` pages | subject endpoints | `treatment-plans.js` (mode + flag + `manage_treatment_plans`) → `services/treatment-plan-service.js` | `subject_type_default` per preset (self vs pet); vet owner↔pet linkage | ☐ |
| Plan from template | `/treatment-plans/templates` | `/api/treatment-plan-templates` | `treatment-plan-templates.js` | template → plan instantiation w/ procedures + pricing | ☐ |
| Charting | `DentalChart`/`BodyChart` (`treatment/` subdir) | chart endpoints | `treatment-plan-service.js` | `chart_preset` per preset (dental / vet_body / body) renders + persists marks | ☐ |
| Sessions | `/treatment-plans/calendar` | session endpoints | `startSession`/`completeSession`/`markSessionNoShow`/`cancelSession` | session ↔ appointment linkage; no-show tracked | ☐ |
| Lab orders | `/treatment-plans/labs` | lab endpoints | service lab sub-system | order → result turnaround visible (feeds `reports/clinical.js` lab-turnaround) | ☐ |
| Consent | plan detail | consent endpoints | `clinical_config.consent_templates` per preset | preset template list offered (extraction/implant vs euthanasia vs manual_therapy) | ☐ |
| Deposits | plan detail | deposit pre-auth | `services/treatment-plan-deposits.js` → gateway | pre-auth; **captured on plan settle** (not checkout — contrast rooms); webhook `findPlanByIntent` | ☐ |
| Plan folio + settle | plan folio | folio endpoints | treatment folio sub-system | procedures billed; settle nets deposit; POS session checkout posts to folio | ☐ |
| Reminders / overdue | (worker) | — | treatment-plan reminder worker (`getOverduePlans`, `getUpcomingSessionsNeedingReminder`) | reminder emails enqueue | ☐ |
| Portal: my treatments | `PortalTreatments` | `customer-portal/treatments.js` (tab `treatments` → `phase4_treatment_plans`, mapping correct — `data.js:34`) | — | patient/owner sees plan progress; per-preset tab label (My Treatment Plans / Pet Treatment Plans / My Treatment) | ☐ |
| Clinical reports | Reports → Clinical group | `reports/clinical.js` (flag + `view_reports`) | — | completion/attendance/revenue-per-plan/retention/lab-turnaround all 200; group only visible for clinical presets (`visible_report_groups` includes "Clinical") | ☐ |

## Defects (P0) — confirmed broken wiring
- None confirmed from this run's tool results.

## Feature-parity gaps (P1)
- **Generic intake forms** — 🟡 §5 (shared with plan 03): clinical document capture exists — decide whether the generic-form gap is closed here (extend clinical docs) or in 03 (booking-time forms). Coordinate, don't duplicate.
- Otherwise none — clinical verticals are §10 exceeds-Square.

## Polish & consistency (P2)
- Vet: Owner vs Patient(pet) labels on receipts + portal.
- Dashboard widgets `active_treatment_plans` + `overdue_sessions` (only these 3 presets set them) render with data.
- Clinical doc upload uses `clinicalDocFileFilter` (PDF+raster, no SVG) — friendly rejection message.

## Confirm during execution
- `treatment_plan_templates` schema drift ([[followup_b15_schema_drift]] — v46 gap in schema-pg.sql): fresh-provisioned tenant vs migrated tenant have identical table shape.
- Session checkout at POS → which write path (sale vs folio line) and tax chain (01 diff — never audited for treatment folios).
- Deposit capture on settle when plan is cancelled mid-way (refund path?).

## Cross-surface lens (mandatory)
- **Appointments interplay** → sessions and bookings must not double-book the same provider slot (03 owns the availability engine).
- **Tax** → folio/settle in 01 diff.
- **Payments/webhooks** → shared gateway intent routing with rooms/billing.
- **Portal** → treatments visible only for own subject; vet portal shows pet names, not other owners' data.

## Verification bar (execution)
- Test tenant: fresh `dental_clinic` (richest clinical config); spot-check `veterinary` pet-subject flow.
- Walkthrough: patient → template plan → chart marks → session via calendar → lab order → consent → deposit → sessions complete → settle → portal shows progress → clinical report tabs 200.
- Done = rows ☑ + verifier confirms.

## Preset-skin checklist
- `dental_clinic` — [ ] labels (Procedure/Patient/Visit/Treatment Plan) [ ] dental chart preset [ ] consent set (extraction/implant) [ ] dashboard clinical widgets [ ] portal "My Treatment Plans" [ ] Clinical report group
- `veterinary` — [ ] Owner labels + pet subjects [ ] vet_body chart [ ] euthanasia consent present [ ] portal "Pet Treatment Plans"
- `physiotherapy` — [ ] Session vocab [ ] body chart [ ] portal "My Treatment"
