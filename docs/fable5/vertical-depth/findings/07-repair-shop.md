# Repair / Service Shop

**Presets:** `repair_shop`  **Modes/flags:** mode `workflow_tickets` → `phase4_workflow_tickets` (`mode-registry.js:47`)
**Surfaces:** POS · portal (tickets/invoices) · admin
**Owned wiring plan:** [completion 05-workflow-tickets.md](../../completion/plans/05-workflow-tickets.md)

## What's built today (from code)

The thinnest mode in the codebase — 6 endpoints, 2 tables:

- Ticket CRUD with fixed status pipeline `intake→approved→in_progress→on_hold→completed→invoiced→cancelled` — `routes/service-tickets.js` (6 routes), `service_tickets` (`schema-pg.sql:4053-4073`) — works
- Fields: title, description, notes, customer, outlet, assigned technician, expected/actual completion — schema above — works
- Deposit recording (amount/method/paid_at — manual, no gateway) — `service_tickets.deposit_*` columns — works
- Activity log (note/status_change/assignment/deposit/invoice) — `service_ticket_activities` (`schema-pg.sql:4078`) — works
- Generate invoice from resolved ticket — `POST /api/service-tickets/:id/generate-invoice` (`routes/service-tickets.js:62`), `services/service-tickets.js:generateInvoiceFromTicket` — works
- Customer portal "Repair Tickets" tab — `PORTAL_ENABLED_TABS_BY_PRESET.repair_shop` (`industry-config.js:759`), portal label overrides (`:787`) — works (tab wiring fixed by completion plan 01)
- Ticket board UI — `pages/redesign/ServiceTicketsRedesign.jsx` — works

## What this industry needs (domain + research)

Benchmarks: RepairDesk (notably Pakistani-founded — it *is* the local category leader) and RepairShopr.

- **Device intake**: one-page intake capturing device make/model, serial/IMEI, passcode, condition, accessories left, pre-repair checklist, custom forms per repair type — source: [RepairDesk ticket management](https://www.repairdesk.co/features/repair-ticket-management-software/), [RepairShopr features](https://www.repairshopr.com/features) (custom intake forms, digital signatures)
- **Automated customer notifications**: SMS/email at every status change ("your phone is ready") — RepairDesk headline feature — source: [RepairDesk](https://www.repairdesk.co/)
- **Parts on tickets**: attach parts from inventory to a ticket, decrement stock, feed cost into the final invoice; serialized parts + PO/GRN linkage — source: [RepairDesk inventory](https://www.repairdesk.co/computer-repair-shop-software/), [RepairShopr rebuilt inventory](https://www.repairshopr.com/features)
- Estimates → customer approval before work begins — RepairShopr estimates module — source: [RepairShopr features](https://www.repairshopr.com/features)
- Custom workflows/statuses per repair type — source: [RepairDesk vs RepairShopr](https://www.repairdesk.co/repairdesk-vs-repairshopr/)
- Warranty tracking on completed repairs — domain reasoning (repeat-visit disputes are routine)
- Printable ticket/claim label with barcode for the physical device — domain reasoning; standard in both leaders

## Gap analysis (ranked)

| Requirement | Built? | Evidence (code) | Impact tier | Note |
|---|---|---|---|---|
| Device/asset fields on ticket (make/model/serial/IMEI/condition/accessories) | no | `service_tickets` has only `title`/`description`/`notes` text (`schema-pg.sql:4062-4064`); no device entity, no custom intake fields | **P0** | the intake form IS the product in this vertical; free-text can't drive lookup by IMEI or dispute defense |
| Parts usage on ticket → inventory decrement → invoice lines | no | no ticket-items/parts table in schema (only the 2 tables above); `generateInvoiceFromTicket` invoices the ticket, not itemized parts+labor (`services/service-tickets.js`) | **P0** | a phone-repair shop's margin is parts; today parts leave stock via unlinked POS sales or manual adjustments |
| Customer status notifications (SMS/email) | no | grep `email\|sms\|notify` in `routes/service-tickets.js` + `services/service-tickets.js` → 0 hits | **P0** | "is my phone ready?" phone calls are the pain this software category exists to kill; `services/sms.js` + `services/email.js` already exist to wire in |
| Estimate → customer approval step | partial | `status='approved'` exists in the pipeline; quotations live separately in `routes/tier4/crm.js` with no ticket linkage | P1 | approval state without an itemized estimate behind it |
| Custom statuses / workflows per repair type | no | status enum is a fixed CHECK constraint (`schema-pg.sql:4060`) | P1 | |
| Warranty tracking on repairs | no | no warranty fields/entity | P1 | |
| Physical ticket label w/ barcode | no | label designer exists for products (`routes/barcode-expenses.js`) but nothing prints a ticket claim tag | P2 | reuse path is obvious |
| Ticket lifecycle, technician assignment, deposits, activity log, portal visibility, invoice generation | yes | files above | — | a serviceable spine to build the above onto |

## Readiness verdict

**Not-viable** (for the electronics/phone repair shop the preset name implies; a tailor/alterations counter could limp along). Three simultaneous P0s — no device intake, no parts-to-ticket, no customer notifications — mean a shop comparing against RepairDesk (the hometown incumbent) rejects the demo at intake, before ever seeing the good invoice/portal machinery.
