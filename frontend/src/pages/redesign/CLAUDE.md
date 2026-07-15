# redesign — Claude Guide

`redesign/` is the primary tenant UI directory — almost every active tenant-facing page is implemented here as a `*Redesign.jsx` file. The corresponding `pages/*Route.jsx` files (one directory up) are thin lazy-load pass-throughs and should never be edited directly (exceptions: `POSRoute.jsx`/`ReportsRoute.jsx` carry real logic).

Two nested sub-modules also live here: `pos/` (the POS terminal, its own fully documented module) and `field/` (the wholesale field-rep mobile PWA) and `treatment/` (clinical treatment-plan chart components). See their own sections below.

---

## POS Module (`pos/` subdirectory)

The POS terminal is its own self-contained module with a full dedicated guide — see `pos/CLAUDE.md` for hook decomposition, every modal, keyboard shortcuts, and the `completeSale` payload shape. Don't duplicate that detail here. Summary only:

- **`POSRedesign.jsx`** — entry point, wraps content in `<POSProvider>` + `<ErrorBoundary>`. All POS modals mount here, not inside individual components.
- **`POSRestaurantRedesign.jsx`** — table-service variant (floor grid, seat/course picker, split check, table transfer), gated by a restaurant feature flag, uses `pos/restaurant/` components.
- **`POSContext.jsx`** (inside `pos/`) — orchestrator composed from 8 domain hooks behind `usePOS()`.
- POS mostly follows the same `--ui-*` design-system tokens as the rest of `redesign/` now, though it started as a hardcoded-color holdout — check `pos/CLAUDE.md` for the current, precise list of any remaining exceptions.

---

## `field/` subdirectory — wholesale field-rep mobile PWA

`FieldTodayRedesign.jsx` (today's route/visit list — the landing page for the Field Rep role), `FieldCheckInRedesign.jsx` (GPS + selfie check-in/out against a visit), `FieldOrderRedesign.jsx` (order capture, posts to the sales endpoint linked back to the visit), `FieldVanRedesign.jsx` (van inventory/load-out view), `FieldVisitsRedesign.jsx` and `FieldRoutesAdminRedesign.jsx` (owner-level: all-reps visit log + route planning — these require the broader field-sales management permission, not the rep-self one).

---

## `treatment/` subdirectory — clinical chart components

Consumed by `TreatmentPlansRedesign.jsx`, not routed to directly: `DentalChart.jsx`, `BodyChart.jsx` (odontogram/body-map picker components for charting conditions), `AllergyBanner.jsx` (patient allergy warning strip), `VaccinationCardRedesign.jsx` (vaccination history — also reachable read-only from the customer portal for pet/patient subjects).

---

## Domain Page Groups (top-level `*Redesign.jsx` files)

### Core POS/Sales
`SalesHistoryRedesign`, `ReturnsRedesign`, `ParkedSalesRedesign`, `QuotationsRedesign` (must PUT status to `accepted` before `convert` works), `HoldsRedesign` (layaway), `CashManagementRedesign`.

### Products/Catalog
`ProductFormPage` (standalone create/edit, not `*Redesign.jsx` — uses `useParams()` + a `cartesian()` variant-combo generator), `PromotionsRedesign` (includes wholesale slab-percent/tier-rule schemes), `SmartCollectionsRedesign`, `AttributeSetsRedesign`, `BrandsRedesign`, `CategoriesRedesign` (hierarchical, leaf-only assignment), `ReturnPoliciesRedesign`, `ReturnedStockRedesign`, `PriceListsRedesign`, `CustomerGroupPriceBookRedesign` (B2B group pricing).

### Inventory
`InventoryRedesign`, `StockAdjustmentsRedesign`, `TransfersRedesign`, `StockCountRedesign`, `ReorderAlertsRedesign`, `InventoryIntelligenceRedesign` (ABC classification + cycle counts), `ExpiringSoonRedesign` (batch/expiry — FEFO write-offs via `/api/batches/expiring`), `ProductionRedesign` (kit/BOM stock conversions — assembles component products into a finished product via `/api/stock-conversions`).

### Purchasing
`PurchaseOrdersRedesign`, `SupplierPayablesRedesign`, `SuppliersRedesign`.

### Customers/CRM
`CustomersRedesign` (list + detail panel: Profile/Ledger/Order History, wallet top-up, clinical-preset field detection), `CustomerGroupsRedesign`, `CRMRedesign`, `LoyaltyTiersRedesign`, `GiftCardsAdminRedesign`.

### HR/Staff
`EmployeesRedesign` (admin-only), `AdministratorRedesign` (role/permission editor), `HRManagementRedesign`, `AttendanceRedesign` (LOCAL time), `SchedulingRedesign`, `CommissionPlansRedesign`.

**Per-outlet role overrides** — `EmployeesRedesign`'s outlet-assignment block renders a role `<Select>` beside each checked outlet, defaulting to "Inherit (*base role*)". Pure helpers live in `redesign/employeeOutletRoles.js` (`buildOutletRolesMap`, `overridesFromAssignments`) — unit-tested in `frontend/tests/unit/outlet-role-overrides.test.jsx`.
- **Contract gotcha**: `PUT /api/employees/:id/outlets` is **bulk-replace** — omitting `outlet_roles` clears every existing override. The editor therefore always round-trips the *full* map (explicit `role_id`, or `null` for inherit) via `buildOutletRolesMap`. Don't "optimize" it to send only changed entries.
- Unchecking an outlet drops its override from state, so a re-check starts at Inherit rather than silently restoring a stale role.
- An `all_access` override at *any* one outlet is effectively tenant-admin (the backend keys outlet *reach* on base perms, capability on effective) — the page warns on this, checked against the file's existing `role_id === 1 → Administrator` seeding idiom. It's advisory UI and fails open if a tenant's admin role isn't id 1; the real enforcement is server-side.
- `AdministratorRedesign` calls `refreshPreset()` after a role-permission save so the *editing* session's own nav/guards pick up the new set immediately; other employees converge at their next bootstrap or outlet switch.

### Finance
`ExpensesRedesign` (LOCAL time), `AccountingRedesign` (gated by an accounting feature flag, uses `from`/`to` params), `JournalEntriesRedesign`, `ChartOfAccountsRedesign`, `PostdatedChequesRedesign`, `CreditDebitNotesRedesign`, `CustomerInvoicesRedesign` (customer-invoicing flag), `RetailRiskRedesign` (A/R aging, credit risk).

### Reports
`ReportsRedesign` (thin — default export is the full page + Power-Up panel + tabs; named export `ReportsTabStandaloneRedesign({ tabId })` backs deep-linked routes), `ReportBuilderRedesign` (custom report builder, its own feature flag), `ReportsPowerUpPanel` (own inline CSV export, not `downloadCsv`).

### Settings/Config
`OutletsRedesign` (admin-only), `CompanySettingsRedesign`, `PrinterSettingsRedesign` (admin-only, tests via `POST /api/print/test`), `BillingRedesign`, `BackupRestoreRedesign` (admin-only), `OutletTaxProfilesRedesign`, `POSLayoutsRedesign`, `TaxesRedesign`, `BarcodeTemplatesRedesign`/`ReceiptTemplatesRedesign` (both wrap legacy originals in `pages/`), `BusinessModulesRedesign` (`/settings/business-modules` — self-service module toggles: recommended-first + bucket-grouped cards off `GET /api/business-modules`, enable confirm shows prerequisites + which staff roles will gain access before the POST, disable confirm shows live counts + dependents that will stay connected, some cards get Set up/Manage buttons routing to their own setup page, sub-toggles writable only while the parent is on; after any toggle it refetches + calls `refreshFeatureFlags()` + `refreshPreset()` so the sidebar updates in place), `NotificationSettingsRedesign` (channel rules + delivery log + a "send test" action).

### Integrations
`IntegrationsHubRedesign` (unified hub — marketplace/social/messaging/feeds/courier/payment/SMS), `WooCommerceIntegrationRedesign`, `ShopifyIntegrationRedesign` (thin wrapper — logic lives in legacy `pages/ShopifyIntegration.jsx`), `CourierSettingsRedesign` (13 courier adapters), `ImportRedesign` (bulk CSV/XLSX, preview→confirm via `api.upload`), `ImportFromCompetitorRedesign`, `ManufacturerPartnersRedesign` (wholesale secondary-sales brand-partner admin, feeds the manufacturer portal).

### FBR/Tax
`FBRSettingsRedesign`, `FBRDashboardRedesign`, `TaxLookupRedesign`.

### Orders/Fulfillment
`OrdersRedesign`, `FulfillmentRedesign` (picklists/loadsheets/dispatch), `CODSettlementsRedesign` (its own `cod/` subdirectory with a `list → import → detail` view state machine).

### Wholesale/B2B
`BackordersRedesign` (shortfall orders reserved at order-time price, invoiced when stock arrives). Wholesale is otherwise additive across several already-listed files: `CustomerGroupsRedesign`/`CustomerGroupPriceBookRedesign` (catalog visibility + group pricing), `RetailRiskRedesign` (A/R aging), `PromotionsRedesign` (slab/tier schemes), `ManufacturerPartnersRedesign` (brand-partner admin). Field-rep capture (`field/`, above) and the customer/manufacturer portals are separate trees, not additional `redesign/` pages.

### Restaurant
`RestaurantFloorRedesign`, `RestaurantChecksRedesign`, `RestaurantInboxRedesign` (online-ordering inbox), `OrderKiosksRedesign` (admin management of counter-mode customer-kiosk tokens per outlet), `ModifierGroupsRedesign`, `TipPoolsRedesign`, `KDSRedesign` (kitchen display, its own feature flag).

### Clinical / Appointments / Rentals / Rooms / Service
`AppointmentsRedesign`/`AppointmentServicesRedesign`/`AppointmentsCalendarRedesign`, `TreatmentPlansRedesign` (uses the `treatment/` chart components), `RecallsRedesign` (patient recall/reminder scheduling, books directly against a recall), `HandoutsRedesign` (clinic-shared documents, assignable per patient/subject), `RentalsRedesign`, `RoomManagementRedesign`, `ServiceTicketsRedesign` (workflow ticket board), `ProjectsRedesign`, `ContractsRedesign`, `SubscriptionsRedesign` (recurring billing). Each of these is gated by its own vertical feature flag/mode.

### Gym/Studio
`MembersRedesign` (membership check-in, front-desk lookup + check-in flow against `/api/members/*`), `ClassTimetableRedesign` (class sessions, roster, booking against `/api/classes/*`).

### Operations/Admin-Facing
`ApprovalsRedesign` (wraps legacy `Approvals`), `KioskRedesign` (public, no auth, LOCAL time — attendance/member kiosk), `ActionHistoryRedesign` (`date_from`/`date_to`), `ReviewModerationRedesign`, `ScheduledChangesRedesign` (deferred/scheduled catalog changes), `NotificationsRedesign` (mark-read is `PUT /api/notifications/read-all`, not POST), `MessagingInboxRedesign` (customer messaging), `MarketingCampaignsRedesign`.

### User Pages
`DashboardRedesign` (role-aware, auto-refreshes every 60s), `ProfileRedesign` (self-service PIN/password change, no admin perm required), `MyTicketsRedesign` (tenant-side support ticket viewer).

---

## Key Conventions

### Layout Primitives
- `PageShell` from `ui/primitives.jsx` — props: `title`, `subtitle`, `right` (no `actions` prop).
- `SectionCard` from `ui/primitives.jsx` — props: `children`, `className` only (no `title` prop, no shadow).

### API Calls
Always `api.get/post/put/del` from `api.js` — never raw `fetch()` in a redesign page. Paths must include the `/api/` prefix. Use `api.raw` when you need `.ok`/`.status`/`.blob()` directly.

### Feature Flags
```jsx
const { flags, loading } = useFeatureFlags(authHeaders);
if (loading) return null;
if (!flags.some_flag) return <Navigate to="/" replace />;
```
No `RequireFeature` wrapper exists — checks are always inline. Do NOT pass an inline `{}` as `authHeaders` each render — causes an infinite loop.

### Currency
Always `const { fmt } = useCurrency()` — never hardcode a currency symbol.

### Timestamps
- UTC columns (sales, returns, shifts, adjustments): `fmtUtcDateTime`/`fmtUtcDate`/`fmtUtcTime`.
- LOCAL columns (attendance, expenses, GRN, parked sales): `fmtLocalDateTime`/`fmtLocalDate`/`fmtLocalTime`.
- Both from `utils/dates.js`. Never raw `new Date(timestamp)` on a DB value.

### CSV Export
Use `downloadCsv(headers, rows, filename)` from `utils/csvExport.js` for new pages. A few existing pages still use inline Blob code — refactor when touching them, don't copy the pattern into new pages.

### Tailwind v4 Rules
`(--css-var)` not `[var(--css-var)]`; `shrink-0`/`grow` not `flex-shrink-0`/`flex-grow`; `bg-linear-to-br` not `bg-gradient-to-br`; `z-200` not `z-[200]`.

### Design System
The app is light-only — Square design system, `--ui-*` tokens from `ui/tokens.css`, black primary, hairline borders, flat, pill buttons. There is no dark mode to account for. POS was the long-standing hardcoded-color exception, though it has largely migrated to tokens — check `pos/CLAUDE.md` before assuming either state.

### Permission Gating
`hasPerm("perm")` from `useAuth()` to conditionally show/hide UI.

### Hooks Available
| Hook | Source | Key returns |
|------|--------|-------------|
| `useAuth()` | `auth/AuthProvider.jsx` | `hasPerm`, `authHeaders`, `employee`, `isImpersonating` |
| `useCurrency()` | `contexts/CurrencyContext.jsx` | `{ symbol, code, fmt, denominations }` |
| `useToast()` | `contexts/ToastContext.jsx` | `{ toast, success, error, warning }` |
| `useFeatureFlags()` | `hooks/useFeatureFlags.js` | `{ flags, loading }` |
| `usePreset()` | `contexts/PresetContext.jsx` | `{ labels, hasMode, label, enabled_modes, unit_vocabulary, pos_layout_mode }` |
| `usePOS()` | `pos/POSContext.jsx` | All POS state; throws if used outside `POSProvider` |
