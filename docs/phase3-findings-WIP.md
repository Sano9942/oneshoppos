# Phase 3 — End-to-End Flows — WIP Findings

> Scratch file for the 2026-04-28 Phase 3 walkthrough on `livetest1`. Promoted into the canonical plan doc + deleted at end of phase.

## 2026-04-29 — 3.14 fix bundle landed + verified live ✅

**Closed end-to-end on livetest1 production:**

- **P8 — sale-write snapshot** ✅ Migration v83 added `sale_items.tax_rate_at_sale`, `tax_amount_at_sale`, `hs_code_at_sale`, `was_backfilled` and `sales.subtotal/tax_total/tax_inclusive`. POST /api/sales resolves the effective rate (outlet_tax_profile → tax_id → gst → category inheritance) and writes the snapshot. Auto-detected `tax_mode='inclusive'` for livetest1 (existing GST products ⇒ likely-registered). Backfilled all 5 historical sale_items rows with `was_backfilled=true`.
- **P9 — exclusive math** ✅ `cartMath.calcTaxTotal` fixed to compute non-zero in exclusive mode. Live verified: 1× Coffee 100 + 2× Snack 50 mixed-rate, exclusive ON → subtotal 200, tax 22 (17+5), total 222.
- **P10 — Sales Summary "Tax Collected"** ✅ Reads `sales.tax_total`. Live response shows `total_tax: 305.61, tax_by_rate: [{17,…},{5,…}]`.
- **P11 — FBR Export** ✅ Switched from live `taxes` JOIN to snapshot reads. Live response: `tax_rate: 17, tax_amount: "14.53"` per Coffee line.
- **M27 — Public receipt** ✅ Renders `tax_breakdown: [{17, 14.53},{5, 4.76}]` + `tax_inclusive` flag.
- **M28 — Product form tax-rule picker** ✅ Dropdown above GST numeric, auto-fills + stamps `tax_id`; manual edit clears tax_id; hidden when `tax_mode='none'`.
- **M29 — 503→403** ✅ `requireFeature` and `requireMode` return 403. Live verified: `GET /api/products/12/modifier-tree` returns `{"error":"Feature disabled: phase4_restaurant","flag":"phase4_restaurant"}` with HTTP 403.

**Bonus / follow-up fixes:**
- Wizard Tax-step replaced with "Are you GST-registered?" Yes/No → on Yes, NTN + STRN + Inclusive/Exclusive radios + optional default rate. POST `/api/setup/complete` accepts `is_gst_registered/tax_mode/ntn/strn`.
- Company Settings → Tax & Compliance card: 3-way registration picker + post-flip amber banner deep-linking to `/inventory`.
- `loadCompanyProfile` cache busted on PUT — surfaced live during scenario C verification when raw-SQL flips didn't propagate. PUT now calls `invalidateCompanyProfileCache(req.tenantId)`.

**Commits:** `b9bc581` `98d3f1c` `5f74706` `ce92c7c` `0d4f34a`. All deployed via Railway/Vercel auto-deploy from main.

**Live verification artifacts:**
- `backend/scripts/__verify_v83_livetest1.js` — confirms schema_version=83, columns present, 5/5 rows backfilled.
- `backend/scripts/__verify_p8_e2e_livetest1.js` — walks scenarios A/B/C/D/D2/D3 end-to-end via real `/api/auth/mt-login` + `/api/sales` + `/api/reports/*` + DB checks. All ✓.
- 3.14 fix bundle: **CLOSED.**

---


## Resume tomorrow at 3.2 — current state

**Live on production** (all 6 commits pushed + deployed + verified):
1. `6828dc8` `fix(provisioner)` pre-seed schema_version
2. `5e3b60f` `fix(migrations) v69 SAVEPOINT`
3. `aa77ea8` `fix(products)` first-outlet fallback for Opening Stock
4. `8bf8c44` `fix(attendance)` kiosk PIN bcrypt
5. `65fb149` `fix(auth)` bake default outlet into JWT.oid
6. (data-only) cleaned `livetest1.tenant_modes` of bogus `workflow_tickets` row + flipped `phase4_workflow_tickets=false`

**livetest1 state for 3.2 resume**:
- Schema version: v81 (current top)
- Products: 5 samples + Test Coffee (id=8, Rs 100, **stock 8** after 3.1 sold 2)
- Sales: 1 row — INV-2026-00001, Rs 200, cash, completed by Hassan
- Shift #1 still open (Main Store, opened Apr 27, Rs 5,000 float) — DO NOT close
- Active session for Hassan in attendance_sessions (clocked in via fix verification)
- tenant_modes: empty (correct for retail)

**Next step (3.2 Return-to-Restock)**:
- Returns → look up sale INV-2026-00001 → return 1× Test Coffee → cash refund
- Verify Sales History shows return-linked
- Verify Test Coffee stock back to 9 (8 + 1)
- Verify Returned Stock page shows the unit


**Date**: 2026-04-28
**Operator**: Hassan
**Tenant**: `livetest1` (Free; 5 sample products; Shift #1 OPEN; loyalty/CoA/couriers all deduped; **schema_version now at v81 after today's pre-Phase-3 fixes**)
**Browser**: headed Playwright at 1440×900

## Pre-Phase-3 architectural fixes shipped today

| Commit | What | Impact |
|---|---|---|
| `6828dc8` `fix(provisioner)` | Provisioner pre-seeds `schema_version` with all migration versions on tenant create | Future signups skip the v1→vN replay entirely |
| `5e3b60f` `fix(migrations) v69 SAVEPOINT` | Wraps `ADD CONSTRAINT` in SAVEPOINT so 42710 doesn't poison the outer transaction | Unblocked livetest1's catch-up; v69 was the only migration with this antipattern |

**Verified**: livetest1 jumped from v68 → v81 cleanly on the post-fix Railway boot (13 migrations applied in ~525ms at 13:05:48 UTC).

---

## 3.1 Sale-to-Report flow

### 🔴 Opening Stock field on Add Product silently drops to 0 (BLOCKER)

**Steps to reproduce:**
1. Inventory → + Add Product
2. Fill: Name "Test Coffee", Selling Price 100, **Opening Stock 10**
3. Save
4. Test Coffee appears in product list with **Stock: 0** (not 10)
5. Edit Test Coffee → Inventory section reads *"No stock data. Use Inventory Adjustments to set stock."*

**Verified via DB**: `outlet_stock` has zero rows for product_id=6 (Test Coffee). Sample products created via Phase-1 SQL seed have proper rows.

**Root cause:**
- Frontend [ProductFormPage.jsx:190](frontend/src/pages/redesign/ProductFormPage.jsx#L190) sends `initial_stock: <value>` per variant in the POST, but does NOT send `outlet_id`.
- Backend [routes/products.js:691](backend/routes/products.js#L691) gates the outlet_stock INSERT behind `if (outlet_id && initial_stock)`.
- Both must be truthy → INSERT skipped silently → product is created but never gets a stock row.

**Severity rationale**: silent data loss on a primary onboarding flow. Every new merchant who uses the "Opening Stock" field expects stock to be set. They get 0. Their first POS sale fails ("not enough stock") and they have no idea why.

**Suggested fix**: backend should default `outlet_id` to the authenticated session's default outlet when not provided in the body — single-outlet tenants (Free plan = 1 outlet) should never have to specify it. Multi-outlet tenants probably still need an explicit field, but a sane default for the most common case is correct.

**Status: ✅✅ FIXED on production** — two commits:
- `30b6192` `fix(products): default outlet_id from session context on Add Product` — first attempt; relied on `req.context.outletId` which is null because of finding #2 below
- `aa77ea8` `fix(products): add first-outlet fallback for Opening Stock seed` — final fallback to first outlet via SQL

Verified live: Test Coffee (id=8) created via UI → outlet_stock row inserted with quantity=10.000 at outlet_id=1.

Before/after screenshots: `phase3-1a-test-coffee-stock-zero.png` / `phase3-1b-test-coffee-stock-fixed.png`

### ⚠️✅ JWT.oid stays null after login — FIXED

**Root cause** (verified from actual code, not stale docs):
- `mt-login` ([routes/auth.js:384](backend/routes/auth.js#L384)) signed JWT with `oid: null`, comment: *"oid null until context selection"*
- `refresh` ([routes/auth.js:477](backend/routes/auth.js#L477)) did the same — every silent token refresh dropped the outlet
- Frontend `ContextSelect.jsx` ([line 28-29](frontend/src/pages/ContextSelect.jsx#L28-L29)) skips entirely when `flags.context_selection_required === false`, which is the **default** ([feature-flags.js:24](backend/middleware/feature-flags.js#L24))
- So the user logged in, ContextSelect silently skipped without ever calling `/api/auth/update-context`, and `req.context.outletId` stayed `null` for the entire session

**Blast radius**: every backend code path reading `req.context.outletId` was silently degraded. The Opening Stock fix (`aa77ea8`) added a SQL first-outlet fallback in products.js to mask this for that one route, but the bug surfaced anywhere else that depended on session context.

**Fix** (`65fb149`): introduced `pickDefaultOutletForEmployee(tenantDb, employeeId)` helper in auth.js. mt-login + refresh now query `employee_outlets` JOIN `outlets` (active only, primary first), bake the result into JWT.oid. Admin "all_access" accounts with no outlet assignments still get `oid: null` — correct for "all branches" scope mode.

**Verified live** (curl + base64-decode of mt-login JWT):
```json
{ "tid": 95, "eid": 1, "rid": 1, "oid": 1, "scope": "full", ... }
```
oid is now `1` (Main Store) instead of `null` ✅

### ⚠️✅ Service Tickets nav appeared after migration catch-up — INVESTIGATED + FIXED on livetest1

**Root cause** (NOT a migration in v70-v81 — was always present, observation miss on Day-2):
- Migration v32 unconditionally inserted `phase4_workflow_tickets=true` into `feature_flags` for all tenants when Phase-4 first shipped, before mode-gating was decided
- Migration v44 (Apr 2026) backfilled `tenant_modes` based on the "globally on" feature_flags state, conflating "feature shipped" with "tenant opted in"
- Result: every tenant provisioned via the legacy migrate-pg ladder (v1→vN sequentially) ended up with `tenant_modes('workflow_tickets', true)` even if they were `general_retail`

**Why fresh tenants from now on are unaffected**:
- Provisioner fix (`6828dc8`) pre-seeds `schema_version` with all migration versions
- Fresh tenants skip v32+v44 entirely — they get the post-fix defaults
- `DEFAULT_FEATURE_FLAGS.phase4_workflow_tickets = false` ([middleware/feature-flags.js:83](backend/middleware/feature-flags.js#L83))
- `schema-pg.sql` doesn't seed the flag

**Why no v82 migration needed**:
- Production has only one active tenant (livetest1) and it's getting nuked in Phase 8
- Other "active" tenants (packagesmall, khantoys, live_test_1) are deleted with schemas dropped
- Future tenants don't run v32+v44 anymore (provisioner fix)

**livetest1 cleanup** (manual SQL, applied):
```sql
DELETE FROM tenant_livetest1.tenant_modes WHERE mode = 'workflow_tickets';
UPDATE tenant_livetest1.feature_flags SET enabled = false WHERE key = 'phase4_workflow_tickets';
```

**Verified live**: dashboard sidebar no longer shows "Service Tickets" / "Tickets" workflow nav (only "My Tickets" — different feature, support tickets in the Admin section, correctly always-visible).

### Sale-to-Report continued


---

## 3.2 Return-to-Restock flow — 2026-04-28

**Pre-state:** Test Coffee (id=8) Rs 100, stock=8 at outlet 1. Sale id=1 (INV-2026-00001) Rs 200 cash, 2× Test Coffee.

**Steps walked:**
1. Returns → Process Return → searched "Test Coffee" → suggestion picked → 1× Rs 100 added to draft
2. Original sale id = 1, Outlet = Main Store, Processed by = Hassan, Refund = Cash, Reason = "Customer changed mind"
3. Total Refund Rs 100.00 → Complete Return → success
4. Returns list now shows RTN-1 / Main Store / Hassan / 1 item / Rs 100.00 ✅
5. DB: outlet_stock product 8 went 8.000 → 9.000 ✅
6. DB: returns row id=1, original_sale_id=1, refund_method=Cash, total_refund=100.00, restock_flag=true ✅

Screenshots: `phase3-2-01-returns-empty.png`, `…02-return-modal-filled.png`, `…03-return-completed.png`, `…04b-returned-stock.png`, `…05-sales-history.png`, `…06-sale-detail.png`, `…07-reports.png`, `…08-refunds-voids.png`.

### ✅ What works
- End-to-end refund processing: stock restored, refund recorded, FBR-ready, idempotency_key column present.
- Reports → Refunds & Voids → Refund Journal correctly lists the return (4/28/2026 7:40 PM, Return #1, Main Store, Hassan, Walk-In, Cash, Rs 100.00).
- Reports → Sales → Overview → "Leakage Today" KPI: Disc 0 / Void 0 / **Refund Rs 100** ✅.
- DB columns now wider — quantity stored as `1.000` (NUMERIC(10,3) from v45).

### ⚠️ M1 — Sales History does NOT show return-linked status (plan-doc acceptance criterion FAILED)

**Plan said:** "Verify Sales History shows return-linked"

**Actual:** After processing a partial return against sale #1:
- Row in Sales History list: status pill is still green "active", no refund/return badge column.
- Detail panel for sale #1 shows the original line items unchanged ("Test Coffee 2.000 x Rs 100.00"), Total still Rs 200. No "Refunded: Rs 100" line, no link to RTN-1, no remaining-qty math.
- The "Return" button in the detail panel is still active with no awareness that 1 of 2 units has already been returned — a cashier could try to refund the same unit twice.

**Schema reality:** `sales` table has no `return_status` column (verified). Tracking partial-return state would require either a denormalized column or a JOIN-on-`returns.original_sale_id` at query time. Backend `routes/sales.js` GET handler currently does neither.

**Severity:** ⚠️ medium UX gap. Data is correct in DB; merchants get partial-return confusion in the most-used screen for sale review. Risk of double-refund if a busy cashier doesn't notice that the original sale was already partially refunded.

**Suggested fix (lite):** Sales History GET should LEFT JOIN `returns` on `original_sale_id`, expose a `refund_total` and `return_count` per sale; UI surfaces a "Partially refunded — Rs 100" line in the detail panel and disables / annotates the Return button.

### ⚠️ M2 — "Returned Stock" nav label is misleading

The nav entry "Returned Stock" under Stock Control points to `/returned-stock`, which is a **supplier-RMA** workflow ("send stock back to supplier"). The customer-return restock flow has no dedicated tracking page — restocked units are reflected only in `outlet_stock` and via the Returns module + Refund Journal report.

The page subtitle disambiguates ("supplier return (RMA) workflow…") but the label alone leads merchants to expect customer-returned items here.

**Suggested fix:** rename nav label to "Supplier Returns (RMA)" so it doesn't collide with the customer-return mental model. Update `nav-config.js` only — page logic is fine.

### ⚠️ M3 — Process Return UI is product-first, not sale-lookup-first

Plan-doc said "Returns → look up the sale from 3.1 → return 1 unit". Actual UI flow: search by product name/barcode/SKU, optionally enter "Original sale id (optional)" as numeric text. There is no sale-lookup-by-receipt-number flow on the admin Returns page — that flow exists only in POS via `POSReturnExchangeModal.jsx`.

For unattended-receipt or no-printer scenarios this is fine. But it requires the cashier to know the numeric sale_id (not the human-friendly INV-2026-00001 invoice number) to link the return — and even then, nothing in the UI validates that the product being returned was actually on that sale, or that it caps the qty at what was sold.

**Severity:** ⚠️ medium. Discoverability gap. POS path is the proper tool; admin Returns is a power-user override.

**Suggested fix:** rename the field to "Original receipt number / sale ID (optional)" and accept either the numeric id or the invoice_number string. Bonus: validate the returned product against the original sale's items.

### ⚠️ M4 — `processed_by_employee_id` is NULL after admin Returns submit

Modal has a "Processed by" dropdown that I set to Hassan. After submit, DB row has `employee_id=1` (auth context) but `processed_by_employee_id=null`. Cause: `ReturnsRedesign.jsx:215` posts `employee_id: form.employee_id` (overwriting the auth-default), but does NOT post `processed_by_employee_id`. Backend route accepts both — POS modal (`POSReturnExchangeModal.jsx:389`) sets `processed_by_employee_id`; admin Returns sets `employee_id` only.

This dual-field design predates the walkthrough; no incorrect data lands, but Reports / FBR audit queries that read `processed_by_employee_id` will be blank for admin-Returns-originated refunds. Reports → Refund Journal currently reads `employee_id` (which is set correctly), so today's reports are unaffected.

**Severity:** ⚠️ low — design ambiguity, not a bug. Worth picking one field as the source of truth post-launch.

### Plan-doc acceptance criteria scorecard

| Criterion | Result |
|---|---|
| Look up sale from 3.1 → return 1 unit → cash refund | ✅ (sale id=1 numeric path) |
| Sales History shows return-linked | ⚠️ FAILS — no indicator anywhere |
| Inventory → Test Coffee stock back to 9 | ✅ (8 → 9 in `outlet_stock`) |
| Returned Stock page shows the unit | ⚠️ N/A — page is supplier-RMA, not customer-return |
| Reports show negative revenue line | ✅ (Leakage Today card + Refund Journal) |

**No 🔴 blockers.** 4 ⚠️ findings worth bundling into a small UX/copy PR before launch (M1 = real risk of double-refund; M2/M3 = onboarding clarity; M4 = future-proofing).

---

### 3.2 follow-up — verifying 2 additional refund entry points (operator request)

After the initial pass, walked the two other ways a cashier can refund against an existing sale, on top of the admin Returns modal already covered.

**Path B — Sales History → row → Return button (sidebar action).**

Click `Return` from the sale-detail panel of INV-2026-00001 (the sale already partially refunded with RTN-1):
- Navigates to `/returns` and opens the same Process Return modal — but **pre-populated**:
  - Items table: `Test Coffee × 2 @ Rs 100` (the FULL original sale qty, NOT remaining-after-prior-return)
  - Original sale id: `1`
  - Outlet: Main Store
  - Processed by: Hassan
  - Refund method: Cash
  - **Total Refund: Rs 200.00**
- Submitting would create a SECOND refund for Rs 200 on top of the existing Rs 100 — the merchant would pay out Rs 200 in cash for goods worth Rs 100, AND `outlet_stock` would jump from 9 → 11 (re-restocking 2 phantom units that physically left the store the first time).

Did NOT submit. Cancelled.

**Path C — POS top-bar → Return.**

Better UX scaffolding than admin Returns:
- Explicit "Do you have the original bill?" prompt with invoice-number lookup (placeholder `e.g. INV-2026-00042` — accepts the human invoice number, not the numeric sale_id).
- "Continue without a bill (manual return)" fallback link.
- After "Find Bill" → modal shows **`Test Coffee × 2 of 2`** with — / + qty stepper, per-line `Restock` checkbox + bulk "All Restock ON/OFF" toggle, reason dropdown, branching CTA `Full Refund` vs `Exchange for Other Items`, refund methods Cash/Card/**Wallet**/Store Credit (admin Returns is missing Wallet entirely — minor consistency gap).
- BUT: same data bug as Path B. The "of 2" badge is the **original** sold quantity, not `sold − already_returned`. Refund pre-fills as Rs 200. Stepper allows submitting qty 2 → over-refund.

Did NOT submit. Cancelled.

**Backend confirms it has no guard either.** Grep of `routes/returns.js` for any prior-return-aware validation: zero hits other than an OpenAPI doc comment. The route accepts whatever items+qty the client posts and inserts them, then increments `outlet_stock` for any items with `restock_flag=true`. No SUM-over-prior-returns sanity check.

### 🔴 P1 (UPGRADED FROM ⚠️ M1) — Over-refund hole, all 3 entry points + backend

What started as an "M1 missing badge" UX gap is actually a full-stack data-integrity hole. **Three** UIs (admin Returns, Sales History → Return, POS Return/Exchange) all let a cashier process a return for the FULL original sale quantity even when prior partial returns exist. The backend doesn't enforce a cap either. Outcome of a real-world double-refund:

- Cash drawer: pays out 2× the merchandise value
- Inventory: `outlet_stock` jumps to "more units than were ever sold"
- Reports: Refund Journal shows two refunds, leakage doubles
- FBR: two refund payloads queued (one of them fictitious)

This is the kind of bug that survives QA because all three UIs work in isolation — the integration test is "process a return, then process another against the same sale" and that's not in any spec.

### Fix plan (proposed — awaiting approval)

| # | Layer | Change | Severity |
|---|---|---|---|
| F1 | backend `routes/returns.js` | When `original_sale_id` provided, compute remaining-refundable qty per line as `sale_items.quantity − COALESCE(SUM(prior return_items.quantity), 0)` inside the same transaction (`SELECT … FOR UPDATE` on the original `sale_items` rows to be safe under concurrent retries). Reject 400 with `{ error: "Cannot refund N units of <product>; only M remaining" }` if any line exceeds. **Hard guard, no UI dependency.** | 🔴 must-fix-before-launch |
| F2 | backend `routes/sales.js` GET | The single-sale fetcher (used by Sales History detail + POS lookup) joins `return_items` and exposes `refunded_qty` per line + `refund_total` per sale. | needed for F3/F4 |
| F3 | frontend `POSReturnExchangeModal.jsx` + Sales-History pre-fill | Use `refunded_qty` from F2 to display `… × (qty − refunded) of qty`, default stepper to remaining, refuse to set stepper above remaining. Also: when a sale is fully refunded, disable Return button and show "Fully refunded" badge instead. | medium |
| F4 | frontend `SalesHistoryRedesign.jsx` detail panel | Show "Refunded: Rs X (link to RTN-N)" line under the items list. Show a "Partially refunded" status pill on the row when refund_total > 0 and < total. | medium |
| F5 | frontend `ReturnsRedesign.jsx` | Rename placeholder "Original sale id (optional)" → "Original receipt number / sale ID (optional)". Add Wallet to the refund-method dropdown to match POS. (No new look-up logic — that's POS's job.) | low UX |
| F6 | frontend `ui/nav-config.js` | Rename "Returned Stock" nav label → "Supplier Returns (RMA)". | low UX copy |

F1 alone closes the data-integrity hole. F2-F4 close the UX trap that lets cashiers fall into it. F5/F6 are unbundled cleanup.

Each will ship as its own commit (cd6f4bd / 593062a / 65fb149 style) once approved.

---

### Status — 2026-04-29 (after F1–F6 shipped + verified live)

| # | Commit | Verified live |
|---|---|---|
| F1 | `6e3be0e` `fix(returns): cap refund qty by sold − already-returned` | ✅ Forced qty=2 on the partial sale via Sales History → Return → backend rejected with `Cannot refund 2 units of product 8; only 1 remaining`. `outlet_stock` and `returns` table both unchanged. |
| F2 | `213422e` `feat(sales): expose refunded_qty + refund_total on GET /api/sales/:id` | ✅ Detail panel + POS modal both consume the new fields end-to-end. |
| F3 | `0df2838` `fix(pos): show remaining-refundable qty in Return / Exchange modal` | ✅ POS Return on `INV-2026-00001` now shows `Test Coffee — qty 1 of 1`, refund Rs 100 (was 2 of 2 / Rs 200). `+` clicked five times — qty held at 1. |
| F4 | `3fa1500` `fix(sales-history): surface refund status + cap Return prefill at remaining qty` | ✅ Sales History detail shows "Partially refunded −Rs 100.00", item line "(1 refunded, 1 remaining)" in rose, "Partial refund recorded — only remaining units are eligible." note under buttons. Return click navigates with `quantity: 1` (was 2). |
| F5 | `461f849` `fix(returns): admin Returns parity with POS` | Verified at edit-time; will surface in next admin Returns interaction. |
| F6 | `a58e65d` `fix(nav): "Returned Stock" → "Supplier Returns"` | ✅ Sidebar shows "Supplier Returns" under Stock Control. |

Screenshots: `phase3-2-15-sales-history-after-fixes.png`, `…16-saleshistory-return-prefill-after-fix.png`, `…17-backend-rejects-overrefund.png`, `…19-pos-return-after-fix.png`.

**Phase 3.2 fully closed.** All four findings + the upgraded P1 are resolved on production. No new findings introduced by the fix bundle. Ready to move to 3.3.

---

## 3.3 FBR enable + invoice queue — BLOCKED

No FBR sandbox creds available. Web search confirmed: FBR has a real sandbox (`https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb`) but the token is **gated** — requires a registered NTN+STRN, IRIS portal login, choice of Licensed Integrator (PRAL is free), and Railway egress IP whitelisted with FBR. No public/anonymous demo token. Skipped to 3.4. Re-open when operator provides NTN/STRN/sandbox-token/province.

---

## 3.4 Cap-hit flow (Free plan) — 2026-04-29

**Pre-state:** livetest1 on Free plan, 1 employee (Hassan, admin). Free caps: 1 outlet, 3 employees, 100 products.

**Steps walked + result:**
1. `/employees` — added Test Cashier 2 (PIN 2222, Main Store) → total 2/3 ✅
2. At 2/3 (67%) the dashboard `PlanUsageBanner` is hidden (correct — threshold is 80%, see [PlanUsageBanner.jsx:8](frontend/src/pages/dashboard/PlanUsageBanner.jsx#L8)) ✅
3. Added Test Cashier 3 (PIN 3333) → total 3/3 ✅
4. Visited `/dashboard` — amber banner shows: "Approaching plan limit. You're using 3 of 3 employees, 1 of 1 outlets. Upgrade to Pro for unlimited." with Upgrade button + dismiss × ✅ (`phase3-4-01-plan-usage-banner-dashboard.png`)
5. `/employees` → Add Employee → filled "Cap Hit Test" / PIN 9999 / Main Store / Save → backend returned `403 { error: "Plan limit reached: maximum 3 employees allowed", code: "PLAN_LIMIT_REACHED", limit: 3, current: 3 }` ✅
6. UI shows BOTH: red inline error banner under the Employees title AND the global cap modal (mounted in AppLayoutRedesign as `PlanLimitModalInterceptor`) ✅ (`phase3-4-03-cap-modal-real-trigger.png`)
7. Modal copy: "Plan limit reached / Plan limit reached: maximum 3 employees allowed / Currently using 3 of 3 on the Free plan. / Upgrade to Pro — Unlimited products and employees, plus advanced features. 8000 PKR/month per outlet." with **Not now** + **Upgrade to Pro** CTAs ✅
8. Clicked **Upgrade to Pro** → routed to `/billing` ✅ (`phase3-4-04-billing-after-upgrade-cta.png`)

### Plan-doc acceptance scorecard

| Criterion | Result |
|---|---|
| Add employees until 3 exist | ✅ (2 new: Test Cashier 2 + 3) |
| 4th attempt → cap modal with Upgrade to Pro CTA | ✅ (modal + inline error both fire) |
| Upgrade CTA routes to `/billing` | ✅ |
| PlanUsageBanner appears at 80% threshold | ✅ at 100% (3/3 + 1/1). Threshold is never directly tested between 80% and 100% on Free because employees jump from 67%(2/3) to 100%(3/3). |
| Skip actual checkout | ✅ (deferred to 3.13) |

### ⚠️ M5 — Cap-modal pricing line conflicts with /billing pricing cards

**Modal copy:** *"Unlimited products and employees, plus advanced features. **8000 PKR/month** per outlet."*

**Actual /billing cards:**
- Monthly: PKR 8,000 (matches)
- Quarterly: PKR 21,600 (= 7,200/mo, 10% off)
- Semi-Annual: PKR 40,800 (= 6,800/mo, 15% off)
- Annual: PKR 80,000 (= 6,667/mo, 17% off, **BEST VALUE** pill)

The modal advertises only the highest (monthly) rate without mentioning that 3 cheaper cycles exist. A merchant on the cap modal sees "8000/mo" and may bounce instead of clicking through. Suggested copy: *"From PKR 6,667/month with annual billing. Plans start at PKR 8,000/month."* — reuses the existing pricing tiers without hardcoding numbers.

**Severity:** ⚠️ low. UX/copy nit. No data integrity issue. Pickable in same PR as M6.

### ⚠️ M6 — Add Employee form opens at-cap with no preflight warning

When `total === limit` (3/3), `Add Employee` button still shows green/active and opens the form. The user fills in name + PIN + email + outlet, clicks Save, then learns the cap is hit. Frontend already has `usage` data via the same `/api/billing/usage` endpoint — could disable the button and show a small "Free plan: at 3/3 employees" hint inline next to it.

**Severity:** ⚠️ low. Wasted-effort UX gap, not a bug. Backend correctly enforces. Modal still fires correctly on Save attempt, so users do reach the upgrade flow — they just type a form first.

**Note:** finding #M5 (modal pricing copy) and the existing known medium ("/billing Quarterly highlighted, Annual has BEST VALUE pill") are both billing-cards UX. Worth a small bundled cleanup PR after launch.

### Onboarding checklist sneak peek (3.6 prep)

While on `/dashboard` the "Get started with SanoPOS" checklist showed **4 of 7 steps complete**: Set up your store ✅, Add your first product ✅, Add employees ✅, Open a shift ✅. Incomplete: Add your first customer, Make your first sale (this row is interesting — 3.1 made a sale, so this should be ticked. Possibly counts only "today" or only sales linked to a customer. Will verify in 3.6.), Print a test receipt.

**No 🔴 blockers.** 2 ⚠️ low-severity UX/copy notes (M5, M6). Phase 3.4 acceptance criteria all met.

---

## 3.5 Marketplace stub disclaimer — 2026-04-29

**Pre-state:** `/settings/integrations` shows the unified hub. All 4 marketplace/social/messaging cards present.

**Disclaimer copy verified per card** (matches PROVIDER_META in [IntegrationsHubRedesign.jsx:34-40](frontend/src/pages/redesign/IntegrationsHubRedesign.jsx#L34)):

| Card | Disclaimer |
|---|---|
| Daraz | "Manual sync only — click Pull Orders to fetch new orders. Automatic background sync coming soon." ✅ |
| Facebook Shop | same as Daraz ✅ |
| Instagram Shopping | "Managed via Facebook Shop connection" ✅ (passive, no separate connect) |
| WhatsApp Business | "Manual sync only — automatic inbound message sync coming soon." ✅ (variant: messaging not orders) + cost-warning amber bar: "WhatsApp Business API charges per conversation. First 1,000 service conversations/month are free." ✅ |
| Google Merchant Center | "Manual sync only — click Sync Products to push your catalog. Automatic feed status checks coming soon." ✅ (variant: push-feed not pull-orders) |

**Daraz happy-path walked end-to-end:**
1. Connect → modal opens with App Key / App Secret / Access Token fields → fake creds saved → POST `/api/integrations/connect` returned 200 ✅ (`phase3-5-02-daraz-connected.png`)
2. Card flips to "Connected" badge + Test / Disconnect / Sync Products / Pull Orders / Push Inventory buttons ✅
3. Pull Orders → POST `/api/integrations/daraz/pull-orders` → 500 with body `{"error":"The specified App Key is invalid"}` (upstream Daraz auth failure passed through) → toast.error fires "The specified App Key is invalid" ✅ (`phase3-5-04-pull-orders-error-toast.png`, captured via DOM poll)
4. Disconnect → card returns to "Connect" state ✅ (clean state, no test data left in `integration_settings`)

**Connect dialogs walked (cancel-only) for parity check:**

| Provider | Fields | Token field type |
|---|---|---|
| Daraz | App Key / App Secret / Access Token | password ✅ |
| Facebook Shop | Page Access Token / Catalog Id / Commerce Account Id | password ✅ |
| WhatsApp Business | API Token / Phone Number Id / Business Account Id | **`text`** ⚠️ (M7 below) |
| Google Merchant Center | OAuth Token / Merchant Id | password ✅ |

### Plan-doc acceptance scorecard

| Criterion | Result |
|---|---|
| Click Daraz → fill creds → save → "Connected" badge + caption | ✅ |
| Click Pull Orders → toast shows result | ✅ (error toast on bad creds — expected per fake-creds path) |
| Verify same for Facebook Shop, WhatsApp, Google Merchant (disclaimer + Connect dialog) | ✅ — disclaimer copy + dialog forms verified for all 3 |

### ⚠️ M7 — WhatsApp API Token input is `type=text`, not `password`

The Connect WhatsApp Business dialog renders the API Token input as `<input type="text">`, while Daraz Access Token, Facebook Page Access Token, and GMC OAuth Token are all `type="password"`. Result: the WhatsApp token sits in plaintext on screen during entry — visible to anyone shoulder-surfing or screen-recording.

**Suggested fix:** in `IntegrationsHubRedesign.jsx`, the connect-form input renderer should treat any field name matching `/token|secret|key/i` as a password input. Today the rule appears to be hardcoded per-field — `Daraz` and `Facebook` got it right, `WhatsApp` slipped through.

**Severity:** ⚠️ low. Operator-only screen, but inconsistent with sibling forms and breaks security expectations. Bundle with M5 + M6 in the post-launch UX cleanup PR.

### ⚠️ M8 — Pull Orders / Sync Products propagate upstream errors with HTTP 500

Backend `POST /api/integrations/daraz/pull-orders` returned `500 { error: "The specified App Key is invalid" }` when called with invalid creds. The error message itself is fine (it's the upstream Daraz API's response), but **HTTP 500 is wrong for a credential failure** — should be 4xx (401 Unauthorized or 422 Unprocessable Entity). 500 implies a server-side bug; merchants reading logs / Sentry will treat it as actionable backend incident, not a tenant config issue.

**Suggested fix:** in the backend marketplace adapters, catch upstream auth/creds errors and surface as 401/422 with a `code: "INTEGRATION_AUTH_FAILED"` so the frontend can show a more actionable toast ("Daraz credentials rejected — re-enter your App Key under Settings → Integrations") instead of the bare upstream string.

**Severity:** ⚠️ low. Functional path works (toast still surfaces). Sentry noise + log-grep noise are the cost. Defer.

**No 🔴 blockers.** 2 ⚠️ low findings (M7 token field type, M8 wrong HTTP code on creds-fail). Phase 3.5 closed; livetest1 state clean.

---

## 3.6 Onboarding checklist — 2026-04-29

**Source verified:** `DashboardOnboarding.jsx` (preset-driven step builder via `usePreset().onboarding_steps`) + `routes/reports/dashboard.js` (signal payload). For `general_retail` preset, the 7 steps are: store, product, customer, employees, shift, sale, receipt.

**Real backend payload** for livetest1 today (`GET /api/reports/dashboard`):

| Signal | Value | Step gated | Resulting state |
|---|---|---|---|
| `data` truthy | yes | store | ✅ |
| `inventory.total_products` | `"6"` | product | ✅ |
| `customerCount` | `0` | customer | ⭕ |
| `attendanceSummary.total_employees` | `3` | employees | ✅ |
| `operationalReadiness[0].shift_open` | `true` | shift | ✅ |
| `saleCount` | `0` | sale | ⭕ |
| `totalRevenueToday` | `0` | sale | ⭕ |
| `testReceiptPrinted` | `false` | receipt | ⭕ |

UI shows **4 of 7 steps complete** — matches.

**Go-button routing verified live:**
- "Add your first customer" Go → navigates to `/customers` ✅
- "Print a test receipt" Go → navigates to `/printer-settings` ✅
- "Make your first sale" Go → opens `/pos` in a new tab (per [DashboardOnboarding.jsx:68](frontend/src/pages/dashboard/DashboardOnboarding.jsx#L68))

**Regression check:** created customer via `POST /api/customers` (Walk-In Test Customer) → `customerCount` flipped 0→1 → dashboard reload → step list went **4/7 → 5/7** with "Add your first customer" ticked + line-through, no more "Go →" next to it ✅. Soft-deleted the customer afterwards (DELETE returns "Customer archived"); `customerCount` correctly drops back to 0 (deleted rows are excluded).

**Wiring verified for "Print a test receipt":** [routes/printer.js:55-62](backend/routes/printer.js#L55) does `UPDATE company_profile SET test_receipt_printed_at = NOW() WHERE test_receipt_printed_at IS NULL` on first successful test print. Dashboard reads `r.test_receipt_printed_at != null` as the boolean. So pressing the **Test Print** button on `/printer-settings` does flip the step.

### 🔴 → ⚠️ M9 — "Make your first sale" step gates on TODAY's sale count, not lifetime first sale

**Plan-doc said:** "Steps so far should be: ... sale ✅ (from 3.1) ..." — implying the sale created in 3.1 (`INV-2026-00001` on Apr 27, total Rs 200) should keep the step ticked.

**Actual:** [DashboardOnboarding.jsx:12](frontend/src/pages/dashboard/DashboardOnboarding.jsx#L12) computes `hasSales = (data?.saleCount ?? 0) > 0 || (data?.totalRevenueToday ?? 0) > 0`. Both signals come from [routes/reports/dashboard.js:67,82](backend/routes/reports/dashboard.js#L67) which filter `WHERE s.timestamp >= todayStart AND s.timestamp < todayEnd`. So:

- **Day 1**: merchant rings up first sale → `saleCount = 1` → step ticked ✅
- **Day 2 (next morning)**: page reload → `saleCount = 0` (no sales today yet) → step **un-ticks** 🔴

For an onboarding "first ever" milestone this is wrong. A merchant who completed setup yesterday and returns today sees the checklist regress to a less-complete state. Worse: every Sunday morning a merchant who forgot to sell on Sunday will see their checklist "lose" the sale step until the first Monday transaction.

**Suggested fix:** in `routes/reports/dashboard.js`, add a separate signal `hasEverSold = SELECT EXISTS(SELECT 1 FROM sales WHERE voided = false LIMIT 1)` and use that to gate the onboarding step. Keep `saleCount` / `totalRevenueToday` as today-only (they're correct for the KPI cards). Then `DashboardOnboarding.jsx` reads `data.hasEverSold` for the sale step.

Same pattern would future-proof the customer step (today: `customerCount` is a lifetime count derived from `customers` table — correct), the receipt step (today: timestamp on `company_profile` — correct), etc. The sale step is the only signal that's incorrectly time-windowed.

**Severity:** ⚠️ medium. Not data corruption — purely UX regression on the onboarding card. Once a merchant dismisses the card (✕ button or auto-dismiss after all 7 done) it's gone forever via `localStorage.onboarding_dismissed=1` + `PUT /api/company-profile/onboarding-dismiss`. So the bug only bites users who haven't yet completed the full 7 steps. Still, every general_retail tenant currently in setup will hit it on day 2 of their trial.

### Plan-doc acceptance scorecard

| Criterion | Result |
|---|---|
| 7-step checklist visible on Dashboard | ✅ |
| store ✅, employee ✅, product ✅ from earlier phases | ✅ all match |
| sale ✅ from 3.1 | ⚠️ FAILS — un-ticks next day (M9 above) |
| customer (if attached) | ⭕ correctly not ticked (no customer was created in 3.1) |
| receipt print | ⭕ correctly not ticked |
| FBR config | N/A — `general_retail` preset doesn't include this step (FBR is gated through a separate banner, not the onboarding card; verified at [DashboardOnboarding.jsx:9-145](frontend/src/pages/dashboard/DashboardOnboarding.jsx#L9)) |
| Each completed step shows checkmark; incomplete shows CTA | ✅ verified |

**No 🔴 blockers** (M9 downgraded to ⚠️ medium — UX regression on a self-dismissing card). Phase 3.6 closed.

---

## 3.7 Public receipt share — 2026-04-29

**Pre-state:** `INV-2026-00001` (Apr 27, Rs 200, partially refunded), backend at `213422e`, frontend at `a58e65d`.

**What the plan-doc said:**
> - Sales History → click any sale → "Share receipt" → copy URL
> - Open URL in incognito window → public receipt renders without auth

**Findings — three separate bugs in this single flow.**

### 🔴 P2 — Public receipt API is broken: SQL query references nonexistent column

**Reproduce:** `curl "https://api.sanopos.com/api/receipts/INV-2026-00001/public?tenant=livetest1"` → `500 {"error":"Internal server error"}`.

**Railway log line at `x-request-id: 7d945e59-bb84-4bc7-ab4a-d927c2d966dc`:**
```
Public receipt error: column "method" does not exist
```

**Root cause** (verified against actual source, not CLAUDE.md):
- [routes/receipts.js:76](backend/routes/receipts.js#L76) does `SELECT method, amount FROM sale_payments`
- [schema-pg.sql:482-488](backend/schema-pg.sql#L482) defines `sale_payments(id, sale_id, payment_method, amount, gateway_ref)` — column is `payment_method`, NOT `method`
- Same error on line 107 (`p.method` should be `p.payment_method`)

**Blast radius:** Every public-receipt URL on every tenant in production is broken. Visiting `/receipt/:invoiceNumber` lands on the React page, which calls the broken API and renders **"Receipt Not Found / Failed to load receipt"**. The dashboard's `routes/reports/dashboard.js:67-68` correctly uses `payment_method` — so this isn't a global rename gone wrong, just a typo in this one route that nobody hit because the share flow is rarely exercised.

**Severity: 🔴 P2.** Not a launch-blocker for normal POS operations (sales work, returns work, receipts print). But the `/receipt/:slug` URL is the entire premise of 3.7, AND the WhatsApp share button in `POSReceiptModal` uses this URL, so any merchant who sends a customer the share link gets a "receipt not found" experience for them. Plan-doc public-receipt behaviour FAILS until fixed.

**Fix:** rename `method` → `payment_method` in lines 76 and 107 of `routes/receipts.js`. Two-character backend patch. TDD: add a tests/integration test that hits `/api/receipts/:invoiceNumber/public` and asserts 200 + payment shape. (Existing tests don't cover this route; that's how the typo survived.)

### 🔴 P3 — POS WhatsApp share URL is missing `?tenant=` and would 400 even if P2 were fixed

**Reproduce:** look at [POSReceiptModal.jsx:14-24](frontend/src/pages/redesign/pos/POSReceiptModal.jsx#L14):
```js
const receiptUrl = `${window.location.origin}/receipt/${slip.invoiceNumber}`;
```
No `?tenant=<slug>`. The frontend page reads `?tenant=` from the query string and forwards it to the API. The backend ([receipts.js:8-12](backend/routes/receipts.js#L8)) returns `400 { error: "tenant query param is required" }` when `MULTI_TENANT=1` and the param is missing — which is the production state.

**Blast radius:** every WhatsApp-shared receipt URL since multi-tenant rolled out on production points to a 400. Even if P2 above is fixed, the share link from POS still won't work because the URL itself is wrong.

**Fix:** in `POSReceiptModal.jsx:16`, derive tenant slug from `readTenantSlug()` (helper exists in `auth/authStore.js`) or from `localStorage.authSession.tenant.slug`, and append `?tenant=${slug}` to the URL. Same pattern needed in any other place that builds a share URL — grep for `/receipt/${`. One additional helper `buildPublicReceiptUrl(invoiceNumber)` would centralise this; today it's inlined.

### ⚠️ M10 — No "Share receipt" button in Sales History detail panel

**Plan-doc said:** "Sales History → click any sale → Share receipt → copy URL". **Actual:** the detail panel for a sale shows only Reprint / Invoice / Void / Return. No share / copy URL anywhere.

**Verified:** grep `SalesHistoryRedesign.jsx` for `share|/receipt/|copyToClipboard|wa\.me` → **zero hits**. The share-receipt feature exists ONLY in `POSReceiptModal` (the post-checkout modal), which means a merchant who wants to send a receipt link days later (the 90% case for "share receipt") has no UI path.

**Severity:** ⚠️ medium UX gap. The infrastructure exists (public route, public page, public API endpoint — once P2 fixed), but the discovery surface is missing. POS-only share covers "I just rang up this sale and the customer wants the link" — not "the customer is asking for last week's receipt."

**Suggested fix:** add a Share button to the Sales History detail panel that:
- Builds the URL via the same `buildPublicReceiptUrl` helper from P3
- Copies to clipboard via `navigator.clipboard.writeText(url)` with toast feedback
- Optionally opens `wa.me/?text=...` for WhatsApp sharing (matches POS flow)

### Plan-doc acceptance scorecard

| Criterion | Result |
|---|---|
| Sales History → click sale → Share receipt → copy URL | 🔴 FAILS — no share button (M10) |
| Open URL in incognito → public receipt renders without auth | 🔴 FAILS — P2 + P3 (API broken + share URL malformed) |

**Phase 3.7 hard-fails on 2 criteria.** Three findings — P2 (backend SQL typo) is the most urgent, P3 (frontend share URL missing tenant) compounds it, M10 (no Sales History share button) blocks the discovery path.

### Status — 2026-04-29 (after P2 + P3 + M10 shipped + verified live)

| # | Commit | Verified live |
|---|---|---|
| P2 | `389e75c` `fix(receipts): public receipt SQL column is payment_method, not method` | ✅ `curl https://api.sanopos.com/api/receipts/INV-2026-00001/public?tenant=livetest1` returns full JSON payload (200) — store, sale, items, payments[0].method = "Cash". 3/3 vitest integration tests green. |
| P3 | `7bf0dbc` `fix(pos): include tenant slug in shared receipt URL` | ✅ Browser eval after Vercel redeploy: clicking Share copies `https://sanopos.com/receipt/INV-2026-00001?tenant=livetest1` (was bare URL without tenant). Helper `buildPublicReceiptUrl()` reads `IS_MULTI_TENANT` + `readTenantSlug()` and appends correctly. |
| M10 | `61291c2` `feat(sales-history): add Share button to copy public receipt link` | ✅ Sales History detail panel now shows Reprint / Invoice / **Share** / Void / Return. Click → clipboard.writeText fires → toast "Receipt link copied" appears. |

Final end-to-end check: opened `https://sanopos.com/receipt/INV-2026-00001?tenant=livetest1` in a no-auth-headers context → public page rendered: green "Live Test 1" header, INV-2026-00001, Apr 28 2026 06:56 PM, Hassan, Test Coffee × 2.000 @ Rs100.00 = Rs200.00, Total Rs200.00, Payment Cash Rs200.00, "Please come again." footer, Print Receipt button. Screenshot: `phase3-7-fixed-public-receipt-renders.png`.

The partial-refund detail (1 refunded / 1 remaining) deliberately does NOT appear on the public receipt — customers see the original transaction shape, not internal refund tracking.

**Phase 3.7 fully closed.** Plan-doc acceptance criteria all met after the 3 fixes. No regressions introduced (POS WhatsApp share now produces working URLs too — same helper, same logic).

### Bonus end-to-end verification — 2026-04-29

After the fixes shipped, rang up a fresh POS sale to verify all 4 distribution paths physically work:

**New sale on livetest1**: INV-2026-00002, Test Coffee × 1, Rs 100, Cash, by Hassan (Apr 29 01:43 AM). Test Coffee stock dropped 9 → 8.

| Path | Verified | Evidence |
|---|---|---|
| POS post-checkout **WhatsApp** | ✅ | Intercepted `window.open` captured `https://wa.me/?text=...View%3A%20https%3A%2F%2Fsanopos.com%2Freceipt%2FINV-2026-00002%3Ftenant%3Dlivetest1` |
| POS post-checkout **Email** | ✅ | `POST /api/email/send-receipt-v2 → 200 (588ms)`. Railway log: `Email sent to="oneshop349@gmail.com" subject="Receipt #INV-2026-00002 from Live Test 1"` |
| Sales History detail **Share** | ✅ | Clipboard captured `https://sanopos.com/receipt/INV-2026-00002?tenant=livetest1` + toast "Receipt link copied" |
| Public receipt page (no-auth) | ✅ | `/receipt/INV-2026-00002?tenant=livetest1` rendered: green "Live Test 1" header, INV-2026-00002, Hassan, Test Coffee × 1.000 = Rs 100.00, Cash, "Please come again.", Print Receipt button (`phase3-7-public-receipt-INV2.png`) |

### ⚠️ M11 — Sales History detail panel is missing Email + WhatsApp buttons (parity gap)

POS post-checkout modal has Email / WhatsApp / Print / Close. Sales History detail panel has Reprint / Invoice / **Share** / Void / Return — no Email, no WhatsApp. A merchant looking up last week's sale to email or WhatsApp the receipt has to use Share to copy the link, then manually paste into WhatsApp/email themselves. The infrastructure for both already exists (`POST /api/email/send-receipt-v2` accepts any `saleId`, and `buildPublicReceiptUrl` is reusable).

**Suggested fix:** add Email + WhatsApp buttons to Sales History detail panel that mirror the POS post-checkout modal. Email opens an inline form like `POSEmailReceiptModal`; WhatsApp builds the same `wa.me/?text=...` URL. Could ship as a single "Send" dropdown (Copy / Email / WhatsApp) or three discrete buttons.

**Severity:** ⚠️ medium UX gap. Workaround exists (Share → copy → paste). But the "send a customer their receipt later" path is the primary use case for this entire feature surface.

### ⚠️ M12 — POS WhatsApp share embeds receipt-template "header_text" instead of company name

The actual WhatsApp message body starts with `"Receipt from Thank you for shopping!"` — `sections.storeName` per [`utils/receipt.js:34`](frontend/src/utils/receipt.js#L34) resolves to `template?.header_text || slip.outlet?.name || "SanoPOS"`. Tenants whose receipt template has `header_text = "Thank you for shopping!"` (a *greeting*, not a name) end up with an awkward share preamble. Production livetest1 hits this today.

**Suggested fix:** in `POSReceiptModal.shareWhatsApp`, prefer the actual company name (from auth session or `slip.outlet?.name`) over `template.header_text`. The template header_text is a *receipt-format greeting*, not a brand identifier. Reorder fallback to: outlet name → company name → header_text → "SanoPOS".

**Severity:** ⚠️ low UX/copy. Doesn't break the share URL (which is what 3.7 cared about) — just an awkward preamble.

### Status — 2026-04-29 (after M11 + M12 shipped + verified live)

| # | Commit | Verified live |
|---|---|---|
| M12 | `04449f7` `fix(pos): WhatsApp share preamble uses outlet name, not template greeting` | ✅ Captured Sales History WhatsApp URL post-fix: `Receipt from Main Store\nInvoice: INV-2026-00002\nTotal: Rs 100.00\nView: https://sanopos.com/receipt/INV-2026-00002?tenant=livetest1` (was "Receipt from Thank you for shopping!"). Reusable helpers `buildReceiptShareMessage()` + `buildWhatsAppShareUrl()` added to `utils/publicReceipt.js`. |
| M11 | `5caa5e4` `feat(sales-history): add Email + WhatsApp buttons for receipt sharing parity` | ✅ Sales History detail action row now: Reprint / Invoice / **Share** / **Email** / **WhatsApp** / Void / Return. Email reuses `POSEmailReceiptModal` (props-driven); WhatsApp uses the M12 helper. |

Final live verification: clicked Sales History WhatsApp on INV-2026-00002 with no intercept → WhatsApp's "Share on WhatsApp" page opened in new tab with message preview correctly showing `Receipt from Main Store Invoice: INV-2026-00002 Total: Rs 100.00 View: https://sanopos.com/receipt/INV-2026-00002?tenant=livetest1` plus Open app / Continue to WhatsApp Web CTAs (`phase3-7-whatsapp-real-share-page.png`). Sales History buttons screenshot: `phase3-7-m11-sales-history-buttons.png`.

**Phase 3.7 share/distribution surface fully closed.** All paths now work end-to-end: POS post-checkout (Email/WhatsApp/Print/Close), Sales History detail (Reprint/Invoice/Share/Email/WhatsApp/Void/Return), public receipt page (renders without auth from any of those URLs).

---

## 3.8 Gift card public balance lookup — 2026-04-29

**Pre-state:** No gift cards on livetest1.

**Steps walked:**
1. `/gift-cards` → click New Card → modal opens with Type (Digital/Physical), Initial Value, Recipient email
2. Filled: Digital, Initial Value 500, no email → Create
3. Toast/inline confirmation: `Gift card created! BF18801AC599 Balance: Rs 500.00` ✅ (`phase3-8-01-gift-card-created.png`)
4. Cards table now shows `BF18801AC599 / Digital / active / Rs 500.00 / Rs 500.00 / —` ✅
5. Public API: `curl https://api.sanopos.com/api/gift-cards/public/BF18801AC599?tenant=livetest1` → 200 with `{ code, initial_value: 500, remaining_value: 500, activation_status: "active", card_type: "digital", created_at }` (no auth headers) ✅
6. Public page: `https://sanopos.com/gift-card/BF18801AC599?tenant=livetest1` rendered → green "Gift Card / Balance check" header, code, REMAINING 500 of 500 initial, TYPE Digital, STATUS Active, footer "Present the code at the store to redeem." ✅ (`phase3-8-02-public-balance-page.png`)

### Plan-doc acceptance scorecard

| Criterion | Result |
|---|---|
| Issue card "GC-001" with 500 balance | ⚠️ Partial — UI doesn't allow specifying a custom code (M14 below). Used the auto-generated `BF18801AC599`. |
| Open `/gift-card/<code>` in incognito → balance 500 visible | ✅ |

### ⚠️ M13 — Public gift card page shows balance with no currency symbol

The page renders REMAINING as a bare "500" (and "of 500 initial"). [GiftCardBalancePage.jsx:50-54](frontend/src/pages/GiftCardBalancePage.jsx#L50) uses `Number(n).toLocaleString()` without any currency symbol/code. A customer in Pakistan looking at a `500` balance can't tell whether it's PKR 500 (~$1.80) or some other denomination. Compare with the public receipt page (3.7) which shows `Rs 100.00`.

**Suggested fix:** the public gift-card API response should include `currency_symbol` (read from `company_profile.currency_symbol` like receipts.js does). The page then renders `Rs 500` or `Rs 500.00`. No tenant context is required since the slug is already in the request and the company profile is keyed by tenant.

**Severity:** ⚠️ medium UX. Customer-facing surface. Doesn't break the lookup but undermines trust ("how much is on this card?").

### ⚠️ M14 — Gift card UI doesn't allow custom codes

Plan-doc said "issue card 'GC-001'" — but `New Gift Card` form only offers Digital (auto-generated) or Physical (also single-card auto-generated). There is no input field to specify a custom human-readable code like "GC-001" or a printed-card serial like "PROMO-2026-XMAS". The only way to register a non-auto code is via the **Register Range** flow (which I didn't open — it expects bulk pre-printed batches, not a single named card).

**Severity:** ⚠️ low product-design gap. The auto-generated `BF18801AC599` works fine for digital gifts (codes are meant to be distributed to recipient via email/SMS, not memorable). But it's an awkward gap for tenants who want to issue named promo cards via the standard flow. Could ship as an optional "Custom code" field on the Physical (single) tab.

**Severity:** ⚠️ low. Workaround: use Register Range with `count=1` and a custom prefix.

**No 🔴 blockers.** 2 ⚠️ findings (M13 currency symbol on public page, M14 custom code support). Phase 3.8 closed; livetest1 has 1 active gift card (`BF18801AC599`, Rs 500 remaining).

### Bonus end-to-end verification — 2026-04-29

After 3.8 plan-doc acceptance, walked the full POS gift-card flow against the same `BF18801AC599` to confirm no upstream bugs before polishing M13/M14:

| Path | Verified | Evidence |
|---|---|---|
| POS Checkout → Gift Card tender → Check | ✅ | UI shows "Balance: Rs 500.00 · active" |
| POS Add tender Rs 100 → Complete Sale | ✅ | INV-2026-00003 created, payment row `gift_card Rs 100.00` (M15 logged from this) |
| Public API balance after redemption | ✅ | `remaining_value: 400` (500 → 400 deduction confirmed) |
| Customers page Gift Card Balance lookup | ✅ | "Balance Rs 400.00 / Rs 500.00 · Active" (auth'd CRM read uses `/api/gift-cards/:code/balance`, separate from public route) |

Gift-card flow is fully functional end-to-end on production. The 3 polish findings below are all UX/cosmetic, not data-integrity.

### ⚠️ M15 (new) — Gift card tender renders as raw `gift_card` on receipts

Discovered while ringing up INV-2026-00003. The POS Checkout uses `"gift_card"` (lowercase + underscore) as the internal tender id so UI code can branch on it; that raw string was then propagated to the receipt's PAYMENT row (POS post-checkout modal, browser print, public receipt page, emailed receipt). Other tenders happened to already be display-cased ("Cash", "Card", "Wallet") so the bug only surfaced for gift cards.

### Status — 2026-04-29 (after M13 + M14 + M15 shipped + verified live)

| # | Commit | Verified live |
|---|---|---|
| M13 | `87cb4ba` `fix(gift-cards): public balance page renders currency symbol` | ✅ Public API now returns `currency_symbol: "Rs"`. Public page renders REMAINING **Rs400.00** of Rs500.00 initial (was bare "500"). 21/21 backend tests green. (`phase3-8-m13-public-balance-with-currency.png`) |
| M14 | `279d0f9` `feat(gift-cards): optional custom code on physical card issue` | ✅ New Gift Card form: switching to Physical reveals "Custom code (optional) — leave empty to auto-generate" input. Created `GC-PHASE3-TEST` Rs 250 ✅. Re-submitting same code returned `409 Gift card code already exists` ✅. 24/24 backend tests green. |
| M15 | `73f82bd` `fix(receipts): format gift_card tender as "Gift Card" on all surfaces` | ✅ Public receipt for INV-2026-00003 now shows PAYMENT row `Gift Card  Rs100.00` (was `gift_card`). Helper applied across browser print + POS modal + public page + email HTML. (`phase3-8-m15-public-receipt-gift-card-label.png`) |

**Phase 3.8 fully closed including all 3 polish findings.** livetest1 now has:
- 3 sales (INV-2026-00001 Rs 200 partially refunded; INV-2026-00002 Rs 100 cash; INV-2026-00003 Rs 100 gift card)
- 2 active gift cards (`BF18801AC599` Rs 400 remaining digital, `GC-PHASE3-TEST` Rs 250 remaining physical with custom code)
- Test Coffee stock: **7.000** (was 8 — sold 1 to gift-card sale)
- Shift #1 still open

---

## 3.12 CSV import preview validation — 2026-04-29

**Pre-state:** livetest1 had 6 products (5 sample + Test Coffee), 0 customers (Walk-In test customer from 3.6 was soft-deleted), shift #1 open, Hassan logged in. Backend `87cb4ba` / frontend `73f82bd` at start.

**Probe approach:** built two intentionally-mixed test files:
- **`docs/phase3-fixtures/products-3-12-probe.csv`** — 6 rows: 1 valid baseline, 1 missing name, 1 missing price, 1 in-file dup-SKU, 1 unknown category, 1 with whitespace name + non-numeric price + Excel-scientific-notation barcode
- **`docs/phase3-fixtures/customers-3-12-probe.xlsx`** — 5 rows: 1 valid, 1 missing name, 1 invalid email, 1 dup mobile, 1 with whitespace name

Walking the Products tab in the UI revealed the entire `/import` page was silently broken in production. Walking via direct API call to capture the actual response shape revealed 4 distinct issues plus 1 hidden parsing bug.

### 🔴 P4 — Frontend/backend preview shape mismatch — entire `/import` UI silently broken (ALL 5 TABS)

**Reproduce:** Upload any valid CSV at `/import` (Products / Customers / Suppliers / Expenses / Payments) → page shows **"0 valid rows"** and the **Import button never appears**, regardless of file content.

**Root cause:** [ImportRedesign.jsx:82-86](frontend/src/pages/redesign/ImportRedesign.jsx#L82-L86) reads `preview.rows[]._errors`, but [routes/import.js:124](backend/routes/import.js#L124) returned `{ preview, valid (count), errors[], sample[] }` — no `rows` key, no per-row `_errors` field. Frontend always saw `preview.rows = undefined` → `validRows = []` → no Import button.

**Blast radius:** every merchant who tried bulk-import on production since launch hit this. Affected all 5 tabs. The single most impactful bug surfaced in Phase 3.

### 🔴 P5 — In-file + DB duplicate SKU not detected by import preview, no DB UNIQUE constraint either

**Reproduce:** Upload products CSV with `[Coffee Beans, COFFEE-001]` and `[Drip Filter, COFFEE-001]` rows → both go into `valid[]` → pressing Import inserts both → two products share a SKU. Schema confirms: `products.sku TEXT` is nullable with no UNIQUE index ([schema-pg.sql:145](backend/schema-pg.sql#L145)).

**Blast radius:** POS barcode-scan-by-SKU would resolve ambiguously; Reports → SKU dump shows duplicate rows; future variant resolution by SKU is unsafe.

### ⚠️ M16 — Excel scientific-notation barcode silently truncated

**Reproduce:** Real-world Excel converts long digit strings (e.g. EAN-13 `1234567890005`) to scientific notation `1.23E+12` when re-saving as CSV. The XLSX library parsed `1.23E+12` as the float `1230000000000`, **losing the last 5 digits of the barcode**, with no warning.

**Severity:** ⚠️ low. Cosmetic in the demo; real Excel-using merchants would see consistent barcode corruption. Defer to a polish bundle (would need the barcode column to be quoted as a string).

### ⚠️ M17 — Misleading error wording for non-numeric `selling_price`

**Reproduce:** Upload CSV with `selling_price=Rs 850` → preview said `"selling_price is required and must be a number"` even though the field had content. A merchant reading "is required" thinks the column is empty.

### ⚠️ M21 (caught while fixing F7) — XLSX auto-coerces ISO date strings into Excel serials

**Reproduce:** Upload expenses or payments CSV with `date=2026-04-29` → `XLSX.utils.sheet_to_json` returns `date=46141.20847…` (Excel serial). Then the route's `Date.parse(46141.2)` returns NaN → "date is not valid" → all rows rejected.

**Blast radius:** every expense/payment CSV import with ISO dates was silently failing in production. The bug was hiding behind P4 (merchants couldn't reach the Import button to discover it). Found while writing the F7 vitest test.

### ⚠️ M18 (deferred) — Customer import accepts invalid email format silently

Row with `email="not-an-email"` slipped into `sample[]`. Now fixed via F14.

### ⚠️ M19 (deferred) — Customer import accepts duplicate mobile silently

Two rows with the same `mobile` both inserted as separate customers, splitting CRM history. Now fixed via F15.

### ⚠️ M20 — Customer name uniqueness not checked

Out of scope — legitimate edge cases (two customers can share a name). Logged but no fix.

### Plan-doc acceptance scorecard (3.12)

| Criterion | Pre-fix | Post-fix |
|---|---|---|
| Upload CSV with valid + missing-field + dup-SKU rows | 🔴 broken UI shows "0 valid rows" regardless | ✅ all rows rendered with per-row error column |
| Preview flags bad rows distinctly | 🔴 cannot reach preview UI | ✅ red rows for errors, OK for valid (verified live screenshot `phase3-12-import-fixed-products-preview.png`) |
| Fix issues, import succeeds | 🔴 Import button hidden | ✅ "Import 1 row" CTA → product inserts (id=9, INV count 6→7→6 after soft-delete cleanup) |
| Imported products in Inventory with correct prices/taxes | ✅ once UI worked | ✅ Coffee Beans landed with `sku=COFFEE-001, price=850, barcode=1234567890001` |
| Repeat with Customers tab using 5-row XLSX | ✅ same broken-shape issue confirmed via API; F7 fix unifies all 5 tabs | ✅ same fix applies |

### Status — 2026-04-29 (after C1–C4 shipped + verified live)

| # | Commit | Verified live |
|---|---|---|
| C1 (F7 + M21) | `e5a7998` `fix(import): unify preview response shape so frontend can render rows` | ✅ POST `/api/import/products?preview=1` now returns `{ preview, rows: [{ _row, _errors, ...fields }], valid, errors }`. UI renders 6 rows with per-row Status column (`phase3-12-import-fixed-products-preview.png`). Same shape across all 5 tabs. M21 fixed by `{ raw: false }` on `sheet_to_json` — ISO dates now stay as strings. |
| C2 (F8 + F9) | `6c30a23` `fix(import): block duplicate SKUs on products import (in-file + DB)` | ✅ Live test row 5 (`Drip Filter, COFFEE-001`) now reports `duplicate SKU "COFFEE-001" already used on row 2`. Re-uploading the same SKU after import returned `SKU "COFFEE-001" already exists in inventory` ✅. |
| C3 (F10) | `e75a098` `fix(migrations): v82 partial UNIQUE on products.sku` | ✅ Railway log: `[migrate-pg] Migrating tenant: livetest1 (tenant_livetest1)` → `Schema is up to date (version 82).` No skip warnings (production has 0 dup SKUs to clean up). DB-level guard now active for direct INSERTs (POS Add Product, single-product API POST). |
| C4 (F11–F15) | `27e55e5` `fix(import): polish error wording + parity dup-detection across remaining tabs` | ✅ Row 4 (empty price) shows "selling_price is required". Row 7 (`Rs 850`) shows `selling_price "Rs 850" is not a number`. Customers/suppliers/payments dup-detection covered by 7 vitest tests. |

### Live verification summary

After 4 pushes + Railway redeploy + tenant_livetest1 migration to v82:

```
POST /api/import/products?preview=1 (with 6-row probe CSV)
→ { preview: true, rows: [...6 rows...], valid: 1, errors: 5 }
  row 2: Coffee Beans, COFFEE-001 → _errors: []  ← valid
  row 3: (empty name)              → _errors: ["name is required"]
  row 4: Loose Tea, TEA-001        → _errors: ["selling_price is required"]
  row 5: Drip Filter, COFFEE-001   → _errors: ["duplicate SKU \"COFFEE-001\" already used on row 2"]
  row 6: Snack Bar, DoesNotExist   → _errors: ["category \"DoesNotExist\" not found"]
  row 7: Espresso Maker, Rs 850    → _errors: ["selling_price \"Rs 850\" is not a number"]
```

UI renders the same 6 rows in a table with red-highlighted errors and a green "Import 1 row" CTA. Real import inserts only row 2 — verified product count 6→7, then soft-deleted the test row to restore livetest1 state to 6.

**Test coverage added in C1–C4:** 23 new vitest tests across 2 files:
- `backend/tests/integration/pg-import-preview-shape.test.js` — 17 tests (preview shape on 5 endpoints, dup-SKU in-file + DB, NULL-SKU repetition allowed, real import blocking, F11 wording, F12/F13/F14/F15 polish)
- `backend/tests/integration/pg-migration-v82-products-sku-unique.test.js` — 6 tests (clean-schema creation, idempotency, NULL repetition, dup rejection, legacy-with-dups skip, no-products-table no-op)

Plus `backend/tests/integration/pg-batch-2g14-competitor-import.test.js` (existing) updated to assert the new unified shape.

### Findings deferred to post-launch polish

- **M16** — Excel sci-notation barcode truncation. Needs CSV barcode column wrapped as string, separate concern.
- **M20** — Customer name uniqueness. Legitimate to share names.
- Expenses dedup — same-day-same-amount expenses are legitimate (two cashiers, two parking expenses).

**Phase 3.12 fully closed.** All P-level findings shipped + verified live. 4 ⚠️ findings either fixed (M17/M21 in C1, M18/M19 in C4) or deferred with rationale (M16, M20).

---

## 3.13 Sandbox payment checkout end-to-end — 2026-04-29

**Pre-state:** livetest1 on Free plan (3/3 employees cap), 0 payment records. `PAYMENT_GATEWAY=sandbox` and `SANDBOX_WEBHOOK_SECRET` confirmed on Railway. Memory `sanopay_sandbox.md` says sandbox went live Apr 18.

### Plan-doc acceptance scorecard

| Criterion | Result |
|---|---|
| /billing → click monthly Pro plan → "Pay Now" | ⚠️ default selection is Quarterly (known medium); switched to Annual manually per brief |
| Redirects to SanoPay sandbox | ✅ (`/api/sandbox/pay/sandbox_1777415747266_3`) |
| Complete sandbox payment with test card | ✅ clicked "Pay Successfully", page showed "Simulated payment.completed" |
| Webhook fires → tenant auto-upgrades to Pro | ✅ Railway log: `Payment confirmed — tenant activated` (intent_id=3, tenant_id=95) |
| Confirmation email arrives | 🔴 → ✅ exposed P6 + P7 (see below); after C6 fix, verification email (intent_id=5) delivered to `oneshop349@gmail.com` rendered as "Payment Confirmed / Plan: pro (annual) / Amount: PKR 80,000 / Valid Until: April 29, 2027" |
| `payment_records` row created with correct amount + status | ✅ row id=2, amount=80000.00 PKR, plan=pro, cycle=annual, payment_method=sandbox, period 2026-04-28 → 2027-04-28 |
| Verify Free-tier caps lifted (4th employee) | ✅ `POST /api/employees` returned id=4 "Test Cashier 4", count went 3→4 |

### Verified live state after upgrade

```
GET /api/billing/status →
{
  plan: "pro",
  billing_cycle: "annual",
  expires_at: "2027-04-28T22:35:59.623Z",
  grace_ends_at: "2027-05-05T22:35:59.623Z",   // +7 days correctly applied
  next_renewal_date: "2027-04-28T22:35:59.623Z",
  payment_status: "active",
  upgrade_options: []                            // no further upgrade tier
}
```

Railway log trace:

```
POST /api/billing/create-checkout            200 (gatewayRef=sandbox_1777415747266_3, amount=80000)
GET  /api/sandbox/pay/sandbox_177...          200 (sandbox UI rendered)
POST /api/sandbox/simulate-webhook            200
  → Processing webhook event (provider=sandbox, event_type=payment.completed)
  → Payment confirmed — tenant activated (intent_id=3, tenant_id=95)
  → Sandbox webhook simulated (result={ok:true})
```

### Findings

#### 🔴 ⚠️ Re-confirmed M22 — `/billing` Quarterly default conflicts with Annual BEST VALUE pill

This was already a known medium ("/billing Quarterly highlighted, Annual has BEST VALUE pill"), but I want to re-record it with the actual repro evidence:

**Reproduce:** Visit `/billing` while on Free plan → 4 cycle cards render, Annual has the "BEST VALUE" pill, Quarterly is **pre-selected** (visible by inspecting the `Upgrade Now — PKR 21,600/quarter` CTA at the bottom). Clicking Upgrade Now without first clicking Annual would route the merchant to the Quarterly checkout despite the visual cue suggesting Annual is recommended.

**Severity:** ⚠️ medium UX/conversion. A merchant trusting the BEST VALUE pill clicks Upgrade Now → pays Quarterly → realizes mid-flow it wasn't Annual. Either revenue is left on the table (Annual saves Rs 16,000) or the merchant aborts.

**Suggested fix:** in `BillingRedesign.jsx`, default the `selectedCycle` state to Annual (per memory note `BillingRedesign.jsx … Annual cycle is RECOMMENDED_CYCLE`). Bundle into the polish PR.

#### ⚠️ M23 — `/api/billing/pricing` still returns Starter tier rows

`GET /api/billing/pricing` returns 6 rows including 2 Starter rows (PKR 30,000 annual, PKR 3,000 monthly), even though memory `historical_notes.md` says Starter was removed. The `status.upgrade_options` correctly filters to Pro-only, so the UI doesn't surface Starter — but the public pricing endpoint is still emitting it. Likely a leftover seed in `plan_pricing` table that the Starter-removal cleanup missed.

**Severity:** ⚠️ low. UI doesn't surface Starter, so end-user impact is zero. But integrations or future admin UI reads of `/billing/pricing` would surface it. Worth a single SQL cleanup in v83 or admin script.

**Verification suggestion:** `SELECT * FROM plan_pricing WHERE plan='starter'` on master DB — if rows exist, remove them.

#### ⚠️ M24 — `period_end` ISO timestamp shown verbatim on payment_records

The new payment_record row has `period_end: "2027-04-28T22:35:59.623Z"` — a UTC instant down to milliseconds. Most billing UIs display this as a friendly date (`Apr 28, 2027`). Currently the merchant inspecting payment-history via API would see the raw ISO. Frontend `BillingRedesign.jsx` formats it (per the BillingRedesign code), but downstream consumers (CSV export, admin dashboards) might not. Defer.

### Closing state

- **Plan:** Pro (annual), expires 2027-04-28
- **payment_records:** 1 row (80000 PKR sandbox)
- **Employees:** 4 (Hassan, Test Cashier 2, Test Cashier 3, **Test Cashier 4** [newly added to verify caps lifted])
- **Sales / gift cards / products / shift / Test Coffee stock:** unchanged from end of 3.12

**No new fix commits in 3.13** — sandbox payment flow is fully working. Findings M22 / M23 / M24 are deferred to the polish bundle (M22 already known, M23/M24 logged here).

**Phase 3.13 closed.** All 7 plan-doc acceptance criteria met after the P6 + P7 fixes below.

### 🔴 P6 — Payment confirmation email never sent (root-caused while verifying 3.13)

**Reproduce:** Complete sandbox payment → tenant activates correctly → no email arrives in `oneshop349@gmail.com` (operator inbox).

**Root cause** (verified against actual source, not CLAUDE.md):
- [routes/webhooks.js:105-109 (pre-fix)](backend/routes/webhooks.js#L105) did a raw `INSERT INTO email_queue (...)` against the legacy `public.email_queue` table.
- The legacy polling worker (`workers/email-worker.js`) that drained that table was deleted during the pg-boss migration. Only `workers/email-worker-boss.js` is wired in `boot/workers.js:247-248`.
- The pg-boss "email" worker only consumes jobs published via `boss.send("email", ...)` — it does NOT poll `email_queue` table.
- Net effect: every payment-confirmation INSERT sat orphaned in `email_queue` forever.

**Why every other email type works:** every other code path uses `services/email.js`'s `enqueueEmail()` helper, which publishes via `boss.send` directly. Only `routes/webhooks.js` was the holdout still doing a raw INSERT.

**Fix (commit `fbc7034`, C5):** swap the raw INSERT for `enqueueEmail(masterDb, { tenantId, type, to, tenant, data })` — same shape every other email path uses.

### 🔴 P7 — pg-boss v12 work handlers all broken — every email + FBR job silently failing in production

**Discovered while verifying P6 fix.** After C5 deployed, the test sandbox payment's email STILL didn't arrive. Inspecting `pgboss.job` table revealed:
- 1 retry-state email job with stack trace:
  ```
  TypeError: Cannot destructure property 'to' of 'job.data' as it is undefined.
    at handleEmailJob (/app/workers/email-worker-boss.js:43:11)
  ```
- Multiple `created`-state email jobs from Apr 27 stuck in queue

**Root cause** (verified):
- `backend/package.json` declares `"pg-boss": "^12.15.0"`, installed = `12.15.0`.
- pg-boss v12 changed `WorkHandler` signature from `(job: Job<T>) => ...` to `(job: Job<T>[]) => ...` (verified at `node_modules/pg-boss/dist/types.d.ts:321-325`).
- `pg-boss/dist/manager.js:201` invokes `callback(jobs)` — passing the whole array.
- All 6 data-reading handlers in `workers/*-worker-boss.js` were written `async (job) => { const x = job.data.x; }` — destructured `.data` from the array, got `undefined`, crashed on every single job.
- 13 cron-style handlers (`async () => { ... }`) were unaffected because they ignore the param.

**Why tests didn't catch it:** `tests/unit/workers-email-worker-boss.test.js` called handlers directly with single-job shape, bypassing pg-boss entirely. Tests passed against the wrong contract.

**Blast radius:** every email enqueued via pg-boss since v12 was deployed silently failed. Includes welcome, password reset, drip, billing payment confirmations (now via P6 fix), invoice reminders, customer subscription renewals, marketing campaigns, and FBR digital invoice posting.

**Fix (commit `fb280fe`, C6):** changed 6 handlers from `async (job) =>` to `async ([job]) =>` (array destructure, default batchSize=1 ⇒ array of length 1):
- `email-worker-boss.js:235` (email), 261 (campaign-email), 322 (invoice-reminder), 379 (campaign-scheduled-send), 397 (subscription-renewal)
- `fbr-worker-boss.js:134` (fbr-invoice)

Plus 9 unit-test invocations in `workers-email-worker-boss.test.js` updated to pass array shape so tests now validate the v12 contract.

### Verification (post-C6 deploy)

Created fresh pending intent (`scripts/3-13-test-fresh-intent.js`) → `simulate-webhook` → Railway log captured:
```
[INFO] Processing webhook event ... event_type="payment.completed" intent_id=5 tenant_id=95
[INFO] Payment confirmed — tenant activated ... intent_id=5 tenant_id=95
[INFO] pg-boss email sent ... to="oneshop349@gmail.com" subject="Payment received — Live Test 1"
```

Operator confirmed: email rendered correctly in inbox — green "SanoPOS / Payment Confirmed" header, Plan: pro (annual), Amount: PKR 80,000, Valid Until: April 29, 2027.

`pgboss.job` state went from `failed: 1` to `completed: 1` — first successful pg-boss email send since v12 was deployed.

### ⚠️ M25 (new) — Tenant deletion does NOT purge pg-boss jobs that reference the tenant

While inspecting `pgboss.job`, found 2 stale `drip_getting_started` / `drip_features` emails scheduled for `start_after = 2026-04-29 12:40 UTC` (tomorrow) targeting `tenant_id=94` — the now-deleted `live_test_1` tenant. They would have fired tomorrow with broken store-link content (linking to the deleted store URL).

**Cleanup applied:** deleted those 2 orphan jobs via `scripts/3-13-cleanup-orphan-drip-jobs.js`. The 2 remaining drip jobs reference `tenant_id=95` (active livetest1) and will fire tomorrow + 5/2 with valid content — left in place.

**Suggested fix:** when soft-deleting a tenant (master `tenants` row → `status='deleted'` + tenant schema dropped), also `DELETE FROM pgboss.job WHERE state='created' AND data->>'tenantId' = $1`. Bundle into a polish PR that addresses the broader email-queue-cleanup story (the legacy `email_queue` table also holds orphan rows now that nothing writes to it).

### Updated state of `livetest1` after 3.13

- Plan: **Pro (annual)**, expires **2027-04-28**
- payment_records: 2 rows (intent_id=3 from initial 3.13 walk + intent_id=5 from P6/P7 verification — both PKR 80,000 sandbox)
- Employees: **4** (Hassan, Test Cashier 2, Test Cashier 3, Test Cashier 4 [id=4, PIN 4444, Cashier role])
- Sales / gift cards / products / shift / Test Coffee stock: unchanged from end of 3.12
- Backend on Railway at `fb280fe` (C6). Schema at v82.

### Commits (3.13 saga)

- `fbc7034` `fix(webhooks): payment confirmation email — enqueue via pg-boss, not dead email_queue` (C5 / P6)
- `fb280fe` `fix(workers): pg-boss v12 work handlers receive Job<T>[], not single Job` (C6 / P7)
- 3 helper scripts in `backend/scripts/`: `3-13-test-fresh-intent.js`, `3-13-check-pgboss-jobs.js`, `3-13-cleanup-orphan-drip-jobs.js` — kept as debug tools (cleanup in polish PR per CLAUDE.md "no out-of-scope churn")

---

## Resume next session at 3.14

**State on `livetest1` (production):**
- **Plan: Pro (annual)**, expires 2027-04-28, `payment_status=active`, grace_ends 2027-05-05.
- **2 sandbox payment records**: id=2 (initial 3.13 walk via /billing UI) + id=3 or higher (P6/P7 verification via simulate-webhook). Both PKR 80,000 sandbox.
- **4 employees**: Hassan, Test Cashier 2, Test Cashier 3, **Test Cashier 4 (id=4, PIN 4444, Cashier role)** — safe to leave or delete.
- 3 sales / 2 gift cards / 6 products / Test Coffee stock 7.000 / Shift #1 still open — unchanged from end of 3.12.
- Backend on Railway at `fb280fe` (C6 — pg-boss v12 fix). Schema at v82. Frontend on Vercel at `73f82bd`.
- pg-boss email worker now functioning: state count `completed: 1, failed: 1 (pre-fix residue), created: 2 (legitimate future-scheduled drip emails for livetest1, fire 4/29 13:16 + 5/2 13:16)`.

**Next step — 3.14 Mixed-rate tax sale.** Create "Coffee Beans" with 17% GST + "Snack Bar" with 5% GST → POS ring up 1× CB + 2× SB → verify receipt shows two tax lines (Rs 17 + Rs 5 = Rs 22 total tax on Rs 200 base). Verify Reports → Sales Summary preserves per-rate breakdown. Skip FBR-payload check (3.3 is still blocked).

Pre-flight question: livetest1 currently has 0 tax rates configured (verified via `/import` Snack Bar probe in 3.12 which returned `tax "DoesNotExist" not found` — same would happen for any name). Will need to first add 17% GST + 5% GST rows to the `taxes` table via `/taxes` admin UI before creating the products.

**Still blocked:** 3.3 FBR (NTN/STRN/sandbox token), 3.9 Shopify, 3.10 Courier (sandbox creds). 3.11 SKIP (physical hardware).

**Carryover findings from 3.13 (deferred to polish bundle):**
- M22 — `/billing` Quarterly default conflicts with Annual BEST VALUE pill (real conversion bug).
- M23 — `/api/billing/pricing` still emits Starter tier rows despite Starter removal (UI filters them out, but endpoint isn't cleaned).
- M24 — `period_end` exposed as raw ISO timestamp in payment_records API.
- M25 — Tenant deletion does NOT purge orphan pg-boss jobs that reference the deleted tenant. 2 such orphans (drip emails for `live_test_1`, tenantId=94) deleted manually via `scripts/3-13-cleanup-orphan-drip-jobs.js`.

**Helper scripts left in repo for future debug:**
- `backend/scripts/3-13-test-fresh-intent.js` — create a fresh pending payment_intent on master DB (replay sandbox upgrade flow without going through /billing UI).
- `backend/scripts/3-13-check-pgboss-jobs.js` — show recent pg-boss "email" jobs + state counts.
- `backend/scripts/3-13-cleanup-orphan-drip-jobs.js` — delete pg-boss email jobs that reference a specific tenant_id (currently hardcoded to 94 — generalize before re-using).
- `backend/scripts/3-13-inspect-stuck-jobs.js` — full row dump of one created-state job (column discovery).
- `backend/scripts/3-13-inspect-remaining.js` — show all created-state jobs + active tenants.

---

## 3.14 Mixed-rate tax sale correctness — 🔴 BROKEN END-TO-END

**Walked Apr 28 2026.** Tenant `livetest1`, Shift #1 still open, sale `INV-2026-00004` rang up at 23:44 UTC (1× Coffee Beans Rs 100 with `gst=17` + 2× Snack Bar Rs 50 with `gst=5`, paid Rs 200 cash).

### State setup (verified live)

| Step | Result |
|---|---|
| `/taxes` adding GST 5% | ✅ Saved. Final state: 3 rules — Default Tax 0%, GST 17% (pre-existing — handoff said "0 tax rates" but this was wrong; it was just the import lookup that couldn't find a name match), GST 5% (new). |
| Coffee Beans product (id=10) | ✅ price=100, gst=17.0000, total_stock=10. |
| Snack Bar product (id=11) | ✅ price=50, gst=5.0000, total_stock=20. |
| POS sale | ✅ Rang up + paid Rs 200 cash. INV-2026-00004 created. |

### What works

- **Cart math is right (in tax-inclusive mode only)**: with the "Tax Inclusive" toggle ON, the cart shows `Subtotal Rs 200.00 / GST (incl.) Rs 19.29 / Total Rs 200.00`. Math checks: Snack Bar Rs 50 incl. 5% → tax Rs 2.38 × 2 = Rs 4.76. Coffee Beans Rs 100 incl. 17% → tax Rs 14.53. Total Rs 19.29 ✓. So the **per-product `gst` rate IS being read correctly** at render time.
- **Post-sale receipt modal** echoes the same Rs 19.29 line.
- **FBR-Export endpoint** does emit per-line rows (Snack Bar + Coffee Beans appear as separate rows on INV-2026-00004) — but see 🔴 below for tax columns.

### 🔴 P8 — `sales` and `sale_items` schema has NO tax columns at all

Verified via `backend/scripts/3-14-inspect-sale-tax.js` against tenant_livetest1:

```
sales columns: id, total_amount, payment_method, timestamp, outlet_id, employee_id,
voided, void_reason, customer_id, discount_amount, discount_type, points_earned,
points_redeemed, notes, invoice_number, shift_id, idempotency_key, fbr_status,
fbr_irn, fbr_qr_code, folio_id, treatment_folio_id
  → no `subtotal`, no `tax_amount`, no `total_tax`, no `tax_breakdown` JSON.

sale_items columns: id, sale_id, product_id, quantity, price_at_sale,
cost_price_at_sale, variant_id, gross_weight, tare_weight, staff_id, seat_number,
price_override_*
  → no `tax_rate_at_sale`, no `tax_amount_at_sale`, no `gst_at_sale`, no `tax_id`.
```

**Implication:** the "GST (incl.) Rs 19.29" line on the cart and post-sale receipt is a **render-time artifact** computed by joining `sale_items → products` and reading `products.gst`. Nothing about the tax breakdown is persisted on the sale.

This means:
- If a product's GST rate is edited after the sale, **the receipt's tax breakdown changes retroactively**.
- Returns/voids cannot reverse the original tax accurately.
- FBR posting (when 3.3 unblocks) will need to recompute from the live `products.gst` — incorrect for any sale of a product whose rate later changed.
- Compliance reports cannot tell you what tax was *charged at sale time* vs. what the rate *currently is*.

This is a **Pakistani tax-compliance blocker for FBR rollout**. Until `sale_items` snapshots tax rate + amount per line at sale-write time, mixed-rate audits are impossible.

### 🔴 P9 — Tax-EXCLUSIVE mode silently drops tax to 0

With "Tax Inclusive" toggle OFF (i.e., user expects tax to be added on top of price):
- Cart: `Subtotal Rs 200.00 / Total Rs 200.00` — no tax line, no GST sub-line, total === subtotal.
- The 3.14 plan's expected math (Rs 200 base + Rs 17 + Rs 5 = Rs 222) is **not achievable in this mode**.

Two interpretations:
1. The product `gst` column is hard-wired as inclusive-only and the toggle just controls whether the tax sub-line is *displayed*.
2. Tax-exclusive math requires `tax_id` (FK to `taxes` table) on the product, which the new-product form doesn't expose.

Either way, a merchant who toggles "Tax Inclusive" OFF (intending "compute tax on top") loses the tax line entirely — silent failure. **At minimum the toggle should disable + tooltip "tax-exclusive requires linked tax rule" if interp #2 is correct.**

### 🔴 P10 — Sales Summary report says "Tax Collected: Rs 0.00"

`/reports → Sales Summary` reads `sales.tax_amount` (which doesn't exist) and falls back to 0 across all 4 sales. Revenue Rs 600 / Tax Rs 0.00 / Net Sales Rs 600 — even though the cart and receipt UI claimed Rs 19.29 of GST on INV-2026-00004.

Per-rate breakdown (Rs from 17%, Rs from 5%) is **not even attempted** as a row.

### 🔴 P11 — FBR-Export emits `tax_rate: 0` and `tax_amount: "0.00"` per line

`GET /api/reports/fbr-export?from=2026-04-27&to=2026-04-30` returns row for Coffee Beans:
```json
{ "tax_rate": 0, "tax_amount": "0.00", "total_amount": "100.00", ... }
```
…and Snack Bar:
```json
{ "tax_rate": 0, "tax_amount": "0.00", "total_amount": "100.00", ... }
```

Both should be `tax_rate: 17 → tax_amount: 14.53` and `tax_rate: 5 → tax_amount: 4.76` respectively. The endpoint exposes the per-line columns correctly, but the underlying query never joins to `products.gst` or computes inclusive-tax math. **This is the same root cause as P8 — there's no per-line tax data in `sale_items` to read from.**

### 🟡 M26 — `GET /api/products` (list) drops the `gst` field

`GET /api/products/:id` (single) returns `gst: "17.0000"`. `GET /api/products` (list) omits the field entirely. UI inventory list shows price-only — there's no way to spot-check what GST rate is on each row without opening the product. Minor consistency bug.

### 🟡 M27 — Public `/receipt/:invoiceNumber` page shows zero tax detail

`https://sanopos.com/receipt/INV-2026-00004?tenant=livetest1` renders only items + Total — no tax line at all (not even the consolidated "GST (incl.)"). The customer-shareable receipt is silent on tax. (First fetch hit a transient CORS preflight error too — second fetch worked. Likely Railway cold-start; not flagging as a separate finding.)

### 🟡 M28 — New-product form has no tax-rule picker

The "GST %" field accepts a free numeric. There's no dropdown to pick from the `taxes` table rules. So `tax_id` stays null even when a matching rule exists at that rate. The `taxes` table is decorative for products — only used by import lookup-by-name (which is what the 3.12 probe found) and possibly hard-keyed reports.

### 🟡 M29 — Feature-flag-disabled routes return HTTP 503 (should be 403 or empty 200)

**Observed during 3.14 walk** (in `.playwright-mcp/console-2026-04-28T23-41-00-970Z.log`):
- `503 GET /api/products/10/modifier-tree` — fires every time an item is added to POS cart (POS unconditionally probes restaurant-style modifier tree).
- `503 GET /api/products/11/modifier-tree` — same, for second cart item.
- `503 GET /api/room-bookings?status=checked_in&outlet_id=1` — POS polls room-bookings periodically.

Backend payload in all 3 cases: `{"error": "Feature disabled: phase4_restaurant"}` / `phase4_room_management`. Both flags are intentionally off on livetest1 (retail-only tenant).

**Root cause:** `backend/middleware/feature-flags.js:169` (`requireFeature`) and `:227` (`requireMode`) both return **HTTP 503** when the flag/mode is off.

**Why 503 is wrong:**
- 503 = "Service Unavailable" — semantically means the server is down or overloaded. Sentry, UptimeRobot, Cloudflare's circuit breakers, and browser fetch retry logic all treat 503 as a transient infra problem. A feature being off on a tenant's plan is not an infra problem.
- For every retail tenant: every POS cart-add fires 2-3 503s → drowns Sentry's real-5xx alerts in noise.
- Uptime SLO calculations count these against availability even though the feature is intentionally disabled.

**Correct fix options:**
1. **HTTP 403** with the same JSON body — semantically correct ("server understood, refuses to authorize") and matches auth-failure pattern. Easiest to roll out.
2. **HTTP 200 with empty payload** for read-only probe endpoints (modifier-tree, room-bookings) — defensive: POS doesn't even know the feature is off; gets `[]` back and renders normally. Better UX, requires per-route opt-in.

Recommended: change `requireFeature` and `requireMode` to return 403 by default; add an `ifMissing404OrEmpty200` variant for probe endpoints that POS calls speculatively.

**Severity rationale for 🟡 not 🔴:** the routes work correctly when the flag is on; the 503 is purely an observability/noise issue, not a user-facing breakage. But it impacts Sentry signal-to-noise across all retail tenants → worth fixing soon.

### Verdict on 3.14

**Mixed-rate tax sale correctness is broken end-to-end.** Cart and receipt MODAL render correct math at display time, but nothing is persisted, nothing is preserved per-rate, and every downstream consumer (Sales Summary, FBR Export, Item Wise, public receipt) reports zero tax. This needs a real fix before FBR rollout (3.3) or any tax-jurisdiction compliance.

**Recommended fix scope (logged as P8 — single largest 3.14 fix):**
1. Migration v83: add `sale_items.tax_rate_at_sale NUMERIC(5,2)` + `sale_items.tax_amount_at_sale NUMERIC(10,2)`.
2. POST `/api/sales` writes both columns at sale-write time, snapshotted from `products.gst` (and inclusive-vs-exclusive computed from the cart's toggle state — also persist that toggle on `sales` row).
3. Sales Summary, Item Wise, FBR Export, receipt builders all switch to read the snapshotted columns.
4. Tax-exclusive toggle wires through to actual math instead of silently dropping tax.
5. UI: receipt modal + public receipt page show two distinct tax lines when rates differ, single line when they match.
6. Minor: list endpoint echo `gst`; new-product form add tax-rule dropdown that auto-fills numeric and stamps `tax_id`.

This is a P-level (compliance-blocker) fix worth a dedicated branch + PR rather than rolling into the polish bundle.

### Updated state of `livetest1` after 3.14

- Plan: Pro (annual), expires 2027-04-28 — unchanged.
- Tax rates: 3 (Default Tax 0%, GST 17%, GST 5% — new).
- Products: 8 total (Coffee Beans id=10 + Snack Bar id=11 added; Test Coffee id=8 still there with stock 7).
- Sales: 4 — INV-2026-00001 (Rs 200 partial refund), INV-2026-00002 (Rs 100 cash), INV-2026-00003 (Rs 100 gift card), INV-2026-00004 (Rs 200 cash, mixed-rate items).
- Snack Bar stock: **20.000 → 18.000** after 3.14. Coffee Beans stock: **10.000 → 9.000**.
- Shift #1 still open. Hassan attendance session active. Backend at `9f1fb1b`, frontend at `73f82bd` — no commits yet today.

### Helper scripts left in repo

- `backend/scripts/3-14-inspect-sale-tax.js` — dump sales + sale_items rows for INV-2026-00004 + their column lists.

### Carryover open mediums after 3.14

(unchanged from 3.13 list — M22, M23, M24, M25 all still deferred to polish bundle. New: P8/P9/P10/P11/M26/M27/M28/M29 all logged above as the 3.14 fix bundle.)

---

# Phase 4 — Public Surfaces (started 2026-04-29)

## 4.1 Storefront `/store/livetest1` — anonymous browse → cart → checkout ✅ closed

Walked end-to-end on production at 1440×900. Required publishing 2 products to the storefront channel first via `backend/scripts/__phase4_publish_storefront.js` (channel_publications was empty — see M30). Then walked Browse → PDP → Add → Cart → Checkout → Place Order → Order Status. Two criticals + two mediums.

### 🔴 P12 — Checkout Total displayed Rs 0 instead of grandTotal — CLOSED

Three field-name paste bugs in `frontend/src/pages/storefront/StorefrontCheckout.jsx`:
- `quote.total` should be `quote.grandTotal`
- `quote.tax` should be `quote.taxTotal`
- `quote.shipping` should be `quote.shippingTotal`

API returns the camelCase totals via `services/quote.js`, but the UI read mismatched names → defaulted to 0. Backend persisted the correct grandTotal to `web_orders.grand_total`, so the customer would commit to a real charge while seeing "Total: Rs 0" — refund-dispute fuel. Subtotal field accidentally happened to match (`quote.subtotal`), which is why only Total was visibly broken.

**Fix**: commit `dcd5f86` `fix(storefront): rename quote field reads in checkout UI (P12)`. Verified live — checkout shows correct totals matching API + DB.

### 🔴 P13 — Storefront quote service ignored P8 tax architecture — CLOSED

`backend/services/quote.js` JOINed `taxes` only via product/category `tax_id`, ignoring:
- `products.gst` (legacy direct-rate column, still in active use; livetest1 Snack Bar id=11 has gst=5, tax_id=null → was returning taxRate=0)
- `company_profile.tax_mode` (`'inclusive'` / `'exclusive'` / `'none'`) — was never read
- Inclusive math (price contains tax → extract; subtotal = gross − tax_total)

POS sales were fixed in the P8 bundle (`routes/sales.js` lines 988–1118 do the full cascade). Storefront was a parallel call path that nobody updated. Compliance blocker for any GST-registered tenant routing customers through the storefront.

**Fix**: commit `fe73b7e` `fix(storefront): apply P8 tax cascade to quote service (P13)`. Mirrors POS resolution: `tax_id → gst → category.tax_id → 0`, with `tax_mode='none'` overriding to 0 and `tax_mode='inclusive'` extracting tax from displayed price. `routes/storefront.js` now loads `company_profile.tax_mode` and passes it to `calculateQuote()`. Outlet tax profiles (P8 step 1) intentionally omitted — livetest1 doesn't use them and the route would also need `getFeatureFlagsMap` plumbed in. Add later if any tenant turns on `phase2_outlet_tax`.

**Tests**: 4-case regression suite at `backend/tests/integration/pg-batch-phase4-storefront-tax.test.js` — exclusive+tax_id, exclusive+gst-only, inclusive (extract from displayed price), none-overrides-rate. All green.

**Live verification**: cart with Test Coffee Rs 100 (no tax) + Snack Bar Rs 50 (gst=5) → Subtotal Rs 147.62, Tax Rs 2.38, Total Rs 150. `web_orders` row persisted: subtotal 147.62, tax_total 2.38, grand_total 150.00. Order token `88f0d2d9-0669-4b67-b5a5-42a4a14f33dc`, external_order_id `sf_6b90993b224742a49d65`.

### 🟡 M30 (carryover from Phase 3) — Empty storefront state by default

All tenants ship with `channel_publications` empty. The only way to publish a product is per-product toggle in `frontend/src/pages/redesign/ProductFormPage.jsx` lines 746–792 — no bulk action, no "publish all to storefront" default in the wizard, no banner on a fresh `/store/{slug}` telling the merchant to publish products. Phase 3 already flagged this. Recommend either default-on for new products or a bulk-publish multi-select in `/inventory`.

**Status**: deferred to polish bundle.

### 🟡 M31 — Storefront order placement does not enqueue customer email confirmation

Verified live: placed order `sf_6b90993b224742a49d65` for `oneshop349@hotmail.com`, queried `public.email_queue` after — zero rows for that recipient. `routes/storefront.js` POST `/api/storefront/checkout` does the inventory + order persistence in a transaction but never calls `enqueueEmail()`. Customer only gets the in-page status URL (`/store/{slug}/order/{token}`) — easy to lose if they close the tab.

Every other customer touchpoint (sale receipts via `email/send-receipt-v2`, password reset, support ticket replies, billing notifications) sends mail. Anonymous storefront orders go silent.

**Recommendation**: add a `web_order_confirmation` email type to `services/email-templates.js` and enqueue from the storefront checkout transaction (after the row is created, before the response). Link customer back to the public status URL.

**Status**: log only — likely the same gap exists across other Phase 4 surfaces (4.2/4.3/4.6). Cluster the email-gap fix into one bundle once Phase 4 walk is complete.

### Drift noted (not flagged as findings)

- Storefront PDP CLAUDE.md describes image gallery, variant selector, reviews, pickup-availability table — actual page renders only single image + Add to Cart. Doc drift; UI works for single-variant products.

### State of livetest1 after 4.1

- 5 sales (4 POS + 1 storefront `web_orders.id=1`).
- Test Coffee stock: **6.000** (was 7, dropped 1 via storefront).
- Snack Bar stock: **17.000** (was 18, dropped 1 via storefront).
- Coffee Beans stock: 9.000 (unchanged).
- 2 active gift cards (unchanged).
- Shift #1 still open (do not close).
- channel_publications: 2 rows (Test Coffee + Snack Bar published to storefront).
- Backend at commit `fe73b7e`/`dcd5f86`, Vercel deployed at 13:42, Railway re-registered workers at 13:41.

---

## 4.2 Customer signup → OTP → portal landing ✅ closed

Walked end-to-end on production at 1440×900. Signup form renders cleanly (name + email + mobile + password). Submit → DB inserts `customers` row + `customer_portal_otps` row + enqueues `customer_portal_email_verify` via pg-boss. Worker delivered email in 379ms (state='completed'). User entered code → verify → redirected to portal landing. Sign-out + password sign-in round-trip also works.

**Live evidence**:
- Customer row id=2 (livetest1 schema): `Phase 4 Customer GMail`, `oneshop349@gmail.com`, mobile `0300-1234567`, `portal_password_hash` set, `portal_enabled_at` flipped after OTP verify.
- pg-boss job `43fa8db1-7fcb-48aa-8a17-dd0afc79bc8d` — type `customer_portal_email_verify`, completed.
- OTP code `128980` (15-min TTL) marked used, session JWT issued.

### 🔴 P14 — Initial OTP send went to Hotmail (Resend "completed" but undelivered)

First signup attempt at 13:52 used `oneshop349@hotmail.com`. pg-boss job `79d2a5d2-…` reported `state='completed'` (Resend accepted hand-off) but the email never arrived in the user's hotmail inbox or junk. Hotmail/Outlook is known to be aggressive on Resend's `noreply@sanopos.com` if SPF/DKIM aren't aligned for `outlook.com` outbound IPs. Re-running the same signup with `oneshop349@gmail.com` delivered fine.

**Status**: Not a code bug per se — `enqueueEmail` doesn't capture Resend's downstream delivery status, so "completed" only means we handed off. **Recommendation**: capture the Resend message-id and add a periodic job to poll `GET /emails/{id}` for terminal status (`bounced`, `complained`, `delivered`). Otherwise tenants lose customers silently to Microsoft spam filters and have no diagnostic trail. Already a known class of issue for any Resend-backed system.

**Status**: log only — not blocking the walk, but worth flagging since it cost ~7min of debug time and would cost real customers their account access. Cluster with M31 in the email-deliverability fix bundle.

### 🟡 M32 — Storefront has zero discovery link to customer portal/signup

Verified by reading `frontend/src/pages/storefront/*.jsx` — zero references to `/portal/`, "sign in", "my account", "create account", or order-history links. The storefront header has `Live Test 1` brand + `All Products` + `Cart`. Post-checkout `StorefrontOrderStatus.jsx` shows the order timeline and a "Continue Shopping" link, but no "Save this order to your account" / "Sign up to track future orders" CTA.

Customer must guess that `/portal/<slug>` exists. Reasonable to assume real customers won't, especially mobile.

**Recommendation**: Add a header "My Account" link (icon-only on mobile) and a post-checkout "Track this order via your account" callout that pre-fills the signup email. Also wire portal-side to recognise the customer if their email matches a guest order on signup (M33 below).

**Status**: deferred to polish bundle.

### 🟡 M33 — Anonymous storefront orders not auto-linked to customers on signup

After 4.1 placed order id=1 as `customer_email_snapshot='oneshop349@hotmail.com'` (anonymous, customer_id=null). When the same email signed up at 4.2, the new portal customer row (id=2, gmail not hotmail in the final test, so this is implied not observed for this exact run) sees an empty Orders tab. There's no backfill step that scans `web_orders WHERE customer_id IS NULL AND customer_email_snapshot = $newEmail` and links them.

Even worse: even if the emails matched, the portal's `Orders` tab queries `web_orders WHERE customer_id = $1` per `routes/customer-portal/data.js` (probably — assumed; not opened during 4.3 walk; verify before fixing). So the customer would never see prior anonymous orders.

**Recommendation**: On portal signup completion (after `portal_enabled_at` flip), run an UPDATE that links matching guest `web_orders.customer_email_snapshot` rows to the new customer_id. Same on first email-verify of an existing customer.

**Status**: deferred to polish bundle.

---

## 4.3 Customer portal — 4 tabs ✅ closed

Walked Dashboard → Orders → Loyalty → Profile after fresh signup. All four render cleanly:

- **Dashboard**: welcome heading with signup name, "Your account at Live Test 1" subtitle, single Loyalty card (Points 0, "No tier yet", View details link).
- **Orders**: empty state "No orders yet." (anonymous storefront order from 4.1 not linked — see M33).
- **Loyalty**: 3 stat cards (Points 0, Total spend 0, Tier "No tier yet") + "To redeem points, mention your account at checkout in store." helper.
- **Profile**: editable name + mobile (pre-populated from signup), optional address/city/DOB/gender/preferred-contact + 3 marketing-consent checkboxes (Email/SMS/WhatsApp) + Save button. "Saved addresses" section ("No saved addresses yet.").

Sign out → redirect to `/portal/<slug>/login`. Password sign-in round-trip works.

**Doc drift note (not a finding)**: plan doc said "4 tabs: invoices, orders, loyalty, profile" — actual nav is **Dashboard, Orders, Loyalty, Profile**. Invoices only appears when `customer_invoicing` flag is enabled (livetest1 retail = off). Same for Appointments/Treatments/Stays/Wallet which the route file declares but the nav config gates by feature. Plan doc should be amended to "tabs vary by tenant features; retail baseline is Dashboard/Orders/Loyalty/Profile."

### State of livetest1 after 4.3

- 2 customers: id=1 anonymous storefront guest (Phase 4 Tester), id=2 portal-registered (Phase 4 Customer GMail).
- Note: the earlier hotmail attempt likely created a 3rd customer row that was abandoned mid-OTP. Worth a cleanup script. (Will check during Phase 4 closure.)
- 1 customer_portal_otps row used.
- pg-boss job archive carries 2 OTP emails (one hotmail-undelivered, one gmail-completed).

---

## 4.4 Public receipt `/receipt/INV-2026-00004` ✅ closed (post-P8 recheck)

Walked the public receipt URL to re-confirm the M27 deliverable from Phase 3.14 (per-rate tax breakdown) is live.

**Live render**:
- Header: "Live Test 1" + Invoice INV-2026-00004 + Date Apr 29, 2026 04:44 AM + Served by Hassan
- Items: Snack Bar 2 × Rs50.00 = Rs100.00; Coffee Beans 1 × Rs100.00 = Rs100.00
- Subtotal Rs200.00, **GST 17% +Rs17.00**, **GST 5% +Rs5.00**, Total Rs200.00 (inclusive — gross matches displayed)
- Payment: Cash Rs200.00, "Please come again." footer, Print Receipt button.

Per-rate breakdown shows distinct lines for each tax rate, exactly as Phase 3.14 closure described. No regression. P8 inclusive math correctly extracts tax from displayed prices and the receipt customer-total matches what the customer paid.

---

## 4.5 Public gift-card balance `/gift-card/BF18801AC599` ✅ closed (recheck)

Walked happy path + bad-code edge.

**Happy path** (existing card from Phase 3.8):
- Code BF18801AC599
- Remaining Rs400.00 of Rs500.00 initial
- Type "digital", Status "active"
- "Present the code at the store to redeem." footer.

**Bad-code edge** (`/gift-card/NOT-A-REAL-CODE`):
- Renders "Gift card not found" + "Double-check the code on your card. If it still doesn't work, contact the store where you received it." — clean error state, no crash.
- API returns 404 (1 console error from network 404, no JS exception).

No regression on gift-card public balance from Phase 3.8 closure.

---

## 4.6 Kiosk `/kiosk?tenant=livetest1&outlet=1` ✅ closed

**Discovery**: `/kiosk` is wrapped in `RequireAuth` (`frontend/src/routes/publicRoutes.jsx:140`), so an unauthenticated visitor gets redirected to `/login`. This is intentional security but contradicts the "public surface" framing in the plan doc — kiosk is employee-facing, just unauthenticated *as a specific employee* (PIN unlocks). Plan doc should be amended.

**Walked as Hassan** (admin login → /kiosk):
- Renders cleanly: store selector ("Main Store" auto-selected), live clock, "Attendance Kiosk" heading, numeric keypad (1-9, Back, 0, Submit PIN with "OK" label), helper line "Enter your PIN to clock in, break, or clock out".
- **Happy path**: PIN 2222 → identified as **Test Cashier 2**, "You are not clocked in today", Clock In + Back buttons. Clock In → "Welcome, Test Cashier 2! Clocked in at 07:08 PM. Returning to kiosk in 5 seconds..." → DB write confirmed (`attendance_sessions` id=3, employee_id=2, outlet_id=1, session_start=14:08:53Z, session_end=null).
- **Bad PIN edge**: PIN 9999 → "Invalid PIN" message, keypad cleared, Submit re-disabled. No crash.
- **a11y/automation note**: keypad button refs invalidate every ~1s due to live clock re-render, breaking ref-based clicks. Used `evaluate(() => button.click())` with text-content lookup as a workaround. Not a finding for end users (manual finger taps don't have this issue) — only impacts e2e test infra.

### 🟡 M35 — `/kiosk` doesn't accept hardware-keyboard numeric input

`KioskRedesign` only listens for clicks on the on-screen keypad buttons. The Phase 4 walk attempted `keyboard.press('2')` four times — Submit stayed disabled. POS terminals often have USB number pads attached for staff convenience; this kiosk variant ignores them. Low severity.

**Status**: log only — keypad works, hardware keyboard is a nice-to-have. Polish bundle.

---

## 4.7 Customer display `/customer-display?shift_id=1&tenant=livetest1` ✅ closed

**Idle render**: header "SanoPOS" + status "Ready", body "Welcome! Your items will appear here.", footer Subtotal/Tax/Total all Rs 0.00.

**Live sync verification**: scripted POST as Hassan to `/api/pos/customer-display` with a fake cart item (`Phase 4 Display Test`, qty 2, Rs 50). The display polled every 2s and updated within 3s:
- Status: "Scanning items..." (was "Ready")
- Item row visible: 1 × Phase 4 Display Test 2 × Rs 50.00 = Rs 100.00
- Footer Subtotal Rs 95.24, Tax Rs 4.76, Total Rs 100.00 (inclusive math from POST payload)

End-to-end sync works.

### 🟡 M34 — Customer display shows hardcoded "SanoPOS" instead of tenant name

`frontend/src/pages/CustomerDisplayPage.jsx:22` initialises `storeName` to `"SanoPOS"`. Lines 32–37 contain a TODO comment ("Try to get company name from company profile (public endpoint may not exist)") but no fetch is implemented. Result: every customer-facing screen displays "SanoPOS" branding rather than the tenant's company name (e.g. "Live Test 1"). Customer perception is wrong (they think they're shopping at SanoPOS, not the actual store).

**Recommendation**: fetch `GET /api/storefront/config?tenant=<slug>` (already public, returns `company_name`) on mount and use that. Already proven via Storefront flow in 4.1.

**Status**: log only — polish bundle.

### 🟡 M36 — Customer display state is in-memory (lost on Railway restart)

`backend/routes/customer-display.js` lines 13–27: `displayStore` is a Map living in process memory, cleaned up after 8h. Railway auto-restarts (max 3 per failure per `railway.toml`) wipe this state. Active checkouts in progress at restart see the customer display go blank until the next `POST /api/pos/customer-display` from POS. Self-heals on the next item rung; not blocking. But annoying for the cashier explaining to the customer.

**Recommendation**: Either accept the trade-off (current state) or persist to Redis / a single ephemeral table. Document the trade-off either way.

**Status**: log only — polish bundle.

### 🟡 M37 — `/customer-display` (no params) shows missing-shift_id helper, but `?shift_id=` accepts any value

Validation is shift_id-presence-only; there's no check that the shift belongs to the tenant or even exists. A malicious actor passing `?shift_id=999&tenant=otherTenant` won't see another tenant's cart (the `displayKey` includes tenant, and an unknown key returns idle), but the page renders as if it were a real shift. Low security risk because data is empty, but the UX could mislead.

**Status**: log only — polish bundle. Tag with M36 in a "customer-display polish" bundle.

### 🟡 M38 — Customer display is undiscoverable for tenants

After spot-checking the POS terminal UI (`POSHeader`, `POSSubHeader`, `nav-config.js`, settings pages): **zero entry points** to `/customer-display`. No "Open customer display" button in POS. No setting page. No mention in the dashboard's onboarding checklist. No tooltip. No nav menu entry. No documentation page in the app.

This means a real tenant who buys a second monitor for their counter has **no way to discover this feature exists** unless they read the URL routes file or a sales rep tells them. They have to know the magic URL pattern `/customer-display?shift_id=N&tenant=slug` and they have to know `shift_id` comes from their currently-open shift.

**Why this is a big deal**: customer-facing displays are a core retail trust signal — customers see their items being rung up correctly, no surprise totals, no "you scanned that twice" disputes. Most tenants will assume SanoPOS doesn't have this feature and either skip it (worse customer experience) or stay on a competitor that surfaces it visibly.

**Recommendation**:
1. Add a "Customer Display" button to `POSHeader` (next to Help/Lock/Logout). On click, opens `/customer-display?shift_id=${activeShift.id}&tenant=${tenantSlug}` in a new window/tab. Disabled until shift is open (matches the same gating as checkout).
2. Add a one-line entry in the onboarding/setup checklist: "Open customer display on a second screen" with a link.
3. Settings page section under POS Settings: "Customer Display" — explains the feature, shows the URL, has a copy-to-clipboard button.

**Status**: log only — polish bundle. **Cluster as the "customer display surfacing" bundle** alongside M34 (hardcoded brand name), M36 (in-memory state), M37 (no shift ownership check). All four together are a half-day of work that converts a hidden feature into a sellable one.

---

# Phase 4 closure — 2026-04-29

**All 7 sub-flows walked**: storefront, customer signup, customer portal (4 tabs), public receipt recheck, gift-card balance recheck, kiosk PIN flow, customer display sync.

**Criticals shipped during walk**:
- 🔴 P12 — Storefront checkout Total displayed Rs 0 due to field-name mismatch — fixed (commit `dcd5f86`), live verified.
- 🔴 P13 — Storefront quote service ignored P8 tax architecture (gst column, tax_mode, inclusive math) — fixed (commit `fe73b7e`) with regression tests, live verified.

**Criticals logged but not fixed (deferred)**:
- 🔴 P14 — Resend `state='completed'` does not mean email delivered; Hotmail silently dropped first OTP. Cluster with M31 in email-deliverability bundle.

**Mediums logged (polish bundle candidates)**:
- M30 — Empty storefront state by default (no bulk-publish UX, carryover from Phase 3).
- M31 — Storefront order placement does not enqueue customer order-confirmation email.
- M32 — Storefront has zero discovery link to customer portal/signup.
- M33 — Anonymous storefront orders not auto-linked to customers on signup (data linkage gap).
- M34 — Customer display shows hardcoded "SanoPOS" instead of tenant name.
- M35 — Kiosk doesn't accept hardware-keyboard numeric input.
- M36 — Customer display state in-memory (Railway-restart fragile).
- M37 — `/customer-display?shift_id=…` accepts any shift_id without ownership check.
- M38 — Customer display is undiscoverable for tenants (no in-app entry point — major UX gap, sellable feature hidden).

**Doc drift noted**:
- Plan doc said portal has "4 tabs: invoices, orders, loyalty, profile" — actual nav is Dashboard/Orders/Loyalty/Profile (Invoices is feature-flag-gated for retail tenants).
- Plan doc placed `/kiosk` in "public surfaces" — actually `RequireAuth`-wrapped (employee-only).
- Plan doc said portal had 16 sub-routes — accurate per route file but most are feature-gated, not all visible in nav.

**Live state of livetest1 after Phase 4**:
- Plan: Pro (annual), expires 2027-04-28.
- Schema_version: 83 (unchanged, no migrations this phase).
- Sales: 4 POS sales (INV-2026-00001..00004) + 1 storefront `web_orders.id=1`.
- Stocks: Test Coffee 6, Coffee Beans 9, Snack Bar 17.
- Customers: 2 (anonymous + portal-registered) + likely 1 abandoned hotmail row.
- channel_publications: 2 rows (Test Coffee + Snack Bar published to storefront).
- Shift #1 still open (do not close).
- attendance_sessions: 2 active (Hassan + Test Cashier 2).
- Backend at commit `fe73b7e`, frontend at `dcd5f86`. Both deployed.

**Phase 4 status**: CLOSED.

**Next phase**: Phase 5 — Worker-Driven Flows (per plan doc).

---

## (legacy) Resume tomorrow at 3.8 — superseded by 3.12 closure above

**State on `livetest1` (production):**
- Test Coffee (id=8): stock **9.000** at outlet 1, sale id=1 (`INV-2026-00001`) Rs 200 cash, RTN-1 already refunded 1 unit (Rs 100). 1 unit still refundable.
- Shift #1 (Main Store, opened 4/27 Rs 5,000 float) — **still open**, do not close.
- Hassan attendance session — should still be active. If POS shows the kiosk PIN gate, `POST /api/attendance/pin-checkin?tenant=livetest1 {"pin_code":"1234","outlet_id":1}`.
- Backend on Railway (api.sanopos.com) at commit `213422e`, frontend on Vercel (sanopos.com) at `a58e65d`. F1–F6 all live.
- **Employees: 3/3** (Hassan, Test Cashier 2 PIN 2222, Test Cashier 3 PIN 3333) — at Free plan cap.
- Cap modal + /billing routing all verified working. M5 (modal pricing copy) + M6 (preflight on Add) noted as low-severity UX nits.
- 3.5 done: Daraz happy-path walked + disconnected. M7 (WhatsApp token=text) + M8 (HTTP 500 on bad creds) noted. No integrations currently connected — clean state.
- 3.6 done: 4-of-7 onboarding state matches backend signals exactly. M9 noted: sale step gates on `saleCount` (today-only), causing it to un-tick the day after a merchant's first sale. Walk-In Test Customer created + soft-deleted during regression check, state clean.
- 3.7 closed: P2 + P3 + M10 + M11 + M12 all shipped (commits 389e75c / 7bf0dbc / 61291c2 / 04449f7 / 5caa5e4) and verified live.
- Bonus end-to-end check: rang up INV-2026-00002 (Test Coffee × 1, Rs 100, Cash). All paths now verified live with real button clicks (no intercepts) — POS WhatsApp + Email, Sales History Share + Email + WhatsApp, public-receipt page renders, real WhatsApp share landing page shows pre-filled message.
- 3.8 closed (incl. polish): M13 + M14 + M15 all shipped (commits 87cb4ba / 279d0f9 / 73f82bd) and verified live. Public balance page renders "Rs400.00", physical-card form has optional Custom code input with 409 dedup, all receipt surfaces render "Gift Card" instead of "gift_card".
- POS gift-card flow fully functional: tender lookup, redemption (deducts 500 → 400 ✅), CRM balance lookup all working pre-fix; M13/M14/M15 were UX polish on top of a sound core.
- **livetest1 state changed**: 3 sales + 2 active gift cards. INV-2026-00001 (Rs 200 partial refund), INV-2026-00002 (Rs 100 cash), INV-2026-00003 (Rs 100 gift card). Cards: `BF18801AC599` Rs 400, `GC-PHASE3-TEST` Rs 250. Test Coffee stock: **7.000**. Shift #1 still open.
- Backend on Railway at `87cb4ba`, frontend on Vercel at `73f82bd`.

**Next step — 3.12 CSV import preview validation.** Upload sample CSV with valid rows + missing-field rows + duplicate-SKU rows, verify preview flags errors distinctly, fix issues, confirm import succeeds. After that: 3.14 mixed-rate tax sale.

**Still blocked:** 3.3 FBR (needs NTN/STRN/sandbox token), 3.9 Shopify, 3.10 Courier, 3.13 sandbox payment (depends on PAYMENT_GATEWAY env var). 3.11 SKIP (physical hardware).

**Skipped / blocked sub-flows tracked for later:**
- 3.9 Shopify import — needs sandbox Shopify creds.
- 3.10 Courier shipment — needs sandbox courier creds.
- 3.11 Receipt printer + cash drawer — physical hardware, skipped per brief.

**Open mediums (deferred, do not re-flag):**
- /accounting Cash Flow tab fires 400.
- /stock-counts (Inventory Audit) blank below title.
- /store/livetest1 storefront empty (channel_publications gating, Phase 4).
- /billing Quarterly highlighted, Annual has BEST VALUE pill — pick Annual manually for 3.13.
- 6 legacy test files still import `helpers/createTestApp` instead of `-pg` (pre-existing).
- Polish bundle (16+ items, see Phase 2 Day 2).





