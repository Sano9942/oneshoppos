# Dashboard Pages — Claude Guide

- **17 files** — dashboard widget components, all receive data as props from the parent `DashboardRedesign.jsx` unless noted
- All use `SectionCard` from `ui/primitives` for card containers
- Components return `null` when their data is empty/missing — no skeleton states

---

## `DashboardShared.jsx`

Shared helpers re-exported for use by all dashboard components.

**Exports:**

| Export | Type | Notes |
|--------|------|-------|
| `useCurrency` | hook re-export | Re-exported from `contexts/CurrencyContext` — avoids import depth |
| `DeltaArrow` | component | Props: `{ today, yesterday, invert? }`. Shows `↑/↓ N%` vs yesterday. `invert=true` flips green/red (for costs where down is good). Returns `null` if `yesterday == null` or `0`. |
| `RelativeTime` | component | Props: `{ ts }`. Shows "Xm ago / Xh ago / Xd ago / just now" using `parseDbDate`. Returns `"—"` on null. |

---

## `DashboardKPICards.jsx`

Props: `{ data, isCashier, onNavigate }`

**Cashier view:** 2-card grid — Revenue Today + Avg Bill (no profit, no expenses).

**Admin/Manager view:** 4 primary cards (Revenue Today, Net Profit, Avg Bill, Refunds) + optional secondary row (Expenses Today + Month Gross Margin — only shown when either > 0).

**Monthly target progress bar:** shown on Revenue Today card when `data.targets.monthly_sales_target > 0`. Sky-500 fill. Shows `% of monthly target`.

**Internal components:** `KPICard` (with yesterday delta), `AbsDelta` (absolute "↑ PKR N vs yesterday"), `SecondaryKPICard` (no delta, just label+value).

**All-zero guard:** shows "No sales yet today. Open POS to start selling" if `totalRevenueToday === 0 && !todayProfit && !saleCount`.

---

## `DashboardTrends.jsx`

Props: `{ data }`

Uses **Recharts**: `BarChart` for 7-day revenue (`data.salesTrend`), `AreaChart` for 6-month trend (`data.monthlyTrend`).

**Peak hour badge:** shown above 7-day chart when `peakHour.hour` is set — reads from `data.hourlySales` (finds max `total`).

**Renders nothing** if both `salesTrend` and `hourlySales` are empty. Monthly trend section is separate and renders independently.

Chart colors use CSS vars: `var(--ui-primary)`, `var(--ui-border)`.

---

## `DashboardAttendance.jsx`

Props: `{ data, isCashier, currentEmployeeId }`

**Cashier view:** only shows the row matching `currentEmployeeId`.
**Admin/Manager view:** all staff rows + summary header (N in · N break · N out).

Status badge mapping:

| Status key | Tone | Label |
|------------|------|-------|
| `clocked_in` | success | In |
| `on_break` | warning | Break |
| `clocked_out` | default | Out |
| `not_started` | default | — |

Returns null if `visible.length === 0`.

---

## `DashboardOpsReadiness.jsx`

Props: `{ data, isSingleBranch }`

**Single-branch view:** full-width card with "READY TO SELL" (emerald) or "SHIFT REQUIRED" (amber). Includes "Open Shift" → `/cash-management` and "Attendance" → `/attendance` buttons.

**Multi-branch view:** grid of `OutletCard` components (internal). Each outlet card shows shift status, employee count, last sale time. "Open shift →" link when no shift.

Returns null if no outlets.

---

## `DashboardAttention.jsx`

Props: `{ data, onNavigate }`

**Pure frontend rules engine** — no API calls. Runs `buildAlerts(data)` on passed-in dashboard data.

**Alert rules (in priority order):**

| Severity | Condition | Link |
|----------|-----------|------|
| `high` | Any outlet with no open shift | `/cash-management` |
| `medium` | Open shift but no sales in 2+ hours | `/sales-history` |
| `medium` | Refund% ≥ `targets.refund_threshold_pct` (default 5%) | `/reports?tab=governance&sub=exceptions` |
| `medium` | Void% ≥ `targets.void_threshold_pct` (default 3%) | same |
| `low` | Any `data.lowStock` items | `/inventory` |

Severity styles: high=red, medium=amber, low=blue.

Returns null if no alerts.

---

## `DashboardExceptions.jsx`

Props: `{ data, onNavigate }`

Shows Discounts / Voids / Refunds as clickable rows with value + % of sales. Each row has warn/danger thresholds from `data.targets`.

- Discounts: warn at 10%, danger at 20%
- Voids: warn at `voidWarn`, danger at `voidWarn * 2`
- Refunds: warn at `refundWarn`, danger at `refundWarn * 2`

Returns "No exceptions today" card if all values are 0.

---

## `DashboardInventoryAlerts.jsx`

Props: `{ data }`

Shows **two sections** (either or both may render):
1. **Inventory value header** (always shown when `data.inventoryValue` present): total_units, retail_value, cost_value
2. **Low stock list** (shown when `data.lowStock` has items): name + stock count + price

Returns null only if both `alerts.length === 0` AND `!iv`.

"View all →" navigates to `/inventory`.

---

## `DashboardContribution.jsx`

Props: `{ data }`

Two side-by-side `SectionCard`s (pure CSS bars, no chart library):
- **Payment Methods** (`data.paymentContribution`) — by `payment_method`
- **Top Categories (30d)** (`data.categoryContribution`) — by `category`

Returns null if both arrays empty.

---

## `DashboardOutletRanking.jsx`

Props: `{ data, onNavigate }`

Shows ranked list of outlets by `data.salesByOutlet`. Each row clickable → `/reports?tab=sales&outlet_id=N`. Green/amber dot for shift open status.

**Anomaly banner:** shown below list if any outlet has no shift open OR refund% ≥ 5%. Hardcoded 5% threshold (does not read `targets`).

Returns null if `outlets.length === 0`.

---

## `DashboardRecentSales.jsx`

Props: `{ recentSales, data, isSingleBranch, onNavigate }`

Table of recent sales. Outlet column hidden in single-branch mode. Rows clickable → `/sales-history?sale_id=N`.

Uses `fmtDateTime` (UTC formatter) for sale timestamps.

Shows "No transactions yet" card when `recentSales` is empty.

---

## `DashboardTopProducts.jsx`

Props: `{ data }`

Top 5 products from `data.topProducts` (`slice(0, 5)`). CSS bars relative to `maxQty`. Shows `name` + `units_sold`.

Returns null if empty.

---

## `DashboardQuickActions.jsx`

Props: `{ isAdmin, isManager }`

Role-filtered action buttons:

| Role | Actions |
|------|---------|
| admin | POS (new tab), Reports, Cash Management, Add Product, Employees |
| manager | POS (new tab), Reports, Cash Management |
| cashier | POS (new tab) only |

POS opens via `window.open("/pos", "_blank")`. All others navigate in-place.

---

## `DashboardOnboarding.jsx`

Props: `{ data, onNavigate }`

First-run checklist (5 steps). Hidden once dismissed.

**Dual-persistence dismissal:**
1. `localStorage["onboarding_dismissed"] === "1"` — checked first (instant)
2. `GET /api/company-profile` — checks `profile.onboarding_dismissed` on mount (server authoritative)

**5 onboarding steps** (derived from `data`):

| Step | Done condition |
|------|----------------|
| Set up your store | `!!data` (any data present) |
| Add your first product | `inventory.total_products > 0` |
| Add employees | `attendanceSummary.total_employees > 1` |
| Open a shift | `operationalReadiness.some(o => o.shift_open)` |
| Make your first sale | `saleCount > 0` OR `totalRevenueToday > 0` |

**Auto-dismiss:** when all steps done, fires `setTimeout` for **3 seconds** then persists dismissal via `PUT /api/company-profile/onboarding-dismiss` (uses `api.raw`).

Not shown until `serverChecked === true` (prevents flash before server response).

---

## `BackupStatusCard.jsx`

No props. Calls `useAuth()` for `hasPerm`.

**Only renders for `all_access` admins** — returns null for all other roles.

**Fetches `GET /api/backup-status`** independently on mount (not from parent data).

**Status thresholds:**

| State | Condition | Style |
|-------|-----------|-------|
| Backup OK | ≤24h old, not failed | emerald |
| Backup Aging | >24h but ≤72h | amber |
| No Recent Backup | >72h OR no backup record | rose |
| Backup Failed | `backup.status === "failed"` | rose |

Shows `error_message` on failure. Shows `duration_ms` if set (formatted as ms or s).

---

## `InsightCards.jsx`

No props.

Fetches `GET /api/insights/auto` **independently** on mount. Returns null if empty or still loading.

**5 card types** with icons + colors:

| Type | Icon | Colors |
|------|------|--------|
| `revenue_trend` | DollarSign | emerald |
| `top_products` | Package | blue |
| `low_stock` | AlertTriangle | amber |
| `busiest_hour` | Clock | violet |
| `avg_transaction` | DollarSign | emerald |

`isCurrency` formatting applied for `revenue_trend` and `avg_transaction` types.

Uses `useCurrency()` from `contexts/CurrencyContext` (NOT from `DashboardShared`).

---

## `AIChatPanel.jsx`

Props: `{ flagEnabled }`

**Returns null if `flagEnabled` is falsy** — must be explicitly gated by parent.

Floating chat panel (bottom-right, fixed position — renders outside normal flow). Toggle button with `Sparkles` icon.

Sends `POST /api/insights/ask` with `{ question }` via `api.raw`. Response field: `data.answer`.

Messages stored as `[{ role: "user"|"ai", text }]`. Auto-scrolls to bottom on new messages. Input focused when panel opens.
