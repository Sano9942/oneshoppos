# OneShopPOS — Testing Record

All testing done manually and via automated scripts. Updated after each session.

---

## Phase 6 Comprehensive Audit — 2026-02-24

### ESLint (Automated)

```
Command: npx eslint src/
Result:  Exit code 0 — 0 errors, 0 warnings
```

All 16 frontend source files pass cleanly.

---

### E2E Automated Test Suite

**Script:** `backend/e2e_test.js`  
**Run:** `node e2e_test.js` (from `backend/` directory, with server running)  
**Date:** 2026-02-24  
**Result: 14/14 PASSED**

```
=== Phase 6: E2E + RBAC Test Suite ===

✅ PASS: Admin role has permissions
✅ PASS: Admin has all_access
✅ PASS: Cashier role does NOT have all_access
✅ PASS: Cannot delete system role 1 (Admin)
✅ PASS: Outlets list available
✅ PASS: Products list available
   ℹ  Using product: "API Brand Test Item" with stock: 10
✅ PASS: Employee PIN validation works
✅ PASS: Sale creation returns 200
   ℹ  Sale ID created: 12
✅ PASS: Stock decremented after sale
✅ PASS: Sale void returns 200
✅ PASS: Stock restored after void
✅ PASS: Sales reports endpoint works
✅ PASS: Action history endpoint works
✅ PASS: Supplier returns endpoint works

=== Results: 14 passed, 0 failed ===
```

---

### RBAC Security Tests

| Test                                              | Expected      | Result                     |
| ------------------------------------------------- | ------------- | -------------------------- |
| Admin role (ID 1) has `all_access`                | ✅ Yes        | ✅ Pass                    |
| Cashier role (ID 3) does NOT have `all_access`    | ✅ No         | ✅ Pass                    |
| DELETE `/api/roles/1` (system role)               | 400 error     | ✅ Pass                    |
| POS Manager Override fires for restricted actions | Modal appears | ✅ Pass (browser-verified) |
| Frontend nav hides restricted items for Cashier   | Items hidden  | ✅ Pass (browser-verified) |

---

### UI/UX Visual Audit — Browser

| Page              | What Was Checked                      | Result  |
| ----------------- | ------------------------------------- | ------- |
| `/pos`            | PIN login, unlock with 1234           | ✅ Pass |
| `/` (Dashboard)   | KPI cards, shift banner, sidebar nav  | ✅ Pass |
| `/inventory`      | Product table, add button, pagination | ✅ Pass |
| `/customers`      | Loyalty points column, empty state    | ✅ Pass |
| `/action-history` | Table renders, data loads             | ✅ Pass |
| `/returned-stock` | Form visible, RMA list loads          | ✅ Pass |
| `/administrator`  | Role cards (Admin, Manager, Cashier)  | ✅ Pass |
| POS unlocked      | Cart, search, checkout flow           | ✅ Pass |

---

### End-to-End Business Workflow — Verified

The following real-world workflow was tested and confirmed working end-to-end:

1. **Open Register:** Dashboard → Open Shift with float amount ✅
2. **POS Login:** Employee PIN entry (PIN: 1234) → unlocks terminal ✅
3. **Auto Clock-In:** Attendance record created on PIN login ✅
4. **Barcode Scan / Product Search:** Product found, added to cart ✅
5. **Apply Discount:** Fixed ($) and % discount applied, live total preview ✅
6. **Multi-Tender Checkout:** Split Cash + Card payment ✅
7. **Customer Linkage:** Customer selected at checkout, linked to sale ✅
8. **Receipt Print:** Thermal-style print triggered from checkout ✅
9. **Stock Decrement:** `outlet_stock` reduced by sold quantity ✅ (E2E verified via API)
10. **Void Sale:** Sale voided with reason, stock restored ✅ (E2E verified via API)
11. **Supplier Return (RMA):** New return filed against supplier ✅
12. **GRN / Purchase Receiving:** PO created, received via GRN modal, stock incremented ✅
13. **Lock Register:** Employee clocked out, attendance record closed ✅
14. **Close Shift:** Float reconciliation, variance calculated ✅
15. **Reports:** Sales Summary, Order Wise, GRN Report — all load with correct data ✅

---

### Previous Session Tests (Earlier Build Phases)

| Test                               | Date          | Result      |
| ---------------------------------- | ------------- | ----------- |
| Returns API: POST/GET/GET-detail   | Prior session | ✅ All pass |
| GRN creation and stock update      | Prior session | ✅ Pass     |
| Multi-tender payment split         | Prior session | ✅ Pass     |
| Discount calculation (fixed + %)   | Prior session | ✅ Pass     |
| Attendance auto clock-in/out       | Prior session | ✅ Pass     |
| Low stock alert on dashboard       | Prior session | ✅ Pass     |
| Inventory transfer between outlets | Prior session | ✅ Pass     |

---

## Known Test Gaps (Future Work)

- [ ] No automated browser integration tests (Playwright / Cypress)
- [ ] No unit tests for helper functions
- [ ] `api_test.js` (earlier script) found `/api/stock-adjustments` returns 404 on invalid qty type instead of 400 — not yet fixed
- [ ] Returns processing via POS qty `-` button not formally tested via script

---

## Full Coverage Audit (Forced Restart + New Features) - 2026-02-24

### Environment Reset (Executed First)

1. Checked listeners on `:5000` and `:5173`
2. Detected backend listener on `:5000` (`node index.js`, PID 12840)
3. Stopped only confirmed app listener process on `:5000`
4. Restarted app using `START.bat` from project root
5. Readiness gates:
   - `GET http://localhost:5000/api/outlets` -> `200` (PASS)
   - `http://localhost:5173` responded (PASS)

### Automated Commands Run

```bash
npm run lint
node e2e_test.js
node e2e_full_test.js
npm run test:e2e-full
```

### Automated Results Summary

- `node e2e_test.js` -> **14 passed, 0 failed**
- `node e2e_full_test.js` -> **61 passed, 1 failed**
- `npm run test:e2e-full` -> **61 passed, 1 failed**
- `npm run lint` -> **0 errors, 2 warnings**

### New Feature Coverage Added in `e2e_full_test.js`

| Feature / Endpoint                                         | Status |
| ---------------------------------------------------------- | ------ |
| Product extended fields (`min_qty`, `max_qty`, `unit`)    | PASS   |
| Bulk import endpoint (`POST /api/products/bulk-import`)   | PARTIAL (1 assertion fail) |
| Attribute Sets full lifecycle (`POST/PUT/GET/DELETE`)     | PASS   |
| Loyalty totals + points math (`POST /api/sales`)          | PASS   |
| Dashboard trend + top salespeople reports                 | PASS   |
| Receipt templates lifecycle + active switch               | PASS   |
| Baseline RBAC + sale/void stock restore regression        | PASS   |

### Failing Check (Action Required)

- **`Bulk import has updated row` failed**
  - API response did not include a row labeled `"updated"` in `results`.
  - Functional verification confirmed the existing row was updated in DB.
  - Likely defect is status labeling in bulk-import response.

### Retained Test Data (Could Not Fully Auto-Clean)

From `e2e_full_test.js` cleanup output:

- Products: IDs `20, 21, 24, 25, 26, 29` failed delete with status `500`
- Customers: IDs `2, 3` failed delete with status `400`

Reason: linked sales/sale_items and non-cascade cleanup behavior in current schema/API path.

### Manual UI Checklist (Exhaustive) - Pending Browser Execution

Manual browser interactions still required:

- POS: PIN login, tax toggle, park/restore sale, note, checkout, receipt print
- Dashboard: KPI cards, sales trend chart, top salespeople widget
- Inventory: min/max/unit fields, export CSV, bulk upload result panel
- Attribute Sets: create/edit/delete flow
- Receipt Templates: create/edit/set active/delete
- Customers: CNIC/occupation/balance persistence
- Purchase Orders: due date create/listing
- Reports: critical tabs render with data
- RBAC: restricted nav behavior in cashier session

### Rerun After Fixes (2026-02-24)

Applied fixes:

- Bulk import response labeling fixed in `POST /api/products/bulk-import` (insert vs update detection)
- `e2e_full_test.js` hardened with direct DB hard-cleanup by run tag
- One-time cleanup executed for prior `E2E_FULL_%` leftovers

Verification:

```bash
npm run test:e2e-full
```

Result:

- **62 passed, 0 failed**
- **Retained test data: none**

Cleanup verification queries:

- Tagged products (`name LIKE 'E2E_FULL_%'`): `0`
- Tagged customers (`name LIKE 'E2E_FULL_%'`): `0`
- Previously retained IDs (`20,21,24,25,26,29` products; `2,3` customers): removed

---

## Phase 12 Validation Run (Latest - 2026-02-24)

### Commands Run

```bash
npm run preflight
npm run test:e2e-full
```

### Results

- `npm run preflight` -> **PASS**
- `npm run test:e2e-full` -> **69 passed, 0 failed**

### Added Coverage in Latest E2E Cycle

- Health endpoint readiness:
  - `GET /api/health`
- Invoice export contract:
  - `GET /api/sales/:id/invoice/export`
  - validates `version`, `items[]`, and numeric totals
- Permission-aware assertions hardened for environments where admin permissions are not seeded in `role_permissions`

### Notes

- A backend query mismatch (`customers.phone` vs `customers.mobile`) that caused export `500` was fixed before the final run.
- Full suite completed with no retained test data.

---

## Shopify Connector Test Matrix (Current)

### What Was Executed

1. Backend syntax/static checks
- `node --check backend/index.js` (multiple iterations after Shopify connector updates)
- `node --check backend/shopify/client.js`
- `node --check backend/migrate41.js`
- `node --check backend/migrate42.js`
- `node --check backend/migrate43.js`
- `node --check backend/migrate44.js`
- `node --check backend/migrate45.js`

2. Frontend lint checks
- `npx eslint src/pages/ShopifyIntegration.jsx`
- `npx eslint src/App.jsx src/components/AppLayout.jsx src/pages/Orders.jsx`

3. Migration execution checks (applied successfully)
- `node migrate41.js`
- `node migrate42.js`
- `node migrate43.js`
- `node migrate44.js`
- `node migrate45.js`

4. Functional smoke checks (local)
- Shopify integration route and page render
- Connection save/disconnect flow (without requiring live token)
- Manual sync actions reachable from UI
- Retry failed queue endpoint wired and callable
- Single-event retry endpoint wired and callable
- Sync event filters (status/entity/direction/search) wired in UI
- Reconciliation run/read/resolve endpoints wired and callable
- Reconciliation corrective actions wired with approval flow in UI/backend:
  - request push local -> Shopify
  - request pull Shopify -> local
  - approve/reject from approvals workflow
- Mapping review workflow wired in UI:
  - include/exclude suggestions before apply
  - backend conflict report handling
- Live validation + readiness flows wired:
  - `/api/integrations/shopify/live-validation`
  - `/api/integrations/shopify/webhooks/setup`
  - `/api/integrations/shopify/uat-checklist`
- Queue health metrics surfaced:
  - `dead_letter`, `retry_due`, `backlog`, `oldest_backlog_minutes`
- Reconciliation audit endpoint wired:
  - `/api/reconciliation/inventory/:id/audit`
- Shopify utility unit tests added:
  - `node backend/shopify_utils_test.js`
- Mocked Shopify integration tests added:
  - `node backend/shopify_mock_integration_test.js`

### What Was Not Executed Yet

1. Live Shopify store E2E (real credentials)
- Verify connection against real `*.myshopify.com` domain with valid token
- Real inventory mutation (`inventoryAdjustQuantities`) validation in Shopify Admin
- Real location and variant catalog reads with production-like data

2. Live webhook delivery tests
- Real `orders/create` webhook delivery from Shopify Admin
- Signature validation with actual Shopify header/payload stream
- Replay window behavior with captured real webhook timestamps

3. Connector automated tests
- Unit tests for:
  - encryption/decryption helpers
  - webhook signature/replay checks
  - retry/backoff transitions (`pending` -> `retry` -> `dead_letter`)
  - inbound web-order stock policy transitions
- Integration tests for reconciliation fetch + mismatch persistence
- Note: mocked integration coverage now exists for Shopify client + webhook payload validation;
  real API integration and live-store flows remain pending.

4. Full post-connector regression
- Full browser/UAT pass across POS + Shopify integration features in one runbook

### Pending UAT Evidence Checklist (To Collect)

- [ ] Screenshot/video: successful Shopify connection verification
- [ ] Screenshot/video: live locations loaded from Shopify
- [ ] Screenshot/video: live mapping suggestions generated and applied
- [ ] Evidence: outbound event created after POS sale and marked `processed`
- [ ] Evidence: outbound event retry path (`retry` then `processed` or `dead_letter`)
- [ ] Evidence: single-event retry action works from UI and updates event state correctly
- [ ] Evidence: inbound webhook creates/updates `web_orders` and respects idempotency
- [ ] Evidence: stock policy applies once on paid/open, reverses on cancelled/refunded
- [ ] Evidence: reconciliation run shows matched/mismatch rows from live Shopify quantities
- [ ] Evidence: reconciliation row resolve/ignore updates persisted
- [ ] Evidence: reconciliation fix request appears in approvals and approve/reject updates request status
- [ ] Evidence: same employee cannot approve/reject their own reconciliation fix request (403 expected)
- [ ] Evidence: approved reconciliation corrective action updates target system and row status
- [ ] Evidence: mapping conflict review prevents incorrect bulk apply and logs conflicts
- [ ] Evidence: live-validation endpoint returns pass/fail checks against real Shopify store
- [ ] Evidence: webhook setup callback URL/topics copied into Shopify admin and subscription test succeeds
- [ ] Evidence: UAT checklist reflects runtime stats after successful sync activity
- [ ] Evidence: reconciliation audit endpoint shows structured approve/reject metadata
- [ ] Final signed UAT report with environment details (shop domain, API version, date/time)
