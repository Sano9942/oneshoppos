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
