# Xstak Feature Implementation Plan

**Last Updated: 2026-02-24 (Phase 2 ✅ Phase 3 ✅ Phase 4 ✅ Phase 5 ✅ Phase 6 ✅)**

---

## Codebase Audit Results — What's Already Built

| Feature                                 | Status     | Finding                                                                                             |
| --------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| **Park Sale**                           | ✅ Built   | `POS.jsx` has full park/restore logic via `localStorage`. RBAC `pos_park` exists.                   |
| **Product Variants (POS UI)**           | ✅ Built   | `POS.jsx` has variant selection modal, fetches `/api/products/:id/variants`                         |
| **Attribute Sets**                      | ✅ Built   | Full CRUD API + `AttributeSets.jsx` page with create/edit/delete. Sidebar enabled.                  |
| **Product Variants (backend)**          | ✅ Built   | All 5 tables + APIs. Variant creation at product-level. POS variant selector works.                 |
| **Loyalty Points**                      | ✅ Complete | Points saved, customer balance updated, `total_amount` now correctly deducts redemption.            |
| **Min/Max QTY, Unit**                   | ✅ Done    | Added in Phase 1 — columns in DB, backend, and frontend form + table                                |
| **PO Due Date**                         | ✅ Done    | Added in Phase 1 — column in DB, date picker in Create PO form                                      |
| **Customer CNIC/Occupation/Balance**    | ✅ Done    | Added in Phase 1 — columns in DB, backend, and customer form                                        |
| **Order Notes**                         | ✅ Done    | Added in Phase 1 — `notes` column in `sales`, POS sends it on checkout                              |
| **Tax toggle in POS**                   | ✅ Built   | `isTaxInclusive` state already in `POS.jsx` — toggling via toolbar button                           |
| **Dashboard charts / Top Sales People** | ❌ Missing | Not built                                                                                           |
| **Export CSV**                          | ❌ Missing | Not on any page                                                                                     |
| **Bulk CSV Import**                     | ❌ Missing | Not built                                                                                           |

---

## Implementation Phases

### ✅ Phase 1 — Quick DB Column Additions _(COMPLETE)_

**Migration file: `migrate26.js`** — ran successfully on 2026-02-24

Added 10 columns across 4 tables:

```sql
-- Products
ALTER TABLE products ADD COLUMN min_qty INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN max_qty INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN unit TEXT DEFAULT 'pcs';

-- Purchase Orders
ALTER TABLE purchase_orders ADD COLUMN due_date TEXT;

-- Customers
ALTER TABLE customers ADD COLUMN cnic TEXT;
ALTER TABLE customers ADD COLUMN occupation TEXT;
ALTER TABLE customers ADD COLUMN balance REAL DEFAULT 0;

-- Sales
ALTER TABLE sales ADD COLUMN notes TEXT;
ALTER TABLE sales ADD COLUMN points_earned INTEGER DEFAULT 0; -- (already existed, skipped)
ALTER TABLE sales ADD COLUMN points_redeemed INTEGER DEFAULT 0; -- (already existed, skipped)
```

**Backend changes completed (`index.js`):**

- Products POST/PUT: now accept `min_qty`, `max_qty`, `unit`
- Purchase Orders POST: now accepts `due_date`
- Customers POST/PUT: now accept `cnic`, `occupation`, `balance`
- Sales POST: now accepts `notes`, already handled `points_earned`/`points_redeemed`

**Frontend changes completed:**

- `Inventory.jsx`: Unit + Min QTY table columns; Unit/Min QTY/Max QTY form fields in modal
- `PurchaseOrders.jsx`: Due Date date picker in Create PO panel
- `Customers.jsx`: CNIC + Occupation form fields in modal
- `POS.jsx`: Order note now sent in sale POST body

---

### ✅ Phase 2 — Product Variants Backend _(COMPLETE — 2026-02-24)_

**What was already built (pre-existing):**
- `migrate27.js` — all 5 tables: `attribute_sets`, `attributes`, `attribute_options`, `product_variants`, `variant_option_values`
- `GET /api/attribute-sets`, `POST /api/attribute-sets`, `DELETE /api/attribute-sets/:id`
- `GET /api/products/:id/variants`, variant creation inside `POST /api/products`
- `AttributeSets.jsx` page (create + list), route `/attribute-sets` in App.jsx
- POS.jsx variant selector modal, Inventory.jsx attribute set picker + variant generator

**Added this session:**
- `PUT /api/attribute-sets/:id` — full replace of attributes+options via transaction (`index.js:2982`)
- Edit UI in `AttributeSets.jsx` — dual-purpose create/edit modal, Edit2 button per row
- Enabled sidebar nav item (`AppLayout.jsx:197` — removed `disabled: true`)

**Deferred (separate task):**
- Variant editing on existing products (reload variants in edit modal, PUT/DELETE per variant)

---

### ✅ Phase 3 — Loyalty Points Backend Integration _(COMPLETE — 2026-02-24)_

**Audit finding:** Almost everything was already built. Only one bug was missing.

**What was already built (pre-existing):**
- `customers.loyalty_points` column (migrate24.js)
- `sales.points_earned` / `sales.points_redeemed` columns (migrate24.js)
- POST /api/sales accepts + saves both fields; UPDATE customers.loyalty_points after sale (`index.js:1732-1740`)
- POS.jsx sends both fields; deducts `pointsRedeemed` from displayed total
- Customers.jsx shows loyalty_points badge + manual adjustment UI

**Fixed this session:**
- `index.js:1633` — `totalAmount` was not subtracting `points_redeemed` before saving to DB. Fixed:
  ```js
  // Before
  const totalAmount = subtotal - discountValue;
  // After
  const totalAmount = subtotal - discountValue - parseFloat(points_redeemed || 0);
  ```
  Now `sales.total_amount` reflects what the customer actually paid.

---

### ✅ Phase 4 — Dashboard: Top Sales People + Chart _(COMPLETE — 2026-02-24)_

**Backend added:**
- `GET /api/reports/top-salespeople?date_from&date_to` — `index.js` after line 2079; returns `{ salespeople: [{ employee_name, transactions, revenue, items_sold, avg_basket }] }`
- `salesTrend` array added to `GET /api/reports/dashboard` response — last 7 days of `{ day, revenue, sale_count }`

**Frontend added (`Dashboard.jsx`):**
- Installed `recharts@3.7.0`
- **Sales Trend bar chart** (full width, last 7 days, fills missing days with 0, custom tooltip)
- **Top Sales People** table widget (rank, name, revenue, transactions, avg basket)
- Layout changed from 2-col to 3-col bottom grid: [Top Sales People | Top Selling Products | Low Stock Alerts]

---

### ✅ Phase 5 — Export CSV _(COMPLETE — 2026-02-24)_

**Frontend-only** — no backend API needed. Added `exportCSV` helper and "Export CSV" button to:
- `Inventory.jsx` — exports barcode, name, price, cost_price, gst, stock, min_qty, max_qty, unit → `inventory.csv`
- `Customers.jsx` — exports name, mobile, email, address, cnic, occupation, loyalty_points, total_spent, order_count → `customers.csv`
- `PurchaseOrders.jsx` — exports id, supplier, total_cost, status, due_date, created_at → `purchase-orders.csv`

Each page has its own local `exportCSV` helper (avoids shared utility complexity). Button sits to the left of the primary action button in each page header.

---

### ✅ Phase 6 — Bulk CSV Product Import _(COMPLETE — 2026-02-24)_

**Backend (`index.js`):**
- `POST /api/products/bulk-import` — accepts `{ rows: [{barcode,name,price,...}] }`, upserts by barcode using SQLite `ON CONFLICT(barcode) DO UPDATE SET`, processes rows sequentially via recursion, returns `{ results: [{ barcode, name, status: "inserted"|"updated"|"error" }] }`

**Frontend (`Inventory.jsx`):**
- `parseCSV()` helper — hand-rolled parser (handles quoted fields with commas), no external library
- `handleImport()` — reads file via `FileReader`, parses CSV, POSTs to bulk-import, refreshes product list
- "Bulk Upload" label-as-button triggers hidden `<input type="file" accept=".csv">` — no extra modal needed
- Inline results panel appears below header after import: color-coded inserted/updated/error rows with dismiss button

**CSV format:**
```
barcode,name,price,cost_price,gst,stock,min_qty,max_qty,unit
```

---

### 🔲 Phase 7 — Receipt Template Designer _(~3 hrs)_

**DB:**

- `receipt_templates` table: `id, name, header_text, footer_text, show_barcode, show_logo, is_active`

**Backend:**

- CRUD at `/api/receipt-templates`
- `GET /api/receipt-templates/active` — used by POS print

**Frontend:**

- New settings page `ReceiptTemplates.jsx` with live preview panel
- POS print function reads active template instead of hardcoded HTML

---

## Phase Status Summary

| #   | Phase                                                       | Effort | Value  | Status  |
| --- | ----------------------------------------------------------- | ------ | ------ | ------- |
| 1   | Quick DB columns (min/max qty, unit, due date, CNIC, notes) | Small  | High   | ✅ Done |
| 2   | Product Variants backend (attribute-sets API)               | Medium | High   | ✅ Done |
| 3   | Loyalty points wired to customer balance                    | Small  | High   | ✅ Done |
| 4   | Dashboard top salespeople + chart                           | Small  | Medium | ✅ Done |
| 5   | Export CSV (all pages)                                      | Small  | Medium | ✅ Done |
| 6   | Bulk CSV product import                                     | Medium | High   | ✅ Done |
| 7   | Receipt Template designer                                   | Large  | Low    | 🔲      |

---

## Verification After Each Phase

1. Run `node e2e_test.js` — confirm 14/14 still pass
2. Spot-check changed UI in the browser
3. Run `npx eslint src/` — confirm 0 errors
