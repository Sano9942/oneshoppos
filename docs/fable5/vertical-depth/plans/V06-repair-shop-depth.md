# V06 — Repair-Shop Depth (Device Intake · Parts on Tickets · Estimates)

**Covers:** findings [07-repair-shop](../findings/07-repair-shop.md) — the worst verdict in the audit (Not-viable, three simultaneous P0s). Device intake, parts-to-ticket-to-invoice, notifications (F05 delivers the engine; wired + verified here), estimates, warranty.
**Presets/modes:** `repair_shop` — mode `workflow_tickets` (`phase4_workflow_tickets`).
**Surfaces:** admin (ticket board) · POS (invoice settle) · portal (ticket status) · notifications
**Closes findings rows:** [07] "Device/asset fields on ticket" (**P0**) · "Parts usage on ticket → inventory decrement → invoice lines" (**P0**) · "Customer status notifications" (**P0** — engine F05, repair wiring lands in F05 task 4; verified here) · "Estimate → customer approval step" (P1) · "Custom statuses / workflows per repair type" (P1) · "Warranty tracking" (P1) · "Physical ticket label w/ barcode" (P2).
**Depends on:** F05 (hard — the notifications P0), F03 (soft — per-repair-type custom intake fields), completion plans 01+05 executed (portal tab fix + ticket wiring proven).
**Branch:** `ServiceTicketsRedesign.jsx` rebuild rides `redesign/square` (this plan is UI-heavy — intake form, ticket drawer, board); backend/schema off `main`.
**Model:** **Opus, effort high.** Benchmarked feature set (RepairDesk), fully specified below; no novel engine.

---

## Tasks

### P0 — device intake
1. **Schema (pause-list):**
```sql
CREATE TABLE ticket_devices (
  id SERIAL PRIMARY KEY,
  service_ticket_id INTEGER NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
  device_type TEXT, brand TEXT, model TEXT,
  serial_number TEXT, imei TEXT,
  passcode TEXT,                                  -- stored plain by industry practice; flag to user (see harden)
  condition_notes TEXT,
  accessories JSONB DEFAULT '[]',                 -- ["charger","case"]
  checklist JSONB DEFAULT '{}',                   -- pre-repair checks {powers_on: true, screen_cracked: true, …}
  photos JSONB DEFAULT '[]',                      -- R2 keys, intake condition photos
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ticket_devices_imei ON ticket_devices(imei) WHERE imei IS NOT NULL;
CREATE INDEX idx_ticket_devices_serial ON ticket_devices(serial_number) WHERE serial_number IS NOT NULL;
```
2. **Intake flow** — ticket creation becomes a one-page intake: customer → device (type/brand/model pickers with free-text fallback, serial/IMEI, passcode, condition, accessories checklist, photos via upload-validation→R2) → problem description → estimate amount + deposit. Device history lookup: entering a serial/IMEI that exists shows prior tickets ("this phone was here in March — water damage"). Search tickets by IMEI/serial/phone.
3. **Per-repair-type checklist templates** — the `checklist` keys come from a repair-type template (simple JSONB on a `ticket_types` lookup table, or F03 templates if landed — prefer F03 to avoid a parallel mini-form-builder; decide by what's shipped when this executes).

### P0 — parts on tickets
4. **Schema (pause-list):**
```sql
CREATE TABLE service_ticket_items (
  id SERIAL PRIMARY KEY,
  service_ticket_id INTEGER NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('part','labor','fee')),
  product_id INTEGER REFERENCES products(id),      -- parts come from inventory
  variant_id INTEGER REFERENCES product_variants(id),
  description TEXT NOT NULL,
  quantity NUMERIC(12,4) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL,
  unit_cost NUMERIC(12,4),                        -- margin visibility
  stock_decremented BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
5. **Stock semantics** — adding a part decrements stock immediately (`FOR UPDATE`, the sales.js discipline) and sets `stock_decremented`; removing before invoice restocks. Serialized parts pick a serial (`product_serial_numbers` machinery exists — findings [01] built row). Cancelled ticket restocks un-invoiced parts.
6. **Itemized invoice** — rewrite `services/service-tickets.js:generateInvoiceFromTicket` (:62 route) to build invoice lines from `service_ticket_items` (parts at price, labor lines, minus deposit) through the standard invoice path (tax snapshot per line). Stock is NOT decremented again at invoice (already taken at add — the flag guards).

### P0 — notifications (verify F05's work)
7. F05 task 4 wires status-change notifications; this plan: repair-vocabulary templates ("Your {device} is ready for pickup"), portal ticket-status parity, and the live verification with a real SMS provider config.

### P1
8. **Estimate → approval** — reuse quotations (`routes/tier4/crm.js` — findings note approval state exists with no itemized estimate behind it): "create estimate" from a ticket builds a quotation from `service_ticket_items`; customer approves via portal or staff marks approved (existing quotation accept flow); approval flips ticket `intake→approved` and locks estimate lines into the ticket. One FK: `service_tickets.quotation_id` (pause-list).
9. **Custom statuses** — `service_tickets.status` is a fixed CHECK (schema:4060). Replace with a `ticket_statuses` lookup (per-tenant, seeded with the current seven, orderable, each mapped to a semantic stage `intake|in_progress|done|closed` so code logic keys on stage, not name). Migration converts the CHECK — pause-list.
10. **Warranty** — columns on `service_tickets`: `warranty_days INTEGER`, `warranty_until DATE` (set at completion); new intake for the same device inside warranty shows a banner + links the prior ticket ("warranty return — March repair"). One join off the IMEI/serial index.

### P2
11. **Ticket claim label** — label-designer template with ticket barcode (Code128 of ticket number) + customer/device; scan at counter opens the ticket (`ServiceTicketsRedesign` scan handler). Reuse `routes/barcode-expenses.js`.
12. Technician workload view (open tickets per tech on the board).

## Reuse map (grep-confirmed)
| Need | Reuse | Evidence |
|---|---|---|
| Notifications | F05 (`customer-notify`) — repair is its first consumer | plans/F05 task 4 |
| Ticket spine | `routes/service-tickets.js` + `service_ticket_activities` | findings [07] built rows |
| Estimates | quotations in `routes/tier4/crm.js` (accept→convert flow) | findings [07] partial row |
| Serialized parts | `product_serial_numbers` + `sale_item_serials` machinery | findings [01] |
| Photos → R2 | upload-validation + `utils/r2.js` | backend/CLAUDE.md |
| Labels | `routes/barcode-expenses.js` designer | findings [07] P2 row |
| Portal ticket tab | fixed by completion 01 (tickets→`phase4_workflow_tickets` mapping) | completion register |

## Harden what's built
- **P0 — the current invoice drops the money.** `generateInvoiceFromTicket` invoices "the ticket" as one line (findings [07] evidence) — no parts, no labor breakdown, deposit handling unclear. Failure: Rs 4,500 screen replacement invoices as one opaque line; deposit of Rs 1,000 recorded on the ticket may not net on the invoice → customer double-charged or shop shorts itself. Verify deposit netting in the current fn BEFORE rewrite (read `services/service-tickets.js` at execution), preserve any correct behavior, and test deposit-net explicitly.
- **P1 — parts today leak margin invisibly.** Findings: "parts leave stock via unlinked POS sales or manual adjustments". After task 5, audit the tenant's old pattern: block nothing, but the Reports story ("parts cost per ticket") only covers post-migration tickets — say so in the report empty-state.
- **P1 — passcode storage.** Industry practice stores device passcodes retrievable (techs need them), but it's sensitive data in plaintext next to PII. Flag to user at approval: plaintext column (default, industry-standard) vs encrypted-at-rest via `services/crypto.js` with reveal-on-click. Recommend crypto.js — it's one encryptSecret/decryptSecret pair.
- **P2 — activity log coverage**: new mutations (device edit, part add/remove, estimate) all write `service_ticket_activities` rows like existing mutations do — dispute defense is the vertical's economics.

## Cross-surface lens
- **Stock:** part add/remove/cancel/invoice = a NEW stock writer — add to the trap-5 census; FOR UPDATE + restock paths tested; F07 batches (if a part is batch-tracked) consume via the same `consumeBatches` choke point.
- **Tax:** itemized invoice lines through `tax-snapshot.js`.
- **Portal:** status + estimate approval visible; device passcode NEVER in any portal payload.
- **Notifications:** status transitions notify per rules; estimate-approval request notifies with portal link.

## Verification bar
- Test tenant: fresh `repair_shop`, SMS provider configured.
- Walkthrough (the RepairDesk demo): intake a phone (device fields, passcode, photos, checklist) → claim label prints → estimate built from parts+labor → customer approves via portal → SMS on approval → tech adds a serialized part (stock decrements, serial assigned) → complete → "ready for pickup" SMS → invoice itemized (parts+labor−deposit, tax correct) → settle at POS → warranty set; same IMEI returns in 10 days → warranty banner + prior-ticket link; search by IMEI finds both; remove-part restock verified; cancelled ticket restocks.
- Empty/error states: intake with no device (plain service job) still works; part with zero stock rejects with clear message; estimate declined path.
