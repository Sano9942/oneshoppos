# 09 — Service projects mode

**Covers:** mode `service_projects` + preset `photography_studio` (booking surface in plan 03)
**Modes/flags in scope:** `phase4_service_projects`, `phase4_service_contracts` (+ `crm_quotations` default-true dependency)
**Surfaces touched:** admin app · customer portal (invoices/orders tabs)
**Branch strategy:** backend/wiring off `main`.

---

## Call-path map + verification checklist

| Flow | Screen / component | API call | Route → service | "Wired correctly = …" | Status |
|---|---|---|---|---|---|
| Quotation | `QuotationsRedesign` | `/api/quotations*` | `tier4/crm.js` (flag `crm_quotations`) | draft → sent (raw nodemailer vs tenant email_config) → `accepted` → `convert` | ☐ |
| Project create | `ProjectsRedesign` | `/api/projects` | `projects.js` (mode `service_projects` + flag + `manage_projects`) → `services/projects.js` | project + milestones persist; activity log rows in `project_activities` | ☐ |
| Milestones | project detail | milestone endpoints | `services/projects.js` | status transitions logged | ☐ |
| Contract + e-sign | `ContractsRedesign` | `/api/contracts` | `contracts.js` (flag `phase4_service_contracts` + `manage_contracts`) → `services/contracts.js` | send → `signContract(signature_data)` → signed PDF-ish view; multi-signer | ☐ |
| Milestone → invoice | project billing | project-billing endpoints | `services/project-billing.js` (`attachInvoiceToProject`) | invoice linked; `getProjectBillingSummary` totals = Σ milestone invoices | ☐ |
| Invoice → payment | `CustomerInvoicesRedesign` / portal | `customer-invoices.js` | `services/customer-invoicing.js` | balance recompute; portal pay CTA when `payment_links`+gateway on | ☐ |
| Portal view | customer portal | `customer-portal/data.js` | — | photography portal tabs (invoices/orders/appointments/profile) render | ☐ |

## Defects (P0) — confirmed broken wiring
- None confirmed from this run's tool results.

## Feature-parity gaps (P1)
- **Estimates → invoice, projects, contracts** are all ✅ §7 — parity already claimed; this plan proves the chain end-to-end instead of adding features.

## Polish & consistency (P2)
- Package/Session vocab on quotations + invoices for photography preset.
- Quotation email uses raw nodemailer (bypasses `services/email.js`) — no queue/retry visibility; consider routing through the unified service when touched.
- Project board empty states.

## Confirm during execution
- Contract signing from the customer side — is there a public/portal signing URL, or admin-only capture? (Route read needed.)
- `convert` guard: quotation must be `accepted` first — error message friendliness on violation.
- Milestone invoice deletion → project billing summary consistency.

## Cross-surface lens (mandatory)
- **Invoicing** → shares `customer-invoicing.js` with core AR + tickets + subscriptions — one balance engine.
- **Tax** → converted-quotation invoices in the 01 diff.
- **Email** → quotation send vs unified email service inconsistency (above).

## Verification bar (execution)
- Test tenant: fresh `photography_studio` signup.
- Walkthrough: quotation → accept → convert → project w/ 2 milestones → contract signed → milestone invoiced → paid → billing summary reconciles → portal shows invoice.
- Done = rows ☑ + verifier confirms.

## Preset-skin checklist
- `photography_studio` — [ ] labels (Package/Client/Session/Booking) [ ] dashboard (appointments_today) [ ] onboarding (01-D2) [ ] portal tabs (invoices/orders/appointments "Photo Shoots"/profile)
