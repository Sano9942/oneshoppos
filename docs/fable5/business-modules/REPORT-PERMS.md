# REPORT-PERMS — D4a: `view_reports` split taxonomy + data-classified mapping table

> ## ✅ RATIFIED BY OWNER — 2026-07-12
> Everything in this document is ratified **as written**, including every recommendation
> where an option was left open. Step 4 applies it verbatim. Explicit rulings on the
> previously open items:
>
> 1. **Taxonomy, mapping table, and pristine-Cashier predicate (§1–§6, §10)**: ratified as written.
> 2. **§8 #2 (clinic/salon front desks)**: option **(b)** — the Step 4 migration seeds
>    `view_customer_reports` onto pristine Cashiers **only on tenants with the
>    `appointments` mode enabled**, in addition to `view_sales_reports`.
> 3. **§7 #7 (notifications bell)**: keep the guard, mapped to `view_sales_reports`
>    (the any-authenticated alternative is rejected).
> 4. **§9.1 C2**: all 12 per-row rulings ratified exactly as proposed.
> 5. **§9.2 C6**: the `manage_finance` + `manage_reports` split ratified; both perms
>    registered in the catalog at Step 4 and defaulted to Manager.
> 6. **§9.3 unguarded trio**: all three guard recommendations ratified
>    (add-outlet + create-checkout + request-upgrade → `all_access`;
>    commissions/calculate → `manage_employees`).
> 7. All ten mixed-endpoint decisions (§7) ratified as written.

> PLAN-V2 Step 3 deliverable (2026-07-12). **Analysis only — nothing here is applied yet.**
> Step 4 (D4b) applies this table verbatim per the ratification above. If Step 4 finds a
> call site this table doesn't cover, it must stop and report, not improvise.
> Evidence basis: fresh grep of every `view_reports` occurrence (417 across 106 files,
> reconciled below), payload inspection of every judgment-call endpoint, and a read-only
> predicate validation against all 48 local `sanopos_dev` tenant schemas.

---

## 1. Taxonomy (5 permissions — all supported by ≥3 call sites)

| Permission | Definition (data classes it grants) |
|---|---|
| `view_sales_reports` | Sales/returns transactions and receipts, POS-operational reads (parked/holds, shift & cash reports, z-reports), sales analytics WITHOUT margin (trends, heatmaps, product mix, discount/void leakage), multichannel revenue, dashboard sales scalars, insight cards, notifications bell |
| `view_inventory_reports` | Stock on hand/movements, transfers, adjustments, serials, batches, stock aging, shrinkage, replenishment/forecast, product audit, Shopify reconciliation, GRN receiving lists, purchase-order reads, **valuation of stock at cost** |
| `view_financial_reports` | Accounting reads (P&L, balance sheet, cashflow, AP/AR, tax ledger, periods), supplier invoices/aging/ledger/payments, purchasing spend reports, GST reports, AR aging/settlement, **all margin/profit/cost-analysis anywhere** (profit layer, pricing-margin, menu engineering, recipe costing, retail matrix) |
| `view_hr_reports` | Attendance viewing, staff performance/labor/loss-prevention reports, commission earnings, risk-control events & anomaly flags (per-employee conduct data), action history |
| `view_customer_reports` | Customer detail surfaces (ledger, statements, order history, per-customer sales), loyalty ledger, customer analytics (RFM, retention, capture), clinical reports, recalls/handouts/vaccination, client service records |

**Two boundary rules** (these resolve every ambiguous case; adopt them as canon):

1. **Margin rule**: any endpoint exposing cost, margin, or profit *analysis* → `view_financial_reports`. `view_inventory_reports` covers stock *valuation* (cost value of what's on the shelf) but not profitability analysis.
2. **POS-adjacency rule**: operational reads the POS terminal itself needs (product lookup/scan/stock, customer search/wallet/credit-status/loyalty tiers, sale-by-barcode, notifications) get `view_sales_reports` added to their `requireAnyPerm` array so a sales-only Cashier keeps a working POS. S5 (Step 4) strips cost/margin fields from `GET /api/products*` for tokens holding only sales-class perms.

`all_access` bypasses everything, unchanged. Composite arrays below never remove existing non-report members (`manage_inventory`, `manage_orders`, `pos_park`, field perms, etc.) — only the `view_reports` member is replaced.

---

## 2. Occurrence reconciliation (fresh grep 2026-07-12: **417 occurrences / 106 files**)

The plan's "~166" estimate predates the role-audit artifacts; `role-matrix.json` alone holds 106.

| Bucket | Occurrences | Disposition |
|---|---|---|
| Backend route guards + in-file comments (34 route files) | 95 | Mapped row-by-row in §3 |
| Backend non-route source (`middleware/permissions.js` ×4, `config/permissions-catalog.js` ×1, `tenant-provisioner-pg.js` ×1, `types/express.d.ts` ×1) | 7 | Mapped in §3.9/§5 |
| `shared/constants.js` (PERMISSIONS.VIEW_REPORTS) | 2 | §5 (Step 4 update) |
| Backend tests (helpers ×4, unit ×8, integration ×32) | 44 | §6 inventory (Step 4 update) |
| Frontend source (8 files) | 24 | Mapped in §4 |
| Frontend tests (`auth_guards.test.jsx` ×1, `tests/auth.json` ×1) | 2 | §6 (auth.json is a gitignored login artifact — regenerates; no edit) |
| CLAUDE.md docs (root ×1, backend ×1, middleware ×2, tier4 ×1, shopify ×2, reports ×6, frontend routes ×1) | 14 | Gate 1 docs pass |
| `docs/**` + `.audit/**` (plans, audits, archive, role-matrix.json) | 229 | Frozen history / plan text — no code action |
| **Total** | **417** | 100% covered |

---

## 3. Backend mapping table (every explicit `view_reports` guard/comment — 95 occurrences)

Legend: **→ perm** = what replaces the `view_reports` member. "(keep …)" = other array members unchanged.

### 3.1 Sales / POS-operational → `view_sales_reports`

| File:line | Route | Returned data | → perm |
|---|---|---|---|
| sales.js:155 | GET /api/sales | sales list w/ totals, payments | view_sales_reports |
| sales.js:241 | GET /api/sales/by-barcode/:code | one sale + items (POS return scan) | view_sales_reports (keep pos_park) |
| sales.js:278 | GET /api/sales/:id | sale detail | view_sales_reports |
| returns.js:841 | GET /api/returns | returns list | view_sales_reports |
| returns.js:885 | GET /api/returns/lookup-web-order | web order for POS return | view_sales_reports (keep manage_returns) |
| returns.js:913 | GET /api/returns/:id | return detail | view_sales_reports |
| holds.js:106 | GET /api/holds/expiring | held sales | view_sales_reports (keep pos_park, manage_orders) |
| holds.js:127 | GET /api/holds/by-barcode/:code | hold lookup (POS) | view_sales_reports (keep pos_park) |
| holds.js:143 | GET /api/holds/:id | hold detail | view_sales_reports (keep pos_park, manage_orders) |
| orders.js:24 | GET /api/orders/aging-summary | web-order fulfillment aging (counts, no money beyond order totals) | view_sales_reports (keep manage_orders) |
| insights.js:6 | GET /api/insights/auto | **payload verified**: revenue trend, top products, low-stock count, busiest hour, avg txn — no margin/cost/HR | view_sales_reports |
| insights-ai.js:20 | POST /api/insights/ask | **payload verified**: AI context = sales counts/totals, top products, low-stock count only | view_sales_reports |
| barcode-expenses.js:814 | GET /api/notifications | notification titles (low stock, system alerts) | view_sales_reports — see §7 mixed #7 |
| barcode-expenses.js:825 | POST /api/notifications/:id/read | self-service mark-read | view_sales_reports (match GET) |
| packages.js:15,31 | package sell/redeem/balance staffGuard | customer package credits (counter-staff surface by design) | view_sales_reports (keep manage_bookings) |
| loyalty.js:25 | GET /api/loyalty/config | earn/redeem rates (POS points math) | view_sales_reports |

### 3.2 Inventory → `view_inventory_reports`

| File:line | Route | Returned data | → perm |
|---|---|---|---|
| inventory.js:26 | GET /api/transfers | transfer list | view_inventory_reports (keep manage_inventory) |
| inventory.js:281 | GET /api/adjustments | adjustments list | view_inventory_reports (keep manage_inventory) |
| batches.js:14 | `VIEW` const (all batch reads) | batch/expiry stock | view_inventory_reports (keep manage_inventory) |
| product-serials.js:14,50 | serial reads | serial inventory (no POS frontend consumer — verified) | view_inventory_reports (keep manage_inventory) |
| backorders.js:15 | backorder reads | unfulfilled-order stock queue | view_inventory_reports (keep manage_orders, manage_inventory) |
| shopify/reconciliation.js:39 | GET /reconciliation | POS-vs-Shopify qty diff | view_inventory_reports (keep manage_inventory) |
| reports/stock-aging.js:13 | GET /api/reports/stock-aging | age buckets + stock cost value (valuation → inventory per margin rule) | view_inventory_reports (keep manage_inventory) |
| reports/inventory.js:736 | (comment) | see §3.8 blanket section | view_inventory_reports |
| grn.js:8,47,60 | GET /api/grn, /by-po/:poId, /:id | GRN receiving lists (costs at receipt = valuation) | view_inventory_reports (keep manage_orders) |
| purchase-orders.js:23,38 | GET /api/purchase-orders(/:id) | PO reads (procurement ops) | view_inventory_reports (keep manage_orders) |

### 3.3 Financial → `view_financial_reports`

| File:line | Route | Returned data | → perm |
|---|---|---|---|
| grn.js:342,381 | GET /api/supplier-invoices(/:id) | supplier invoices (AP) | view_financial_reports (keep manage_orders) |
| grn.js:476 | GET /api/supplier-aging | AP aging | view_financial_reports (keep manage_orders) |
| grn.js:561 | GET /api/supplier-ledger/:supplier_id | supplier money ledger | view_financial_reports (keep manage_orders) |
| tier4/accounting.js:27,130,198,269,299,351,417,497,530,576,614 | GET pnl, cashflow, cashflow/daily, ap-ar, ap, periods, balance-sheet, expenses, ap-aging, tax-ledger, supplier-payments | accounting reads | view_financial_reports — **also replaces the `manage_employees` member** (C6, §9.2) |
| reports/menu-engineering.js:19,32 | GET menu-engineering | per-item margin quadrants (margin rule) | view_financial_reports |
| reports/recipe-costing.js:21,30 | recipe-costing + recipe-usage | plate cost, margin, food-cost % (margin rule) | view_financial_reports |

### 3.4 HR / staff-conduct → `view_hr_reports`

| File:line | Route | Returned data | → perm |
|---|---|---|---|
| attendance.js:241 | (comment re blanket GET /api/attendance) | team attendance | view_hr_reports via rule change (§3.8) |
| commissions.js:138 | GET /api/commissions/earnings | **payload verified**: cross-employee commission+tip earnings (any employee_id) | view_hr_reports — judgment call §8 #5 |
| risk-controls.js:150,201,267 | GET no-sale-events, anomaly-flags, summary | per-employee fraud/conduct signals | view_hr_reports |
| receipt-templates.js:212 | GET /api/action-history | staff action audit trail (frontend page is already all_access) | view_hr_reports |

### 3.5 Customer / clinical → `view_customer_reports`

| File:line | Route | Returned data | → perm |
|---|---|---|---|
| customers.js:71 | GET /api/customers/tags | tag list (customer-filter UI) | view_customer_reports (keep manage_customers) |
| customers.js:141 | GET /api/customers/:id/ledger | customer money ledger | view_customer_reports (keep manage_customers) |
| customers.js:425 | GET /api/customers/:id/statement | AR statement | view_customer_reports (keep manage_customers) |
| customers.js:564 | GET /api/customers/:id/sales | per-customer sales history | view_customer_reports |
| customers.js:624 | GET /api/customers/:id/order-history | CRM order history | view_customer_reports (keep manage_customers) |
| loyalty.js:77 | GET /api/loyalty/customers/:id/ledger | loyalty point ledger | view_customer_reports |
| reports/clinical.js:5,12 | all clinical reports (plan-completion, attendance, revenue-per-plan, retention, lab-turnaround) | clinical outcomes | requireAnyPerm([view_customer_reports, manage_treatment_plans]) |
| recalls.js:12,32,42 | recall reads | patient recall queue | view_customer_reports (keep manage_treatment_plans) — blast radius §8 #2 |
| handouts.js:33 | handout reads | patient education docs | view_customer_reports (keep manage_treatment_plans) — §8 #2 |
| client-service-records.js:12,34 | service-record reads | salon/clinic client history incl. formulas | view_customer_reports (keep manage_bookings) — §8 #2 |

### 3.6 POS-adjacency composites → `[view_sales_reports, view_inventory_reports]` or `[view_sales_reports, view_customer_reports]`

| File:line | Route | Why composite | → perms |
|---|---|---|---|
| products.js:182 | GET /api/products | POS product grid; `SELECT p.*` leaks cost → **S5 strips cost/margin for sales-only tokens** | [view_sales_reports, view_inventory_reports] (keep manage_inventory, manage_field_sales, execute_field_sales) |
| products.js:310,378 | GET /api/products/search, /scan/:barcode | POS hot paths | [view_sales_reports, view_inventory_reports] + S5 |
| products.js:510,563,611,628,655 | GET /:id, /variants, /stock, /bundle-components, /components | POS detail/availability/bundle expansion | [view_sales_reports, view_inventory_reports] + S5 |
| customers.js:525 | GET /api/customers | **POS F4 customer search** — without this a sales-only Cashier breaks | [view_sales_reports, view_customer_reports] |
| customers.js:791 | GET /api/customers/:id/wallet | POS wallet-tender balance | [view_sales_reports, view_customer_reports] |
| customers.js:987 | GET /api/customers/:id/profile | POS customer panel (points/wallet at attach) | [view_sales_reports, view_customer_reports] (keep manage_customers) — §8 #1 |
| customers.js:89 | GET /api/customers/:id/credit-status | wholesale POS credit gate | [view_sales_reports, view_customer_reports] (keep manage_customers, manage_field_sales, execute_field_sales) |
| customers.js:1070 | GET /api/loyalty/tiers | POS tier display | [view_sales_reports, view_customer_reports] |

### 3.7 Cross-domain composites → any-split

| File:line | Route | Decision |
|---|---|---|
| report-builder.js:162 | GET builder/datasets | requireAnyPerm(all 5 splits); response **filtered** to datasets the token's perms allow |
| report-builder.js:170 | POST builder/run | requireAnyPerm(all 5 splits) + **per-dataset enforcement** (§7 mixed #3): sales_summary→sales, product_performance→financial (margin measures), inventory_snapshot→inventory, customer_analysis→customer, employee_performance→hr |
| report-builder.js:185,202,223,256 | definitions list/create/update/delete | requireAnyPerm(all 5 splits); create/update validate the referenced dataset against the caller's perms; writes additionally proposed → `manage_reports` (C6, §9.2) |
| reports/governance.js:640,668,706,734 | saved-views reads/writes | requireAnyPerm(all 5 splits + manage_employees→manage_reports per C6) — views are pointers, run-time enforcement is on the underlying report |
| reports/kds-analytics.js:8,20 | GET kds/prep-times | station prep percentiles — operational, no money/HR → **view_sales_reports** (keeps restaurant mode+flag gates) |

### 3.8 The `/api/reports/*` blanket rule (the biggest single decision)

`PERMISSION_RULES` **is live middleware** ([registerAllRoutes.js:308-326](../../../backend/routes/registerAllRoutes.js)) — one rule guards every `GET /api/reports/*` with `["view_reports","manage_employees"]`, and most files under `routes/reports/` have **no inline guard at all**. Step 4 must:

1. **Add explicit per-domain guards** inside each reports file (first middleware in each route chain):

| reports/ file | → perm | Exceptions (route-level) |
|---|---|---|
| dashboard.js | mixed — **permission-filtered response** (§7 mixed #1) | wholesale dashboard → view_financial_reports (AR data) |
| sales.js | view_sales_reports | profit-summary / profit-by-product / profit-by-outlet → view_financial_reports (already flag-gated reports_profit_layer) |
| analytics.js | view_sales_reports (trends, heatmaps, revenue-leaks, discount-leakage, product-mix, outlet-comparison, supplier-wise, returns-by-reason) | retail-matrix + exceptions → view_financial_reports (margin-based; §7 mixed #4); customer-rfm / customer-details / customer-retention / customer-capture-rate → view_customer_reports |
| inventory.js | view_inventory_reports | pricing-margin + pricing-exceptions → view_financial_reports (margin rule) |
| purchasing.js | view_financial_reports (procurement spend) | — |
| finance.js | view_financial_reports | — |
| staff.js | view_hr_reports | — |
| shifts.js | view_sales_reports (cash ops — cashiers close shifts) | — |
| multichannel.js | view_sales_reports | — |
| governance.js | already inline-guarded (§3.7, §9.2) | — |
| fbr-export.js | all_access (unchanged) | — |
| stock-aging / clinical / kds-analytics / menu-engineering / recipe-costing | already inline-guarded (rows above) | — |

2. **Rewrite the blanket rule as a backstop only**: `anyPerms: [all 5 splits, "manage_reports"]` — defense in depth so an unguarded new report route still requires *some* report permission; the inline guard is what enforces the *right* one.
3. Same for the attendance rule: `GET /api/attendance(/|$)` → `anyPerms: ["view_hr_reports", "manage_employees"]`. (Kiosk `pin-*` endpoints are POST and exempt — unaffected.)

### 3.9 Backend non-route source (7 + 2 occurrences)

| File:line | What | Step 4 action |
|---|---|---|
| middleware/permissions.js:42 | Manager default list | replace `view_reports` with **all five splits** |
| middleware/permissions.js:74 | Cashier default list | `["view_sales_reports", "pos_discount", "pos_park"]` |
| middleware/permissions.js:110 | /api/reports blanket rule | backstop rewrite (§3.8) |
| middleware/permissions.js:115 | /api/attendance rule | `["view_hr_reports", "manage_employees"]` |
| config/permissions-catalog.js:99→ | registration | **done this step** (5 splits registered; view_reports relabeled "legacy — being split"; removed entirely in Step 4) |
| tenant-provisioner-pg.js:27 | provisioner perm seed | swap to splits per new defaults (also grep setup.js wizard seeding) |
| types/express.d.ts:23 | doc-comment example | cosmetic update |
| shared/constants.js ×2 | `PERMISSIONS.VIEW_REPORTS` | replace with five constants; grep consumers first (JSDoc type + object) |

---

## 4. Frontend mapping (24 source occurrences, 8 files)

Step 2 already gave `hasPerm`/`perm(...)` any-of array support — used below.

| File:line | Surface | → perm(s) |
|---|---|---|
| nav-config.js:233,236,237 | Accounting, Credit/Debit Notes, Post-Dated Cheques | view_financial_reports |
| nav-config.js:244 | Report Builder | any-of [all 5 splits] |
| nav-config.js:245 | Retail Risk | any-of [view_hr_reports, view_financial_reports] (page shows conduct events + AR/credit risk) |
| nav-config.js:252 | Attendance | view_hr_reports — **Cashier loses the nav entry** (§8 #3) |
| appRoutes.jsx:163 | /retail-risk | any-of [view_hr_reports, view_financial_reports] |
| appRoutes.jsx:183 | /accounting | view_financial_reports |
| appRoutes.jsx:204 | /attendance | view_hr_reports |
| appRoutes.jsx:241,242 | /credit-debit-notes, /postdated-cheques | view_financial_reports |
| appRoutes.jsx:258 | /report-builder | any-of [all 5 splits] |
| DashboardQuickActions.jsx:9 | Reports quick action | any-of [all 5 splits] (Reports page shows per-perm tabs) |
| DashboardQuickActions.jsx:10 | Cash Management quick action | view_sales_reports |
| DashboardRedesign.jsx:47-62 (6 occ.) | `canViewReports` widget gating | split per widget: KPI/trends/top-products/insights → view_sales_reports; inventory alerts → view_inventory_reports; team attendance → view_hr_reports (own-attendance stays for everyone); retail/wholesale cards → view_sales_reports / view_financial_reports respectively — mirrors the server-side dashboard filter (§7 mixed #1) |
| HandoutsRedesign.jsx:44 | page guard | any-of [manage_treatment_plans, view_customer_reports] |
| RecallsRedesign.jsx:75 | page guard | any-of [manage_treatment_plans, view_customer_reports] |
| treatment/VaccinationCardRedesign.jsx:87 | page guard | any-of [manage_treatment_plans, view_customer_reports] |
| RetailRiskRedesign.jsx:134 | page guard | any-of [view_hr_reports, view_financial_reports] |

Plus one consequential non-occurrence item: **Reports.jsx tab orchestrator** must gate each tab group by its domain perm (Sales/Shifts/Multichannel → sales; Inventory/Catalog → inventory; Finance/Purchasing → financial; Staff/Audit/Commissions → hr; Customers → customer; Governance → manage_reports) so a sales-only Cashier sees only sales tabs instead of a wall of 403s.

---

## 5. Proposed `DEFAULT_ROLE_PERMISSIONS`

| Role | Change |
|---|---|
| Administrator | unchanged (`all_access`) |
| Manager | `view_reports` → **all five splits** (+ `manage_finance`, `manage_reports` if C6 ratified — §9.2) |
| Cashier | `["view_sales_reports", "pos_discount", "pos_park"]` |
| Field Rep | unchanged (`execute_field_sales`) |

C4 rule applies: `ensureDefaultRolePermissions` re-seeds from this constant at every boot, so the constant and the migration must change together — otherwise boot re-inserts `view_reports`… except Step 4 also deletes `view_reports` from the catalog, and the constant would fail the drift test. The test is the safety net; still change both in one commit.

---

## 6. Tests & types inventory (Step 4 sweep list — 44 backend + 2 frontend occurrences)

| File | Occ. | Nature |
|---|---|---|
| tests/helpers/createTestApp-pg.js:100,101,251,256 | 4 | mirrored PERMISSION_RULES + seeded role perms — update to match §3.8/§5 |
| tests/unit/middleware.test.js | 8 | requirePerm/requireAnyPerm behavior tests — mechanical string swap |
| tests/integration/context-enforcement.test.js | 5 | fake perm arrays |
| tests/integration/pg-roles-permissions.test.js | 5 | role-editor round-trips (uses view_reports as a known perm — swap to a split) |
| tests/integration/pg-w0a-audit-security.test.js | 7 | S1/S4 fixtures seeding view_reports |
| tests/integration/pg-step2-delegation-field-split.test.js | 4 | Step 2 fixtures |
| tests/integration/pg-batch1-crud.test.js, pg-batch4-reports.test.js, pg-batch8-middleware.test.js | 2+2+2 | assertions on default perms / report access |
| tests/integration/attendance.test.js | 2 | "cashier can view attendance" — **assertion flips**: post-split Cashier gets 403 (§8 #3) |
| tests/integration/crud_employees.test.js:41, pg-kds-analytics.test.js:48, smoke-gate.test.js:68 | 3 | fixtures/comments (smoke-gate is legacy — comment-level only) |
| frontend tests/unit/auth_guards.test.jsx:109 | 1 | RequirePerm example — swap string |
| frontend tests/auth.json | 1 | gitignored login artifact — regenerates, no edit |

---

## 7. Mixed-endpoint decisions (every one explicit)

1. **GET /api/reports/dashboard** (dashboard.js — ~15-query composite payload: sales scalars, profit metrics, expenses, inventory value/low stock, attendance summary, cash position, per-outlet readiness): **permission-dependent response filtering.** Segment → required perm: today/yesterday scalars (`totalRevenueToday`, `saleCount`, `averageBill`), hourly/7-day/6-month trends, top products, category matrix, per-outlet readiness → `view_sales_reports`; profit metrics + expenses + month purchases + cash position → `view_financial_reports`; inventory value + low-stock → `view_inventory_reports`; attendance summary → `view_hr_reports` **except the caller's own attendance row, which is always included** (keeps the Cashier's own-attendance dashboard widget alive). A sales-only Cashier keeps exactly the POS-dashboard slice they see today.
2. **GET /api/reports/dashboard/wholesale**: AR outstanding/overdue + top buyers → `view_financial_reports` (Cashiers already don't see these cards).
3. **Report builder**: route-level any-split + per-dataset map enforced in `run` and at definition create/update; datasets list filtered by perm. Dataset map: sales_summary→sales, product_performance→**financial** (cost/margin/margin_percent measures), inventory_snapshot→inventory, customer_analysis→customer, employee_performance→hr.
4. **reports/analytics.js `exceptions`**: the 4 exception types span margin (negative_margin_sales, high_discount_orders) and conduct (frequent_voids_by_employee, frequent_returns_by_product) → single guard `view_financial_reports`, **documented composite** (splitting one query-param endpoint by type is not worth the surface; conduct types are also visible to financial viewers, which matches how exception review is actually staffed).
5. **reports/inventory.js**: file-level `view_inventory_reports` with two route exceptions to `view_financial_reports` (pricing-margin, pricing-exceptions) per the margin rule.
6. **GET /api/products***: composite [sales, inventory] + **S5 field filtering** — sales-only tokens get cost/margin fields stripped (dedicated POS-shaped select), POS cart/scan/search regression-tested (Step 4 item 8).
7. **Notifications** (GET /api/notifications + mark-read): shell-level bell every staffer sees; content is alert titles. Mapped `view_sales_reports` so every default role that had it keeps it. *Alternative if preferred: drop to any-authenticated (the audit already classes self-service notification reads as open-by-design).* Owner picks at ratification.
8. **Saved report views**: any-split composite (pointers, not data).
9. **Retail Risk page**: genuinely two data classes (conduct + AR/credit) → frontend any-of [hr, financial]; each API section enforces its own class server-side.
10. **POS-adjacent customer reads**: composite [sales, customer] (§3.6) — deliberate, so "Cashier = sales-only" never breaks customer attach/wallet/credit flows at the terminal.

---

## 8. Top judgment calls (the 5 the owner should look at hardest)

1. **POS composites keep the Cashier alive** (§3.6): product and customer POS reads accept `view_sales_reports`. Without this, "Cashier → sales-only" bricks the POS (F4 customer search, wallet tender, credit gate, product grid). This is the single most load-bearing choice in the table.
2. **Clinic/salon front-desk surfaces move to `view_customer_reports`** (client-service-records, recalls, handouts, vaccination card — all currently *deliberately* Cashier-reachable per in-file comments): a pristine Cashier at a salon/clinic tenant **loses** these on migration day. Options: (a) accept — owner grants `view_customer_reports` to front-desk roles per tenant afterwards; (b) have the Step 4 migration seed `view_customer_reports` onto pristine Cashiers **only on tenants with the `appointments` mode enabled**. I recommend **(b)** — it preserves the shipped front-desk design without widening retail Cashiers. Needs an explicit ruling.
3. **Cashiers lose attendance viewing** (nav entry + `/attendance` page + team-attendance dashboard widget → `view_hr_reports`); their own clock-in (kiosk PIN endpoints) and own-attendance dashboard row are unaffected. `attendance.test.js` assertion flips accordingly.
4. **Margin rule** puts menu-engineering, recipe-costing, retail-matrix, pricing-margin, profit layer, and the product_performance builder dataset under `view_financial_reports` — a restaurant manager needs the financial split to see menu engineering. Fine for default Manager (holds all five), matters for custom roles.
5. **Commission earnings → `view_hr_reports`** with no self-scope: an employee can't view their *own* earnings without the HR split. Today any view_reports holder can view **everyone's** earnings, so this is a strict tightening; a "my earnings" self-scoped read is a candidate future endpoint, not part of D4.

---

## 9. Audit-rulings batch (analysis only — applied in Step 4 as ratified)

### 9.1 C2 — Manager-page `all_access` mutations (from role-audit REPORT.md §A2; guards re-verified)

Note: C1 (GET /api/employees) already fixed in Wave 0. "Relax" = swap guard to the named perm; "keep+hide" = leave all_access, hide/disable the control for non-admins.

| # | Action (endpoint) | Proposed ruling | Rationale |
|---|---|---|---|
| 1 | Edit/delete customer, customer groups (`PUT/DELETE /api/customers/:id`, groups CRUD → `manage_customers`) | **Grant Manager `manage_customers` by default** (guard already correct; the gap is the role, not the guard). C4: add to DEFAULT_ROLE_PERMISSIONS | store managers routinely edit customers; guard string is already the right one |
| 2 | Edit attendance (`PUT /api/attendance/:id` inline all_access, attendance.js:591) | **Relax → `manage_employees`** | matches the (currently dead/contradicted) PERMISSION_RULES entry; fixes audit finding #3 in the same stroke |
| 3 | Save receipt template (`PUT /api/receipt-templates/:id`) | **Relax → `manage_inventory`** | nav already shows it to manage_inventory; template design is store config, not admin |
| 4 | Delete adjustment (`DELETE /api/adjustments/*`) | **Keep admin-only + hide control** | destroys stock audit history; reversal-style corrections exist |
| 5 | Reverse transfer (`POST /api/transfers/:id/reverse`) | **Relax → `manage_inventory`** | operational correction, itself audited; Managers own transfers end-to-end otherwise |
| 6 | Void supplier payment (`POST /api/supplier-payments/:id/void`) | **Relax → `manage_finance`** (new perm, §9.2); keep admin-only if C6 isn't ratified | money mutation — belongs to the finance perm, not blanket admin |
| 7 | Connect/disconnect integration (`POST /api/integrations/connect\|disconnect`) | **Relax → `manage_integrations`** (registered in Step 2) + hide control without it | exactly what D7 delegation built; Manager doesn't get it by default |
| 8 | Approve COD settlement (`POST /api/fulfillment/cod/settlements/:id/approve`) | **Relax → `manage_finance`** | cash reconciliation approval = finance authority |
| 9 | Risk config (`GET\|PUT /api/risk/config`) | **Keep admin-only + hide control** | fraud-control thresholds monitor managers too; reads of events go to view_hr_reports (§3.4) |
| 10 | Product outlet-visibility (`PUT /api/products/:id/outlet-visibility`) | **Relax → `manage_inventory`** | catalog scoping is inventory management |
| 11 | FBR export (`GET /api/reports/fbr-export`) | **Keep admin-only + hide button for non-admins** | statutory filing export; keep blast radius minimal |
| 12 | Print config read (`GET /api/print/config` on /kds) | **Relax → any-of [`manage_kds`, `manage_restaurant`]** | KDS page needs it; config content is printer host/port, not secrets |

### 9.2 C6 — `manage_employees` beyond HR (fresh grep: 32 route call sites; classification 100%)

HR-legit (keep): employees.js ×3 (list, revoke-token ×2), roles.js:122 (self-or-admin role read), PERMISSION_RULES attendance entries, attendance PUT (after C2 #2).

Non-HR (28 sites) — **propose two new perms**, both defaulted to Manager (no capability change for default Managers; stops future custom HR roles inheriting financial authority):

| New perm | Call sites it takes over | Count |
|---|---|---|
| **`manage_finance`** — financial mutations | tier4/accounting.js periods POST/PUT (:367,:388), credit/debit-notes mount guard (:648 → both `credit-notes` + `debit-notes` route families), cheques `chequeAuth` (:1183 → 12 cheque routes incl. deposit/clear/bounce/cancel); plus C2 #6 (void supplier payment) and #8 (COD approve) | 4 guard defs / ~17 routes |
| **`manage_reports`** — report governance writes | reports/governance.js requirePerm(manage_employees) ×9 (:455,:471,:515,:568,:587,:607,:624 schedules CRUD/run-now/runs + :753,:769 definition versions), saved-views composite member (×4), report-builder definitions writes (§3.7) | 13 guard sites |
| (read sites) | tier4/accounting.js ×11 `manage_employees` members in view guards → replaced by `view_financial_reports` (§3.3) | 11 |

COA + journal-entry routes stay `all_access`-only (unchanged; flagging them to `manage_finance` is a possible follow-up, not proposed now). Both perms get registered in the catalog + linked module_key `accounting` only if the module card lists them (check `business-modules.js` cards at Step 4 — the bidirectional test enforces agreement).

### 9.3 Unguarded trio (re-verified unguarded on current branch)

| Endpoint | Recommendation | Rationale |
|---|---|---|
| `POST /api/billing/add-outlet` (billing.js:253) | **Guard: `requirePerm("all_access")`** | billable plan change; /billing page is already perm("all_access") frontend — guard matches UI |
| `POST /api/billing/create-checkout` (:321) + `POST /api/billing/request-upgrade` (:221, same class) | **Guard: `requirePerm("all_access")`** | initiates payment/plan change; owner action by design |
| `POST /api/commissions/calculate` (commissions.js:223) | **Guard: `requireAnyPerm(["manage_employees"])`** | triggers a comp recalculation for a sale; HR authority (idempotent recalc, so severity is low — but staff shouldn't fire it) |

### 9.4 Out-of-scope observations (noted while inventorying; for the Step 4 sweep or E-list, not rulings here)

- `GET /api/expenses` + `GET /api/expenses/summary` (barcode-expenses.js:220,347) and `POST/PUT /api/expenses` (:260,:296) have **no permission guard at all** — financial data open to any authenticated staffer. Candidate: reads → `view_financial_reports`, writes → `manage_finance`, in the Step 4 sweep.
- `GET /api/sales/:id/invoice` (+ `/export`, barcode-expenses.js:678,712) unguarded — receipt-shaped, low sensitivity, but should at least ride `view_sales_reports` when the file is touched.

---

## 10. Pristine-Cashier predicate (owner ruling 2026-07-11) + local validation

**Predicate** (Step 4 migration applies per tenant schema):

> A role is a *pristine default Cashier* iff `roles.name = 'Cashier'` (exact, case-sensitive)
> AND the deduplicated set of its `role_permissions.permission` rows equals exactly
> `{view_reports, pos_discount, pos_park}`.
> Pristine → insert `view_sales_reports` only. Every other role holding `view_reports`
> (customized Cashiers, Managers, custom roles, Administrators with redundant explicit rows)
> → insert **all five splits**. Then delete the `view_reports` rows. Idempotent; one
> transaction per tenant; log (tenant, role, posture) per classification.

Deliberately name+set only — no id (wizard seeds id=3 but customs may differ), no created_at heuristics. A renamed default Cashier is treated as customized → grandfathered (safe direction: nobody loses access by being missed).

**Validation (read-only, local `sanopos_dev`, 2026-07-12** — script: scratchpad `pristine-cashier-check.js`):

| Result | Count |
|---|---|
| Tenant schemas scanned | 48 |
| Pristine Cashier roles → sales-only | **47** |
| Customized Cashier roles → grandfather | 0 |
| Non-Cashier roles holding view_reports → grandfather (Managers + Administrators) | 95 |
| Schemas with no role named Cashier (tenant_gymtest) | 1 — predicate no-ops correctly |

Note: every local Administrator role holds an explicit `view_reports` row alongside `all_access` (wizard-seeded); grandfathering hands it all five splits — redundant under the all_access bypass, harmless. Prod re-validation (same read-only script, Supabase) is a Step 4 pre-deploy gate item, mirroring the Gate 0 blast-radius count.

---

## 11. Catalog registration status (this step's only code change)

`tests/unit/permissions-catalog.test.js` verified FIRST: it enforces call-site → catalog only (unregistered strings fail; registered-but-unused entries pass), and the module-linkage check ignores entries without `module_key`. So the five splits are **registered now** in `config/permissions-catalog.js` (category "Reporting", no module_key — spine perms), `view_reports` relabeled "(legacy — being split)" and retained until Step 4 removes it. `manage_finance` / `manage_reports` are NOT registered — they are §9.2 proposals awaiting ratification. Both catalog drift suites green post-edit (26/26).

Registration side effect to be aware of: the five splits are now grantable in the role editor but consumed by no guard until Step 4 — inert if granted early. This branch doesn't deploy before Gate 1, so no prod exposure.
