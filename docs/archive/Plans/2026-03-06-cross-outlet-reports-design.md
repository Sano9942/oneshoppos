# Cross-Outlet Reports — Design Doc
**Date:** 2026-03-06
**Approach:** Option A — extend `outlet_id` param to accept comma-separated IDs

## Problem
The Reports filter bar has a single-outlet dropdown. Users cannot compare or view data across multiple outlets simultaneously.

## Solution
Extend the existing `outlet_id` query parameter to accept comma-separated IDs (`outlet_id=1,3`). Update the backend helper and manual outlet-filter code to emit `IN (?,?,?)` clauses. Replace the frontend dropdown with a checkbox multi-select popover.

## Backend Changes

### `backend/routes/reports/helpers.js` — `buildReportFilterParts()`
- Parse `outlet_id` from `req.query` as comma-separated string → integer array
- 0 IDs: no WHERE clause (all outlets)
- 1 ID: `s.outlet_id = ?` (index-efficient single equality)
- 2+ IDs: `s.outlet_id IN (?,?,?)` with spread params
- All IDs cast to `Number()` before use — no SQL injection risk

### `backend/routes/reports/dashboard.js`
- Lines 24–32: replace manual `outletFilter` string with same array parse logic
- Affects all ~20 dashboard queries that use `outletFilter`

### `backend/routes/reports/sales.js`
- `applySaleTimeFilters()` at line 12: same array parse + IN-clause logic

### `backend/routes/reports/inventory.js`
- Inline `outlet_id` checks scattered through file: same pattern applied

## Frontend Changes

### `frontend/src/pages/Reports.jsx`

**State:**
- `filters.outletId: ""` → `filters.outletIds: []` (integer array)

**Outlet selector UI** (lines 228–243):
- Replace `<select>` with checkbox multi-select popover component
- Trigger button shows: `"All Outlets"` | `"Outlet A, Outlet B"` | `"3 outlets selected"`
- Popover: "Select All" / "Clear" + one checkbox per outlet
- Close on outside click

**Serialization** (in each tab's fetch calls — tabs receive `filters` prop):
- `outlet_id: filters.outletIds.join(",")` — empty array sends no param

**Shift filter** (line 728):
- `filters.outletId ? ... : true` → `filters.outletIds.length ? filters.outletIds.includes(session.outlet_id) : true`

**Reset:**
- `outletIds: []`

## Data Flow
```
User checks [1, 3] → filters.outletIds = [1,3]
→ tab serializes: outlet_id=1,3
→ backend parses: [1,3] → IN (?,?) with params [1,3]
→ results include outlet_name from existing JOINs
→ table shows rows labeled by outlet
```

## Edge Cases
- All outlets selected = no filter (same result, no extra WHERE clause needed)
- Single selection uses `= ?` not `IN` for query efficiency
- Empty outlets list → selector empty, no param sent, all data returned
- No schema migration needed

## Files to Touch
1. `backend/routes/reports/helpers.js`
2. `backend/routes/reports/dashboard.js`
3. `backend/routes/reports/sales.js`
4. `backend/routes/reports/inventory.js`
5. `frontend/src/pages/Reports.jsx`
