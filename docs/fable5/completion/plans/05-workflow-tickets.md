# 05 — Workflow tickets mode

**Covers:** mode `workflow_tickets` + preset `repair_shop`
**Modes/flags in scope:** `phase4_workflow_tickets`
**Surfaces touched:** admin app · POS (ticket settlement) · customer portal (tickets tab — currently broken, see 01-cross-surface D1)
**Branch strategy:** backend/wiring off `main`.

---

## Call-path map + verification checklist

| Flow | Screen / component | API call | Route → service | "Wired correctly = …" | Status |
|---|---|---|---|---|---|
| Ticket create | `ServiceTicketsRedesign` board | `POST /api/service-tickets` | `service-tickets.js` (mode `workflow_tickets` + flag + `manage_tickets`) → `services/service-tickets.js` | ticket number generated; customer + item + issue persisted | ☐ |
| Status workflow | board drag/status | `PUT /api/service-tickets/:id` | `updateTicket` + `logActivity` | transitions logged; board columns match statuses | ☐ |
| Deposit at intake | ticket form | deposit endpoint / POS | — | deposit recorded; nets off final invoice | ☐ |
| Resolve → invoice | ticket detail | invoice-from-ticket endpoint | `generateInvoiceFromTicket` | invoice totals = labor+parts−deposit; tax via v83 chain | ☐ |
| Settle at POS | POS | `POST /api/sales` | `sales.js` | payment closes ticket balance | ☐ |
| Portal: my tickets | `PortalDashboard` tickets tab | `customer-portal/data.js` | — | **blocked by 01-D1** (tab flag maps to `phase4_service_projects`); post-fix, repair-shop customer sees "Repair Tickets" | ☐ |
| Notifications | ticket status change | notifications | `createNotification` | customer-visible status updates (if designed) or staff notification fires | ☐ |

## Defects (P0) — confirmed broken wiring
- Portal Tickets tab dead for repair_shop — **owned by 01-cross-surface D1** (`customer-portal/data.js:35` maps `tickets` → `phase4_service_projects`; repair_shop seeds `phase4_workflow_tickets` only). Listed here for sequencing: execute this plan after 01, or cherry-pick that one-line fix first.

## Feature-parity gaps (P1)
- None — Square has no ticket-workflow equivalent (§10 exceeds-Square list). Wiring-only plan.

## Polish & consistency (P2)
- Repair-shop vocab (Repair / Job Ticket) across board, POS lines, receipts, portal label ("Repair Tickets").
- Board empty states + ticket search.

## Confirm during execution
- Whether the portal tickets *data* endpoint (not just the tab flag) is gated on the right flag too.
- Ticket → invoice → return path (customer returns a repaired item — does a return reopen anything?).
- Deposit accounting entries land in `accounting_core` journals.

## Cross-surface lens (mandatory)
- **Invoicing** → `generateInvoiceFromTicket` must produce the same invoice shape as `customer-invoicing.js` (payments/balance recompute apply).
- **Tax** → ticket invoices in the 01 tax-chain diff.
- **Portal** → tab + data flags consistent post-01-D1.

## Verification bar (execution)
- Test tenant: fresh `repair_shop` signup.
- Walkthrough: intake w/ deposit → status hops → resolve → invoice → settle at POS → portal shows the ticket lifecycle.
- Done = rows ☑ + verifier confirms.

## Preset-skin checklist
- `repair_shop` — [ ] labels (Service/Repair/Job Ticket) [ ] dashboard (inventory_alerts on) [ ] onboarding "ticket" step (01-D2) [ ] portal tabs (tickets/invoices/profile — post-01-D1)
