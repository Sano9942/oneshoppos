# Wave 0 (W0a) — Backend Security Fixes: Verification Report

Branch: `fix/audit-wave0` · Date: 2026-07-12 · Spec: PLAN-V2.md Step W0a (AUDIT §4A/§4B)

## S1 — `pos_discount` enforcement on `POST /api/sales`

### Call-path inventory (every writer that creates a sale or carries a discount into one)

| # | Path | Writer | Manual discount reachable? | Handling after W0a |
|---|------|--------|---------------------------|--------------------|
| 1 | POS checkout (`useCheckout.js`) | `routes/sales.js` `POST /api/sales` | **YES** — body `discount_amount` (order-level, fixed/percent) | **GATED** — `pos_discount` required (all_access bypasses); 403 `DISCOUNT_NOT_PERMITTED` |
| 2 | Field-rep order capture (`routes/field.js` → rep app posts to `POST /api/sales` with `field_visit_id/uuid`) | same endpoint | **YES** — same body contract | **GATED** — same check (Field Rep role holds only `manage_field_sales`, so a field-rep manual discount now 403s unless the role is granted `pos_discount`) |
| 3 | Backorder fulfillment (`BackordersRedesign.jsx` → `POST /api/sales` with `cartItems[].backorder_id`) | same endpoint | **YES** — same body contract | **GATED** — same check |
| 4 | Offline queue replay (`useOfflineQueue.js` → `POST /api/sales`) | same endpoint | **YES** — replays a POS payload | **GATED** — same check (a queued sale from a role lacking the perm 403s on drain, surfacing in the queue's failed state) |
| 5 | Restaurant check settle / draft-order resume (POS settles with `draft_order_id`) | same endpoint | **YES** — draft line discounts are folded into the settle payload's `discount_amount` by the client | **GATED** — same check, binding at settle time (the settling employee needs the perm) |
| 6 | Promo-engine discounts (schemes/slabs, `/api/promotions/quote`) | rides paths 1–5: client folds promo value INTO `discount_amount`, `applied_promotions[]` carries the breakdown | N/A — system-computed | **NOT gated.** The promo share is re-verified server-side via the same `evaluatePromotions` engine (category_id hydrated from `products`); only the residual above the engine-computed total counts as manual. A fabricated/inflated `applied_promotions` row cannot launder a manual discount (verified by test). |
| 7 | Loyalty redemption (`points_redeemed`) | `routes/sales.js` | N/A — separate field, valued server-side at `loyalty_redeem_rate`, FOR-UPDATE balance guards (H3) | **NOT gated** (system-computed) |
| 8 | Auto-pricing: price books / group / tier (`services/pricing.js`) | `routes/sales.js` (`autoDiscountValue`) | N/A — computed server-side, separate variable | **NOT gated** (system-computed) |
| 9 | Line-level `cartItems[].discount` | `routes/sales.js` | **Dead payload** — server ignores it: subtotal is `price × quantity`, `sale_items` has no line-discount column | **Inert** (test-documented). Line-level manual price cuts flow through `price_override`, which was ALREADY gated (2-G.5: `override_price` perm or manager `approval_event_id`) |
| 10 | Quotation convert | `routes/tier4/crm.js:682` (direct `INSERT INTO sales`, copies `quote.discount_amount`) | **YES** — discount entered on the quote | **Perm-gated at entry**: every quote create/update/convert route requires `manage_orders` (Manager+) + `crm_quotations` flag. Not the "any authenticated employee" hole S1 targets; left as-is, documented. |
| 11 | Layaway/hold settle | `routes/holds.js:358` | **NO** — `discount_amount` hardcoded `0` ("no promotion/loyalty/discount at this layer") | No change needed |
| 12 | Pay-at-table (QR guest payment) | `routes/restaurant/pay-at-table.js:446` (webhook writer) | **NO** — `discount_amount` hardcoded `0`; `computeCheckAmount` deliberately does NOT subtract `discount_total`; session creation requires `manage_restaurant` | No change needed |
| 13 | Aggregator orders (foodpanda/Careem) | `services/aggregator-orders.js:380` (`settleAggregatorSale`) | **NO** — `discount_total` comes from the platform payload (platform-funded, signature-verified webhook), never employee-entered | **NOT gated** by design (system/platform discount) |
| 14 | Storefront / customer-portal / subscriptions / web orders / kiosk / inbox | none — no `INSERT INTO sales` in `orders.js`, `subscriptions.js`, `storefront.js`, `restaurant-kiosk.js`, `restaurant-inbox.js`, `customer-portal/*`, `services/{subscriptions,storefront-cart,online-inbox}.js` | N/A | These produce `web_orders`/`customer_invoices`; any conversion to a sale goes through `POST /api/sales` (gated) |

**Residual note (documented, not fixed in W0a):** `routes/draft-orders.js` POST/PUT accept per-item `discount` with only a feature-flag gate (no perm). The stored draft discount only materializes into a sale via `POST /api/sales` (now gated at settle) — pay-at-table ignores it — so there is no ungated path to a discounted *sale*. Entry-time gating of draft-order discounts is a candidate for a later step, not a live hole.

### Gate design

- Location: `routes/sales.js`, immediately after `discountValue` is computed (order-level, pre-transaction).
- Trigger: `discountValue > 0.009` AND employee lacks both `all_access` and `pos_discount`.
- Promo allowance: server recomputes `evaluatePromotions(db, cart, subtotal)` (category_id hydrated; `price_locked` honored) — only runs for non-perm employees with `applied_promotions`, so the hot path (all default roles hold `pos_discount`) is zero-cost. Fail-closed on engine error.
- Tolerance: 0.05 (client rounds each promo to 2dp).
- Violation: **403 `{ code: "DISCOUNT_NOT_PERMITTED" }`** — reject, never silently strip.

### Blast radius

Default roles: Administrator (`all_access`), Manager (holds `pos_discount`), Cashier (holds `pos_discount`) — all unaffected. Field Rep (`manage_field_sales` only) and custom roles lacking the perm are newly blocked from manual discounts — matching what the POS UI already implies. Gate 0 pre-deploy: count prod roles missing `pos_discount` (Supabase read-only) per the Gate protocol.

## S4 — Admin self-lockout guard (`PUT /api/roles/:id/permissions`)

- Role 1 (built-in Administrator, wizard-seeded) must always retain `all_access`: any permissions array without it → 400 `CANNOT_REMOVE_LAST_ADMIN`, checked before any write.
- Any update that would leave **zero** roles holding `all_access` → 400 `CANNOT_REMOVE_LAST_ADMIN`, checked inside the write transaction (self-holds + no other holder).
- Stripping `all_access` from a non-last holder still works; all other Administrator-role edits unaffected.

## C1 — Staff-dropdown guard relax (`GET /api/employees`)

- Guard changed `requirePerm("all_access")` → `requireAnyPerm(["manage_employees", "all_access"])`.
- Fixes the empty staff dropdown on the ~21 Manager pages (role-audit REPORT headline).
- **Observation for owner (Gate 0):** the list response includes `pin_code` (plaintext legacy PINs where not yet hashed) and salary fields — previously Admin-only, now visible to `manage_employees` holders (default Manager). Managers legitimately manage staff and the plan prescribes this exact change, but trimming `pin_code`/salary columns from this endpoint is a cheap hardening candidate for a later step.

## Test evidence

`backend/tests/integration/pg-w0a-audit-security.test.js` — 17/17 green (local PG, isolated schema):

- S1: no-perm + fixed manual → 403; no-perm + percent manual → 403; no-perm + zero discount → 200; Cashier + manual → 200 (total 450 = 500−50); Admin + manual → 200; no-perm + promo-covered (folded + `applied_promotions`) → 200; no-perm + spoofed `applied_promotions` (claims 200, engine justifies 50) → 403; perm-holder + promo + manual on top → 200; `cartItems[].discount` inert (total unchanged) → documented.
- S4: strip role 1 → 400 + nothing written; strip role 1 with a second admin role present → still 400; last non-built-in holder stripping itself → 400; non-last holder strip → 200; role-1 edit retaining `all_access` → 200.
- C1: Manager → 200, Cashier → 403, Admin → 200.

Neighbor suites re-run green (serial): `pg-roles-permissions`, `pg-ws1b-sales-money`, `pg-ws1d-adjacent-writers`, `pg-sales-payment-validation` (34/34).

## Browser spot-checks (C1)

Local dev servers on the fix branch, logged in as a Manager-role employee ("W0a Manager", role 2) on `golv_general_retail`:

- **Attendance** (`/attendance`): the Employee filter dropdown populates ("All Employees / Owner / W0a Manager") — previously empty for Managers because `GET /api/employees` 403'd.
- **Sales History** (`/sales-history`): the "All Employees" cashier filter populates the same way.

(Test employee removed from the local tenant afterwards.)

## Full-suite baseline diff

Method: full suite on the branch (2287 tests: 37 failed / 1957 passed / 293 skipped, parallel), then the 20 failing files re-run serially (parallel-load artifacts drop out → 14 files / 22 failing tests), then those 14 files run against **stashed main** serially.

**Result: per-file failure counts are IDENTICAL on main and on the branch** — all 22 serial failures are pre-existing (cod-settlements 1, pg-batch11-admin 1, pg-batch14-bookings 3, pg-batch-2g15-error-states 2, pg-batch-2g17-risk-controls 1, pg-batch13-restaurant 1, pg-batch8-middleware 1, sales-decimal-quantity 3, pg-batch2-medium 1, pg-restaurant-reservations 1, pg-mode-gates 2, services.test 1, saas-phase1 2, routes-admin-worker-status 2). **Zero new failures introduced by W0a.**

Spot-triage: `sales-decimal-quantity.test.js` (3 × expected-200-got-400) fails identically with the W0a changes stashed — unrelated to the S1 gate (which returns 403, not 400).
