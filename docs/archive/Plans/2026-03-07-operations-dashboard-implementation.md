# Operations Dashboard Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the SanoPOS dashboard from a static report page into a shift-aware, scope-aware, role-aware operations dashboard organized into 11 focused components.

**Architecture:** Modular component approach — `frontend/src/pages/dashboard/` contains 11 section components, `DashboardRedesign.jsx` becomes a thin orchestrator (~150 lines). Backend extends existing `/api/reports/dashboard` with same-time comparisons, operational readiness data per outlet, currency from company_profile, and exception ratios. No new endpoints. No schema changes for Phases 1-3.

**Tech Stack:** React 19, Recharts, Lucide icons, Tailwind v4, Express + SQLite backend, existing `primitives.jsx` (PageShell, SectionCard, Badge, Button, Skeleton).

---

## Reference Files

Before starting, read these files to understand existing patterns:
- `backend/routes/reports/dashboard.js` — the endpoint you will extend
- `frontend/src/pages/redesign/DashboardRedesign.jsx` — current monolith to replace
- `frontend/src/ui/primitives.jsx` — shared UI components (PageShell, SectionCard, Badge, Button, Skeleton)
- `frontend/src/utils/dates.js` — use `fmtTime`, `fmtDate`, `fmtDateTime` for all timestamps
- `frontend/src/auth/AuthProvider.jsx` — `hasPerm`, `authHeaders`, session structure
- `frontend/src/auth/authStore.js` — `readContext` returns `{ scope_mode, active_outlet_id, ... }`

## Key Constraints

- **Never** use `new Date(x.timestamp)` directly — always use `fmtTime`/`fmtDate`/`fmtDateTime` from `frontend/src/utils/dates.js`
- **Never** hardcode `"PKRs"` — read from `data?.currency?.symbol`
- Tailwind v4: use `(--css-var)` not `[var(--css-var)]`, use `bg-linear-to-br` not `bg-gradient-to-br`
- Backend test runner: `npx jest backend/tests/integration/<file>.test.js`
- Frontend dev: port 5173 (Vite), backend: port 5000

---

## PHASE 1: Fix Usefulness

---

### Task 1: Backend — Currency + Exception Ratios

**Files:**
- Modify: `backend/routes/reports/dashboard.js`

**Goal:** Add `currency` field and enrich existing exception objects with ratio percentages.

**Step 1: Add currency field to response**

In the `res.json({...})` block near the end of the file, add:

```js
currency: {
  symbol: req.company?.currency_symbol || "PKRs",
  code: req.company?.currency_code || "PKR",
},
```

**Step 2: Enrich exception objects with ratios**

Replace the existing `refundsToday`, `voidsToday`, `discountsToday` in `res.json({...})` with:

```js
refundsToday: {
  count: refundsToday.count,
  value: refundsToday.value,
  pct_of_sales: totalRevenueToday > 0 ? Number(((refundsToday.value / totalRevenueToday) * 100).toFixed(1)) : 0,
  pct_of_orders: saleCount > 0 ? Number(((refundsToday.count / saleCount) * 100).toFixed(1)) : 0,
},
voidsToday: {
  count: voidsToday.count,
  value: voidsToday.value,
  pct_of_sales: totalRevenueToday > 0 ? Number(((voidsToday.value / totalRevenueToday) * 100).toFixed(1)) : 0,
  pct_of_orders: saleCount > 0 ? Number(((voidsToday.count / saleCount) * 100).toFixed(1)) : 0,
},
discountsToday: {
  count: discountsToday.count,
  value: discountsToday.value,
  pct_of_sales: totalRevenueToday > 0 ? Number(((discountsToday.value / totalRevenueToday) * 100).toFixed(1)) : 0,
  pct_of_orders: saleCount > 0 ? Number(((discountsToday.count / saleCount) * 100).toFixed(1)) : 0,
},
```

**Step 3: Verify manually**

Start backend: `cd backend && node index.js`
Call: `curl -s "http://localhost:5000/api/reports/dashboard" -H "x-employee-id: 1" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.currency, d.refundsToday)"`

Expected: `{ symbol: 'PKRs', code: 'PKR' }` and `{ count: N, value: N, pct_of_sales: N, pct_of_orders: N }`

**Step 4: Commit**

```bash
git add backend/routes/reports/dashboard.js
git commit -m "feat(dashboard): add currency field and exception ratios to dashboard API"
```

---

### Task 2: Backend — Same-Time Yesterday Comparison

**Files:**
- Modify: `backend/routes/reports/dashboard.js`

**Goal:** Add `yesterdayRevenue`, `yesterdaySaleCount`, `yesterdayProfit`, `yesterdayRefunds` for same-hour-of-day comparison.

**Step 1: Compute yesterday's same-time window**

After the existing `todayStart`/`todayEnd` computation block, add:

```js
// Same-time-of-day comparison: yesterday 00:00 local → yesterday at same elapsed time as now
const elapsedMs = Date.now() - new Date(todayStart + "Z").getTime();
const yesterdayDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 24 * 3600 * 1000));
const yesterdayStart = toUtcStart(yesterdayDateStr, tz);
// yesterdayEnd = yesterdayStart + elapsed seconds, expressed as SQLite datetime string
const yesterdayEndMs = new Date(yesterdayStart + "Z").getTime() + elapsedMs;
const yesterdayEnd = new Date(yesterdayEndMs).toISOString().replace("T", " ").slice(0, 19);
```

Note: `todayStart` format from `toUtcStart` is `"YYYY-MM-DD HH:MM:SS"` (SQLite format). Appending `"Z"` makes it parseable as UTC by `new Date()`.

**Step 2: Add yesterday revenue + count query**

After `saleCountRow` query, add:

```js
const yesterdaySalesRows = await getQuery(
  `SELECT
    ROUND(COALESCE(SUM(s.total_amount), 0), 2) AS revenue,
    COUNT(s.id) AS sale_count
   FROM sales s
   WHERE s.voided = 0
     AND s.timestamp >= ?
     AND s.timestamp < ?
     ${outletFilter}`,
  [yesterdayStart, yesterdayEnd, ...outletParams],
);
const yesterdayRevenue = Number(yesterdaySalesRows[0]?.revenue || 0);
const yesterdaySaleCount = Number(yesterdaySalesRows[0]?.sale_count || 0);
```

**Step 3: Add yesterday profit query**

```js
const yesterdayProfitRows = await getQuery(
  `SELECT
    ROUND(
      COALESCE(SUM(
        CASE
          WHEN t.id IS NOT NULL
            THEN (si.quantity * si.price_at_sale) / (1 + (t.rate / 100.0))
          ELSE (si.quantity * si.price_at_sale) / (1 + (COALESCE(p.gst, 0) / 100.0))
        END
      ), 0) - COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0),
    2) AS profit
   FROM sale_items si
   JOIN sales s ON si.sale_id = s.id
   JOIN products p ON si.product_id = p.id
   LEFT JOIN taxes t ON p.tax_id = t.id
   WHERE s.voided = 0
     AND s.timestamp >= ?
     AND s.timestamp < ?
     ${outletFilter}`,
  [yesterdayStart, yesterdayEnd, ...outletParams],
);
const yesterdayProfit = Number(yesterdayProfitRows[0]?.profit || 0);
```

**Step 4: Add yesterday refunds query**

```js
const yesterdayRefundRows = await getQuery(
  `SELECT ROUND(COALESCE(SUM(ri.quantity * ri.refund_price), 0), 2) AS value
   FROM returns r
   LEFT JOIN return_items ri ON ri.return_id = r.id
   WHERE r.timestamp >= ?
     AND r.timestamp < ?
   ${outletIds.length === 1 ? "AND r.outlet_id = ?" : outletIds.length > 1 ? `AND r.outlet_id IN (${outletIds.map(() => "?").join(",")})` : ""}`,
  [yesterdayStart, yesterdayEnd, ...outletIds],
);
const yesterdayRefunds = Number(yesterdayRefundRows[0]?.value || 0);
```

**Step 5: Add to response**

In `res.json({...})`, add:

```js
yesterdayRevenue,
yesterdaySaleCount,
yesterdayProfit,
yesterdayRefunds,
```

**Step 6: Verify**

Curl the endpoint again and confirm the four `yesterday*` fields appear in the response.

**Step 7: Commit**

```bash
git add backend/routes/reports/dashboard.js
git commit -m "feat(dashboard): add same-time yesterday comparison fields"
```

---

### Task 3: Backend — Operational Readiness Per Outlet

**Files:**
- Modify: `backend/routes/reports/dashboard.js`

**Goal:** Add `operationalReadiness` array — shift status, staff counts, last sale time per outlet.

**Step 1: Add the operational readiness query**

After the `attendanceSummary` computation, add:

```js
const allOutletsRows = await getQuery(`SELECT id, name FROM outlets ORDER BY name ASC`);

const operationalReadiness = await Promise.all(
  allOutletsRows.map(async (outlet) => {
    const shiftRow = await getQuery(
      `SELECT cs.id, cs.opened_at, cs.opening_float, e.name AS employee_name
       FROM cash_shifts cs
       LEFT JOIN employees e ON e.id = cs.employee_id
       WHERE cs.outlet_id = ? AND cs.status = 'open'
       ORDER BY cs.opened_at DESC LIMIT 1`,
      [outlet.id],
    );
    const shift = shiftRow[0] || null;

    const staffRows = await getQuery(
      `SELECT
        SUM(CASE WHEN a.session_type = 'work' THEN 1 ELSE 0 END) AS clocked_in,
        SUM(CASE WHEN a.session_type = 'break' THEN 1 ELSE 0 END) AS on_break,
        COUNT(DISTINCT e.id) AS total
       FROM employees e
       LEFT JOIN (
         SELECT employee_id, session_type
         FROM attendance_sessions
         WHERE session_end IS NULL
           AND session_start >= ?
           AND session_start < ?
           AND outlet_id = ?
       ) a ON a.employee_id = e.id`,
      [todayStart, todayEnd, outlet.id],
    );
    const staff = staffRows[0] || { clocked_in: 0, on_break: 0, total: 0 };

    const lastSaleRow = await getQuery(
      `SELECT MAX(timestamp) AS last_sale_at FROM sales WHERE outlet_id = ? AND voided = 0`,
      [outlet.id],
    );

    return {
      outlet_id: outlet.id,
      outlet_name: outlet.name,
      shift_open: !!shift,
      shift_employee: shift?.employee_name || null,
      shift_opened_at: shift?.opened_at || null,
      opening_float: shift?.opening_float || 0,
      staff_clocked_in: Number(staff.clocked_in || 0),
      staff_on_break: Number(staff.on_break || 0),
      staff_total: Number(staff.total || 0),
      last_sale_at: lastSaleRow[0]?.last_sale_at || null,
    };
  }),
);
```

**Step 2: Add to response**

In `res.json({...})`, add:

```js
operationalReadiness,
```

**Step 3: Verify**

Curl the endpoint. Confirm `operationalReadiness` is an array with one object per outlet, each with `shift_open`, `staff_clocked_in`, `last_sale_at`.

**Step 4: Commit**

```bash
git add backend/routes/reports/dashboard.js
git commit -m "feat(dashboard): add operational readiness per outlet to dashboard API"
```

---

### Task 4: Frontend — Create `dashboard/` Directory + `DashboardShared.jsx`

**Files:**
- Create: `frontend/src/pages/dashboard/DashboardShared.jsx`

**Goal:** Shared currency formatter hook, delta arrow component, relative time display.

**Step 1: Create the file**

```jsx
import { useCallback } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/**
 * Returns a currency formatter function using the symbol from dashboard data.
 * Usage: const fmt = useCurrency(data); fmt(1234.5) => "PKRs 1,234.50"
 */
export function useCurrency(dashboardData) {
  const sym = dashboardData?.currency?.symbol || "PKRs";
  return useCallback(
    (n) => `${sym} ${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    [sym],
  );
}

/**
 * Shows percentage delta vs previous value with directional arrow and color.
 * "—" when previous is 0 (no data to compare).
 */
export function DeltaArrow({ current, previous, higherIsBetter = true }) {
  if (!previous || previous === 0) {
    return <span className="text-xs text-(--ui-text-muted)">—</span>;
  }
  const pct = ((current - previous) / previous) * 100;
  const isUp = pct >= 0;
  const isGood = higherIsBetter ? isUp : !isUp;
  const color = isGood ? "text-emerald-600" : "text-rose-600";
  const Icon = isUp ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Icon size={11} />
      {Math.abs(pct).toFixed(1)}% vs yesterday
    </span>
  );
}

/**
 * Displays a timestamp as relative time: "14m ago", "2h ago", "yesterday".
 * Accepts SQLite UTC timestamp string ("YYYY-MM-DD HH:MM:SS").
 */
export function RelativeTime({ timestamp }) {
  if (!timestamp) return <span className="text-xs text-(--ui-text-muted)">—</span>;
  // Append Z to parse as UTC (SQLite timestamps have no suffix)
  const ms = Date.now() - new Date(timestamp.replace(" ", "T") + "Z").getTime();
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let label;
  if (minutes < 1) label = "just now";
  else if (minutes < 60) label = `${minutes}m ago`;
  else if (hours < 24) label = `${hours}h ago`;
  else if (days === 1) label = "yesterday";
  else label = `${days}d ago`;

  return <span className="text-xs text-(--ui-text-muted)">{label}</span>;
}
```

**Step 2: Verify file exists**

```bash
ls frontend/src/pages/dashboard/
```

Expected: `DashboardShared.jsx`

**Step 3: Commit**

```bash
git add frontend/src/pages/dashboard/DashboardShared.jsx
git commit -m "feat(dashboard): add DashboardShared utilities (currency, delta, relative time)"
```

---

### Task 5: Frontend — `DashboardOpsReadiness.jsx`

**Files:**
- Create: `frontend/src/pages/dashboard/DashboardOpsReadiness.jsx`

**Goal:** Shift status + staff count + last sale time. Top widget — answers "can we sell right now?"

**Step 1: Create the file**

```jsx
import { AlertTriangle, CheckCircle, Clock, Coffee, UserCheck, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button, SectionCard } from "../../ui/primitives";
import { RelativeTime } from "./DashboardShared";

function OutletReadinessCard({ outlet }) {
  const navigate = useNavigate();
  const ready = outlet.shift_open;
  return (
    <div
      className={`rounded-lg border p-4 ${ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {ready ? (
            <CheckCircle size={14} className="text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle size={14} className="text-amber-600 shrink-0" />
          )}
          <span className="text-sm font-semibold text-(--ui-text) truncate">{outlet.outlet_name}</span>
        </div>
        <span className={`text-xs font-bold ${ready ? "text-emerald-700" : "text-amber-700"}`}>
          {ready ? "READY" : "BLOCKED"}
        </span>
      </div>
      <div className="space-y-1 text-xs text-(--ui-text-muted)">
        {ready ? (
          <>
            <p>Shift by {outlet.shift_employee || "—"} · Float: {outlet.opening_float > 0 ? outlet.opening_float.toLocaleString() : "—"}</p>
            <div className="flex items-center gap-1">
              <UserCheck size={10} /> {outlet.staff_clocked_in} in
              {outlet.staff_on_break > 0 && <><Coffee size={10} className="ml-1" /> {outlet.staff_on_break} break</>}
            </div>
            <div className="flex items-center gap-1">
              <Clock size={10} /> Last sale: <RelativeTime timestamp={outlet.last_sale_at} />
            </div>
          </>
        ) : (
          <>
            <p>No shift open — sales are blocked</p>
            <div className="flex items-center gap-1">
              <Users size={10} /> {outlet.staff_clocked_in} of {outlet.staff_total} clocked in
            </div>
            <Button
              size="sm"
              className="mt-2 w-full"
              onClick={() => navigate("/cash-management")}
            >
              Open Shift
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function DashboardOpsReadiness({ data, loading }) {
  const navigate = useNavigate();
  const readiness = data?.operationalReadiness || [];

  if (loading) {
    return (
      <SectionCard className="mb-4 p-4">
        <div className="h-4 w-40 animate-pulse rounded bg-(--ui-muted-surface)" />
        <div className="mt-2 h-16 animate-pulse rounded bg-(--ui-muted-surface)" />
      </SectionCard>
    );
  }

  if (readiness.length === 0) return null;

  // Single outlet: full-width banner
  if (readiness.length === 1) {
    const outlet = readiness[0];
    const ready = outlet.shift_open;
    return (
      <div
        className={`mb-4 rounded-xl border p-4 ${ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {ready ? (
              <CheckCircle size={18} className="text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle size={18} className="text-amber-600 shrink-0" />
            )}
            <div>
              <p className={`text-sm font-bold ${ready ? "text-emerald-800" : "text-amber-800"}`}>
                {ready ? "STORE READY" : "STORE BLOCKED — No shift open"}
              </p>
              {ready ? (
                <p className="text-xs text-(--ui-text-muted)">
                  Shift by {outlet.shift_employee || "—"} · Float: {outlet.opening_float > 0 ? `${outlet.opening_float.toLocaleString()}` : "—"} ·{" "}
                  {outlet.staff_clocked_in} clocked in
                  {outlet.staff_on_break > 0 ? `, ${outlet.staff_on_break} on break` : ""}
                </p>
              ) : (
                <p className="text-xs text-(--ui-text-muted)">
                  Sales cannot be processed until a shift is opened
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {outlet.last_sale_at && (
              <span className="text-xs text-(--ui-text-muted)">
                Last sale: <RelativeTime timestamp={outlet.last_sale_at} />
              </span>
            )}
            <div className="flex gap-2">
              {!ready && (
                <Button size="sm" tone="primary" onClick={() => navigate("/cash-management")}>
                  Open Shift
                </Button>
              )}
              <Button size="sm" onClick={() => navigate("/cash-management")}>View Shift</Button>
              <Button size="sm" onClick={() => navigate("/attendance")}>Attendance</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Multiple outlets: card grid
  const readyCount = readiness.filter((o) => o.shift_open).length;
  return (
    <SectionCard className="mb-4">
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-(--ui-border)">
        <p className="text-sm font-semibold text-(--ui-text)">Outlet Readiness</p>
        <span className={`text-xs font-semibold ${readyCount === readiness.length ? "text-emerald-600" : "text-amber-600"}`}>
          {readyCount} of {readiness.length} ready
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {readiness.map((outlet) => (
          <OutletReadinessCard key={outlet.outlet_id} outlet={outlet} />
        ))}
      </div>
    </SectionCard>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/dashboard/DashboardOpsReadiness.jsx
git commit -m "feat(dashboard): add DashboardOpsReadiness shift/staff/last-sale widget"
```

---

### Task 6: Frontend — `DashboardKPICards.jsx`

**Files:**
- Create: `frontend/src/pages/dashboard/DashboardKPICards.jsx`

**Goal:** 4 KPI cards with same-time delta arrows. Cashier sees only Revenue + Avg Bill.

**Step 1: Create the file**

```jsx
import { AlertTriangle, BarChart3, Package, TrendingUp } from "lucide-react";
import { SectionCard, Skeleton } from "../../ui/primitives";
import { DeltaArrow } from "./DashboardShared";

function KPICard({ label, value, subtitle, icon: Icon, color, bg, delta, deltaField, loading }) {
  return (
    <SectionCard className="flex items-stretch overflow-hidden">
      <div className={`w-1 shrink-0 ${bg} rounded-l-(--ui-radius-md)`} />
      <div className="p-5 flex-1">
        {loading ? (
          <>
            <Skeleton className="mb-2 h-3 w-24" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="mt-1 h-3 w-28" />
          </>
        ) : (
          <>
            <p className={`mb-1 flex items-center gap-1.5 text-xs font-medium text-(--ui-text-muted)`}>
              {Icon && <Icon size={12} className={color} />}
              {label}
            </p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <div className="mt-1 flex flex-col gap-0.5">
              <p className="text-xs text-(--ui-text-muted)">{subtitle}</p>
              {delta !== undefined && <DeltaArrow current={delta.current} previous={delta.previous} higherIsBetter={delta.higherIsBetter ?? true} />}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}

export default function DashboardKPICards({ data, loading, fmt, isCashier }) {
  const noSales = !loading && (data?.saleCount || 0) === 0;

  if (noSales) {
    return (
      <div className="mb-4 rounded-xl border border-(--ui-border) bg-(--ui-surface) p-6 text-center">
        <p className="text-sm font-medium text-(--ui-text)">No sales yet today.</p>
        <p className="mt-1 text-xs text-(--ui-text-muted)">Open POS to start selling.</p>
      </div>
    );
  }

  const cards = isCashier
    ? [
        {
          label: "Total Revenue Today",
          value: fmt(data?.totalRevenueToday),
          subtitle: `${data?.saleCount || 0} transactions`,
          icon: BarChart3, color: "text-sky-600", bg: "bg-sky-500",
          delta: { current: data?.totalRevenueToday, previous: data?.yesterdayRevenue },
        },
        {
          label: "Average Bill",
          value: fmt(data?.averageBill),
          subtitle: `${data?.saleCount || 0} completed sales`,
          icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-500",
          delta: null,
        },
      ]
    : [
        {
          label: "Average Bill Today",
          value: fmt(data?.averageBill),
          subtitle: `${data?.saleCount || 0} completed sales`,
          icon: BarChart3, color: "text-sky-600", bg: "bg-sky-500",
          delta: null,
        },
        {
          label: "Net Profit Today",
          value: fmt(data?.todayProfit),
          subtitle: "Gross sales minus COGS",
          icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-500",
          delta: { current: data?.todayProfit, previous: data?.yesterdayProfit },
        },
        {
          label: "Refunds Today",
          value: fmt(data?.refundsToday?.value),
          subtitle: `${data?.refundsToday?.count || 0} refund events`,
          icon: AlertTriangle, color: "text-rose-600", bg: "bg-rose-500",
          delta: { current: data?.refundsToday?.value, previous: data?.yesterdayRefunds, higherIsBetter: false },
        },
        {
          label: "Month Sales / Purchases",
          value: `${fmt(data?.monthSales)} / ${fmt(data?.monthPurchases)}`,
          subtitle: "Sales vs received purchase cost",
          icon: Package, color: "text-indigo-600", bg: "bg-indigo-500",
          delta: null,
        },
      ];

  return (
    <div className={`mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 ${isCashier ? "xl:grid-cols-2" : "xl:grid-cols-4"}`}>
      {cards.map((card) => (
        <KPICard key={card.label} {...card} loading={loading} fmt={fmt} />
      ))}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/dashboard/DashboardKPICards.jsx
git commit -m "feat(dashboard): add DashboardKPICards with same-time delta arrows"
```

---

### Task 7: Frontend — `DashboardQuickActions.jsx`

**Files:**
- Create: `frontend/src/pages/dashboard/DashboardQuickActions.jsx`

**Goal:** Role-aware action buttons below the page title.

**Step 1: Create the file**

```jsx
import { useNavigate } from "react-router-dom";
import { BarChart2, Package, ShoppingBag, Users } from "lucide-react";
import { Button } from "../../ui/primitives";

export default function DashboardQuickActions({ isAdmin, isManager }) {
  const navigate = useNavigate();
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <Button tone="primary" onClick={() => navigate("/pos")}>
        <ShoppingBag size={14} className="mr-1.5 inline" /> Open POS
      </Button>
      {(isAdmin || isManager) && (
        <>
          <Button onClick={() => navigate("/reports")}>
            <BarChart2 size={14} className="mr-1.5 inline" /> Reports
          </Button>
          <Button onClick={() => navigate("/cash-management")}>
            View Shift
          </Button>
        </>
      )}
      {isAdmin && (
        <>
          <Button onClick={() => navigate("/inventory")}>
            <Package size={14} className="mr-1.5 inline" /> Add Product
          </Button>
          <Button onClick={() => navigate("/employees")}>
            <Users size={14} className="mr-1.5 inline" /> Employees
          </Button>
        </>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/dashboard/DashboardQuickActions.jsx
git commit -m "feat(dashboard): add role-aware DashboardQuickActions"
```

---

### Task 8: Frontend — `DashboardExceptions.jsx`

**Files:**
- Create: `frontend/src/pages/dashboard/DashboardExceptions.jsx`

**Goal:** Exceptions with ratios. Collapses to single line when all zero.

**Step 1: Create the file**

```jsx
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Badge, Button, SectionCard, Skeleton } from "../../ui/primitives";

export default function DashboardExceptions({ data, loading, fmt }) {
  const navigate = useNavigate();
  const refunds = data?.refundsToday || { count: 0, value: 0, pct_of_sales: 0, pct_of_orders: 0 };
  const voids = data?.voidsToday || { count: 0, value: 0, pct_of_sales: 0, pct_of_orders: 0 };
  const discounts = data?.discountsToday || { count: 0, value: 0, pct_of_sales: 0, pct_of_orders: 0 };
  const leakageTotal = Number(refunds.value || 0) + Number(voids.value || 0) + Number(discounts.value || 0);
  const allZero = leakageTotal === 0;

  const items = [
    { label: "Discounts", data: discounts, threshold: null, tone: "text-amber-600" },
    { label: "Voids",     data: voids,     threshold: 3,    tone: "text-rose-600" },
    { label: "Refunds",   data: refunds,   threshold: 5,    tone: "text-slate-700" },
  ];

  return (
    <SectionCard>
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-(--ui-border)">
        <p className="flex items-center gap-2 text-sm font-semibold text-(--ui-text)">
          <AlertTriangle size={15} className="text-(--ui-primary)" />
          Executive Exceptions
        </p>
        <Badge tone={leakageTotal > 0 ? "warning" : "success"}>
          {loading ? "…" : fmt(leakageTotal)}
        </Badge>
      </div>

      {!loading && allZero ? (
        <p className="px-5 py-4 text-sm text-emerald-700">No exceptions today</p>
      ) : (
        <div className="grid grid-cols-1 gap-px border-t border-(--ui-border) bg-(--ui-border)">
          {items.map((item) => {
            const overThreshold = item.threshold && item.data.pct_of_sales > item.threshold;
            return (
              <div key={item.label} className={`bg-(--ui-surface) px-5 py-4 ${overThreshold ? "bg-rose-50!" : ""}`}>
                {loading ? (
                  <>
                    <Skeleton className="mb-2 h-3 w-20" />
                    <Skeleton className="mb-1 h-6 w-28" />
                    <Skeleton className="h-3 w-36" />
                  </>
                ) : (
                  <>
                    <p className="text-xs font-medium text-(--ui-text-muted)">{item.label}</p>
                    <p className={`mt-1 text-xl font-bold ${overThreshold ? "text-rose-700" : item.tone}`}>
                      {fmt(item.data.value)}
                    </p>
                    <p className="mt-0.5 text-xs text-(--ui-text-muted)">
                      {item.data.count || 0} events
                      {item.data.pct_of_sales > 0 && (
                        <span className={`ml-1.5 font-medium ${overThreshold ? "text-rose-600" : ""}`}>
                          · {item.data.pct_of_sales}% of sales · {item.data.pct_of_orders}% of orders
                        </span>
                      )}
                    </p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && (
        <div className="px-5 pb-4 pt-3">
          <Button size="sm" className="w-full" onClick={() => navigate("/reports")}>
            <ArrowRight size={13} className="mr-1 inline" /> Open revenue leak reports
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/dashboard/DashboardExceptions.jsx
git commit -m "feat(dashboard): add DashboardExceptions with ratios and threshold coloring"
```

---

### Task 9: Frontend — `DashboardOutletRanking.jsx`

**Files:**
- Create: `frontend/src/pages/dashboard/DashboardOutletRanking.jsx`

**Goal:** All-branches only. Outlet leaderboard + anomaly flags.

**Step 1: Create the file**

```jsx
import { useNavigate } from "react-router-dom";
import { AlertTriangle, BarChart3 } from "lucide-react";
import { Badge, Button, SectionCard } from "../../ui/primitives";

export default function DashboardOutletRanking({ data, loading, fmt }) {
  const navigate = useNavigate();
  const salesByOutlet = data?.salesByOutlet || [];
  const readiness = data?.operationalReadiness || [];
  const refunds = data?.refundsToday;

  // Build ranked list merging sales + readiness
  const ranked = salesByOutlet
    .map((s) => {
      const ops = readiness.find((r) => r.outlet_name === s.name) || {};
      return { name: s.name, total: s.total, outlet_id: ops.outlet_id, shift_open: ops.shift_open };
    })
    .sort((a, b) => b.total - a.total);

  // Detect anomalies
  const anomalies = [];
  readiness.forEach((o) => {
    if (!o.shift_open) anomalies.push(`${o.outlet_name}: no shift open`);
  });
  if (refunds?.pct_of_sales > 5) anomalies.push(`High refund rate: ${refunds.pct_of_sales}% of sales`);

  if (loading) {
    return (
      <SectionCard>
        <div className="px-5 pt-4 pb-3 border-b border-(--ui-border)">
          <div className="h-4 w-40 animate-pulse rounded bg-(--ui-muted-surface)" />
        </div>
        <div className="p-5 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-(--ui-muted-surface)" />
          ))}
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-(--ui-border)">
        <p className="flex items-center gap-2 text-sm font-semibold text-(--ui-text)">
          <BarChart3 size={15} className="text-(--ui-primary)" />
          Outlet Performance Today
        </p>
        <Button size="sm" onClick={() => navigate("/reports")}>View Reports</Button>
      </div>

      <div className="divide-y divide-(--ui-border)">
        {ranked.length === 0 ? (
          <p className="px-5 py-6 text-sm text-(--ui-text-muted)">No sales data today.</p>
        ) : (
          ranked.map((outlet, i) => (
            <div key={outlet.name} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs font-bold text-(--ui-text-muted) w-5 shrink-0">#{i + 1}</span>
                <div className={`h-2 w-2 rounded-full shrink-0 ${outlet.shift_open ? "bg-emerald-500" : "bg-amber-400"}`} />
                <span className="truncate text-sm text-(--ui-text)">{outlet.name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-semibold text-(--ui-text)">{fmt(outlet.total)}</span>
                <Badge tone={outlet.shift_open ? "success" : "warning"}>
                  {outlet.shift_open ? "open" : "closed"}
                </Badge>
              </div>
            </div>
          ))
        )}
      </div>

      {anomalies.length > 0 && (
        <div className="border-t border-(--ui-border) px-5 py-3 space-y-1">
          {anomalies.map((a, i) => (
            <p key={i} className="flex items-center gap-1.5 text-xs text-amber-700">
              <AlertTriangle size={11} /> {a}
            </p>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/dashboard/DashboardOutletRanking.jsx
git commit -m "feat(dashboard): add DashboardOutletRanking for all-branches view"
```

---

### Task 10: Frontend — Extract Remaining Section Components

**Files:**
- Create: `frontend/src/pages/dashboard/DashboardContribution.jsx`
- Create: `frontend/src/pages/dashboard/DashboardTrends.jsx`
- Create: `frontend/src/pages/dashboard/DashboardInventoryAlerts.jsx`
- Create: `frontend/src/pages/dashboard/DashboardAttendance.jsx`
- Create: `frontend/src/pages/dashboard/DashboardRecentSales.jsx`

**Goal:** Extract existing functionality from `DashboardRedesign.jsx` monolith into clean focused components. The logic is already written — these are extractions, not new features. Add `item_count` to recent sales and outlet column in all-branches mode.

**Step 1: Create `DashboardContribution.jsx`**

Extract the "Contribution Snapshot" section (category + payment contribution bars) from the current monolith. Signature:

```jsx
export default function DashboardContribution({ data, loading, fmt, isAllBranches }) { ... }
```

Copy the existing Contribution Snapshot JSX from `DashboardRedesign.jsx` (lines ~382-469). Replace hardcoded `"PKRs "` with `fmt(...)`.

**Step 2: Create `DashboardTrends.jsx`**

Extract the "Sales vs Purchases" bar chart section. Also add a "Peak Hour" text card using `data.hourlySales`:

```jsx
// Find peak hour
const peak = (data?.hourlySales || []).reduce((best, h) => h.total > (best?.total || 0) ? h : best, null);
// Display: "Peak: 2:00 PM — PKRs 4,200 / 8 orders"
```

Signature:
```jsx
export default function DashboardTrends({ data, loading, fmt }) { ... }
```

**Step 3: Create `DashboardInventoryAlerts.jsx`**

Extract the "Low Stock Alerts" section. No changes to logic needed — just extract.

Signature:
```jsx
export default function DashboardInventoryAlerts({ data, loading }) { ... }
```

**Step 4: Create `DashboardAttendance.jsx`**

Extract the "Attendance Today" section. No changes to logic needed.

Signature:
```jsx
export default function DashboardAttendance({ data, loading }) { ... }
```

**Step 5: Create `DashboardRecentSales.jsx`**

Extract the "Recent Transactions" section. Add `item_count` display and outlet column in all-branches mode.

```jsx
// In the sale row:
<p className="text-xs text-(--ui-text-muted)">
  {time}
  {sale.item_count ? ` · ${sale.item_count} items` : ""}
  {isAllBranches && sale.outlet_name ? ` · ${sale.outlet_name}` : ""}
</p>
```

Signature:
```jsx
export default function DashboardRecentSales({ recentSales, loading, fmt, isAllBranches }) { ... }
```

**Step 6: Commit all five**

```bash
git add frontend/src/pages/dashboard/DashboardContribution.jsx \
        frontend/src/pages/dashboard/DashboardTrends.jsx \
        frontend/src/pages/dashboard/DashboardInventoryAlerts.jsx \
        frontend/src/pages/dashboard/DashboardAttendance.jsx \
        frontend/src/pages/dashboard/DashboardRecentSales.jsx
git commit -m "feat(dashboard): extract contribution, trends, inventory, attendance, recent sales into modules"
```

---

### Task 11: Frontend — Rewrite `DashboardRedesign.jsx` as Thin Orchestrator

**Files:**
- Modify: `frontend/src/pages/redesign/DashboardRedesign.jsx`

**Goal:** Replace the 714-line monolith with a ~150-line orchestrator that fetches data once and renders section components.

**Step 1: Read the current file first**

Read `frontend/src/pages/redesign/DashboardRedesign.jsx` in full to understand all imports and data dependencies.

**Step 2: Write the new orchestrator**

```jsx
import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { readContext } from "../../auth/authStore";
import { API_BASE as API } from "../../config";
import { PageShell, SectionCard } from "../../ui/primitives";
import { useCurrency } from "../dashboard/DashboardShared";
import DashboardOpsReadiness from "../dashboard/DashboardOpsReadiness";
import DashboardQuickActions from "../dashboard/DashboardQuickActions";
import DashboardKPICards from "../dashboard/DashboardKPICards";
import DashboardExceptions from "../dashboard/DashboardExceptions";
import DashboardOutletRanking from "../dashboard/DashboardOutletRanking";
import DashboardContribution from "../dashboard/DashboardContribution";
import DashboardTrends from "../dashboard/DashboardTrends";
import DashboardInventoryAlerts from "../dashboard/DashboardInventoryAlerts";
import DashboardAttendance from "../dashboard/DashboardAttendance";
import DashboardRecentSales from "../dashboard/DashboardRecentSales";

export default function DashboardRedesign() {
  const { authHeaders, hasPerm } = useAuth();
  const [data, setData] = useState(null);
  const [recentSales, setRecentSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Role detection
  const isAdmin = hasPerm("all_access");
  const isManager = !isAdmin && hasPerm("view_reports");
  const isCashier = !isAdmin && !isManager;

  // Scope detection
  const ctx = readContext();
  const isAllBranches = ctx?.scope_mode === "all_branches";

  const fmt = useCurrency(data);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch(`${API}/api/reports/dashboard`, { headers: authHeaders() }).then((r) => r.json()),
      fetch(`${API}/api/sales?limit=10`, { headers: authHeaders() })
        .then((r) => r.json())
        .catch(() => ({ sales: [] })),
    ])
      .then(([dash, salesData]) => {
        if (!mounted) return;
        setData(dash);
        setRecentSales(salesData.sales || []);
      })
      .catch((e) => { if (mounted) setError(e.message || "Failed to load dashboard"); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [authHeaders]);

  return (
    <PageShell title="Dashboard" subtitle="Today's overview and key metrics.">
      {error && (
        <SectionCard className="mb-4 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      )}

      {/* 1. Role-aware quick actions */}
      <DashboardQuickActions isAdmin={isAdmin} isManager={isManager} />

      {/* 2. Operational readiness — shift + staff + last sale */}
      <DashboardOpsReadiness data={data} loading={loading} />

      {/* 3. KPI cards with same-time deltas */}
      <DashboardKPICards data={data} loading={loading} fmt={fmt} isCashier={isCashier} />

      {/* 4. All-branches: outlet leaderboard + anomalies */}
      {isAllBranches && !isCashier && (
        <div className="mb-4">
          <DashboardOutletRanking data={data} loading={loading} fmt={fmt} />
        </div>
      )}

      {/* 5. Exceptions + Contribution side by side */}
      {!isCashier && (
        <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <DashboardExceptions data={data} loading={loading} fmt={fmt} />
          <div className="xl:col-span-2">
            <DashboardContribution data={data} loading={loading} fmt={fmt} isAllBranches={isAllBranches} />
          </div>
        </div>
      )}

      {/* 6. Attendance */}
      <DashboardAttendance data={data} loading={loading} />

      {/* 7. Trends + Low stock */}
      {!isCashier && (
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DashboardTrends data={data} loading={loading} fmt={fmt} />
          </div>
          <DashboardInventoryAlerts data={data} loading={loading} />
        </div>
      )}

      {/* 8. Recent sales */}
      <DashboardRecentSales
        recentSales={recentSales}
        loading={loading}
        fmt={fmt}
        isAllBranches={isAllBranches}
      />
    </PageShell>
  );
}
```

**Step 3: Verify the app loads**

Start dev server and navigate to `/dashboard`. All sections should render. Check browser console for errors.

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/DashboardRedesign.jsx
git commit -m "refactor(dashboard): replace monolith with modular orchestrator"
```

---

## PHASE 2: Surface Existing Data

### Task 12: Render `hourlySales` as Peak Hour Card + Chart

**Files:**
- Modify: `frontend/src/pages/dashboard/DashboardTrends.jsx`

**Goal:** Add a peak hour summary card using `data.hourlySales` (already in API response).

**Step 1: Add peak hour detection**

```jsx
const hourlySales = data?.hourlySales || [];
const peak = hourlySales.reduce((best, h) => (h.total > (best?.total || 0) ? h : best), null);
```

**Step 2: Add peak hour card above the existing chart**

```jsx
{peak && peak.total > 0 && (
  <div className="px-5 py-3 border-b border-(--ui-border) bg-(--ui-muted-surface)/40">
    <p className="text-xs text-(--ui-text-muted)">
      Peak hour today:{" "}
      <span className="font-semibold text-(--ui-text)">{peak.hour}</span>
      {" — "}{fmt(peak.total)} · {peak.orders} orders
    </p>
  </div>
)}
```

**Step 3: Add 6-month sparkline using `monthlyTrend`**

Add a second section below the 7-day chart showing monthly trend as a small area chart using Recharts `AreaChart`.

**Step 4: Commit**

```bash
git add frontend/src/pages/dashboard/DashboardTrends.jsx
git commit -m "feat(dashboard): surface hourlySales peak and monthlyTrend sparkline"
```

---

### Task 13: Show Work Hours in Attendance + `salesByOutlet` in All-Branches

**Files:**
- Modify: `frontend/src/pages/dashboard/DashboardAttendance.jsx`
- Modify: `frontend/src/pages/dashboard/DashboardOutletRanking.jsx`

**Goal:** Show `net_work_hours` per employee. Use `salesByOutlet` for accurate outlet revenue in ranking.

**Step 1: `DashboardAttendance` — add hours to employee pills**

In the employee pill row, change:
```jsx
// Before:
{emp.name} · {label}
// After:
{emp.name} · {label}{emp.net_work_hours > 0 ? ` · ${emp.net_work_hours.toFixed(1)}h` : ""}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/dashboard/DashboardAttendance.jsx \
        frontend/src/pages/dashboard/DashboardOutletRanking.jsx
git commit -m "feat(dashboard): show work hours in attendance, use salesByOutlet in ranking"
```

---

## PHASE 3: Prescriptive "Needs Attention" Queue

### Task 14: `DashboardAttention.jsx`

**Files:**
- Create: `frontend/src/pages/dashboard/DashboardAttention.jsx`
- Modify: `frontend/src/pages/redesign/DashboardRedesign.jsx`

**Goal:** Auto-generated prioritized list of actionable items. Pure frontend logic.

**Step 1: Create `DashboardAttention.jsx`**

```jsx
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { SectionCard } from "../../ui/primitives";

function buildAlerts(data) {
  const alerts = [];
  const readiness = data?.operationalReadiness || [];
  const refunds = data?.refundsToday;
  const voids = data?.voidsToday;
  const lowStock = data?.lowStock || [];

  readiness.forEach((o) => {
    if (!o.shift_open) {
      alerts.push({
        priority: 1,
        message: `${o.outlet_name}: no shift open — sales blocked`,
        path: "/cash-management",
        label: "Open Shift",
      });
    } else if (o.staff_clocked_in === 0) {
      alerts.push({
        priority: 2,
        message: `${o.outlet_name}: shift open but no staff clocked in`,
        path: "/attendance",
        label: "View Attendance",
      });
    } else if (o.last_sale_at) {
      const minutesAgo = Math.floor((Date.now() - new Date(o.last_sale_at.replace(" ", "T") + "Z").getTime()) / 60000);
      if (minutesAgo > 120) {
        alerts.push({
          priority: 3,
          message: `${o.outlet_name}: no sales for ${Math.floor(minutesAgo / 60)}h ${minutesAgo % 60}m (shift is open)`,
          path: "/pos",
          label: "Open POS",
        });
      }
    }
  });

  if (refunds?.pct_of_sales > 5) {
    alerts.push({
      priority: 2,
      message: `Refund rate at ${refunds.pct_of_sales}% (above 5% threshold)`,
      path: "/reports",
      label: "View Exceptions",
    });
  }
  if (voids?.pct_of_sales > 3) {
    alerts.push({
      priority: 2,
      message: `Void rate at ${voids.pct_of_sales}% (above 3% threshold)`,
      path: "/reports",
      label: "View Exceptions",
    });
  }
  if (lowStock.length > 0) {
    alerts.push({
      priority: 3,
      message: `${lowStock.length} product${lowStock.length > 1 ? "s" : ""} below reorder level`,
      path: "/inventory",
      label: "View Inventory",
    });
  }

  return alerts.sort((a, b) => a.priority - b.priority);
}

export default function DashboardAttention({ data, loading }) {
  const navigate = useNavigate();
  if (loading) return null;

  const alerts = buildAlerts(data);
  if (alerts.length === 0) return null;

  return (
    <SectionCard className="mb-4 border-amber-200 bg-amber-50">
      <div className="px-5 pt-4 pb-3 border-b border-amber-200">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
          <AlertTriangle size={15} />
          Today Needs Attention ({alerts.length})
        </p>
      </div>
      <div className="divide-y divide-amber-100">
        {alerts.map((alert, i) => (
          <div key={i} className="flex items-center justify-between gap-3 px-5 py-3">
            <p className="text-sm text-amber-900">{alert.message}</p>
            <button
              className="shrink-0 text-xs font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900"
              onClick={() => navigate(alert.path)}
            >
              {alert.label}
            </button>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
```

**Step 2: Add to orchestrator**

In `DashboardRedesign.jsx`, import and render `DashboardAttention` between OpsReadiness and KPICards:

```jsx
import DashboardAttention from "../dashboard/DashboardAttention";
// ...
<DashboardOpsReadiness data={data} loading={loading} />
<DashboardAttention data={data} loading={loading} />
<DashboardKPICards data={data} loading={loading} fmt={fmt} isCashier={isCashier} />
```

**Step 3: Commit**

```bash
git add frontend/src/pages/dashboard/DashboardAttention.jsx \
        frontend/src/pages/redesign/DashboardRedesign.jsx
git commit -m "feat(dashboard): add prescriptive DashboardAttention needs-attention queue"
```

---

## PHASE 4: Configuration-Backed Strategy Widgets

### Task 15: Schema Migration — Targets and Thresholds

**Files:**
- Create: `backend/migrate69.js`

**Step 1: Create the migration**

```js
const path = require("path");
const Database = require("sqlite3").Database;

const dbPath = path.resolve(__dirname, "sanopos.db");
const db = new Database(dbPath);

db.serialize(() => {
  db.run(`ALTER TABLE company_profile ADD COLUMN monthly_sales_target REAL DEFAULT 0`, (err) => {
    if (err && !err.message.includes("duplicate column")) console.error(err);
  });
  db.run(`ALTER TABLE company_profile ADD COLUMN margin_threshold_pct REAL DEFAULT 20`, (err) => {
    if (err && !err.message.includes("duplicate column")) console.error(err);
  });
  db.run(`ALTER TABLE company_profile ADD COLUMN refund_threshold_pct REAL DEFAULT 5`, (err) => {
    if (err && !err.message.includes("duplicate column")) console.error(err);
  });
  db.run(`ALTER TABLE company_profile ADD COLUMN void_threshold_pct REAL DEFAULT 3`, (err) => {
    if (err && !err.message.includes("duplicate column")) console.error(err);
  });
  db.run(`ALTER TABLE outlets ADD COLUMN monthly_sales_target REAL DEFAULT 0`, (err) => {
    if (err && !err.message.includes("duplicate column")) console.error(err);
    db.close((e) => { if (e) console.error(e); else console.log("migrate69 complete"); });
  });
});
```

**Step 2: Run locally**

```bash
cd backend && node migrate69.js
```

Expected: `migrate69 complete`

**Step 3: Expose new fields in company-profile route**

In `backend/routes/tier4/company-profile.js`, add the four new columns to the GET response SELECT and the PUT body destructuring + UPDATE query. Follow the exact same pattern as `currency_symbol`/`currency_code`.

**Step 4: Expose in dashboard response**

In `backend/routes/reports/dashboard.js`, add to `res.json({...})`:

```js
targets: {
  monthly_sales_target: req.company?.monthly_sales_target || 0,
  margin_threshold_pct: req.company?.margin_threshold_pct || 20,
  refund_threshold_pct: req.company?.refund_threshold_pct || 5,
  void_threshold_pct: req.company?.void_threshold_pct || 3,
},
```

**Step 5: Commit**

```bash
git add backend/migrate69.js backend/routes/tier4/company-profile.js backend/routes/reports/dashboard.js
git commit -m "feat(dashboard): migrate69 adds target/threshold columns, expose in API"
```

---

### Task 16: Company Settings — Dashboard Targets UI

**Files:**
- Modify: `frontend/src/pages/redesign/CompanySettingsRedesign.jsx`

**Goal:** Add "Dashboard Targets" section with monthly sales target and exception thresholds.

**Step 1: Read CompanySettingsRedesign.jsx** first to understand the form pattern.

**Step 2: Add a "Dashboard Targets" section card** after the regional settings section:

```jsx
<SectionCard>
  <CardHeader title="Dashboard Targets & Thresholds" />
  <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
    <div>
      <label className="text-xs font-medium text-(--ui-text-muted)">Monthly Sales Target</label>
      <Input type="number" min="0" value={form.monthly_sales_target || ""} onChange={(e) => setForm((f) => ({ ...f, monthly_sales_target: e.target.value }))} placeholder="0" />
      <p className="mt-1 text-xs text-(--ui-text-muted)">Target revenue for the current month</p>
    </div>
    <div>
      <label className="text-xs font-medium text-(--ui-text-muted)">Margin Alert Threshold (%)</label>
      <Input type="number" min="0" max="100" value={form.margin_threshold_pct || ""} onChange={(e) => setForm((f) => ({ ...f, margin_threshold_pct: e.target.value }))} placeholder="20" />
    </div>
    <div>
      <label className="text-xs font-medium text-(--ui-text-muted)">Refund Alert Threshold (%)</label>
      <Input type="number" min="0" max="100" value={form.refund_threshold_pct || ""} onChange={(e) => setForm((f) => ({ ...f, refund_threshold_pct: e.target.value }))} placeholder="5" />
    </div>
    <div>
      <label className="text-xs font-medium text-(--ui-text-muted)">Void Alert Threshold (%)</label>
      <Input type="number" min="0" max="100" value={form.void_threshold_pct || ""} onChange={(e) => setForm((f) => ({ ...f, void_threshold_pct: e.target.value }))} placeholder="3" />
    </div>
  </div>
</SectionCard>
```

**Step 3: Update `DashboardAttention` and `DashboardExceptions`** to use `data.targets` thresholds instead of hardcoded values (5, 3).

**Step 4: Add monthly target progress to `DashboardKPICards`**

In the Revenue card, when `data.targets.monthly_sales_target > 0`, show a progress bar:
```jsx
{data?.targets?.monthly_sales_target > 0 && (
  <div className="mt-2">
    <div className="h-1.5 rounded-full bg-(--ui-muted-surface)">
      <div
        className="h-1.5 rounded-full bg-sky-500"
        style={{ width: `${Math.min(100, (data.monthSales / data.targets.monthly_sales_target) * 100)}%` }}
      />
    </div>
    <p className="mt-0.5 text-xs text-(--ui-text-muted)">
      {((data.monthSales / data.targets.monthly_sales_target) * 100).toFixed(1)}% of monthly target
    </p>
  </div>
)}
```

**Step 5: Commit**

```bash
git add frontend/src/pages/redesign/CompanySettingsRedesign.jsx \
        frontend/src/pages/dashboard/DashboardKPICards.jsx \
        frontend/src/pages/dashboard/DashboardAttention.jsx \
        frontend/src/pages/dashboard/DashboardExceptions.jsx
git commit -m "feat(dashboard): add configurable targets and thresholds from company settings"
```

---

## PHASE 5: Drill-Through Consistency

### Task 17: Deep-Link Every Card to Reports with Filters

**Files:**
- Modify: `frontend/src/pages/Reports.jsx`
- Modify: all `frontend/src/pages/dashboard/*.jsx` components

**Goal:** Every dashboard card links to the exact report with outlet + date filters pre-applied.

**Step 1: Update `Reports.jsx` to read URL params on mount**

```jsx
// In Reports.jsx, in useEffect or initialization:
import { useSearchParams } from "react-router-dom";
const [searchParams] = useSearchParams();

// On mount, read tab, sub, outlet_id, date params and apply to state
useEffect(() => {
  const tab = searchParams.get("tab");
  const outletId = searchParams.get("outlet_id");
  const date = searchParams.get("date");
  if (tab) setActiveTab(tab);
  if (outletId) setFilters((f) => ({ ...f, outletIds: [Number(outletId)] }));
  // etc.
}, []); // run once on mount only
```

**Step 2: Add navigation with params to each section component**

Replace bare `navigate("/reports")` calls with parameterized navigation:

```jsx
// In DashboardKPICards — Revenue card
onClick={() => navigate("/reports?tab=sales&date=today")}

// In DashboardExceptions
onClick={() => navigate("/reports?tab=governance&sub=exceptions")}

// In DashboardInventoryAlerts
onClick={() => navigate("/reports?tab=inventory&sub=stockout-risk")}

// In DashboardOutletRanking — per outlet row
onClick={() => navigate(`/reports?tab=sales&outlet_id=${outlet.outlet_id}`)}

// In DashboardTrends — hourly peak
onClick={() => navigate("/reports?tab=analytics&sub=heatmap")}
```

**Step 3: Update `DashboardRecentSales` — link each sale to sales-history**

```jsx
// Make each sale row clickable
<div
  key={sale.id}
  className="... cursor-pointer hover:bg-(--ui-muted-surface)/50"
  onClick={() => navigate(`/sales-history?sale_id=${sale.id}`)}
>
```

**Step 4: Commit**

```bash
git add frontend/src/pages/Reports.jsx \
        frontend/src/pages/dashboard/DashboardKPICards.jsx \
        frontend/src/pages/dashboard/DashboardExceptions.jsx \
        frontend/src/pages/dashboard/DashboardInventoryAlerts.jsx \
        frontend/src/pages/dashboard/DashboardOutletRanking.jsx \
        frontend/src/pages/dashboard/DashboardTrends.jsx \
        frontend/src/pages/dashboard/DashboardRecentSales.jsx
git commit -m "feat(dashboard): add drill-through deep-links to reports with outlet/date filters"
```

---

## Final Verification

After all phases are complete:

1. Start backend: `cd backend && node index.js`
2. Start frontend: `cd frontend && npm run dev`
3. Navigate to `/dashboard` as Admin — verify all sections render
4. Switch to "All Branches" — verify OutletRanking appears, OpsReadiness shows multi-outlet grid
5. Log in as a cashier role — verify simplified view (2 KPI cards, no exceptions, POS-only quick action)
6. Confirm currency symbol matches what's in Company Profile settings
7. Confirm exception ratios show `%` values (not just amounts)
8. Open a shift in Cash Management, return to dashboard — verify READY banner
9. Close the shift — verify BLOCKED banner with "Open Shift" link
10. Run existing test suite: `cd backend && npx jest backend/tests/integration/ --testPathIgnorePatterns=concurrency`

Expected: 296/298 tests passing (2 pre-existing failures in concurrency.test.js).
