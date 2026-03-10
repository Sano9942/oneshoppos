# Phase 3 Remaining Items — Design Document

*Date: March 10, 2026*
*Status: Approved*

---

## 1. Mobile/Tablet POS Layout

### Problem
POS screen is desktop-only (fixed 320px sidebar, 5-column cart table, 3-column search grid). Unusable on phones (<640px), tight on tablets (768-1024px).

### Design
Two-mode layout switching at `md` (768px) breakpoint.

**Desktop (≥768px)** — unchanged:
- Main area (flex-1) + Sidebar (w-80) side by side

**Mobile (<768px)** — tabbed single-panel:
- 3-tab bar at top: Cart | Search | Customer/Pay
- Active tab content renders full-width
- Sticky bottom pay button always visible regardless of active tab
- `useState` for `activeTab` — only active on mobile (desktop ignores it)

**Component changes:**
- `POSRedesign.jsx`: Add `activeTab` state, wrap main+sidebar in responsive container
- `POSHeader.jsx`: Collapse to icons on mobile, hide employee name (already has `hidden sm:block`)
- `POSSidebar.jsx`: `hidden md:flex` on desktop wrapper, full-width on mobile tab
- `POSCartTable.jsx`: 5 cols → 3 cols on mobile (Product | Qty | Total), hide Unit Price + Action cols
- `POSSearchArea.jsx`: 3-col grid → stacked on mobile (`grid-cols-1 md:grid-cols-3`)
- `POSSubHeader.jsx`: Stack vertically on mobile, hide date display

### Files
`POSRedesign.jsx`, `POSHeader.jsx`, `POSSidebar.jsx`, `POSCartTable.jsx`, `POSSearchArea.jsx`, `POSSubHeader.jsx` — CSS class changes + small `activeTab` state wrapper.

---

## 2. IP Allowlisting for /api/admin

### Problem
Super-admin endpoints (`/api/admin/*`) are public on the internet with only JWT password protection.

### Design
Env-var-based IP allowlist middleware applied to admin routes only.

- New env var: `ADMIN_ALLOWED_IPS` — comma-separated IPs or CIDR ranges (e.g. `192.168.1.0/24,203.0.113.5`)
- If unset/empty → all IPs allowed (backward compatible, no breaking change)
- Middleware reads `req.ip` (Express respects `X-Forwarded-For` when `trust proxy` is set)
- Add `app.set('trust proxy', 1)` in `index.js` (Railway runs behind reverse proxy)
- Returns `403 { error: "IP not allowed" }` if blocked
- Applied in `admin.js` before `requireSuperAdmin`

### CIDR Matching
Use Node's built-in `net.isIP()` + simple CIDR match function (no external dependency). Support IPv4 only (Railway/Vercel are IPv4).

### Files
`backend/routes/admin.js` (middleware), `backend/index.js` (`trust proxy`)

---

## 3. Stock Discrepancy / Shrinkage Report

### Problem
No automated reconciliation of expected vs actual stock. Users rely on manually recorded `stock_adjustments` which only shows known losses, not mysterious variances.

### Design

**Backend** — `GET /api/reports/shrinkage` in `routes/reports/inventory.js`:
- Required params: `date_from`, `date_to`
- Optional: `outlet_id` (comma-separated), `category_id`, `search`
- Per product per outlet, calculates:
  - `opening_qty` = current stock reversed by all movements in date range
  - `purchases_qty` = SUM(grn_items.qty_received) in range
  - `sales_qty` = SUM(sale_items.quantity) in range
  - `returns_qty` = SUM(return_items.quantity) in range
  - `transfers_in` = SUM(transfers WHERE to_outlet) in range
  - `transfers_out` = SUM(transfers WHERE from_outlet) in range
  - `adjustments_qty` = SUM(stock_adjustments.quantity_change) in range
  - `expected_qty` = opening + purchases + returns + transfers_in - sales - transfers_out + adjustments
  - `actual_qty` = current outlet_stock.quantity
  - `variance` = actual - expected
  - `variance_value` = variance × cost_price
- Opening stock derivation: `actual - purchases - returns - transfers_in + sales + transfers_out - adjustments` (reverse all movements from current)
- Uses `toUtcStart`/`toUtcEnd` for UTC timestamp columns (sales, returns, adjustments, transfers); GRN uses local time columns

**Frontend** — new `ShrinkageTab` in `ReportsInventory.jsx`:
- Table columns: Product, Barcode, Outlet, Opening, Purchases, Sales, Returns, Transfers, Adjustments, Expected, Actual, Variance, Variance Value
- Color-coded variance: red for negative (shrinkage), green for zero/positive
- Summary row: total shrinkage value
- Filters: outlet, category, date range

### Files
`backend/routes/reports/inventory.js` (new endpoint), `frontend/src/pages/reports/ReportsInventory.jsx` (new tab)

---

## 4. Customer-Facing Display

### Problem
No way to show customers what's being rung up during checkout. Customer-facing displays build trust and reduce disputes.

### Design
Standalone route at `/customer-display` — poll-based, no WebSocket needed.

**Backend** — `backend/routes/customer-display.js`:
- In-memory Map keyed by `shift_id` → current cart state
- `POST /api/pos/customer-display` — POS pushes cart state (items, totals, payment status)
- `GET /api/pos/customer-display?shift_id=X` — display page polls every 2s
- No auth required on GET (read-only, shows only item names + prices)
- POST requires auth (only POS cashier can update)
- Auto-cleanup: entries expire after 8 hours (shift length)

**Frontend** — `frontend/src/pages/CustomerDisplayPage.jsx`:
- Clean, large-font design optimized for readability on secondary screen
- Shows: store name/logo, item list with prices, subtotal/tax/total, payment status ("Waiting..." / "Paid ✓")
- Route at `/customer-display?shift_id=X` — no sidebar, no header, full-screen
- Cashier opens in second browser window on customer-facing monitor

**POS Integration** — `POSContext.jsx`:
- `useEffect` posts cart state to `/api/pos/customer-display` whenever cart changes
- Debounced (500ms) to avoid flooding during rapid scanning

### Files
`backend/routes/customer-display.js` (new), `backend/routes/registerAllRoutes.js` (mount), `frontend/src/pages/CustomerDisplayPage.jsx` (new), `frontend/src/App.jsx` (route), `frontend/src/pages/redesign/pos/POSContext.jsx` (push cart state)

---

## 5. API Key / Token Revocation

### Problem
No way to invalidate a specific employee's access token without changing their PIN or waiting for expiry. If a device is lost or an employee is terminated, their token remains valid for up to 24 hours.

### Design

**Migration** — `migrate74.js`:
- Add `revoked_tokens` table: `id, token_jti TEXT UNIQUE, employee_id INTEGER, revoked_by INTEGER, reason TEXT, revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP`
- Add `tokens_revoked_before DATETIME` column to `employees` table (for bulk revoke)
- Index on `token_jti` for fast lookup

**JWT Changes** — `backend/jwt-auth.js`:
- `signAccessToken` now includes `jti` claim (UUID via `crypto.randomUUID()`)
- Existing tokens without `jti` are unaffected (backward compatible)

**Middleware** — `backend/index.js`:
- After JWT decode, check if `decoded.jti` exists in `revoked_tokens` → 401 if found
- Also check if employee has `tokens_revoked_before` set and token `iat` < that timestamp → 401
- Only runs when `MULTI_TENANT=1` (single-tenant uses header-based auth, no JWT)

**Endpoints** — `backend/routes/employees.js`:
- `POST /api/employees/:id/revoke-token` — revoke specific token by jti (admin only)
- `POST /api/employees/:id/revoke-all-tokens` — sets `tokens_revoked_before = NOW()` on employee (admin only)

**Frontend** — `EmployeesRedesign.jsx`:
- "Revoke All Sessions" button on employee detail (admin only)
- Confirmation modal with reason field

**Cleanup**: Periodic deletion of expired entries from `revoked_tokens` (tokens older than 24h are already expired, no need to keep). Done on INSERT via `DELETE FROM revoked_tokens WHERE revoked_at < datetime('now', '-2 days')`.

### Files
`backend/migrate74.js`, `backend/jwt-auth.js`, `backend/index.js`, `backend/routes/employees.js`, `backend/run_migrations.js`, `frontend/src/pages/redesign/EmployeesRedesign.jsx`

---

## Parallel Execution Plan

| Agent | Items | Non-overlapping files |
|-------|-------|-----------------------|
| A | Mobile POS layout | POS frontend components only |
| B | IP allowlist + API key revocation | admin.js, index.js, jwt-auth.js, employees.js, migrate74 |
| C | Shrinkage report | reports/inventory.js, ReportsInventory.jsx |
| D | Customer-facing display | customer-display.js (new), CustomerDisplayPage.jsx (new), POSContext.jsx |

**Conflict note**: Agent A (POSContext CSS) and Agent D (POSContext cart push) both touch `POSContext.jsx` — Agent D adds a `useEffect` at the end, Agent A doesn't touch POSContext. Safe to parallelize.
