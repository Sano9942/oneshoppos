# Redesign Pages — Claude Guide

- **ALL active pages live here** as `*Redesign.jsx` — these are the real implementations (~88 JSX files + CLAUDE.md + pos/ subdirectory)
- **Use `PageShell`** from `ui/primitives.jsx` for page layout (props: `title`, `subtitle`, `right`)
- **Use `SectionCard`** for content sections (props: `children`, `className` only — no `title` prop)
- **Use `api.js`** for all API calls (`api.get`, `api.post`, `api.put`, `api.del`) — never raw `fetch()`
- **Dark mode** works automatically via CSS variables — no special handling needed
- **Permission gating**: Use `hasPerm("perm")` from `useAuth()` to conditionally show/hide UI
- **Feature flag gating**: Use `useFeatureFlags()` hook, check flag inside component, `<Navigate to="/" replace />` if off

## Key Non-Wave-16 Pages

### `POSRedesign.jsx`
Entry point for the POS terminal. Wraps `POSContent` with `<POSProvider>` + `<ErrorBoundary>`. All 12 modals are mounted here (not inside individual components). Has two layouts:
- **Desktop**: Header → SubHeader + SearchArea + CartTable + Sidebar (side-by-side)
- **Mobile**: Tab-driven (Cart / Search / Pay) with sticky Pay button

Phase 2B features rendered inline:
- POS Layout tiles from `posLayout.layout_json` (above `POSCartTable`)
- Item suggestions from `suggestions` (below `POSCartTable`, max 4 shown)

Offline queue amber banner + sync success emerald banner shown at top when queued sales exist.

### `DashboardRedesign.jsx`
Role-aware orchestrator. **Auto-refreshes every 60 seconds** (via `refreshKey` increment). Role detection:
- `isAdmin` = `hasPerm("all_access")`
- `isManager` = has `view_reports` but not `all_access`
- `isCashier` = neither

Scope detection: `isSingleBranch = ctx.scope_mode !== "all_branches"` — `DashboardOutletRanking` only shown in all-branches mode.

Cashier sees only: onboarding (if admin/manager), quick actions, ops readiness, attention queue, KPI cards, attendance, recent sales.

`AIChatPanel` gated by `ai_insights` feature flag. `InsightCards` hidden for cashier. `BackupStatusCard` admin-only. Fetches: `GET /api/reports/dashboard` + `GET /api/sales?limit=10` in parallel.

### `ReportsRedesign.jsx`
Thin wrapper — renders `ReportsPowerUpPanel` above the main `Reports` component. **Exports TWO components**:
- Default: `ReportsRedesign` — full page with Power-Up panel + tabs
- Named: `ReportsTabStandaloneRedesign({ tabId })` — delegates to `ReportTabStandalone` from `pages/Reports.jsx` (used by standalone report tab routes)

### `ShopifyIntegrationRedesign.jsx`
Thin wrapper around legacy `ShopifyIntegration.jsx` — does NOT use `PageShell`. Provides a design-system header strip using **CSS variable tokens** (`--ui-border`, `--ui-surface`, `--ui-text`, `--ui-text-muted`). All Shopify logic stays in the legacy component.

### `ApprovalsRedesign.jsx`
Feature-flag gated: checks `flags.approvals`, redirects to `/` if off. Wraps legacy `Approvals` component in `PageShell`.

### `KioskRedesign.jsx`
Public route (no auth). Key behavior:
- Reads `?tenant=<slug>` and `?outlet=<id>` URL params — also inherits `readContext().active_outlet_id` as fallback
- Checks `kiosk_context_locked` feature flag — locks outlet switcher when enabled
- PIN entry via `POST /api/attendance/pin-status` (NOT `/api/auth/kiosk-login` or `/clock-in`)
- Max PIN length: 8 digits
- Confirmation view auto-resets to idle after 5 seconds
- Has `BREAK_REASONS` list: lunch, prayer, bathroom, personal, other
- Timestamps: uses `fmtLocalTime` + `parseLocalDate` (attendance records are LOCAL time)

### `ProfileRedesign.jsx`
Self-service employee profile. No admin perm required. Fetches: `GET /api/auth/me` + `GET /api/employees/:id/outlets`.
- PIN change: `PUT /api/employees/:id/change-pin` (min 4 digits; requires current_pin)
- Password change: `PUT /api/employees/:id/change-password` (min 8 chars)

### `BillingRedesign.jsx`
After payment gateway redirect, polls `GET /api/billing/status` **every 2s for up to 15 attempts** to confirm webhook activation. Cleans up URL params (`?payment=success&intent=X`) after result via `window.history.replaceState`. Payment plans fetched from `GET /api/billing/pricing` — prices hardcoded as PKR with `monthly_equivalent` + `savings` fields. Annual cycle is `RECOMMENDED_CYCLE`.

### `IntegrationsHubRedesign.jsx`
Unified hub for all integrations. **12 providers in PROVIDER_META**: daraz, shopify, woocommerce, facebook, instagram, whatsapp, google_merchant, xpay, jazzcash, easypaisa, zong_sms, jazz_sms, twilio. Tabs: all, marketplace, social, messaging, feeds, courier, payment, sms. Shopify + WooCommerce cards use `link` (navigate to dedicated page) rather than inline credential form. xPay shows "configured via env vars" note (no form).

### `ImportRedesign.jsx`
**5 tabs** (products, customers, suppliers, **expenses**, **payments**). Workflow: select file → `api.upload /api/import/:tab?preview=1` → preview rows → confirm → `api.upload /api/import/:tab`. Template download uses `API_BASE` directly (not `api.js`) for raw file download. Resets file input on tab switch.

### `FBRSettingsRedesign.jsx`
Provinces hardcoded: `["Punjab", "Sindh", "KPK", "Balochistan", "ICT", "AJK", "Gilgit-Baltistan"]`. Fields: NTN, STRN, province, FBR API token, environment (sandbox/live), default HS code. Has connection test button. Saves to `GET/PUT /api/fbr/config`.

### `PrinterSettingsRedesign.jsx`
Paper sizes hardcoded: 80mm/48, 76mm/42, 58mm/32, 57mm/30 chars, Custom. Default connection: `192.168.1.100:9100`. Supports `all_access` perm gate. Test print via `POST /api/print/test`.

### `MyTicketsRedesign.jsx`
Fetches `GET /api/support/tickets`. Shows status badges (open, acknowledged, resolved, closed) + admin reply column. No permission gate — available to all authenticated employees.

### `ReportsPowerUpPanel.jsx`
Accepts `{ flags }` prop. Returns `null` if none of `reports_profit_layer`, `reports_inventory_health_plus`, `reports_exceptions` are enabled. Collapsible panel with:
- Profit Layer (flag: `reports_profit_layer`) — summary + by-product + by-outlet + discount leakage
- Inventory Health+ (flag: `reports_inventory_health_plus`) — dead stock, aging, stockout risk, forecast, replenishment
- Exception analytics (flag: `reports_exceptions`) — 4 exception types selectable
- Filters (flag: `reports_enhanced_filters`) — date range, outlet, employee, category
- CSV export with metadata header lines (generated_at, currency, filters_applied)
- Uses `useReportFilters()` hook from `hooks/useReportFilters.js`

### `ProductFormPage.jsx`
Standalone product create/edit form. NOT a `*Redesign.jsx`. Uses `useParams()` for edit mode. Has `cartesian()` helper for auto-generating variant combinations from attribute set options. Imports `StarDisplay` + `StarPicker` from `ui/StarRating.jsx`. Uses `API_BASE` as `API` alias (imported from config).

### `CODSettlementsRedesign.jsx`
Orchestrates 3 sub-components from `cod/` subdirectory: `BatchList`, `ImportWizard`, `BatchDetail`. Feature-flag gated (`phase5_cod_settlements`). View state machine: `{ name: "list" }` → `{ name: "import" }` → `{ name: "detail", batchId }`.

---

## Wave-16 Feature Pages

All follow the standard pattern: `PageShell` + `SectionCard` + `useFeatureFlags` check + `<Navigate to="/" replace />` if flag is off. Flag-gated pages do NOT render anything while `flagsLoading`.

| Pages | Feature Flag |
|-------|-------------|
| `AppointmentsRedesign`, `AppointmentsCalendarRedesign`, `AppointmentServicesRedesign` | `phase4_appointments` |
| `RestaurantChecksRedesign`, `RestaurantFloorRedesign`, `KioskOrderingRedesign` | `phase4_restaurant` |
| `KDSRedesign` | `phase4_restaurant_kds` |
| `ContractsRedesign` | `phase4_service_contracts` |
| `ProjectsRedesign` | `phase4_service_projects` |
| `CustomerInvoicesRedesign`, `SubscriptionsRedesign` | `customer_invoicing` / `subscription_billing` |
| `MarketingCampaignsRedesign`, `MessagingInboxRedesign` | `marketing_campaigns` / `customer_messaging` |
| `CommissionPlansRedesign`, `LoyaltyTiersRedesign`, `ReviewModerationRedesign` | no flag guard (always visible) |
| `POSLayoutsRedesign`, `ReturnPoliciesRedesign`, `ScheduledChangesRedesign`, `SchedulingRedesign`, `SmartCollectionsRedesign`, `OutletTaxProfilesRedesign` | Phase 2 flags (`phase2_*`) |
| `ReportBuilderRedesign` | `phase2_report_builder` |
| `CODSettlementsRedesign`, `FulfillmentRedesign` | `phase5_cod_settlements` / `phase5_fulfillment` |
| `ChartOfAccountsRedesign`, `JournalEntriesRedesign`, `CreditDebitNotesRedesign`, `PostdatedChequesRedesign` | `accounting_core` |
| `CustomerGroupsRedesign`, `PriceListsRedesign`, `ReorderAlertsRedesign`, `StockCountRedesign`, `ParkedSalesRedesign`, `NotificationsRedesign` | no flag guard or Phase 2 |

---

## Conventions

### CSV Export
Use `downloadCsv(headers, rows, filename)` from `utils/csvExport.js`. Exception: `ReportsPowerUpPanel` has its own inline `toCsv()` with metadata header lines.

### Currency
Always `const { fmt } = useCurrency()` — never hardcode symbols.

### Timestamps
Use `fmtUtcDateTime`/`fmtLocalDateTime` from `utils/dates.js` — never raw `new Date()`. Exception: `KioskRedesign` uses `fmtLocalTime` + `parseLocalDate` (attendance is LOCAL time).

### Feature Flag Pattern
```jsx
const { flags, loading } = useFeatureFlags(authHeaders);
if (loading) return null;
if (!flags.some_flag) return <Navigate to="/" replace />;
```
No `RequireFeature` wrapper component exists — checks are always inside the component.
