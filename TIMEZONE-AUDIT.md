# SanoPOS Timezone Audit & Fix Plan (v3 — Final)

**Date:** 2026-03-08
**Status:** PENDING APPROVAL
**Revision:** v3 — adds SQLite `'localtime'` grouping flaw (Section G), SaaS cache bug (Section H), write-path design debt (Section I), and correction plan refinements

---

## The Root Problem

The database has **two timestamp storage systems** with no enforcement or documentation of which columns use which system. Every new query is a guessing game, and we keep writing the wrong pattern for the wrong column type.

| Storage System | SQLite DEFAULT | Example Tables |
|---|---|---|
| **UTC** | `CURRENT_TIMESTAMP` | `sales`, `returns`, `cash_shifts`, `stock_adjustments`, `inventory_transfers`, `purchase_orders`, `customers`, `roles`, `product_variants`, `supplier_returns`, `action_history` |
| **LOCAL** | `datetime('now','localtime')` | `employee_attendance`, `attendance_sessions`, `goods_received_notes`, `supplier_invoices`, `supplier_payments`, `expenses`, `parked_sales`, `promotions`, `notifications`, `quotations`, `crm_leads`, ALL Shopify tables, ALL Tier4 audit tables |

The split is roughly 50/50 across the schema, making it impossible to have a "default assumption."

### Correct Query Patterns

| Column Type | Correct Filtering | Correct Display (SQL) | Correct Display (Frontend) |
|---|---|---|---|
| **UTC** | `col >= toUtcStart(date, tz)` / `col < toUtcEnd(date, tz)` | `date(col, 'localtime')` for GROUP BY | `fmtUtcDateTime()` (appends 'Z') |
| **LOCAL** | `date(col) >= ?` / `date(col) <= ?` with plain `YYYY-MM-DD` | `date(col)` — NO 'localtime' modifier | `fmtLocalDateTime()` (no 'Z') |

---

## SECTION A: Backend Query Bugs

### BUG 1 — HIGH: Inventory sales velocity double-localtime
- **File:** `backend/routes/reports/inventory.js` lines 605, 699
- **Code:** `date(s.timestamp,'localtime') >= date('now', '-' || ? || ' days', 'localtime')`
- **Column:** `sales.timestamp` (UTC)
- **Problem:** Double 'localtime' modifier shifts date window forward by UTC offset.
- **Impact:** Sales velocity and demand forecast reports exclude recent sales in UTC+ timezones.
- **Fix:** Replace with `s.timestamp >= ?` using `toUtcStart(X_days_ago_str, tz)`.

### BUG 2 — HIGH: Staff report attendance filter uses UTC boundaries on LOCAL column
- **File:** `backend/routes/reports/staff.js` lines 37-38, 44-45, 51-52
- **Code:** `session_start >= toUtcStart(date_from, tz)`
- **Column:** `attendance_sessions.session_start` (LOCAL)
- **Problem:** `toUtcStart('2026-03-08', 'Asia/Karachi')` = `'2026-03-07 19:00:00'`, but `session_start` stores local time like `'2026-03-08 02:04:35'`. UTC boundary doesn't match.
- **Impact:** Labor performance report attendance window off by 5 hours.
- **Fix:** Replace with `date(session_start) >= ?` / `date(session_start) <= ?` using plain YYYY-MM-DD.

### BUG 3 — HIGH: GRN report double-converts LOCAL received_at
- **File:** `backend/routes/reports/inventory.js` lines 879, 883, 889, 912, 916
- **Code:** `date(grn.received_at, 'localtime') >= ?`
- **Column:** `goods_received_notes.received_at` (LOCAL — migrate19)
- **Problem:** `received_at` already stores local time. Adding 'localtime' applies UTC→local a second time.
- **Impact:** GRN history records shifted by 5 hours. Late-day receipts appear on next day.
- **Fix:** Replace with `date(grn.received_at) >= ?` (no modifier).

### BUG 4 — HIGH: GRN list endpoint applies UTC conversion to LOCAL column
- **File:** `backend/routes/grn.js` lines 14-15, 18-19
- **Code:** `g.received_at >= toUtcStart(date_from, tz)`
- **Column:** `goods_received_notes.received_at` (LOCAL)
- **Problem:** Opposite direction — applying UTC boundary math to a local-time column.
- **Impact:** GRN list date filter off by 5 hours.
- **Fix:** Replace with `date(g.received_at) >= ?` / `date(g.received_at) <= ?` using plain YYYY-MM-DD.

### BUG 5 — HIGH: Accounting P&L uses plain date() on UTC sales
- **File:** `backend/routes/tier4/accounting.js` lines 28, 44, 52, 123, 469
- **Code:** `date(s.timestamp) BETWEEN ? AND ?` / `date(r.timestamp) BETWEEN ? AND ?`
- **Column:** `sales.timestamp`, `returns.timestamp` (UTC)
- **Problem:** `date('2026-03-07 21:09:58')` = `'2026-03-07'`, but sale happened 2:09 AM PKT March 8. Sales between 7 PM–midnight local time attributed to wrong day.
- **Impact:** P&L, cash flow, and tax reports misattribute transactions in the 5-hour offset window daily.
- **Fix:** Replace with `s.timestamp >= ?` / `s.timestamp < ?` using `toUtcStart`/`toUtcEnd`.

### BUG 6 — HIGH: HR payroll double-converts LOCAL check_in
- **File:** `backend/routes/tier4/hr.js` lines 191, 200
- **Code:** `date(check_in, 'localtime') AS work_date` / `GROUP BY date(check_in, 'localtime')`
- **Column:** `employee_attendance.check_in` (LOCAL)
- **Problem:** `check_in` already stores local time. The 'localtime' modifier treats it as UTC and converts again.
- **Impact:** Payroll hours grouped into wrong days. Evening shifts attributed to next day.
- **Fix:** Replace with `date(check_in)` (no modifier).

### BUG 7 — HIGH: Finance applyRangeFilters applies UTC conversion to LOCAL columns
- **File:** `backend/routes/reports/finance.js` lines 50-56 (shared `applyRangeFilters` function)
- **Called at:** line 158 (`e.expense_date`), line 165 (`sp.paid_at`), line 177 (`si.created_at`), line 960 (`grn.received_at`)
- **Columns:** `expenses.expense_date` (LOCAL), `supplier_payments.paid_at` (LOCAL), `supplier_invoices.created_at` (LOCAL), `goods_received_notes.received_at` (LOCAL)
- **Problem:** `applyRangeFilters` unconditionally calls `toUtcStart`/`toUtcEnd` on whatever `dateColumn` is passed. Works for `s.timestamp` (UTC) but wrong for LOCAL columns.
- **Impact:** Financial reports (payables breakdown, supplier invoices, GRN analysis) off by 5 hours.
- **Fix:** Split `applyRangeFilters` into `applyUtcRangeFilter` and `applyLocalDateFilter`, or add a `columnType` parameter. Callers must declare storage type.

### BUG 8 — HIGH: Dashboard GRN queries use UTC boundaries on LOCAL received_at
- **File:** `backend/routes/reports/dashboard.js` lines 495-496, 562, 566-568
- **Code:** `grn.received_at >= ?` / `grn.received_at < ?` (params are `monthStart`/`todayEnd` from `toUtcStart`/`toUtcEnd`); `date(grn.received_at, 'localtime')` for grouping
- **Column:** `goods_received_notes.received_at` (LOCAL)
- **Problem:** UTC boundaries applied to LOCAL column for month-purchases KPI; double-converts with 'localtime' in trend grouping.
- **Impact:** Month purchases KPI and purchase-vs-sales trend chart off by 5 hours.
- **Fix:** Replace filtering with `date(grn.received_at) >= ?` using plain YYYY-MM-DD; remove 'localtime' from GROUP BY.

### BUG 9 — HIGH: Purchasing procurement-parity applies UTC conversion to LOCAL GRN
- **File:** `backend/routes/reports/purchasing.js` lines 372-373, 380-381
- **Code:** `grn.received_at >= toUtcStart(date_from, tz)` / `grn.received_at < toUtcEnd(date_to, tz)`
- **Column:** `goods_received_notes.received_at` (LOCAL)
- **Problem:** Same as Bug 4 — UTC boundary math on local-time column.
- **Impact:** Procurement-parity report GRN values off by 5 hours.
- **Fix:** Replace with `date(grn.received_at) >= ?` / `date(grn.received_at) <= ?` using plain YYYY-MM-DD.

### BUG 10 — MEDIUM: Inventory report stock adjustments/transfers use localtime on UTC
- **File:** `backend/routes/reports/inventory.js` lines 317, 321, 346, 350, 811, 815, 845, 849, 976, 980
- **Code:** `date(sa.timestamp,'localtime') >= ?` / `date(it.timestamp,'localtime') >= ?` / `date(s.timestamp,'localtime') >= ?`
- **Columns:** `stock_adjustments.timestamp`, `inventory_transfers.timestamp`, `sales.timestamp` (all UTC)
- **Problem:** Using `date(col, 'localtime')` converts UTC to local for comparison, then comparing against plain YYYY-MM-DD. "Works" by accident but conceptually wrong and fragile.
- **Fix:** Replace with `col >= toUtcStart(date, tz)` / `col < toUtcEnd(date, tz)` for consistency.

### BUG 11 — MEDIUM: Inventory product-audit parses UTC with raw new Date()
- **File:** `backend/routes/reports/inventory.js` line 1125
- **Code:** `const lastSoldAt = row.last_sold_at ? new Date(row.last_sold_at) : null`
- **Column:** derived from `sales.timestamp` (UTC)
- **Problem:** `new Date('2026-03-07 21:09:58')` (no 'Z') parsed as local time. `daysSinceSale` calculation off by UTC offset hours, which can flip the day count.
- **Fix:** Append 'Z': `new Date(row.last_sold_at + 'Z')`.

### BUG 12 — MEDIUM: Governance scheduled report uses raw UTC lookback
- **File:** `backend/routes/reports/governance.js` line 130
- **Code:** `s.timestamp >= datetime('now', '-' || ? || ' days')`
- **Column:** `sales.timestamp` (UTC)
- **Problem:** Day boundary uses UTC midnight, not company timezone midnight.
- **Impact:** Minor — rolling windows are approximate.
- **Fix:** Replace with `s.timestamp >= toUtcStart(X_days_ago_str, tz)`.

---

## SECTION B: Backend Write-Path Inconsistencies

These won't cause immediate bugs but will reintroduce timezone issues over time.

### WRITE-BUG 1: web_orders.updated_at mixed UTC/LOCAL writes
- `backend/routes/orders.js:404` — `updated_at = datetime('now')` (UTC)
- `backend/shopify/order-service.js:211` — `updated_at = datetime('now','localtime')` (LOCAL)
- **Column DEFAULT:** `datetime('now','localtime')` (LOCAL)
- **Fix:** Standardize both to match the DEFAULT (localtime), or decide UTC and update both + DEFAULT.

### WRITE-BUG 2: shopify_connections.last_sync_at / updated_at mixed
- `backend/routes/orders.js:982-984` — `datetime('now')` (UTC)
- `backend/routes/shopify/sync.js:249-251` — `datetime('now','localtime')` (LOCAL)
- **Column DEFAULT:** `datetime('now','localtime')` (LOCAL)
- **Fix:** Standardize to match DEFAULT.

---

## SECTION C: Frontend Display Bugs

### C1: Files using raw `new Date()` on UTC columns (need UTC formatter)

These use `new Date(ts).toLocaleString()` without 'Z' on UTC-stored timestamps. Display shifts by 5 hours.

| # | File | Line | Column Source | Fix |
|---|------|------|---------------|-----|
| 1 | `frontend/src/pages/redesign/SalesHistoryRedesign.jsx` | 21 | `sales.timestamp` (UTC) | Use `fmtUtcDateTime` |
| 2 | `frontend/src/pages/redesign/CashManagementRedesign.jsx` | 24 | `cash_shifts.opened_at` (UTC) | Use `fmtUtcDateTime` |
| 3 | `frontend/src/pages/redesign/ReturnsRedesign.jsx` | 22 | `returns.timestamp` (UTC) | Use `fmtUtcDateTime` |
| 4 | `frontend/src/pages/redesign/StockAdjustmentsRedesign.jsx` | 19 | `stock_adjustments.timestamp` (UTC) | Use `fmtUtcDateTime` |
| 5 | `frontend/src/pages/redesign/TransfersRedesign.jsx` | 17 | `inventory_transfers.timestamp` (UTC) | Use `fmtUtcDateTime` |
| 6 | `frontend/src/pages/redesign/ReturnedStockRedesign.jsx` | 21 | `stock_adjustments.timestamp` (UTC) | Use `fmtUtcDateTime` |
| 7 | `frontend/src/pages/InvoiceView.jsx` | 7 | `sales.timestamp` (UTC) | Use `fmtUtcDateTime` |
| 8 | `frontend/src/pages/redesign/ActionHistoryRedesign.jsx` | 15 | `action_history.timestamp` (UTC) | Use `fmtUtcDateTime` |

### C2: Files using raw `new Date()` on LOCAL columns (need LOCAL formatter)

These also use `new Date(ts).toLocaleString()` — but the underlying columns are LOCAL. They currently display correctly BY ACCIDENT (browser parses ambiguous string as local, column is local). However, they should use an explicit LOCAL formatter so the intent is clear and won't break if columns are later migrated to UTC.

| # | File | Line | Column Source | Fix |
|---|------|------|---------------|-----|
| 9 | `frontend/src/pages/redesign/pos/POSParkedModal.jsx` | 52 | `parked_sales.parked_at` (LOCAL) | Use `fmtLocalDateTime` |
| 10 | `frontend/src/pages/redesign/BackupRestoreRedesign.jsx` | 13 | `backup_log.created_at` (LOCAL) | Use `fmtLocalDateTime` |
| 11 | `frontend/src/pages/redesign/CRMRedesign.jsx` | 24 | `crm_leads.created_at` (LOCAL) | Use `fmtLocalDateTime` |
| 12 | `frontend/src/pages/redesign/QuotationsRedesign.jsx` | 23 | `quotations.created_at` (LOCAL) | Use `fmtLocalDate` |
| 13 | `frontend/src/pages/shopify/ShopifyOverview.jsx` | 81 | `shopify_connections.last_sync_at` (LOCAL) | Use `fmtLocalDateTime` |
| 14 | `frontend/src/components/NotificationBell.jsx` | 16 | `notifications.created_at` (LOCAL) | Use `fmtLocalDateTime` |

### C3: Files using UTC formatter (`fmtDateTime`/`fmtDate`) on LOCAL columns (reverse bug)

These import the UTC-aware `dates.js` utility (which appends 'Z') but pass LOCAL-time values. This shifts the display by -5 hours (the opposite direction).

| # | File | Line | Column Source | Fix |
|---|------|------|---------------|-----|
| 15 | `frontend/src/pages/Approvals.jsx` | 178 | `approval_requests.created_at` (LOCAL) | Switch to `fmtLocalDateTime` |
| 16 | `frontend/src/pages/redesign/SupplierPayablesRedesign.jsx` | 349, 417 | `supplier_invoices.created_at` (LOCAL) | Switch to `fmtLocalDate` |

### C4: ReportShared.jsx redefines formatters without 'Z' handling
- **File:** `frontend/src/pages/reports/ReportShared.jsx` lines 9, 18
- **Code:** Defines local `fmtDate` / `fmtDateTime` using raw `new Date(d)` — no 'Z' handling.
- **Problem:** Report timestamps from UTC columns display wrong; if imported elsewhere, spreads the bug.
- **Fix:** Delete local definitions, import `fmtUtcDate`/`fmtUtcDateTime` from shared utility. For any report columns that source LOCAL data, use `fmtLocalDate` instead.

### C5: ShopifyEvents.jsx field name mismatch + silent fallback
- **File:** `frontend/src/pages/shopify/ShopifyEvents.jsx` line 147
- **Code:** `fmtDateTime(ev.timestamp)` — but backend returns `created_at`, not `timestamp` (see `shopify/sync.js:40`)
- **Problem:** `ev.timestamp` is `undefined`. `parseDbDate(undefined)` returns `new Date()` — silently shows "now" instead of actual event time.
- **Fix:** Change to `ev.created_at`. Also fix `parseDbDate` to return `null` or `"—"` on missing input instead of `new Date()`.

---

## SECTION D: Utility-Level Fixes

### D1: `parseDbDate` silent fallback masks bugs
- **File:** `frontend/src/utils/dates.js` line 9
- **Code:** `if (!str) return new Date();`
- **Problem:** When a field name is wrong (like ShopifyEvents) or data is missing, the formatter silently renders "now" instead of showing an error or placeholder. This masks data bugs.
- **Fix:** Change to `if (!str) return null;` and update all `fmt*` functions to return `"—"` when `parseDbDate` returns null.

### D2: Split formatters into UTC and LOCAL variants
- **File:** `frontend/src/utils/dates.js`
- **Current:** Single `fmtDateTime`/`fmtDate`/`fmtTime` that always appends 'Z' (UTC assumption).
- **Problem:** When used on LOCAL-time columns, it shifts display by -5 hours. When NOT used on UTC columns, display shifts by +5 hours. One formatter for both types is an error trap.
- **Fix:** Create explicit variants:
  ```javascript
  // UTC columns (sales.timestamp, returns.timestamp, etc.)
  export function fmtUtcDateTime(str) { ... } // appends 'Z'
  export function fmtUtcDate(str) { ... }
  export function fmtUtcTime(str, opts) { ... }

  // LOCAL columns (attendance, expenses, GRN, etc.)
  export function fmtLocalDateTime(str) { ... } // no 'Z' — parse as-is
  export function fmtLocalDate(str) { ... }
  export function fmtLocalTime(str, opts) { ... }

  // Keep old names as aliases for UTC (backward compat) but add deprecation comment
  export const fmtDateTime = fmtUtcDateTime;
  export const fmtDate = fmtUtcDate;
  export const fmtTime = fmtUtcTime;
  ```

---

## SECTION E: Backend Filter Helper Refactor

### E1: Split `applyRangeFilters` by column type
- **File:** `backend/routes/reports/finance.js`
- **Problem:** The shared `applyRangeFilters` function unconditionally applies `toUtcStart`/`toUtcEnd`. Callers for LOCAL columns (expense_date, paid_at, si.created_at, grn.received_at) get wrong boundaries.
- **Fix:** Create two explicit helpers in `backend/routes/reports/helpers.js`:
  ```javascript
  // For UTC-stored columns (sales.timestamp, returns.timestamp, etc.)
  function applyUtcDateFilter(where, params, { date_from, date_to, column }, tz) {
    if (date_from) { where.push(`${column} >= ?`); params.push(toUtcStart(date_from, tz)); }
    if (date_to)   { where.push(`${column} < ?`);  params.push(toUtcEnd(date_to, tz)); }
  }

  // For LOCAL-stored columns (expenses.expense_date, grn.received_at, etc.)
  function applyLocalDateFilter(where, params, { date_from, date_to, column }) {
    if (date_from) { where.push(`date(${column}) >= ?`); params.push(date_from); }
    if (date_to)   { where.push(`date(${column}) <= ?`); params.push(date_to); }
  }
  ```
  Callers must explicitly choose which one to use. This makes the column type decision visible at the call site.

---

## SECTION F: Missing Features

### F1: Stale attendance session auto-close (on clock-in)
- **File:** `backend/routes/attendance.js` — `POST /api/attendance/pin-checkin`
- **Problem:** Sessions stay open forever if employee doesn't clock out.
- **Fix:** Before creating new session, auto-close any open session from a previous day:
  ```sql
  UPDATE attendance_sessions
  SET session_end = session_start, session_type = 'auto_closed'
  WHERE employee_id = ? AND session_end IS NULL AND date(session_start) < date('now', 'localtime')
  ```

### F2: Daily server-level stale session cleanup
- **Problem:** F1 only fires on next clock-in. Employees who never return still have open sessions.
- **Fix:** Add a daily cleanup that runs on server startup and via `setInterval` (once per day):
  ```javascript
  function closeStaleAttendanceSessions(db) {
    db.run(`
      UPDATE attendance_sessions
      SET session_end = session_start, session_type = 'auto_closed'
      WHERE session_end IS NULL AND date(session_start) < date('now', 'localtime')
    `);
  }
  ```
  Call on server boot in `index.js` and schedule with `setInterval(fn, 24 * 60 * 60 * 1000)`.

---

## SECTION G: SQLite `'localtime'` Grouping Flaw (SaaS-Critical)

**Why this was missed in v2:** The v2 audit focused on date-range *filtering* bugs. But `'localtime'` is also used for **grouping and time extraction** — converting UTC timestamps to local time for monthly buckets, hourly heatmaps, and time-of-day bounding. SQLite's `'localtime'` modifier always uses the **server OS timezone**, not an IANA timezone string. In SaaS, two tenants on the same Node process get the same conversion regardless of their `company_profile.timezone`.

### G1 — CRITICAL: Monthly revenue grouping uses server timezone

| File | Lines | Code |
|------|-------|------|
| `reports/sales.js` | 297, 310, 790, 796 | `strftime('%Y-%m', s.timestamp, 'localtime') AS month_bucket` |
| `reports/dashboard.js` | 101 | `strftime('%Y-%m', s.timestamp, 'localtime') AS month` |

**Impact:** Monthly revenue charts group sales by server OS timezone month boundary, not tenant's. A sale at 11 PM New York time (4 AM UTC next day) appears in the wrong month for a Tokyo tenant.

### G2 — CRITICAL: Hourly/time-of-day extraction uses server timezone

| File | Lines | Code |
|------|-------|------|
| `reports/sales.js` | 35, 39, 730, 734, 1032-1039, 1161-1171 | `time(s.timestamp, 'localtime') >= time(?)` |
| `reports/dashboard.js` | 146 | `strftime('%H:00', s.timestamp, 'localtime') AS hour` |
| `reports/analytics.js` | 115-116 | `strftime('%w'/'%H', timestamp, 'localtime')` for heatmaps |
| `reports/finance.js` | 59, 63 | `time(timeColumn, 'localtime') >= time(?)` |
| `reports/inventory.js` | 920, 924, 984, 988 | `strftime('%H:%M', col, 'localtime') >= ?` |

**Impact:** Sales-by-time-of-day charts, peak-hours analysis, and heatmaps all show times in server OS timezone. A Tokyo tenant's 9 AM sale shows as 5 PM (if server is UTC) or midnight (if server is Asia/Karachi).

**Total: ~30 occurrences across 5 report files.**

### G Fix: Runtime timezone offset injection

SQLite doesn't support IANA timezone names, but it does support fixed UTC offsets like `'+05:00'`. Add a helper to `backend/utils/tz.js`:

```javascript
const { getTimezoneOffset } = require("date-fns-tz");

/** Returns SQLite-compatible offset string like '+05:00' or '-04:00' for a given IANA tz.
 *  Recomputed per-request to handle DST transitions correctly. */
function tzOffsetForSqlite(ianaTimezone) {
  const offsetMs = getTimezoneOffset(ianaTimezone, new Date());
  const sign = offsetMs >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMs);
  const h = String(Math.floor(abs / 3600000)).padStart(2, "0");
  const m = String(Math.floor((abs % 3600000) / 60000)).padStart(2, "0");
  return `${sign}${h}:${m}`;
}
```

Then replace all `'localtime'` modifiers in grouping/extraction with the computed offset:

```sql
-- Before (uses server OS timezone):
strftime('%Y-%m', s.timestamp, 'localtime') AS month_bucket

-- After (uses tenant's timezone):
strftime('%Y-%m', s.timestamp, ?) AS month_bucket
-- param: tzOffsetForSqlite(req.company.timezone)  → e.g. '+05:00'
```

**Note on DST:** The offset is computed once per request. For queries spanning DST boundaries (e.g., a 6-month trend), a single offset is an approximation. This is acceptable — the alternative (per-row offset) is not feasible in SQLite. For precise DST handling, post-process in JS.

---

## SECTION H: SaaS Architecture Bugs

### H1 — CRITICAL: `loadCompanyProfile` global cache breaks multi-tenancy

- **File:** `backend/index.js` lines 404-424
- **Code:** Single `_cachedCompany` variable caches one tenant's profile for 5 minutes. In MT mode, the first tenant to hit the server sets `req.company.timezone` for ALL tenants.
- **Impact:** Revenue reports, date filters, and hourly grouping use the wrong timezone for every tenant except whoever loaded first.
- **Fix:** Key the cache by tenant identifier:
  ```javascript
  const _companyCache = new Map(); // key: tenantSlug or "single"

  function loadCompanyProfile(req, res, next) {
    const key = req.tenantSlug || "single";
    const entry = _companyCache.get(key);
    const now = Date.now();
    if (!entry || now - entry.ts > COMPANY_CACHE_MS) {
      _companyCache.set(key, { ts: now, data: entry?.data || { timezone: "UTC" } });
      deps.db.get("SELECT * FROM company_profile WHERE id = 1", [], (err, row) => {
        if (!err && row) _companyCache.set(key, { ts: now, data: row });
      });
    }
    req.company = _companyCache.get(key)?.data || { timezone: "UTC" };
    next();
  }
  ```

---

## SECTION I: Write-Path Design Debt (SaaS)

Beyond the 2 direct mismatch bugs in Section B, there is a broader design debt: **~50 write paths across 15+ files use `datetime('now','localtime')`** (server OS timezone). These are internally consistent (they match their table DEFAULTs), so they don't cause bugs in single-tenant mode. However, in SaaS mode they all break because they stamp the server's timezone, not the tenant's.

### Affected modules (confirmed count):

| Module | `datetime('now','localtime')` writes |
|--------|--------------------------------------|
| `routes/shopify/config.js` | 3 |
| `routes/shopify/health.js` | 1 |
| `routes/shopify/import.js` | 4 |
| `routes/shopify/mappings.js` | 6 |
| `routes/shopify/orders.js` | 4 |
| `routes/shopify/sync.js` | 8 |
| `routes/shopify/webhooks.js` | 3 |
| `routes/shopify/reconciliation.js` | 3 |
| `routes/tier4/company-profile.js` | 2 |
| `routes/tier4/crm.js` | 7 |
| `routes/tier4/hr.js` | 1 |
| `routes/reports/governance.js` | 7 |
| **Total** | **~49 writes** |

### Recommended approach:
- **Phase 1 (now):** Fix the 2 genuine mismatch bugs (Section B). Leave all consistent `localtime` writes as-is.
- **Phase 2 (SaaS migration):** Standardize ALL writes to UTC (`CURRENT_TIMESTAMP` / `datetime('now')`). Update table DEFAULTs. Update all LOCAL-column read queries to use `toUtcStart`/`toUtcEnd`. This is a large migration but eliminates the dual-system entirely.
- **Phase 2 alternative:** Keep `localtime` writes but inject tenant offset: `datetime('now', ?)` with `tzOffsetForSqlite(tz)`. Less disruptive but perpetuates the dual system.

---

## SECTION J: Additional Frontend Findings

### J1: `Attendance.jsx` uses raw `new Date(dt)` on LOCAL columns
- **File:** `frontend/src/pages/Attendance.jsx` lines 15, 19, 24
- **Columns:** `attendance_sessions` fields (LOCAL)
- **Status:** Works correctly by accident (browser parses ambiguous string as local, column is local). Should use explicit `fmtLocalDateTime` for clarity.

### J2: `HRManagementRedesign.jsx` fragile date construction
- **File:** `frontend/src/pages/redesign/HRManagementRedesign.jsx` line 17
- **Code:** `new Date(d + "T00:00:00")` — forces local midnight interpretation
- **Status:** Works for date-only fields but fragile. Should use `fmtLocalDate`.

---

## Summary

| Category | Count | Files |
|----------|-------|-------|
| Backend query bugs (HIGH) | 9 | inventory.js, staff.js, grn.js, accounting.js, hr.js, finance.js, dashboard.js, purchasing.js |
| Backend query bugs (MEDIUM) | 3 | inventory.js, governance.js |
| Backend write-path mismatches | 2 | orders.js, order-service.js, sync.js |
| **SQLite `'localtime'` grouping flaw (NEW)** | **~30 occurrences** | **sales.js, dashboard.js, analytics.js, finance.js, inventory.js** |
| **SaaS cache bug (NEW)** | **1** | **index.js `loadCompanyProfile`** |
| **Write-path design debt (NEW)** | **~49 writes** | **shopify/*, tier4/*, governance.js** |
| Frontend UTC-column display bugs | 8 | SalesHistory, CashManagement, Returns, StockAdjustments, Transfers, ReturnedStock, InvoiceView, ActionHistory |
| Frontend LOCAL-column display (clarify) | 6+2 | POSParkedModal, BackupRestore, CRM, Quotations, ShopifyOverview, NotificationBell, Attendance, HRManagement |
| Frontend reverse bugs (UTC fmt on LOCAL) | 2 | Approvals, SupplierPayables |
| Frontend ReportShared redefines formatters | 1 | ReportShared.jsx |
| Frontend field mismatch | 1 | ShopifyEvents.jsx |
| Utility-level fixes | 2 | dates.js (parseDbDate fallback + split formatters) |
| Backend helper refactor | 1 | finance.js applyRangeFilters split |
| Missing features | 2 | attendance auto-close (clock-in + daily) |
| **Total** | **~50 distinct issues + ~49 write-path debt across ~30 files** |

---

## Implementation Priority

### Phase 1 — Immediate (single-tenant correctness)
Fix Sections A through F — the 37 bugs from v2. These cause wrong data display and query results RIGHT NOW.

### Phase 2 — SaaS readiness
1. **Section G** — Replace all `'localtime'` grouping with `tzOffsetForSqlite()` injection (~30 occurrences)
2. **Section H** — Per-tenant `loadCompanyProfile` cache
3. Add `date-fns-tz` dependency for offset computation

### Phase 3 — Write-path unification (optional, large)
Section I — Standardize all 49 `datetime('now','localtime')` writes to UTC. Only needed if pursuing full UTC-everywhere architecture.

---

## Prevention: Column Timezone Map

Replace manual COLUMN_TZ_MAP with a **generated** source from live schema + explicit overrides:

```javascript
// backend/utils/tz.js — auto-generated from sqlite_master defaults + manual overrides
// Run: node backend/utils/generate-tz-map.js > backend/utils/column-tz-map.json

// Manual overrides for columns whose write paths differ from schema DEFAULT:
const OVERRIDES = {
  "cash_shifts.closed_at": "UTC",  // written via JS new Date().toISOString() — UTC
  // Add any column where INSERT/UPDATE uses a different tz than the DEFAULT
};
```

A generator script reads `sqlite_master` for each table's column defaults, classifies `CURRENT_TIMESTAMP` as UTC and `datetime('now','localtime')` as LOCAL, then merges overrides. This stays accurate as migrations evolve.

---

## Long-Term Recommendation

For SaaS (multi-tenant), **all columns should be UTC**. The `datetime('now','localtime')` pattern uses the **server's** OS timezone — a tenant in `America/New_York` would get timestamps written in `Asia/Karachi`. This is fine for single-tenant but breaks in multi-tenant.

**Recommended path:**
1. Fix all 37 issues listed above now (Option A — safe, no data migration)
2. When ready for SaaS cutover, run a data migration to convert all LOCAL columns to UTC and update their DEFAULTs to `CURRENT_TIMESTAMP` (Option B)
