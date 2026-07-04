# F03 — Form Builder (Intake · Waivers · Questionnaires)

**Covers:** the single missing form entity (cross-cutting observation #4 in [../README.md](../README.md)) — tenant-defined forms with typed fields, filled by customers (portal/public link) or staff, optionally signed, attached to an entity (appointment, ticket, project, membership, patient).
**Modes/flags:** new flag `custom_forms` (default OFF; seeded by clinical/gym/photography/repair presets per V05/V06/V07/V08).
**Surfaces:** admin (builder + responses) · portal (fill) · public tokenized link (pre-visit fill, no login) · POS/booking (staff-assisted fill)
**Closes findings rows:**
- [06-clinical](../findings/06-clinical.md) → "Patient intake forms (self-service, pre-visit)" (P1)
- [08-gym](../findings/08-gym.md) → "Liability waivers" (P1)
- [09-photography](../findings/09-photography.md) → "Client questionnaires" (P1)
- [07-repair-shop](../findings/07-repair-shop.md) → the "custom forms per repair type" half of "Device intake" (the fixed device fields are V06's own P0)
**Depends on:** nothing (parallel-safe). V05/V06/V07/V08 consume it.
**Branch:** backend + schema off `main`; builder UI + portal tab ride `redesign/square`.
**Model:** **Opus, effort high.** Well-bounded CRUD + rendering engine; the one subtle part (public tokenized access) copies an existing pattern (public receipts).

---

## Design

### Schema (pause-list at execution)

```sql
CREATE TABLE form_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  entity_scope TEXT NOT NULL DEFAULT 'customer'
    CHECK (entity_scope IN ('customer','appointment','service_ticket','project','membership','patient_subject')),
  fields JSONB NOT NULL DEFAULT '[]',      -- [{key,label,type:text|textarea|select|checkbox|date|number|signature_ack,options[],required}]
  require_signature BOOLEAN DEFAULT FALSE, -- drawn signature (canvas → R2), distinct from checkbox ack
  auto_attach TEXT,                        -- e.g. 'first_appointment','membership_enroll','ticket_intake' (consumers wire triggers)
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE form_responses (
  id SERIAL PRIMARY KEY,
  form_template_id INTEGER NOT NULL REFERENCES form_templates(id),
  fields_snapshot JSONB NOT NULL,          -- template fields frozen at send time (template edits must not corrupt old responses)
  customer_id INTEGER REFERENCES customers(id),
  patient_subject_id INTEGER REFERENCES patient_subjects(id),
  entity_type TEXT, entity_id INTEGER,     -- polymorphic attach (appointment/ticket/project/…)
  answers JSONB NOT NULL DEFAULT '{}',
  signature_url TEXT,                      -- R2 key, consent-style
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','void')),
  public_token TEXT UNIQUE,                -- pre-visit fill link; NULL once submitted
  submitted_via TEXT CHECK (submitted_via IN ('portal','public_link','staff')),
  submitted_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
);
```

`fields_snapshot` is the design's load-bearing choice: responses render from their own snapshot, never the live template.

## Tasks

### P0 — builder + fill + attach
1. Schema + `custom_forms` flag. PAUSE for approval.
2. `routes/forms.js` — template CRUD (manager+); `POST /api/forms/:templateId/send` (creates pending response + public_token, optionally emails/SMS link via F05 or `enqueueEmail` directly); `GET/POST /api/public/forms/:token` (public fill — mount BEFORE tenant middleware alongside `public-bookings.js`, resolve tenant via `services/public-tenant-context.js:resolvePublicTenantDb`, rate-limit like `publicBookingLimiter`); `GET /api/forms/responses?entity_type&entity_id` (staff view); `POST .../responses/:id/void`.
3. Signature capture: reuse the consent-form canvas→R2 flow byte-for-byte (`routes/treatment-plans.js:310-317` — base64 PNG → `uploadToR2` under `forms/:responseId/`). Validation via `middleware/upload-validation.js`.
4. Builder UI (admin): field-list editor with type/options/required; preview. Response viewer on the entity's page (ticket drawer, project page, patient chart) — one shared `<FormResponsesPanel entityType entityId>` component.
5. Portal fill: portal tab lists pending forms for the logged-in customer; submission marks `submitted`.
6. Zod schemas (`schemas/forms.js`) — validate `fields` shape server-side; answers validated against `fields_snapshot` (required fields enforced at submit, typed coercion for number/date).

### P1 — consumer trigger hooks
7. `auto_attach` dispatch helper `services/forms.js:autoAttachForms(db, trigger, {customerId, entityType, entityId})` — called by consumers: booking creation (V05 intake), membership enroll (V07 waiver), ticket creation (V06), project creation (V08). This plan ships the helper + one wired example (appointment); verticals wire their own triggers.
8. "Unsubmitted required form" badge: appointments/tickets list shows pending-form indicator (single JOIN, no polling).

### P2
9. Form-response PDF export for handout/printing (server-rendered HTML → print CSS; no new PDF lib).
10. Template library seeds per preset (gym waiver, clinical intake, photography wedding questionnaire) shipped as INSERT seeds gated by preset — content reviewed by user before seeding.

## Reuse map (grep-confirmed)

| Need | Reuse | Evidence |
|---|---|---|
| Signature → R2 | consent flow in `routes/treatment-plans.js` | :310-317 (`consents/`, base64 PNG) |
| Public no-auth tenant routing | `services/public-tenant-context.js:resolvePublicTenantDb` | used by storefront/public-bookings (services/CLAUDE.md) |
| Public-link token pattern | `routes/receipts.js` public receipt by invoice number | CLAUDE.md routes list |
| Rate limiting public writes | `publicBookingLimiter` (middleware/rate-limit.js) | backend/CLAUDE.md |
| Upload validation | `middleware/upload-validation.js` raster filters | backend/CLAUDE.md |
| Send-link email | `services/email.js:enqueueEmail` + `email-templates.js` registry | services/CLAUDE.md |

## Harden what's built

- **P0 — consent forms are template-frozen wrongly today?** Verify before reusing: `consent_forms` stores template text at sign time or references the live template — if live-referenced, editing a consent template rewrites what past patients "signed" (legal exposure). Grep `consent_templates` usage in `routes/treatment-plans.js:295-317` during execution; if live-referenced, fix there with the same snapshot pattern this plan uses (in-scope: it's the machinery being generalized). Failure scenario: clinic edits anaesthesia consent wording → all historical signed consents silently show the new wording in any dispute.
- **P1 — public token lifecycle**: tokens must be single-use (NULL on submit) and unguessable (crypto random ≥128 bits), and the public GET must not leak customer PII beyond the form's own fields. Mirror the `?tenant=` lockdown lessons ([security_audit_fixes_may2026]) — the route is public by design, so return 404 (not 403) for bad tokens.
- **P1 — 10MB JSON body limit**: signature base64 rides the JSON body (like consents). A high-res canvas can exceed limits on slow mobile links; downscale client-side to the same bounds the consent UI uses (verify what that is during execution).

## Cross-surface lens
- **Auth:** three fill paths (portal-authed, public token, staff) must converge on one submit handler with one validation path — divergence here is the [[feedback_parallel_paths]] pattern in miniature.
- **Notifications:** send-link + "form completed" staff notification ride F05 when available.
- **Visibility:** portal lists only own responses (customer_id scope); public token responses hide everything except the form.

## Verification bar
- Test tenant: fresh `gym` (waiver) + spot-check `dental_clinic` (intake) labels.
- Walkthrough: build template (all field types + signature) → send to customer → fill via public link on mobile viewport → response visible on entity page with snapshot rendering → edit template → old response unchanged → portal fill for a second pending form → required-field rejection works → void a response → staff-assisted fill.
- Empty/error states: expired/used token → 404 page (not stack trace); template with zero fields can't be activated.
