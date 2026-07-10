# redesign — Claude Guide

`redesign/` is the primary tenant UI directory — almost every active tenant-facing page is implemented here as a `*Redesign.jsx` file. The corresponding `pages/*Route.jsx` files (one directory up) are thin lazy-load pass-throughs and should never be edited directly (exceptions: `POSRoute.jsx`/`ReportsRoute.jsx` carry real logic).

---

## POS Module (`pos/` subdirectory)

The POS terminal is its own self-contained module with a full dedicated guide — see `pos/CLAUDE.md` for hook decomposition, every modal, keyboard shortcuts, and the `completeSale` payload shape. Don't duplicate that detail here. Summary only:

- **`POSRedesign.jsx`** — entry point, wraps content in `<POSProvider>` + `<ErrorBoundary>`. All POS modals mount here, not inside individual components.
- **`POSRestaurantRedesign.jsx`** — table-service variant (floor grid, seat/course picker, split check, table transfer), gated `phase4_restaurant`, uses `pos/restaurant/` components.
- **`POSContext.jsx`** — orchestrator composed from 8 domain hooks behind `usePOS()`.
- POS does **not** use the `--ui-*` design-system tokens for most of its own top-level components historically, though it has migrated to `--ui-*` tokens for the bulk of its UI — check `pos/CLAUDE.md` for the current, precise list of remaining hardcoded-color exceptions before assuming either way.

---

## Domain Page Groups

### Core POS/Sales
`SalesHistoryRedesign`, `ReturnsRedesign`, `ParkedSalesRedesign`, `QuotationsRedesign` (must PUT status to `accepted` before `convert` works), `HoldsRedesign`, `CashManagementRedesign`.

### Products/Catalog
`ProductFormPage` (standalone create/edit, not `*Redesign.jsx`, uses `useParams()` + a `cartesian()` variant-combo generator), `PromotionsRedesign` (incl. wholesale slab-percent/tier-rule schemes), `SmartCollectionsRedesign`, `AttributeSetsRedesign`, `BrandsRedesign`, `CategoriesRedesign` (hierarchical, leaf-only assignment), `ReturnPoliciesRedesign`, `ReturnedStockRedesign`, `PriceListsRedesign`, `CustomerGroupPriceBookRedesign` (B2B group pricing).

### Inventory
`InventoryRedesign`, `StockAdjustmentsRedesign`, `TransfersRedesign`, `StockCountRedesign`, `ReorderAlertsRedesign`, `InventoryIntelligenceRedesign`.

### Purchasing
`PurchaseOrdersRedesign`, `SupplierPayablesRedesign`, `SuppliersRedesign`.

### Customers/CRM
`CustomersRedesign` (list + detail panel: Profile/Ledger/Order History, wallet top-up, clinical-preset field detection), `CustomerGroupsRedesign`, `CRMRedesign`, `LoyaltyTiersRedesign`, `GiftCardsAdminRedesign`.

### HR/Staff
`EmployeesRedesign` (admin-only), `AdministratorRedesign`, `HRManagementRedesign`, `AttendanceRedesign` (LOCAL time), `SchedulingRedesign`, `CommissionPlansRedesign`.

### Finance
`ExpensesRedesign` (LOCAL time), `AccountingRedesign` (`accounting_core` flag, `from`/`to` params), `JournalEntriesRedesign`, `ChartOfAccountsRedesign`, `PostdatedChequesRedesign`, `CreditDebitNotesRedesign`, `CustomerInvoicesRedesign` (`customer_invoicing` flag), `RetailRiskRedesign` (A/R aging, credit risk).

### Reports
`ReportsRedesign` (thin — default export is the full page + Power-Up panel + tabs; named export `ReportsTabStandaloneRedesign({ tabId })` backs deep-linked routes), `ReportBuilderRedesign` (`phase2_report_builder`), `ReportsPowerUpPanel` (own inline CSV export, not `downloadCsv`).

### Settings/Config
`OutletsRedesign` (admin-only), `CompanySettingsRedesign`, `PrinterSettingsRedesign` (`all_access` gated, tests via `POST /api/print/test`), `BillingRedesign`, `BackupRestoreRedesign` (admin-only), `OutletTaxProfilesRedesign`, `POSLayoutsRedesign`, `TaxesRedesign`, `BarcodeTemplatesRedesign`/`ReceiptTemplatesRedesign` (both wrap legacy originals in `pages/`).

### Integrations
`IntegrationsHubRedesign` (unified hub — marketplace/social/messaging/feeds/courier/payment/SMS), `WooCommerceIntegrationRedesign`, `ShopifyIntegrationRedesign` (thin wrapper — logic lives in legacy `pages/ShopifyIntegration.jsx`), `CourierSettingsRedesign` (13 adapters), `ImportRedesign` (bulk CSV/XLSX, preview→confirm via `api.upload`), `ImportFromCompetitorRedesign`, `ManufacturerPartnersRedesign` (Tier 1.4/1.5 wholesale, feeds the manufacturer portal).

### FBR/Tax
`FBRSettingsRedesign`, `FBRDashboardRedesign`, `TaxLookupRedesign`.

### Orders/Fulfillment
`OrdersRedesign`, `FulfillmentRedesign`, `CODSettlementsRedesign` (`phase5_cod_reconciliation`, own `cod/` subdirectory with a `list → import → detail` view state machine).

### Vertical/Specialty (services, clinical, wholesale B2B)
`ServiceTicketsRedesign` (`phase4_workflow_tickets`), `AppointmentsRedesign`/`AppointmentServicesRedesign`/`AppointmentsCalendarRedesign` (`phase4_appointments`), `RentalsRedesign` (`phase4_rentals` + `manage_rentals`), `RoomManagementRedesign` (`phase4_room_management`), `TreatmentPlansRedesign` (`phase4_treatment_plans` + `manage_treatment_plans`, uses `treatment/` chart components), `ProjectsRedesign` (`phase4_service_projects`), `ContractsRedesign` (`phase4_service_contracts`), `SubscriptionsRedesign` (`subscription_billing`).

Wholesale/B2B (Tiers 0–2) is additive across several already-listed files: `CustomerGroupsRedesign`/`CustomerGroupPriceBookRedesign` (catalog visibility + group pricing), `RetailRiskRedesign` (A/R aging), `PromotionsRedesign` (slab/tier schemes), `ManufacturerPartnersRedesign` (brand-partner admin). Field-rep capture and the customer/manufacturer portals are separate route trees, not `redesign/` pages.

### Restaurant
`RestaurantFloorRedesign`, `RestaurantChecksRedesign`, `RestaurantInboxRedesign`, `ModifierGroupsRedesign`, `TipPoolsRedesign` (all `phase4_restaurant`), `KDSRedesign` (`phase4_restaurant_kds`).

### Operations/Admin-Facing
`ApprovalsRedesign` (wraps legacy `Approvals`), `KioskRedesign` (public, no auth, LOCAL time), `KioskOrderingRedesign` (`phase4_restaurant`), `ActionHistoryRedesign` (`date_from`/`date_to`), `ReviewModerationRedesign`, `ScheduledChangesRedesign` (`phase2_scheduled_changes`), `NotificationsRedesign` (mark-read is `PUT /api/notifications/read-all`, not POST), `MessagingInboxRedesign` (`customer_messaging`), `MarketingCampaignsRedesign` (`marketing_campaigns`).

### User Pages
`DashboardRedesign` (role-aware, auto-refreshes every 60s), `ProfileRedesign` (self-service PIN/password change, no admin perm required), `MyTicketsRedesign`.

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
The app is light-only — Square design system, `--ui-*` tokens from `ui/tokens.css`, black primary, hairline borders, flat, pill buttons. There is no dark mode to account for. POS is the long-standing hardcoded-color exception, though it has been migrating toward tokens — check `pos/CLAUDE.md` before assuming either state.

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
