# Cross-Outlet Reports Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace single-outlet dropdown in Reports with a multi-select checkbox popover, and extend backend to accept comma-separated `outlet_id` values across all report endpoints.

**Architecture:** Extend the `outlet_id` query param to accept `"1,2,3"` format. Backend parses it into an array and emits `= ?` (single) or `IN (?,?,?)` (multi). Frontend replaces the `<select>` with a checkbox popover; `filters.outletId` becomes `filters.outletIds: []`.

**Tech Stack:** Node.js/Express backend, SQLite3, React 19 + Tailwind v4 frontend.

---

### Task 1: Extend `buildReportFilterParts()` in helpers.js

**Files:**
- Modify: `backend/routes/reports/helpers.js:52-58`

**Step 1: Write the failing test**

In `backend/tests/integration/reports_accuracy.test.js`, add at the top of the describe block:

```js
describe("buildReportFilterParts outlet multi-select", () => {
  it("emits IN clause for comma-separated outlet_id", async () => {
    const app = express();
    let capturedWhere, capturedParams;
    app.get("/test", async (req, res) => {
      const helpers = require("../../routes/reports/helpers")(db);
      const { where, params } = await helpers.buildReportFilterParts(req);
      capturedWhere = where;
      capturedParams = params;
      res.json({ where, params });
    });
    const res = await request(app).get("/test?outlet_id=1,2");
    expect(res.body.where).toContain("s.outlet_id IN (?,?)");
    expect(res.body.params).toContain(1);
    expect(res.body.params).toContain(2);
  });

  it("emits = clause for single outlet_id", async () => {
    const helpers = require("../../routes/reports/helpers")(db);
    const fakeReq = { query: { outlet_id: "3" }, company: { timezone: "UTC" } };
    const { where, params } = await helpers.buildReportFilterParts(fakeReq);
    expect(where.some(w => w.includes("s.outlet_id = ?"))).toBe(true);
    expect(params).toContain("3");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd backend && npx jest tests/integration/reports_accuracy.test.js --testNamePattern="buildReportFilterParts outlet" -t "outlet multi-select"
```
Expected: FAIL — `s.outlet_id IN (?,?)` not found.

**Step 3: Implement the fix**

In `backend/routes/reports/helpers.js`, replace lines 52–58:

```js
// BEFORE:
if (outlet_id) {
  if (sale) {
    where.push(`${sale}.outlet_id = ?`);
  } else if (outlet) {
    where.push(`${outlet}.id = ?`);
  }
  params.push(outlet_id);
}
```

```js
// AFTER:
if (outlet_id) {
  const ids = String(outlet_id).split(",").map(Number).filter(Boolean);
  const col = sale ? `${sale}.outlet_id` : `${outlet}.id`;
  if (ids.length === 1) {
    where.push(`${col} = ?`);
    params.push(ids[0]);
  } else if (ids.length > 1) {
    where.push(`${col} IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd backend && npx jest tests/integration/reports_accuracy.test.js -t "outlet multi-select"
```
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/routes/reports/helpers.js backend/tests/integration/reports_accuracy.test.js
git commit -m "feat: extend buildReportFilterParts to accept comma-separated outlet_id"
```

---

### Task 2: Fix `applySaleTimeFilters()` in sales.js

**Files:**
- Modify: `backend/routes/reports/sales.js:30-33`

**Step 1: Write the failing test**

Add to `backend/tests/integration/reports_accuracy.test.js`:

```js
it("GET /api/reports/sales-summary with outlet_id=1,2 returns 200", async () => {
  const res = await request(app)
    .get("/api/reports/sales-summary?outlet_id=1,2&date_from=2020-01-01&date_to=2030-01-01")
    .set("x-outlet-id", "1");
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty("rows");
});
```

**Step 2: Run test to verify it fails (or errors)**

```bash
cd backend && npx jest tests/integration/reports_accuracy.test.js -t "sales-summary with outlet_id=1,2"
```
Expected: error or returns rows only for one outlet.

**Step 3: Implement**

In `backend/routes/reports/sales.js`, replace lines 30–33:

```js
// BEFORE:
if (outlet_id) {
  where.push(`${saleAlias}.outlet_id = ?`);
  params.push(outlet_id);
}
```

```js
// AFTER:
if (outlet_id) {
  const ids = String(outlet_id).split(",").map(Number).filter(Boolean);
  if (ids.length === 1) {
    where.push(`${saleAlias}.outlet_id = ?`);
    params.push(ids[0]);
  } else if (ids.length > 1) {
    where.push(`${saleAlias}.outlet_id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
}
```

**Step 4: Run tests**

```bash
cd backend && npx jest tests/integration/reports_accuracy.test.js
```
Expected: all PASS.

**Step 5: Commit**

```bash
git add backend/routes/reports/sales.js
git commit -m "feat: extend applySaleTimeFilters to accept comma-separated outlet_id"
```

---

### Task 3: Fix `outlet_id` checks in inventory.js

**Files:**
- Modify: `backend/routes/reports/inventory.js`

There are 8 inline `outlet_id` checks in this file. Apply the same pattern to each one.

**The pattern to apply everywhere** (replace every block of this shape):

```js
// BEFORE:
if (outlet_id) {               // or if (req.query.outlet_id)
  where.push("os.outlet_id = ?");   // or s.outlet_id, grn.outlet_id
  params.push(outlet_id);           // or req.query.outlet_id
}
```

```js
// AFTER — define this helper at the top of the module function body (line ~6):
function applyOutletFilter(where, params, rawId, col = "os.outlet_id") {
  if (!rawId) return;
  const ids = String(rawId).split(",").map(Number).filter(Boolean);
  if (ids.length === 1) {
    where.push(`${col} = ?`);
    params.push(ids[0]);
  } else if (ids.length > 1) {
    where.push(`${col} IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
}
```

Then replace each check:

| Line(s) | Current col | New call |
|---------|-------------|----------|
| 68–71 | `os.outlet_id` | `applyOutletFilter(where, params, outlet_id)` |
| 207–210 | `os.outlet_id` | `applyOutletFilter(where, params, outlet_id)` |
| 394–397 | `os.outlet_id` | `applyOutletFilter(where, params, req.query.outlet_id)` |
| 505–508 | `os.outlet_id` | `applyOutletFilter(where, params, req.query.outlet_id)` |
| 554–559 | `os.outlet_id` | `applyOutletFilter(where, params, req.query.outlet_id)` |
| 611–614 | `s.outlet_id` | `applyOutletFilter(where, params, filters.outlet_id, "s.outlet_id")` |
| 694–697 | `os.outlet_id` | `applyOutletFilter(where, params, req.query.outlet_id)` |
| 827–830 | `from/to transfer` | **skip** — transfer outlet is directional, leave as single |
| 861–864 | `from/to transfer` | **skip** — same |
| 895–898 | `grn.outlet_id` | `applyOutletFilter(where, params, outlet_id, "grn.outlet_id")` |
| 939–942 | `grn.outlet_id` | `applyOutletFilter(where, params, req.query.outlet_id, "grn.outlet_id")` |
| 1006–1009 | `s.outlet_id` | `applyOutletFilter(where, params, req.query.outlet_id, "s.outlet_id")` |
| 1076–1081 | `os.outlet_id` + `s.outlet_id` | Two calls: `applyOutletFilter(stockWhere, stockParams, req.query.outlet_id)` and `applyOutletFilter(saleWhere, saleParams, req.query.outlet_id, "s.outlet_id")` |

**Step 1: Run existing tests before touching anything**

```bash
cd backend && npx jest tests/integration/reports_accuracy.test.js
```
Note how many pass (baseline).

**Step 2: Add the `applyOutletFilter` helper and apply all substitutions**

**Step 3: Run tests again**

```bash
cd backend && npx jest tests/integration/reports_accuracy.test.js
```
Expected: same or more passing, no regressions.

**Step 4: Commit**

```bash
git add backend/routes/reports/inventory.js
git commit -m "feat: extend inventory report outlet filters to accept comma-separated outlet_id"
```

---

### Task 4: Fix `dashboard.js` outlet filter

**Files:**
- Modify: `backend/routes/reports/dashboard.js:24-32`

**Step 1: Replace the manual outlet filter block**

```js
// BEFORE (lines 24-32):
const outletId =
  req.query?.outlet_id !== undefined &&
  req.query?.outlet_id !== null &&
  req.query?.outlet_id !== ""
    ? Number(req.query.outlet_id)
    : null;

const outletFilter = outletId !== null ? " AND s.outlet_id = ?" : "";
const outletParams = outletId !== null ? [outletId] : [];
```

```js
// AFTER:
const rawOutletId = req.query?.outlet_id;
const outletIds = rawOutletId
  ? String(rawOutletId).split(",").map(Number).filter(Boolean)
  : [];

const outletFilter =
  outletIds.length === 1
    ? " AND s.outlet_id = ?"
    : outletIds.length > 1
      ? ` AND s.outlet_id IN (${outletIds.map(() => "?").join(",")})`
      : "";
const outletParams = outletIds.length ? outletIds : [];
```

Note: `outletParams` is spread into query params with `...outletParams` everywhere — this is already how the code uses it, so no other lines need to change.

**Step 2: Run tests**

```bash
cd backend && npx jest tests/integration/reports_accuracy.test.js
```
Expected: all PASS.

**Step 3: Commit**

```bash
git add backend/routes/reports/dashboard.js
git commit -m "feat: extend dashboard outlet filter to accept comma-separated outlet_id"
```

---

### Task 5: Frontend — multi-select outlet popover in Reports.jsx

**Files:**
- Modify: `frontend/src/pages/Reports.jsx`

**Step 1: Update the filters state shape**

In `Reports()` (line 677), change the initial state:

```js
// BEFORE:
outletId: "",

// AFTER:
outletIds: [],
```

Also update `handleReset` in `GlobalFilterBar` (line 154):
```js
// BEFORE:
outletId: "",

// AFTER:
outletIds: [],
```

**Step 2: Replace the outlet `<select>` with a multi-select popover**

Add `useState` for popover open state (already imported). Replace lines 228–243 with:

```jsx
{/* Outlet Multi-Select */}
<div className="relative">
  <button
    onClick={() => setOutletOpen((v) => !v)}
    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-w-35"
  >
    <Building2 size={14} className="text-slate-400 shrink-0" />
    <span className="truncate">
      {filters.outletIds.length === 0
        ? "All Outlets"
        : filters.outletIds.length === 1
          ? outlets.find((o) => o.id === filters.outletIds[0])?.name ?? "1 outlet"
          : `${filters.outletIds.length} outlets`}
    </span>
  </button>
  {outletOpen && (
    <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-slate-200 bg-white shadow-lg">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <button
          className="text-xs text-blue-600 hover:underline"
          onClick={() => setFilters({ ...filters, outletIds: outlets.map((o) => o.id) })}
        >
          Select All
        </button>
        <button
          className="text-xs text-slate-500 hover:underline"
          onClick={() => setFilters({ ...filters, outletIds: [] })}
        >
          Clear
        </button>
      </div>
      <div className="max-h-56 overflow-y-auto py-1">
        {outlets.map((o) => (
          <label key={o.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={filters.outletIds.includes(o.id)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...filters.outletIds, o.id]
                  : filters.outletIds.filter((id) => id !== o.id);
                setFilters({ ...filters, outletIds: next });
              }}
              className="accent-blue-600"
            />
            <span className="text-xs font-medium text-slate-700">{o.name}</span>
          </label>
        ))}
      </div>
    </div>
  )}
</div>
```

Add the `outletOpen` state near the top of `GlobalFilterBar`:
```js
const [outletOpen, setOutletOpen] = useState(false);
```

Add a click-outside handler to close the popover:
```js
useEffect(() => {
  if (!outletOpen) return;
  const handler = (e) => {
    if (!e.target.closest("[data-outlet-popover]")) setOutletOpen(false);
  };
  document.addEventListener("mousedown", handler);
  return () => document.removeEventListener("mousedown", handler);
}, [outletOpen]);
```

Add `data-outlet-popover` attribute to the `<div className="relative">` wrapping the popover.

**Step 3: Update shift filter (line ~728)**

```js
// BEFORE:
shifts: (cashFlow.sessions || []).filter((session) =>
  filters.outletId ? String(session.outlet_id) === String(filters.outletId) : true,
),

// AFTER:
shifts: (cashFlow.sessions || []).filter((session) =>
  filters.outletIds.length
    ? filters.outletIds.includes(Number(session.outlet_id))
    : true,
),
```

**Step 4: Update `useEffect` dependency (line ~736)**

```js
// BEFORE:
}, [filters.outletId, filters.dateFrom, filters.dateTo]);

// AFTER:
}, [filters.outletIds, filters.dateFrom, filters.dateTo]);
```

**Step 5: Update all tabs that build `outlet_id` query param**

Search for `filters.outletId` in `Reports.jsx` and all `frontend/src/pages/reports/*.jsx` files:

```bash
grep -rn "filters\.outletId" frontend/src/pages/
```

For each occurrence, replace:
```js
// BEFORE:
outlet_id: filters.outletId,
// or
outlet_id: filters.outletId || undefined,

// AFTER:
outlet_id: filters.outletIds.length ? filters.outletIds.join(",") : undefined,
```

**Step 6: Manual smoke test**
1. Open Reports page
2. Click outlet button — popover opens with checkboxes
3. Check 2 outlets — button shows "2 outlets"
4. Navigate to Sales Summary tab — data loads for both outlets
5. Clear — reverts to "All Outlets", all data returns
6. Click outside popover — it closes

**Step 7: Commit**

```bash
git add frontend/src/pages/Reports.jsx frontend/src/pages/reports/
git commit -m "feat: multi-select outlet filter for cross-outlet reports"
```

---

### Task 6: Run full backend test suite

```bash
cd backend && npx jest tests/integration/ --passWithNoTests
```

Expected: 257/259 passing (2 pre-existing vitest failures in concurrency.test.js are expected).

If any new failures appear, fix them before proceeding.

**Commit if clean:**
```bash
git commit --allow-empty -m "chore: verify all tests pass after cross-outlet reports"
```
