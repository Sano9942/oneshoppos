# 00 — Core commerce spine

**Covers:** core spine — the always-on surfaces every tenant gets regardless of preset: auth/login, POS/checkout, products & catalog, inventory, customers/CRM/loyalty, employees/attendance/roles, cash shifts, sales & returns, taxes, promotions, dashboard, reports, accounting, setup wizard.
**Modes/flags in scope:** none (mode-less core) + always-on default-true flags (`accounting_core`, `crm_quotations`, `notifications`, `supplier_payables`, `customer_invoicing`, `marketing_campaigns`, `customer_messaging`, …) + the default-false unseeded flags this plan flags as defects (`ai_insights`, `reports_*` power-ups, `payment_links`).
**Surfaces touched:** POS · admin app · kiosk (attendance) · receipts (public)
**Branch strategy:** backend fixes off `main`. The two P0s have frontend touch-points ≤5 lines each — land those on `main` too (they're production bugfixes; `redesign/square` only re-skins classNames, so a one-line API-path change merges cleanly later). No new screens on `main`.

---

## Call-path map + verification checklist
> Built from code (routes/*.js registrations, frontend pages, `api.js` layer). Execution walks these live on a `general_retail` test tenant.

| Flow | Screen / component | API call | Route → service | "Wired correctly = …" | Status |
|---|---|---|---|---|---|
| Login (MT) | `LoginPage` | `POST /api/auth/mt-login` | `auth.js` → jwt-auth | token pair returned; refresh works on 401 TOKEN_EXPIRED | ☐ |
| Context select after login | `ContextSelect` | `GET /api/outlets`, `POST /api/context/*` | `outlets.js` | outlet header set; 428 CONTEXT_REQUIRED never hit with header present | ☐ |
| Preset bootstrap | `PresetContext` | `GET /api/context/bootstrap` | tier4/company-profile | labels/modes/vocab/pos_layout_mode match tenant `industry_type` | ☐ |
| POS sale (cash) | `POSRedesign` → `useCheckout` | `POST /api/sales` (body `cartItems`, item `id`, `price`) | `sales.js` | sale row + sale_items with tax snapshot cols; stock decremented on correct outlet; receipt renders | ☐ |
| POS offline sale | `useOfflineQueue` | queued → replayed `POST /api/sales` w/ idempotency key | `sales.js` | replay does not double-post; queue drains | ☐ |
| Discount w/ approval | `POSDiscountModal` | `POST /api/sales` + approval-policy eval | `approval-policies.js` → `services/approval-policy.js` | over-threshold discount requires manager PIN (`services/manager-pin.js`) | ☐ |
| Park / retrieve | POS F3/F5 | `POST/GET /api/parked-sales` | `parked-sales.js` | cart round-trips incl. customer + per-line discounts | ☐ |
| Return | `ReturnsRedesign` / POS | `POST /api/returns` (`original_sale_id`, `total_refund`, `refund_method`, item `refund_price`) | `returns.js` | stock restocked per `restock_flag`; loyalty/wallet reversed; FBR credit note enqueued when flag on | ☐ |
| Product CRUD + variants | `ProductFormPage` | `POST/PUT /api/products` | `products.js` | variant combos, image → R2, `serial_required`, leaf-only category enforced | ☐ |
| Bulk import | `ImportRedesign` | `POST /api/import/products?preview=1` → confirm | `import.js` → `services/import/` | preview counts = committed counts; template downloads | ☐ |
| Stock adjustment / transfer | `StockAdjustmentsRedesign`, `TransfersRedesign` | `POST /api/adjustments`, `/api/transfers` | `inventory.js` | outlet_stock deltas correct both sides; action history row | ☐ |
| Stock count | `StockCountRedesign` | `/api/inventory-intelligence` cycle-count endpoints | `inventory-intelligence.js` | count session → variance → adjustment posts | ☐ |
| PO → GRN → payable | `PurchaseOrdersRedesign` | `/api/purchase-orders`, `/api/grn` | `purchase-orders.js`, `grn.js` | GRN receipt raises stock + creates payable (`supplier_payables` default-true) | ☐ |
| Customer + loyalty + wallet | `CustomersRedesign` | `/api/customers`, `/api/loyalty` | `customers.js`, `loyalty.js` | earn/redeem ledger balances; wallet top-up spendable at POS | ☐ |
| Employees + roles + PIN | `EmployeesRedesign` | `/api/employees`, `/api/roles` | `employees.js`, `roles.js` | role perms enforce (Cashier vs Manager); `validate-pin` POS re-auth works | ☐ |
| Attendance (kiosk PIN) | `KioskRedesign` | `POST /api/attendance/pin-checkin?tenant=` | `attendance.js` | check-in/out with LOCAL time display (see 01-cross-surface D7 for the outlets 401) | ☐ |
| Cash shift open/close | `CashManagementRedesign` | `/api/shifts`, `GET /api/shifts/active?outlet_id=` | `shifts.js` | z-report math = sales − refunds ± cash movements | ☐ |
| Taxes | `TaxesRedesign` | `/api/taxes` | `taxes.js` | `tax_mode` (inclusive/exclusive) respected in POS totals + per-line snapshot (v83 arch — **pause-list: don't change, only verify**) | ☐ |
| Promotions | `PromotionsRedesign` | `/api/promotions` | `promotions.js` → `services/quote.js`/`pricing.js` | active promo applies at POS AND storefront (cross-surface lens) | ☐ |
| Dashboard | `DashboardRedesign` | `GET /api/reports/dashboard` | `reports/dashboard.js` | KPI fields `totalRevenueToday`/`saleCount`/`averageBill` consumed; widgets per preset config | ☐ |
| Reports (each tab) | `Reports.jsx` groups | `/api/reports/*` | `reports/*` | every listed tab returns 200 for a default tenant (see D2 below — 3 don't) | ☐ |
| Accounting | `AccountingRedesign` | `/api/accounting/*` (`from`/`to`) | `tier4/accounting.js` | P&L/trial balance/journal balance; sale → journal postings reconcile | ☐ |
| Customer invoices (AR) | `CustomerInvoicesRedesign` | `/api/customer-invoices` | `customer-invoices.js` → `services/customer-invoicing.js` | invoice → payment → balance recompute reconciles (see [[feedback-audit-ledger-before-building]]) | ☐ |
| Quotation → invoice | `QuotationsRedesign` | `PUT status accepted` → `convert` | `tier4/crm.js` | convert only after accepted; converted invoice totals match quote | ☐ |
| Notifications | `NotificationBell` | `PUT /api/notifications/read-all` | `tier4/notifications.js` | unread badge count drops; low-stock notifications fire on sale | ☐ |
| Receipt email + public URL | POS receipt modal | `POST /api/email/send-receipt-v2`; `/receipt/:invoiceNumber` | `email.js`, `receipts.js` | SMTP-first/Resend-fallback; public page renders w/o auth | ☐ |
| Setup wizard | `SetupWizard` | `/api/setup/*` | `setup.js` | wizard completes; mode + retail flag seeding runs (`retail-flag-preset.js`) | ☐ |
| Action history | `ActionHistoryRedesign` | `GET /api/action-history` (`date_from`/`date_to`) | action-history route | destructive ops (void, delete, adjustment) all logged | ☐ |

## Defects (P0) — confirmed broken wiring

- **AI insights chat is unreachable for every tenant** — flag `ai_insights` is gated in backend (`backend/routes/insights-ai.js:30`) and in frontend (`frontend/src/pages/redesign/DashboardRedesign.jsx:285` — `<AIChatPanel flagEnabled={!!flags.ai_insights} />`), but grep over the whole repo shows `ai_insights` appears ONLY in those two files: it is not in `DEFAULT_FEATURE_FLAGS` (`middleware/feature-flags.js`), not in any seed list (`retail-flag-preset.js`, `mode-registry.js`, `setup.js`, `migrate-pg.js`, `schema-pg.sql`), so `flags.ai_insights` is always falsy and the flag never even appears in the admin flags editor (which lists defaults ∪ DB rows). The comparison doc counts "AI insights ✅" — in reality the chat half is dead in product. · surfaces: dashboard · fix sketch: add `ai_insights` to `DEFAULT_FEATURE_FLAGS` (decide default) or seed per-plan; verify `ANTHROPIC_API_KEY` set on Railway.
- **Three Reports→Inventory tabs 403 for every default tenant** — `Reports.jsx:477-480` lists `stock-aging`, `stockout-risk`, `replenishment-smart` unconditionally in the Inventory tab group, but their routes are gated `requireFeature("reports_inventory_health_plus")` (`reports/inventory.js:736-738` et al.), and that flag defaults `false` (`feature-flags.js:21`) with no wizard/mode/migration seed → clicking any of the three yields a 403 error state on every tenant. Compounding it: `/api/reports/stock-aging` is registered twice — the gated copy in `inventory.js:737` (registered via `reports/index.js:21`) shadows the ungated Wave-3 implementation in `stock-aging.js:12` (registered later at `reports/index.js:33`), so the dedicated stock-aging report can never serve. · surfaces: reports · fix sketch: delete one stock-aging duplicate, and either gate the three tabs client-side on the flag or ungate the routes — one consistent decision.

## Feature-parity gaps (P1)
> From [sanopos-vs-square-comparison.md](../../../research/sanopos-vs-square-comparison.md).

- **Exchanges (item-swap)** — 🟡 §2: returns are full; explicit swap flow thin · reuse: `returns.js` + `sales.js` in one transaction (return + new sale linked).
- **Cross-location returns UX** — 🟡 §2: return at outlet B for sale at outlet A · reuse: `returns.js` already has the data; needs outlet-aware restock + UI affordance.
- **Product bundles** — 🟡 §3: `smart-collections.js` exists; true bundle SKU (components decrement) missing · reuse: variants + a `bundle_components` mapping.
- **Automatic invoice payment reminders (cadence)** — 🟡 §7: `services/customer-invoicing.js:scheduleReminders` exists; confirm an automated cadence actually enqueues without manual trigger · reuse: pg-boss + email worker.
- **Batch invoices** — 🟡 §7: `createBatchInvoices` service exists with idempotency guard; confirm a UI path exposes it · reuse: `CustomerInvoicesRedesign`.
- **Unified messaging hub** — 🟡 §8: `messaging.js` inbox is WhatsApp-centric; email/SMS threads not unified · reuse: `messaging.js` thread model.
- **New-hire onboarding** — 🟡 §9: HR records exist; guided flow limited · reuse: `tier4/hr.js`. (Low priority.)
- **Age-verification prompts** — ❌ §2 · smallest possible version: per-product flag + POS confirm dialog. (Low priority; decide if PK market needs it.)

## Polish & consistency (P2)
- Report date-param inconsistency: most tabs `date_from`/`date_to`; `multichannel`, `kds-analytics`, `fbr-export` use `from`/`to` (reports/CLAUDE.md + code). Standardize by accepting both server-side.
- `payment_links` defaults `false` and is only seeded as `('payment_links', false)` (`migrate-pg.js:1845`) — the invoice "payment link" button is admin-opt-in only; document or auto-enable when gateway `isEnabled()`.
- `reports_profit_layer` / `reports_exceptions` / `reports_scheduled_exports` (`feature-flags.js:20-23`) — same default-false-never-seeded pattern; Power-Up panel advertises them but nothing in-product can turn them on. Decide: admin-only upsell (document) or self-serve toggle.
- Inline CSV Blob code in `SalesHistoryRedesign`, `CustomersRedesign`, `OrdersRedesign`, `InventoryRedesign` → `downloadCsv`.
- Legacy wrappers (`Accounting.jsx`, `Attendance.jsx`, `Approvals.jsx`…) still carry logic — fold into their `*Redesign.jsx` when touched.

## Confirm during execution
- **Currency 401 live regression** ([[followup_currency_401_regression]], found Jun 19): code on this branch now allowlists `^/api/company-profile/currency$` in `PUBLIC_TENANT_PARAM_PATHS` (`middleware/tenant-auth.js:39`) — verify the fix is actually deployed and dashboards show Rs, not $.
- `GET /api/sales` list pagination + filters actually consumed by `SalesHistoryRedesign` (shape drift suspected, unverified).
- Dashboard onboarding checklist signals (`reports/dashboard.js` try/catch-wrapped queries) return real data on a fresh tenant, not silent nulls.
- Draft-order dependency: `phase2_draft_orders` is seeded for retail/restaurant/cafe wizards only — verify other presets' POS never lazily calls `POST /api/draft-orders` (would 403).
- `PLAN_LIMIT_REACHED` modal fires on Free-plan product cap (event-driven path in `api.js`).

## Cross-surface lens (mandatory)
- **Tax snapshot** → also written by storefront `services/quote.js`, `draft-orders.js`, `orders.js`, `customer-invoicing.js`, `restaurant-checks.js`, `rental-service.js`, `treatment-plan-service.js` → per [[feedback_parallel_paths]] verify ALL use the v83 chain (owned by 01-cross-surface; this plan verifies the POS path only).
- **Stock decrement** → POS sales, storefront checkout (`reservation.js`/`allocation.js`), returns restock, GRN, transfers, adjustments → 01-cross-surface owns the diff.
- **Promotions** → POS + storefront quote + field-rep sales → same engine? (01 owns.)
- **Receipts** → POS print, email, public URL, WhatsApp share — all from `utils/receipt.js` builders → consistent totals incl. tax lines.

## Verification bar (execution)
- Test tenant: `general_retail` (reuse `squaretest` local, or a fresh signup for clean flag state).
- Walkthrough: login → context → POS sale (cash+card+discount+park) → return → product CRUD → adjustment/transfer → PO→GRN → customer+loyalty → shift close z-report → each report tab 200 → accounting reconcile → receipt email/public → notifications.
- Done = every checklist row ☑ live + both P0s fixed + verifier subagent confirms.
