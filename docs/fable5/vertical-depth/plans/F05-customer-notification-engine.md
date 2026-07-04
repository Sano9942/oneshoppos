# F05 — Customer Status-Change Notification Engine

**Covers:** cross-cutting observation "status-change customer notifications" ([../README.md](../README.md) candidate list) — one event→template→channel engine over the existing `services/sms.js` + `services/email.js` adapters, so every vertical stops hand-rolling (or skipping) "your X is ready" messages.
**Modes/flags:** new flag `customer_notifications` (default OFF; consumers seed it). Per-rule toggles in-app, not flags.
**Surfaces:** admin (rules + log UI) · every entity screen (send/preview) · SMS/email/WhatsApp outbound
**Closes findings rows:**
- [07-repair-shop](../findings/07-repair-shop.md) → "Customer status notifications (SMS/email)" (**P0**)
- [05-salon](../findings/05-salon.md) → "SMS reminders" (P1 — the `booking-reminders.js` SMS wire-up)
- Supporting rows: rentals overdue/status ([10-rentals] built-worker extension), lodging booking comms, F02 dunning notices, F06 waitlist offers.
**Depends on:** nothing. **Consumed by:** V04, V06 (P0), V07, V09, V10, F02, F06.
**Branch:** off `main` (backend-heavy; settings UI rides `redesign/square`).
**Model:** **Opus, effort high** (Sonnet viable for execution — the adapters and queue already exist; this is disciplined wiring plus two tables).

---

## Design

```
services/customer-notify.js
  notify(db, { event, customerId, channelHints, data, tenantSlug })
    → resolve rule (notification_rules: event → enabled channels + template)
    → render (email via email-templates.js registry pattern; SMS via new sms-templates.js: short text + vars)
    → deliver: email → enqueueEmail (pg-boss, retries); sms → sendSms; whatsapp → whatsapp-client.sendTemplate (optional)
    → log row in customer_notifications (status, provider ref)
  NON-THROWING (returns status object) — a failed notification must never roll back the business write,
  same contract as booking-reminders.js (services/CLAUDE.md "Non-throwing services").
```

### Schema (pause-list at execution)

```sql
CREATE TABLE notification_rules (
  id SERIAL PRIMARY KEY,
  event TEXT NOT NULL,               -- 'ticket.status_changed:completed', 'appointment.reminder', 'rental.overdue', …
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  template_key TEXT NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  UNIQUE(event, channel)
);
CREATE TABLE customer_notifications (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  event TEXT NOT NULL, channel TEXT NOT NULL,
  recipient TEXT NOT NULL,           -- phone/email actually used
  entity_type TEXT, entity_id INTEGER,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  provider_ref TEXT, error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Default rules seeded per preset at wizard time (repair: 4 status events ON; salon: reminder SMS ON; others per vertical plan).

## Tasks

### P0
1. Schema + flag. PAUSE for approval.
2. `services/customer-notify.js` + `services/sms-templates.js` (plain-string templates with `{{var}}` substitution; PK-appropriate lengths — 1 SMS segment where possible; Urdu-capable UTF handling noted: 70-char segments).
3. `routes/notification-settings.js` — rules CRUD + log list + test-send (mirrors `services/sms.js:testProvider`).
4. **First consumer, proving the engine: repair tickets** — `routes/service-tickets.js` status-transition handler calls `notify` on `approved/in_progress/completed/invoiced` (closes V06's P0 — V06 then only adds vocabulary/polish). Findings evidence: grep `email|sms|notify` in service-tickets routes/services → 0 hits today ([07-repair-shop] gap row).
5. **Fix the SMS reminder wire-up** — `services/booking-reminders.js` skips SMS but marks `sent` (documented behavior + guarding unit test — services/CLAUDE.md). Route SMS rows through `customer-notify`; update the guarding test deliberately. **Coordinate with completion plan 03's triage item** — if 03 already ran and produced a verdict, honor it; do not double-fix.

### P1
6. Wire remaining built consumers behind rules (each ~10 lines at the existing status-transition points): rental overdue (extend `workers/rental-overdue-worker-boss.js` — today email-only, add SMS channel), rental status (confirmed/checked-out/returned), room booking (confirmed/checked-in/checked-out — `services/room-service.js` transitions), appointment created/rescheduled/cancelled (booking-services.js already enqueues confirmation email — migrate it onto rules so tenants can toggle).
7. WhatsApp channel via `whatsapp-client.sendTemplate` when the tenant has WhatsApp configured in the Integrations Hub (`integration_settings`); falls back to SMS.
8. Settings UI: per-event channel toggles + template preview + log viewer with failure reasons.

### P2
9. Quiet-hours setting (don't SMS at 3am; queue until morning, tenant timezone via `req.company.timezone`).
10. Per-customer opt-out flag (`customers` column or tag) honored by the engine — flag schema addition at execution.

## Reuse map (grep-confirmed)

| Need | Reuse | Evidence |
|---|---|---|
| SMS delivery + provider config | `services/sms.js:sendSms/resolveProvider` | sms.js:136-259; persists `sms_provider_messages` |
| Email delivery + retries | `services/email.js:enqueueEmail` (pg-boss 3×60s) | services/CLAUDE.md |
| HTML template registry | `services/email-templates.js` TEMPLATES pattern | services/CLAUDE.md |
| WhatsApp sends | `services/marketplace/whatsapp-client.js:sendTemplate/sendTextMessage` | services/CLAUDE.md marketplace section |
| Non-throwing batch contract | `booking-reminders.js` shape | services/CLAUDE.md |
| Provider test endpoint | `sms.js:testProvider` | :250 |

## Harden what's built

- **P0 — reminders lie about delivery.** `booking-reminders.js` marks SMS rows `status='sent'` without sending (documented; findings [05-salon] partial row). Failure: salon relies on SMS reminders, log says all sent, no-shows spike, owner blames clients. Task 5 fixes; the new `customer_notifications` log records provider truth (`sms_provider_messages` linkage).
- **P0 — campaign bursts vs transactional sends share one queue.** `email_queue`/pg-boss and the SMS adapter are shared with marketing campaigns (`services/marketing.js:enqueueCampaignSend`). Failure: 5k-customer campaign enqueued at 6pm delays "your phone is ready" by hours. Completion plan 11 flags queue priority for email — this engine must pass a priority hint for transactional sends now (pg-boss job priority), and V-plans inherit it. Reference plan 11; implement only the priority hint here.
- **P1 — `enqueueEmail` ignores its `db` param** (services/CLAUDE.md gotcha) — always enqueues to public-schema pg-boss. Not a bug for this engine (it passes `tenantSlug` in data), but the engine must include `tenantSlug` in every job payload or worker-side rendering will hit the wrong schema. Enforce with a throw like `subscriptions.processRenewal` does.
- **P1 — recipient resolution.** `customers.mobile` formats vary (03xx…, +923xx…). `sendSms` adapters take the raw string. Failure: Zong adapter rejects `+92` format silently → `failed` rows pile up. Normalize once in the engine (single normalizer fn, PK-default country code), log `skipped` when no mobile.

## Cross-surface lens
- **Notifications is itself the shared concern** — after this lands, ANY new status-change comm in any vertical must go through `customer-notify` (add to plans' review checklist). Direct `sendSms`/`enqueueEmail` calls for customer-facing status messages become a code-review smell.
- **Auth/PII:** log viewer is `requirePerm` (admin/manager); recipient values are PII — no public exposure.
- **Portals:** portal-triggered events (customer reschedules from portal) fire the same rules — single dispatch point in the service layer, not per-route.

## Verification bar
- Test tenant: fresh `repair_shop` with SMS sandbox/generic provider configured (+ [[wholesale_test_tenant]] spot-check that campaigns still send).
- Walkthrough: configure rules → ticket status walk (intake→approved→in_progress→completed) fires 3 configured messages with correct variables → log shows sent/provider refs → disable one rule → transition → `skipped` row → customer with no mobile → `skipped` not `failed` → booking SMS reminder actually delivers (the fixed path) and marks truthfully → template preview renders variables → quiet-hours defers (P2, if built).
- Failure injection: break provider creds → `failed` with error surfaced in log UI, business transition unaffected.
