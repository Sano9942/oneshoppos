# V05 — Clinical Depth (Clinic Enablement · Recall · Vaccinations · Safety Data)

**Covers:** findings [06-clinical](../findings/06-clinical.md) — the three P0s: generic `clinic` preset excluded from the clinical stack, recall/continuing-care, vet vaccination schedules; plus structured allergies/alerts, intake forms (F03), physio home-exercise.
**Presets/modes:** `clinic`, `dental_clinic`, `veterinary`, `physiotherapy` — `treatment_plans` + `appointments` modes; the clinic-enablement P0 is a preset-config decision.
**Surfaces:** admin (charting/plans) · POS (visit checkout) · public booking · portal
**Closes findings rows:** [06] "Generic clinic preset gets ANY clinical records" (**P0 clinic**) · "Recall / continuing-care system" (**P0 dental**, P1 vet/physio) · "Vaccination schedules + reminders (vet)" (**P0 veterinary**) · "Structured allergies / medical alerts / medication history" (P1) · "Patient intake forms" (P1 — F03) · "Home-exercise programs / handouts (physio)" (P1) · "Tooth-level dental charting" (P1 — confirm live) · "Insurance claims" (P2 — parked, PK cash-pay per findings).
**Depends on:** F03 (intake), F05 (recall outreach), F06 (booking-surface improvements land there), completion plans 03+08 executed (clinical stack + booking proven, schema-drift confirm resolved — [[followup_b15_schema_drift]] flags `treatment_plan_templates` v46 drift).
**Branch:** backend off `main`; chart/recall UI rides `redesign/square`.
**Model:** **Opus, effort high.** The stack is the deepest phase-4 build; these are well-shaped extensions to it. Recall is a worker + table, not a new engine.

---

## Tasks

### P0
1. **Clinic preset enablement** — the cheapest P0 in the audit (findings verdict). Config change: `industry-config.js:144` `clinic.modes = ["appointments"]` → `["appointments","treatment_plans"]` + a `clinical_config` chart preset (`body`, like physio) + consent templates + portal tab. Decide at approval: full stack ON vs. a trimmed "encounters" default (recommend: full stack ON, features are individually flag-toggleable anyway). Backfill decision for EXISTING clinic tenants (mode-gate backfill migration precedent exists — migrations list "mode-gate backfill"). PAUSE: touches preset engine + migration.
2. **Recall / continuing-care** — schema (pause-list):
```sql
CREATE TABLE patient_recalls (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  patient_subject_id INTEGER REFERENCES patient_subjects(id),
  recall_type TEXT NOT NULL,                    -- 'hygiene','checkup','vaccination','follow_up'
  interval_months INTEGER,                      -- recurring: re-arm on completion
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due','contacted','booked','completed','dismissed')),
  source_plan_id INTEGER REFERENCES treatment_plans(id),
  appointment_id INTEGER REFERENCES appointments(id),  -- when booked
  last_contacted_at TIMESTAMPTZ, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
```
   Auto-arm: completing a plan/session with a template-level `recall_interval_months` (column on `treatment_plan_templates`, pause-list) creates/advances the recall. Worker (`workers/`, standard checklist) rolls `due` → outreach via F05 (SMS/email "time for your 6-month checkup" with public booking link) on a tenant-configured cadence. **Overdue-patients screen** (the Dentrix list): filter by type/age/status, one-click contact, mark booked (links appointment). Booking an appointment from a recall completes it and re-arms the interval.
3. **Vaccination schedules (vet)** — recall specialization, NOT a parallel table: `recall_type='vaccination'` + a `vaccination_records` table for what was administered:
```sql
CREATE TABLE vaccination_records (
  id SERIAL PRIMARY KEY,
  patient_subject_id INTEGER NOT NULL REFERENCES patient_subjects(id),
  vaccine_name TEXT NOT NULL, administered_at DATE NOT NULL,
  treatment_session_id INTEGER REFERENCES treatment_sessions(id),
  next_due DATE, batch_number TEXT, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
   Administering (from a session or standalone) writes the record + arms a `vaccination` recall at `next_due`. Vet vaccine card view per pet (printable). Vaccine catalog = plain products or a template list — keep simple, decide at review.

### P1
4. **Structured allergies / alerts** — on `patient_subjects` (pause-list): `allergies JSONB DEFAULT '[]'`, `medical_alerts JSONB DEFAULT '[]'`, `current_medications JSONB DEFAULT '[]'`. Surfaced as a red banner at: session start screen, prescription entry, booking drawer. Prescription entry cross-checks allergy list by substring match → warning (not block — clinician judgment). Findings evidence: only free-text `notes` today (schema:4440); "penicillin allergy" must flag at prescribe time.
5. **Intake forms** — F03 consumed: clinical intake template seeded per preset; auto-attach on first appointment (`auto_attach='first_appointment'`); responses visible on the patient chart.
6. **Home-exercise / handouts (physio)** — lightweight: `handouts` library (uploaded PDFs via `clinicalDocFileFilter`, title+tags) + attach-to-session → patient receives portal link / email (F05). NOT an exercise-builder — a document library with delivery. Findings note `clinical_documents` upload already carries PDFs; this adds the reusable library + patient delivery.
7. **Tooth-level charting confirm** — walk the dental chart preset live (findings: confirm whether chart areas = numbered teeth with status history). If areas are generic, extend `clinical_config.chart_preset='dental'` to seed FDI-numbered areas + per-entry status colors in the chart UI — config + UI, no schema.

### P2
8. Recall effectiveness report (contacted → booked conversion).
9. Patient medical-history print/export (chart + vitals + prescriptions summary) — server-rendered print CSS.

## Reuse map (grep-confirmed)
| Need | Reuse | Evidence |
|---|---|---|
| Reminder/overdue worker shape | `workers/treatment-plan-worker-boss.js` | findings [06] built rows |
| Outreach channels | F05 engine | plans/F05 |
| Public booking link in outreach | `routes/public-bookings.js` page | findings [05] built rows |
| Session/plan lifecycle hooks | `services/treatment-plan-service.js` completeSession/plan transitions | services/CLAUDE.md |
| Doc upload | `clinicalDocFileFilter` | backend/CLAUDE.md |
| Chart presets | `clinical_config` per preset (`industry-config.js:609,648,687`) | findings [06] header |
| Preset mode backfill | mode-gate backfill migration precedent | CLAUDE.md migrations wave list |

## Harden what's built
- **P0 — clinic backfill must not surprise live tenants.** Flipping `clinic.modes` changes what existing clinic tenants see overnight. Failure: a GP tenant using it as appointments-only suddenly grows charting nav; support tickets. Mitigate: backfill sets flags OFF for existing tenants + announcement banner; new signups get ON. Decide at approval.
- **P1 — recall vs session-reminder overlap.** `treatment-plan-worker-boss.js` already reminds about upcoming sessions of ACTIVE plans; recalls target COMPLETED/lapsed patients. Failure: a patient completing a plan with a future session gets both a session reminder and a recall for the same visit → looks broken. Rule: arming a recall suppresses it while any future appointment/session exists for that subject (`status='booked'` auto-set).
- **P1 — subject-scoped portal leakage re-check.** Adding vaccination/allergy data raises stakes on the existing portal scope check (completion 08 lens: "vet portal must not leak other owners' pets"). Re-assert with the new endpoints: every new route filters by the authed customer's subjects.
- **P2 — prescription allergy check is substring-naive** (by design v1): document the limitation in the UI ("checks name match only") so it's a aid, not a trusted guard — clinical safety framing matters.

## Cross-surface lens
- **Booking:** recall outreach deep-links the public booking page; booking from it must link back (`patient_recalls.appointment_id`) — one join, don't lose attribution.
- **Tax/folios:** session checkout tax is completion-01's OPEN pause item (treatment folio tax linkage needs schema) — if still open when this executes, surface it: this plan's POS-visit flows walk right through it. Coordinate; do not silently re-fix.
- **Notifications:** all recall/vaccination comms via F05.
- **Portal:** intake forms + handouts appear in portal; vaccination card read-only view (vet) — scope-checked.

## Verification bar
- Test tenants: fresh `clinic` (post-enablement), fresh `veterinary`, reuse a `dental_clinic` tenant.
- Walkthrough: clinic tenant now charts/prescribes end-to-end (the stack works under the preset); dental: complete a plan with 6-month recall template → recall armed → clock-shift → worker fires outreach (logged) → overdue list shows patient → book from link → recall completes + re-arms; vet: administer rabies vaccine in a session → card shows it → recall armed at next_due → reminder fires; allergy banner: add penicillin allergy → prescribe "Penicillin V" → warning shown; intake form auto-attached on first booking, filled via public link, visible on chart; physio handout delivered to portal.
- Empty states: overdue list empty; vaccine card for a new pet; patient with no alerts shows no banner (not an empty red bar).
