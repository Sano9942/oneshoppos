# Operations Dashboard Redesign

## Problem

The current dashboard is a report page — it shows revenue cards and charts but doesn't answer the first question a shop owner has: "Can this outlet sell right now?" It's not shift-aware, scope-aware, or role-aware, and it hardcodes currency, ignores unused backend data, and shows misleading comparisons.

## Design Principles

1. **Operations first, reports second** — shift status and staff readiness before revenue cards
2. **Shift-aware** — sales are blocked without open shift + clocked-in employee; dashboard must surface this
3. **Scope-aware** — single-branch sees floor operations; all-branches sees outlet ranking + anomalies
4. **Role-aware** — admin/manager/cashier see different sections and quick actions
5. **Same-time comparisons** — today-up-to-now vs yesterday-up-to-now, not full-day vs full-day
6. **Currency from config** — read `company_profile.currency_symbol`, never hardcode "PKRs"
7. **Prescriptive, not just descriptive** — "needs attention" queue tells you what to do

## Architecture: Modular Dashboard (Approach B)

Matches the existing `pages/reports/` and `routes/shopify/` modular patterns.

### Frontend Structure

```
frontend/src/pages/dashboard/
  DashboardShared.jsx          — Currency formatter, delta arrow, shared constants
  DashboardOpsReadiness.jsx    — Shift status, staff count, last sale timer
  DashboardKPICards.jsx        — Revenue, profit, avg bill, refunds (with deltas)
  DashboardExceptions.jsx      — Discounts/voids/refunds with ratios
  DashboardContribution.jsx    — Category + payment contribution
  DashboardOutletRanking.jsx   — All-branches leaderboard + anomaly flags
  DashboardTrends.jsx          — Hourly peak, 7-day chart, 6-month sparkline
  DashboardInventoryAlerts.jsx — Low stock + reorder link
  DashboardRecentSales.jsx     — Recent transactions with item count + outlet
  DashboardAttendance.jsx      — Staff attendance tiles
  DashboardQuickActions.jsx    — Role-aware action buttons
```

### Orchestrator (`DashboardRedesign.jsx`)

Thin (~150 lines). Single fetch, reads scope + permissions, passes props to sections.

### Conditional Rendering Matrix

| Section            | Single Branch | All Branches | Admin | Manager | Cashier |
|--------------------|:-----------:|:----------:|:---:|:-----:|:-----:|
| OpsReadiness       | 1 outlet    | all outlets | Y   | Y     | Y     |
| KPICards           | Y           | aggregated  | Y   | Y     | simplified |
| QuickActions       | POS + Shift | POS + Reports | full | medium | POS only |
| Exceptions         | Y           | Y           | Y   | Y     | hidden |
| OutletRanking      | hidden      | Y           | Y   | Y     | hidden |
| Trends             | 7d + hourly | 7d + 6mo + hourly | Y | Y  | hidden |
| Contribution       | Y           | Y           | Y   | Y     | hidden |
| InventoryAlerts    | Y           | Y           | Y   | Y     | hidden |
| Attendance         | Y           | all outlets | Y   | Y     | own only |
| RecentSales        | Y + items   | Y + outlet col | Y | Y   | Y     |

Role detection uses existing `hasPerm`:
- Admin: `hasPerm("all_access")` true
- Manager: `hasPerm("view_reports")` true, `hasPerm("all_access")` false
- Cashier: neither

---

## Phase 1: Fix Usefulness

### Backend Changes (extend `/api/reports/dashboard`)

**Same-time comparison fields:**
```
yesterdayRevenue     — revenue yesterday up to same hour
yesterdaySaleCount   — transaction count yesterday up to same hour
yesterdayProfit      — net profit yesterday up to same hour
yesterdayRefunds     — refund value yesterday up to same hour
```

Computation: `yesterdayStart = todayStart - 24h`, filter `timestamp >= yesterdayStart AND timestamp < yesterdayStart + elapsed`, where `elapsed = now - todayStart`.

**Operational readiness (per outlet):**
```json
"operationalReadiness": [
  {
    "outlet_id": 1,
    "outlet_name": "Main Store",
    "shift_open": true,
    "shift_employee": "Hassan",
    "shift_opened_at": "2026-03-07 09:02:00",
    "opening_float": 5000,
    "staff_clocked_in": 3,
    "staff_on_break": 1,
    "staff_total": 5,
    "last_sale_at": "2026-03-07 14:23:11"
  }
]
```

Queries: `cash_shifts` (status='open') per outlet, attendance session counts per outlet, `MAX(timestamp)` from sales per outlet.

**Currency from company_profile:**
```json
"currency": { "symbol": "PKRs", "code": "PKR" }
```

Read from `req.company.currency_symbol` and `req.company.currency_code`.

**Exception ratios (enhance existing fields):**
```json
"refundsToday":   { "count": 2, "value": 500, "pct_of_sales": 1.3, "pct_of_orders": 0.8 },
"voidsToday":     { "count": 0, "value": 0, "pct_of_sales": 0, "pct_of_orders": 0 },
"discountsToday": { "count": 12, "value": 1200, "pct_of_sales": 3.2, "pct_of_orders": 4.8 }
```

No new endpoints. No schema changes.

### Frontend Phase 1 Components

**DashboardOpsReadiness:**
- Single branch: status banner (READY/BLOCKED), shift info, staff counts, last sale relative time, links to Cash Management + Attendance
- All branches: outlet cards grid, each with shift/staff/last-sale, color-coded green/amber
- When shift closed: amber banner with "Open Shift" link to Cash Management page

**DashboardKPICards:**
- 4 cards: Revenue, Profit, Avg Bill, Refunds
- Each shows same-time delta arrow (up/down % vs yesterday)
- Month snapshot (stock units, margin, top seller) collapsed into a single inline row below
- Cashier: only Revenue + Avg Bill (2 cards, full width)
- Zero state: all zeros collapse to single banner "No sales yet today. [Open POS]"

**DashboardExceptions:**
- 3 rows: Discounts, Voids, Refunds
- Each shows: value, % of sales, count of N orders
- Threshold coloring: refund > 5% = red, voids > 3% = amber (hardcoded Phase 1, configurable Phase 4)
- Zero state: single line "No exceptions today" (collapsed)

**DashboardOutletRanking (all-branches only):**
- Ranked list: outlet name, revenue, sale count, readiness dot
- Anomaly flags below: "Branch B: no shift open", "Branch A: refunds at 8.1%"

**DashboardQuickActions:**
- Horizontal button bar below page title (replaces lone "Open POS" button)
- Admin: Open POS, View Reports, View Shift, Add Product, Manage Employees
- Manager: Open POS, View Reports, View Shift
- Cashier: Open POS

**DashboardRecentSales:**
- Add item_count (already in sales API response)
- Add outlet_name column in all-branches mode

**DashboardShared:**
- `useCurrency(data)` hook — returns formatter using `data.currency.symbol`
- `DeltaArrow` component — shows percentage change with color
- `RelativeTime` component — "14m ago", "2h ago", "yesterday"

**DashboardContribution, DashboardAttendance, DashboardTrends, DashboardInventoryAlerts:**
- Extracted from current monolith with minimal changes in Phase 1
- Trends renders existing `hourlySales` as peak-hour highlight text (full chart in Phase 2)

**Zero states:**
- KPI all zeros: "No sales yet today. [Open POS to start selling]"
- Exceptions all zeros: "No exceptions today" (one line)
- Recent sales empty: "No transactions yet. First sale will appear here."
- Payment contribution empty: hidden (don't show empty half)

---

## Phase 2: Surface Existing Data

No new backend queries needed (data already returned).

- **DashboardTrends**: Full hourly bar chart from `hourlySales`, 6-month area chart from `monthlyTrend`, `salesByOutlet` visualization
- **DashboardAttendance**: Show `net_work_hours` per employee
- **DashboardExceptions**: Mini 7-day exception trend chart (one new backend query)

## Phase 3: Prescriptive "Needs Attention" Queue

New component: `DashboardAttention.jsx`, positioned below OpsReadiness.

Prioritized actionable list, auto-generated from dashboard data:

Rules engine (pure frontend):
- Shift not open at any outlet -> alert
- Staff not clocked in during business hours -> alert
- Low stock items > 0 -> alert with count
- Refund/void % above threshold -> alert
- No sales for 2+ hours with shift open -> alert

Each item links to the relevant page with context.

## Phase 4: Configuration-Backed Strategy Widgets

**Schema addition** (`migrate69.js`):
```sql
ALTER TABLE company_profile ADD COLUMN monthly_sales_target REAL DEFAULT 0;
ALTER TABLE company_profile ADD COLUMN margin_threshold_pct REAL DEFAULT 20;
ALTER TABLE company_profile ADD COLUMN refund_threshold_pct REAL DEFAULT 5;
ALTER TABLE company_profile ADD COLUMN void_threshold_pct REAL DEFAULT 3;
ALTER TABLE outlets ADD COLUMN monthly_sales_target REAL DEFAULT 0;
```

**Settings UI**: "Dashboard Targets" section in Company Settings.

**Dashboard widgets**:
- Monthly target progress bar on KPI cards
- Per-outlet targets in OutletRanking
- Attention queue uses configurable thresholds
- Margin card shows red/green based on `margin_threshold_pct`

## Phase 5: Drill-Through Consistency

Every card deep-links to the exact report with matching filters:

| Dashboard Section | Links To | Params |
|---|---|---|
| Revenue KPI | `/reports?tab=sales&date=today` | outlet, date |
| Profit KPI | `/reports?tab=finance&date=today` | outlet, date |
| Exceptions | `/reports?tab=governance&sub=exceptions` | outlet, date |
| Low Stock | `/reports?tab=inventory&sub=stockout-risk` | outlet |
| Outlet Ranking item | `/reports?tab=sales&outlet_id=X` | outlet |
| Attendance | `/attendance` | date |
| Recent Sales item | `/sales-history?sale_id=X` | sale id |
| Hourly Peak | `/reports?tab=analytics&sub=heatmap` | outlet, date |

Reports page reads URL params on mount and auto-applies filters.

---

## Files Modified

### Phase 1
- `backend/routes/reports/dashboard.js` — add yesterday comparison, operational readiness, currency, exception ratios
- `frontend/src/pages/redesign/DashboardRedesign.jsx` — rewrite as thin orchestrator
- `frontend/src/pages/dashboard/*.jsx` — 11 new module files
- No schema changes. No new endpoints.

### Phase 4
- `backend/migrate69.js` — new migration for target/threshold columns
- `backend/routes/tier4/company-profile.js` — expose new fields
- `frontend/src/pages/redesign/CompanySettingsRedesign.jsx` — targets UI section

### Phase 5
- `frontend/src/pages/Reports.jsx` — read URL params on mount
- All dashboard section components — add navigation with filter params
