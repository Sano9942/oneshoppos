# Dashboard Pages — Claude Guide

- **17 files** — dashboard widget components, all receive data as props from parent fetch
- **`DashboardShared.jsx`** — re-exports `useCurrency`. Local helpers: `DeltaArrow` component, `RelativeTime` component
- **KPI & Metrics**: `DashboardKPICards` (revenue, transactions, avg-basket with deltas), `DashboardTrends` (Recharts BarChart + AreaChart), `DashboardContribution` (pure CSS bars), `DashboardOutletRanking`
- **Operational**: `DashboardAttendance` (with Badge STATUS_TONE map), `DashboardOpsReadiness` (shift open, recent activity), `DashboardRecentSales`, `DashboardTopProducts`
- **Alerts**: `DashboardInventoryAlerts` (low/out-of-stock, navigates to inventory), `DashboardExceptions` (expense/discount % thresholds), `DashboardAttention` (uses `parseDbDate` for age)
- **Special**: `DashboardOnboarding` (first-run checklist, dismissible), `DashboardQuickActions` (POS opens in new tab), `BackupStatusCard` (uses `useAuth` for admin token), `AIChatPanel` (floating AI chat), `InsightCards` (AI-generated, fetches from API)
- **All use `SectionCard`** from `ui/primitives`
