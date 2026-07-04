# 01 — Cross-surface seams

**Covers:** the shared concerns that must stay consistent across every write path: tax snapshot, stock decrement/reservation, pricing & promotions, catalog visibility, auth scopes & public-path allowlists, receipts, the preset engine (labels/tabs/flags), and the portal/kiosk/public surfaces that sit outside the tenant middleware chain. This is where the repo's recurring bug class (POS-fixed-storefront-broken, P8→P13) lives.
**Modes/flags in scope:** none exclusively — this plan owns the seams the mode plans reference.
**Surfaces touched:** POS · storefront · field-rep PWA · customer portal · manufacturer portal · kiosk · public pages (booking/menu/receipt/reservation) · admin
**Branch strategy:** backend/wiring only → off `main`. The kiosk fix (D3) is backend allowlist + possibly 1 line of FE — `main`.

---

## Call-path map + verification checklist
> Each row is a shared concern traced across every write/read path that touches it. Pass condition = all paths resolve it identically.

| Flow | Screen / component | API call | Route → service | "Wired correctly = …" | Status |
|---|---|---|---|---|---|
| Tax resolution (v83 chain) | POS, storefront checkout, draft orders, endless-aisle orders, restaurant checks, invoices, rentals, rooms, treatment folios | each write path | `sales.js` · `services/quote.js` · `draft-orders.js` · `orders.js` · `services/customer-invoicing.js` · `services/restaurant-checks.js` · `services/rental-service.js` · `services/room-service.js` · `services/treatment-plan-service.js` | same `tax_mode` + per-line `tax_rate_at_sale`/`tax_amount_at_sale` snapshot on every path; inclusive-mode totals identical for the same cart on POS vs storefront vs portal (**pause-list: verify only, changes need approval**) | ☐ |
| Stock decrement | POS sale, storefront checkout, field-rep order, restaurant check settle, kiosk order, returns restock | write paths above | `sales.js` · `services/reservation.js` + `allocation.js` · `storefront.js` | `outlet_stock`/`variant_outlet_stock` decremented exactly once per unit on every path; reservations expire (15-min TTL); no oversell under FOR UPDATE | ☐ |
| Pricing cascade | POS, storefront, portal reorder, field-rep capture | quote/price endpoints | `services/quote.js` (outlet → channel → customer → group → price_list → base) · `services/pricing.js` (group+tier stack) | same customer, same product → same price on every surface; slab promos apply per priority | ☐ |
| Catalog visibility | storefront, portal, field-rep picker, POS (must NOT filter) | product list endpoints | `services/product-visibility.js` | `visibility='restricted'` hidden from ungrouped buyers on portal/storefront/field; POS always sees all | ☐ |
| MOQ / case-pack | portal cart, storefront cart, field-rep order; POS bypasses | cart/sale endpoints | `services/moq.js` | violations rejected on the three gated paths; POS unaffected | ☐ |
| Auth scopes | tenant app, super-admin, customer portal, manufacturer portal, kiosk | login + refresh per scope | `jwt-auth.js` · `middleware/{tenant,customer,manufacturer}-auth.js` | four token stores never cross; kiosk-scope token restricted to attendance/auth paths; refresh rotation + reuse detection on all four | ☐ |
| Public `?tenant=` allowlist | kiosk, currency bootstrap, feature-flag bootstrap, setup, public receipt/booking/menu/storefront | unauthenticated GETs | `tenant-auth.js:PUBLIC_TENANT_PARAM_PATHS` + the before-middleware route set | every public screen's full mount-time fetch set resolves the tenant (see D3 — kiosk does not) | ☐ |
| Receipts | POS print, email, public URL, WhatsApp, portal invoice PDF-ish views | `utils/receipt.js` builders + `receipts.js` | single builder | totals/tax lines/currency identical across all renderings of one sale | ☐ |
| Preset engine | every screen using labels/vocab/widgets/tabs | `GET /api/context/bootstrap`, portal `GET /api/portal/config` | `industry-config.js` → `tier4/company-profile.js` · `customer-portal/data.js` | labels + `pos_layout_mode` + portal tabs match preset for each of the 23 presets (see D1) | ☐ |
| Flag seeding lifecycle | signup → wizard → mode seeder → multi-outlet seeder | `setup.js` + `retail-flag-preset.js` + `mode-registry.js` | see [[feature_flag_seed_lifecycle]] | after wizard, every nav entry visible for that preset has its backend gate satisfied (no visible-but-403 pair) | ☐ |
| Offline queue replay | POS sale/return, field check-in/order | `utils/offlineQueue.js` → replay | respective routes | idempotent replay on all 4 queue types | ☐ |

## Defects (P0) — confirmed broken wiring

- **Repair-shop customer portal can never show its Tickets tab** — `PORTAL_ENABLED_TABS_BY_PRESET.repair_shop = ["tickets", …]` (`backend/config/industry-config.js:759`), but the portal config endpoint ANDs each tab against `TAB_FEATURE_FLAGS` where `tickets: "phase4_service_projects"` (`backend/routes/customer-portal/data.js:35`). Repair shop's mode is `workflow_tickets`, which seeds `phase4_workflow_tickets` (`mode-registry.js:47-52`) — never `phase4_service_projects`. The AND always fails → tab filtered out for the only preset that uses it. · surfaces: customer portal × preset engine · fix sketch: map `tickets` → `phase4_workflow_tickets` (and audit the other 9 tab mappings against the presets that enable them).
- **Preset `onboarding_steps` are dead config** — every one of the 23 presets defines an `onboarding_steps` array (`industry-config.js`), but a repo-wide grep finds zero consumers outside `industry-config.js` itself: `SetupWizard.jsx` runs hardcoded numeric steps 1–5 (`SetupWizard.jsx:279-292,436-724`) and no backend route reads the field. A hotel/rental/clinic tenant gets the same generic retail wizard the config was designed to replace. · surfaces: setup wizard × all 23 presets · fix sketch: either drive `SetupWizard` step list from `GET /api/setup/status` preset payload, or delete the config field (decide, don't leave dead config).
- **Kiosk outlet picker dead in multi-tenant mode** — `KioskRedesign.jsx:126` fetches `GET /api/outlets?tenant=<slug>` unauthenticated at mount (kiosk is a public route), but `/api/outlets` is not in `PUBLIC_TENANT_PARAM_PATHS` (`middleware/tenant-auth.js:33-40` — only `auth/`, `attendance/pin-`, `feature-flags`, `setup/`, `health`, `company-profile/currency`), so tenant resolution fails and the request 401s in MT production. Same class as the May `?tenant=` lockdown that caused the live currency-401 regression. The sibling call `GET /api/feature-flags?tenant=` (line 127) IS allowlisted — the pair proves the drift. · surfaces: kiosk · fix sketch: add a read-only public outlets path (id+name only) to the allowlist, or have kiosk read outlets from an already-public endpoint (**pause-list: touches tenant routing/auth — get approval on the mechanism before implementing**).

## Feature-parity gaps (P1)
- None owned here — this plan is pure wiring. (Square's moat *is* this consistency; closing P0/checklist rows here is the parity work.)

## Polish & consistency (P2)
- `customer-auth.js` vs `manufacturer-auth.js` TTL/status-check drift (documented in backend/CLAUDE.md) — align or extract shared module.
- Error-shape consistency for gated routes: `requireFeature` 403 vs `requireMode` 403 vs perm 403 — frontend pages should distinguish "feature off" from "no permission" in their error states.
- Rate-limiter tenant keying (`?tenant=` / `x-tenant-slug`) on portal/public limiters — confirm keys can't collide across tenants.

## Confirm during execution
- Tax chain: diff each of the 9 write paths listed in the map against `sales.js`'s resolution — the memory says POS+quote were fixed (P8/P13); rentals/rooms/treatment folio paths were never explicitly audited.
- Stock: whether kiosk/restaurant-inbox order acceptance decrements stock at all (design may intentionally skip for F&B).
- Field-rep sale (`POST /api/sales` + `field_visit_uuid`) hits the same promotions/pricing engine as POS.
- Portal reorder `?adopt=` cart handoff still works post-redesign.
- Manufacturer portal PII invariant: only `customers.city` exposed (grep each `manufacturer-portal/data.js` query during execution).
- Whether `CONTEXT_EXEMPT_PATHS` (`tenant-auth.js:42-49`) matches the real set of pre-context calls the frontend makes at mount (428-class bugs).

## Cross-surface lens (mandatory)
This plan IS the lens. Every mode plan references back here for: tax · stock · pricing · visibility · auth · receipts · preset labels/tabs.

## Verification bar (execution)
- Test tenants: `general_retail` + `wholesale` (for visibility/MOQ/pricing) + one restaurant (kiosk paths). Reuse [[wholesale_test_tenant]] + [[cafe_test_tenant]].
- Walkthrough: same cart priced on POS vs storefront vs portal (tax-inclusive tenant); restricted product invisible on portal, visible on POS; kiosk cold-load with only `?tenant=` in URL; repair-shop portal shows Tickets tab post-fix.
- Done = every seam row ☑ with per-path evidence + 3 P0s fixed + verifier confirms.
