# 04 — Wholesale / B2B distribution mode

**Covers:** mode `wholesale` + preset `wholesale` (Tiers 0–2 shipped 2026-05; this plan makes the whole stack provably connected)
**Modes/flags in scope:** `wholesale_credit_controls` (mode registry) + `wholesale_field_sales`, `wholesale_schemes`, `wholesale_secondary_sales` (all seeded ON at wholesale signup via `WHOLESALE_SEED_FLAGS`, layered on `seedRetailFlags` — `retail-flag-preset.js:111-116`)
**Surfaces touched:** POS (On Account tender, credit gate) · field-rep PWA · customer portal (reorder) · manufacturer portal · storefront (MOQ/visibility) · admin · reports (A/R)
**Branch strategy:** backend/wiring off `main`. Field PWA + portals are outside the `redesign/square` scope → no collision.

---

## Call-path map + verification checklist

| Flow | Screen / component | API call | Route → service | "Wired correctly = …" | Status |
|---|---|---|---|---|---|
| Credit limit + terms | `CustomersRedesign` Credit & A/R card | customer credit endpoints | `customers.js` | limit/block-mode/terms persist; On Account tender disabled until limit set | ☐ |
| On-account sale | POS | `POST /api/sales` (credit tender) | `sales.js` (+ `override_credit_limit` perm path) | sale links `customer_invoice_id`; over-limit blocked or overridden w/ perm; `completeSale` uses `api.raw` to surface the 4xx | ☐ |
| A/R aging + statements | `RetailRiskRedesign`, finance report | `GET /api/reports/ar-aging` (`as_of`), statement endpoints | `reports/finance.js`, `customer-invoices.js` | buckets from `company.ar_aging_buckets`; statement opening+debits−credits = closing ([[feedback-audit-ledger-before-building]]) | ☐ |
| Field route + check-in | field PWA (`pages/redesign/field/`) | `/api/field/*` | `field.js` → `services/geo.js` | GPS+selfie check-in; geofence flag vs `company_profile.field_geofence_meters`; Field Rep role (only `manage_field_sales`) hits zero 403s across the whole PWA ([[feedback_field_rep_perm_audit]]) | ☐ |
| Field order capture | field PWA "Took Order" | `POST /api/sales` w/ `field_visit_uuid` | `sales.js` + `services/moq.js` | sale linked to visit; MOQ/case-pack enforced (POS bypasses); offline queue type `field_order` replays | ☐ |
| Owner visit log | `/field/visits`, `/field/routes` | `GET /api/field/*`, `/api/admin/field-routes` | `field.js` | visit ↔ invoice linkage renders | ☐ |
| Slab schemes | `PromotionsRedesign` slab editor | `/api/promotions` (`slab_percent`, `tier_rules`, brand scope, priority) | `promotions.js` → quote/pricing | slab applies by qty tier; `sale_promotion_applications` snapshot frozen | ☐ |
| Manufacturer partner CRUD | `ManufacturerPartnersRedesign` (`/settings/manufacturer-partners`) | `/api/manufacturer-partners` | `manufacturer-partners.js` (flag `wholesale_secondary_sales`, perm `manage_inventory`) | invite → signup token → partner active | ☐ |
| Manufacturer portal | `/manufacturer-portal/:slug` | `manufacturer-portal/{auth,data}.js` (pre-tenant-middleware) | `manufacturer-auth.js` | brand-scoped sales data only; PII invariant = only `customers.city`; password reset works | ☐ |
| Portal reorder | customer portal | reorder endpoints + `?adopt=` cart handoff | `customer-portal/data.js` → `storefront-cart.js` | web + in-store UNION history; adopt lands cart in storefront | ☐ |
| Catalog visibility | portal/storefront/field pickers | product list endpoints | `services/product-visibility.js` | `restricted` SKUs hidden from ungrouped buyers; POS unaffected (01 owns the diff) | ☐ |
| Wholesale dashboard | `DashboardRedesign` | `GET /api/reports/dashboard/wholesale` | `reports/dashboard.js` | A/R outstanding/overdue + top buyers cards render for wholesale preset | ☐ |

## Defects (P0) — confirmed broken wiring
- None confirmed from this run's tool results — the stack was walked live at Tier 1/2 ship time. The cross-surface risks live in the Confirm list.

## Feature-parity gaps (P1)
- None from the comparison doc — wholesale is a §10 "exceeds Square" area. Deferred tiers (1.3.5 retrospective rebates, 1.4.5) stay deferred until a customer asks (per [[tier13_wholesale_schemes_complete]]).

## Polish & consistency (P2)
- Wholesale preset labels (Buyer/Invoice) coverage across POS + reports headers.
- Portal label overrides ("Account Invoices"/"Purchase Orders") render.
- Field PWA offline queue UX (pending badge, retry affordance).

## Confirm during execution
- Statement math reconciles on a tenant with refunds ("Reduce A/R" ledger-gap class caught in Tier 0.4 — re-verify post-v9x migrations).
- Slab scheme + customer-group discount + loyalty tier stacking order is deterministic (pricing.js stacks additively; quote.js cascade — confirm combined behavior matches on POS vs portal).
- Manufacturer portal TTL drift vs customer portal (backend/CLAUDE.md notes drift) — confirm sessions don't expire surprisingly.
- Geofence behavior when customer has no geocode (should warn, not block).

## Cross-surface lens (mandatory)
- **Pricing/promotions** → POS, field capture, portal reorder, storefront — same engine, same result (01 owns; this plan supplies the wholesale test cases).
- **Stock** → field orders decrement the rep's outlet stock exactly once, offline replay included.
- **Auth** → third+fourth JWT scopes (customer/manufacturer portals) never leak tenant data cross-brand.
- **Credit** → On Account writes hit `customer_invoices` — same AR tables the statements/aging read.

## Verification bar (execution)
- Test tenant: reuse [[wholesale_test_tenant]] (`wholesalewalktest1778451`, PIN 4321).
- Walkthrough: set credit limit → POS on-account sale → over-limit block → override → field check-in (geofence) → field order w/ MOQ violation rejected → slab promo applies → statement reconciles → manufacturer portal shows brand sales, city-only PII → portal reorder adopt.
- Done = rows ☑ + verifier confirms.

## Preset-skin checklist
- `wholesale` — [ ] labels (Buyer/Invoice) [ ] dashboard (A/R cards + field summary when rep exists) [ ] onboarding (01-D2) [ ] portal tabs (invoices/orders/profile + overrides)
