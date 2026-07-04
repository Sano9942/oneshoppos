# V04 — Salon Depth (Checkout Link · Client History · Retention Loop)

**Covers:** findings [05-salon](../findings/05-salon.md) — the broken daily loop (appointment→checkout, via F06) plus the vertical-specific P0 this plan owns outright: client service history / formula notes. Retention mechanics (packages, waitlist, no-show, SMS) land by consuming F02/F04/F05/F06.
**Presets/modes:** `salon` — modes `appointments`+`commissions`; flag seeding decision: salon currently gets NO retail seed flags (findings header) — decide whether loyalty/gift-cards seed ON for salon at approval.
**Surfaces:** POS · admin calendar · public booking · portal
**Closes findings rows:** [05] "Appointment → POS checkout link" (**P0** — F06 builds the link; this plan owns the salon UX + commission verification) · "Client service history / formula notes" (**P0**) · "SMS reminders" (P1 — F05) · "Packages" (P1 — F02) · "Waitlist" (P1 — F06) · "No-show fee auto-charge" (P1 — F04) · "Recurring appointments / rebooking prompt" (P2 — F06 task 9).
**Depends on:** F06 (hard), F02/F04/F05 (per-row), completion plan 03 executed.
**Branch:** UI rides `redesign/square`; history schema off `main`.
**Model:** **Opus, effort high.** Everything hard is in the foundations; this is the consuming skin plus one well-shaped new entity (service history).

---

## Tasks

### P0 — client service history / formula notes
1. **Schema (pause-list):**
```sql
CREATE TABLE client_service_records (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  appointment_id INTEGER REFERENCES appointments(id),
  sale_id INTEGER REFERENCES sales(id),
  booking_service_id INTEGER REFERENCES booking_services(id),
  employee_id INTEGER REFERENCES employees(id),      -- who performed it
  notes TEXT,                                        -- free notes
  formula JSONB DEFAULT '{}',                        -- structured: [{label, value}] — "Base: 6N 40ml", "Developer: 20vol"
  photos JSONB DEFAULT '[]',                         -- R2 keys (before/after)
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_service_records_customer ON client_service_records(customer_id, created_at DESC);
```
2. **Auto-created at checkout** — F06's checkout link commit creates a skeleton record per service line (customer/appointment/sale/service/provider prefilled); stylist fills notes/formula from the appointment drawer or the POS post-sale screen. Manual add for walk-ins (no appointment).
3. **Surfaced where the work happens** — booking modal + appointment drawer show "last visit" panel (most recent record for this client: service, provider, formula, date); customer profile gets a Service History tab (timeline). This is the "show me her last formula" demo moment — the panel in the BOOKING view is the point, not the archive page.
4. Photo capture (before/after) via existing upload validation → R2 (`rasterImageFileFilter`).

### P1 — retention loop (consume foundations)
5. **SMS reminders live** — F05 task 5 wires it; this plan verifies on the salon tenant + seeds the salon default rules (24h + 1h SMS reminders — the 1h email exists today).
6. **Packages** — F02 consumed: salon vocabulary ("5-Facial Package"), portal tab, POS redemption walk.
7. **Waitlist** — F06 consumed: walk the offer flow with salon labels.
8. **No-show protection** — F04 consumed: per-service `no_show_fee` + card-on-file; salon settings page section.
9. **Rebooking prompt** — post-checkout modal "book next appointment" with same service/provider prefilled (+ F06 recurrence when built). Cheap, high retention value (findings: Fresha/Vagaro standard).

### P2
10. Client preference fields on customer profile (allergies to products, preferred stylist) — plain columns/JSONB on customers, shown in booking drawer.
11. Birthday campaign template seeded for salon (marketing machinery exists — `services/marketing.js` birth_month filter, findings [01] built row).

## Reuse map (grep-confirmed)
| Need | Reuse | Evidence |
|---|---|---|
| Checkout link + POS appointments list | F06 tasks 3 | plans/F06 |
| Structured clinical-style notes precedent | SOAP notes on `treatment_sessions` (shape reference only) | findings [06] built rows |
| Photo upload | `middleware/upload-validation.js` + R2 | backend/CLAUDE.md |
| Commission attribution | `routes/commissions.js` + earnings ledger | findings [05] built rows |
| Campaign machinery | `services/marketing.js:resolveAudience` (birth_month) | services/CLAUDE.md |
| Portal tabs config | `PORTAL_ENABLED_TABS_BY_PRESET` | industry-config.js:729+ |

## Harden what's built
- **P0 — walk-in commission attribution is cashier-dependent.** Findings [05] P0 row evidence: without the checkout link, commission attribution "depends on the cashier picking the right employee". F06 fixes the appointment path; the WALK-IN path still relies on manual pick. Failure: busy front desk leaves default employee on the sale → wrong stylist paid → payroll disputes. Harden: when salon preset + service-type line, require an explicit performed-by pick (blocking select, not a default) — one POS conditional.
- **P1 — double-booking race** — fixed in F06 (advisory lock); VERIFY it here on the salon tenant with the scripted parallel public bookings, because salon is the highest-public-traffic consumer.
- **P1 — reminder truthfulness** — after F05, assert `appointment_reminders.status='sent'` rows correspond to `sms_provider_messages`/`customer_notifications` rows on this tenant (the old always-sent lie must be provably gone — findings [05] partial row).
- **P2 — history privacy**: service records visible to all staff by default; formulas are competitively sensitive (stylists leave and take clients). Flag to user: per-record visibility is out of scope, note it, don't build silently.

## Cross-surface lens
- **Commissions:** one earning per checkout line; tips (`distributeTipPool`) also write `commission_earnings` — verify no double-count on a sale that has both (completion 03's lens re-run post-link).
- **Slots:** cancel from admin/portal/public all free slots + trigger waitlist (F06 lens).
- **Notifications:** all client comms via F05 rules; no direct sends.
- **Portal:** service history is NOT exposed to the client in v1 (formulas are internal) — portal keeps appointments/invoices; state explicitly so nobody "helpfully" adds it.

## Verification bar
- Test tenant: fresh `salon`.
- Walkthrough (the Fresha-aware-owner demo): public booking with deposit → SMS reminder actually delivered (provider log) → client arrives → booking drawer shows last-visit formula → checkout from appointment at POS with retail add-on → commission attributed to stylist automatically → service record auto-created, stylist adds formula + photo → rebooking prompt books next month → next booking's drawer shows the new formula; walk-in service forces performed-by pick; package sold + redeemed (F02); full class of no-show: card-on-file booking → no-show → fee charged (F04, sandbox); waitlist offer loop (F06).
- Empty states: new client with zero history (drawer shows "first visit"); history tab empty state.
