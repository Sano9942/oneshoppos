# Redesign Pages — Claude Guide

`redesign/` is the primary tenant UI directory. All active tenant-facing page implementations live here as `*Redesign.jsx`. Route wrappers (`*Route.jsx` in `pages/`) are thin pass-throughs — never edit them (except `POSRoute.jsx`/`ReportsRoute.jsx`, which carry real logic).

---

## POS Module (`pos/` subdirectory)

The POS terminal is its own self-contained module — see `pos/CLAUDE.md` for the full detail (hook decomposition, all modals, gotchas, keyboard shortcuts, `completeSale` payload). Summary only:

- **`POSRedesign.jsx`** — entry point. Wraps `POSContent` in `<POSProvider>` + `<ErrorBoundary>`. All POS modals mount here, not inside individual components. Desktop (side-by-side) vs mobile (tab-driven Cart/Search/Pay) layouts.
- **`POSRestaurantRedesign.jsx`** — table-service variant, gated `phase4_restaurant`. Uses `pos/restaurant/` components (floor grid, seat/course picker, split check, table transfer).
- **`POSContext.jsx`** — orchestrator composed from 8 domain hooks (`useShiftGate`, `useCart`, `useReceipt`, `useCustomerDisplay`, `useLoyaltyWallet`, `useFolioCharging`, `useOfflineQueue`, `useCheckout`), ~165 exports via `usePOS()`.
- **Critical gotcha**: `completeSale` uses `api.raw` (not `api.post`) to inspect status codes mid-checkout (401 session expiry, insufficient stock, wholesale credit-limit exceeded). Do not refactor to `api.post`.
- POS does **not** use design-system tokens — hardcoded `#8066FF` accent, `slate-*`, dark sidebar. Exceptions: `POSShortcutsOverlay`, `EndlessAisleModal`.

---

## Domain Page Groups

### Core POS/Sales

| File | What it does |
|------|-------------|
| `SalesHistoryRedesign` | Sales list + detail panel; CSV inline blob (refactor to `downloadCsv` when touching) |
| `ReturnsRedesign` | Return list and status management |
| `ParkedSalesRedesign` | Parked draft orders; no flag guard |
| `QuotationsRedesign` | Quotations; must PUT status to `accepted` before `convert` works |
| `HoldsRedesign` | Layaway holds management; no flag guard |
| `CashManagementRedesign` | Shift open/close + cash drawer management |

### Products/Catalog

| File | What it does / notes |
|------|---------------------|
| `ProductFormPage` | Standalone product create/edit. NOT `*Redesign.jsx`. Uses `useParams()` for edit mode. Has `cartesian()` for auto-generating variant combos. |
| `PromotionsRedesign` | Promotions CRUD (includes wholesale slab-percent/tier-rule schemes) |
| `SmartCollectionsRedesign` | Smart collections; `phase2_smart_collections` flag |
| `AttributeSetsRedesign` | Product attribute sets; `manage_orders` perm |
| `BrandsRedesign` | Brand management |
| `CategoriesRedesign` | Hierarchical category tree; leaf-only product assignment |
| `ReturnPoliciesRedesign` | Return policy rules; `phase2_return_policies` flag |
| `ReturnedStockRedesign` | Returned inventory disposition |
| `PriceListsRedesign` | Outlet/customer price lists; `phase2_outlet_pricing` flag |
| `CustomerGroupPriceBookRedesign` | Price overrides per customer group (B2B/wholesale catalog visibility) |

### Inventory

| File | What it does |
|------|-------------|
| `InventoryRedesign` | Stock levels per outlet; CSV inline blob (refactor when touching) |
| `StockAdjustmentsRedesign` | Manual stock adjustments |
| `TransfersRedesign` | Inter-outlet stock transfers |
| `StockCountRedesign` | Stocktake / cycle count; no flag guard |
| `ReorderAlertsRedesign` | Low-stock reorder alerts; no flag guard |
| `InventoryIntelligenceRedesign` | AI-powered inventory analytics and forecasting |

### Purchasing

| File | What it does |
|------|-------------|
| `PurchaseOrdersRedesign` | PO creation and management |
| `SupplierPayablesRedesign` | Supplier invoice payment tracking |
| `SuppliersRedesign` | Supplier directory |

### Customers/CRM

| File | What it does / notes |
|------|---------------------|
| `CustomersRedesign` | Customer list + detail panel (Profile, Ledger, Order History). Wallet top-up. Clinical field detection for `clinic`/`dental_clinic`/`veterinary`/`physiotherapy` presets. CSV inline blob. |
| `CustomerGroupsRedesign` | Customer group management (B2B pricing/visibility tiers); no flag guard |
| `CRMRedesign` | CRM notes and contact management |
| `LoyaltyTiersRedesign` | Loyalty tier config; no flag guard |
| `GiftCardsAdminRedesign` | Gift card issuance and management |

### HR/Staff

| File | What it does / notes |
|------|---------------------|
| `EmployeesRedesign` | Employee CRUD; admin-only |
| `AdministratorRedesign` | Admin employee management |
| `HRManagementRedesign` | HR records and leave |
| `AttendanceRedesign` | Attendance records; uses LOCAL time (`fmtLocalDateTime`) |
| `SchedulingRedesign` | Staff scheduling; `phase2_scheduling` flag |
| `CommissionPlansRedesign` | Commission plan management; `phase2_commissions` flag |

### Finance

| File | What it does / notes |
|------|---------------------|
| `ExpensesRedesign` | Expense tracking; uses LOCAL time |
| `AccountingRedesign` | Accounting overview; `accounting_core` flag; params are `from`/`to` |
| `JournalEntriesRedesign` | Journal entry management; `accounting_core` flag |
| `ChartOfAccountsRedesign` | Chart of accounts; `accounting_core` flag |
| `PostdatedChequesRedesign` | Postdated cheque tracking; `accounting_core` flag |
| `CreditDebitNotesRedesign` | Credit/debit note management; `accounting_core` flag |
| `CustomerInvoicesRedesign` | Customer invoices; `customer_invoicing` flag |
| `RetailRiskRedesign` | Risk and loss prevention analytics (A/R aging, credit risk) |

### Reports

| File | What it does / notes |
|------|---------------------|
| `ReportsRedesign` | Thin wrapper. Two exports: default `ReportsRedesign` (full page + Power-Up panel + tabs), named `ReportsTabStandaloneRedesign({ tabId })` for deep-linked routes |
| `ReportBuilderRedesign` | Custom report builder; `phase2_report_builder` flag |
| `ReportsPowerUpPanel` | Optional add-on panel shown only when profit-layer/inventory-health-plus/exceptions flags are on; own inline `toCsv()` (not `downloadCsv`) |

### Settings/Config

| File | What it does / notes |
|------|---------------------|
| `OutletsRedesign` | Outlet management; admin-only |
| `CompanySettingsRedesign` | Company/store profile and logo |
| `PrinterSettingsRedesign` | Thermal printer config; test via `POST /api/print/test`; `all_access` gated |
| `BillingRedesign` | Trial/subscription billing; polls `GET /api/billing/status` after payment redirect |
| `BackupRestoreRedesign` | DB backup management; admin-only |
| `OutletTaxProfilesRedesign` | Per-outlet tax profiles; `phase2_outlet_tax_profiles` flag |
| `POSLayoutsRedesign` | POS layout configuration; `phase2_pos_layouts` flag |
| `TaxesRedesign` | Tax rate management |
| `BarcodeTemplatesRedesign` | Barcode label template designer; wraps legacy `BarcodeTemplates.jsx` |
| `ReceiptTemplatesRedesign` | Receipt template designer; wraps legacy `ReceiptTemplates.jsx` |

### Integrations

| File | What it does / notes |
|------|---------------------|
| `IntegrationsHubRedesign` | Unified hub — marketplace/social/messaging/feeds/courier/payment/sms providers, incl. Shopify + WooCommerce (link out to dedicated pages) |
| `WooCommerceIntegrationRedesign` | WooCommerce sync; consumer key/secret |
| `ShopifyIntegrationRedesign` | Thin wrapper around legacy `ShopifyIntegration.jsx` — all Shopify logic lives there |
| `CourierSettingsRedesign` | Courier adapter configuration (13 courier adapters) |
| `ImportRedesign` | Bulk import — products/customers/suppliers/expenses/payments tabs. Preview → confirm workflow via `api.upload` |
| `ImportFromCompetitorRedesign` | Competitor data migration import |
| `ManufacturerPartnersRedesign` | Brand/manufacturer-partner CRUD (Tier 1.4/1.5 wholesale — feeds the manufacturer portal) |

### FBR/Tax

| File | What it does / notes |
|------|---------------------|
| `FBRSettingsRedesign` | FBR config: NTN, STRN, province, API token, environment, default HS code |
| `FBRDashboardRedesign` | FBR invoice queue: summary cards, filters, retry, auto-refresh |
| `TaxLookupRedesign` | Province-aware HS code search, export, suggest correction |

### Orders/Fulfillment

| File | What it does |
|------|-------------|
| `OrdersRedesign` | Web/channel orders; CSV inline blob |
| `FulfillmentRedesign` | Pick-list and dispatch; perm-gated only |
| `CODSettlementsRedesign` | COD reconciliation; `phase5_cod_reconciliation` flag. Orchestrates a `cod/` subdirectory (BatchList, ImportWizard, BatchDetail); view state machine `list → import → detail` |

### Vertical/Specialty (services, clinical, wholesale B2B)

| File | Flag | What it does |
|------|------|---------------|
| `ServiceTicketsRedesign` | `phase4_workflow_tickets` | Service ticket management |
| `AppointmentsRedesign` | `phase4_appointments` | Appointment list and booking |
| `AppointmentServicesRedesign` | `phase4_appointments` | Bookable service catalog |
| `AppointmentsCalendarRedesign` | `phase4_appointments` | Calendar view of appointments |
| `RentalsRedesign` | `phase4_rentals` + `manage_rentals` perm | Rental contract + asset check-out/in management |
| `RoomManagementRedesign` | `phase4_room_management` | Room booking, folio, check-in/check-out |
| `TreatmentPlansRedesign` | `phase4_treatment_plans` + `manage_treatment_plans` perm | Multi-tab (Plans, Calendar, Lab Orders, Templates); uses `DentalChart`/`BodyChart` from `treatment/` subdirectory |
| `ProjectsRedesign` | `phase4_service_projects` | Project management |
| `ContractsRedesign` | `phase4_service_contracts` | Service contracts |
| `SubscriptionsRedesign` | `subscription_billing` | Customer subscription management |

Wholesale/B2B (Tier 0–2) also spans several files already listed above under their functional category rather than a separate group: `CustomerGroupsRedesign`/`CustomerGroupPriceBookRedesign` (catalog visibility + group pricing), `RetailRiskRedesign` (A/R aging, credit risk), `PromotionsRedesign` (slab/tier schemes), `ManufacturerPartnersRedesign` (brand partner portal admin). Field-rep mobile capture and the manufacturer/customer portals themselves are separate route trees, not `redesign/` pages.

### Restaurant

| File | Flag | What it does |
|------|------|---------------|
| `RestaurantFloorRedesign` | `phase4_restaurant` | Table floor plan management |
| `RestaurantChecksRedesign` | `phase4_restaurant` | Restaurant check/tab management |
| `RestaurantInboxRedesign` | `phase4_restaurant` | Kitchen/server order inbox |
| `ModifierGroupsRedesign` | `phase4_restaurant` | Product modifier group management |
| `KDSRedesign` | `phase4_restaurant_kds` | Kitchen display system |
| `TipPoolsRedesign` | `phase4_restaurant` | Tip pool configuration |

### Operations/Admin-Facing

| File | What it does / notes |
|------|---------------------|
| `ApprovalsRedesign` | Approval workflow; `flags.approvals` check, redirects to `/` if off. Wraps legacy `Approvals` component |
| `KioskRedesign` | Public route (no auth). Reads `?tenant=<slug>` + `?outlet=<id>`. PIN entry via `POST /api/attendance/pin-status`. Uses LOCAL time |
| `KioskOrderingRedesign` | `phase4_restaurant` — customer-facing kiosk ordering |
| `ActionHistoryRedesign` | Audit log viewer; params are `date_from`/`date_to` |
| `ReviewModerationRedesign` | Product review moderation; no flag guard |
| `ScheduledChangesRedesign` | Scheduled price/product changes; `phase2_scheduled_changes` flag |
| `NotificationsRedesign` | In-app notifications. Mark-read: `PUT /api/notifications/read-all` (not POST) |
| `MessagingInboxRedesign` | Customer messaging inbox; `customer_messaging` flag |
| `MarketingCampaignsRedesign` | Marketing campaign management; `marketing_campaigns` flag |

### User Pages

| File | What it does / notes |
|------|---------------------|
| `DashboardRedesign` | Role-aware orchestrator (`isAdmin`/`isManager`/`isCashier`); auto-refreshes every 60s |
| `ProfileRedesign` | Self-service employee profile — PIN + password change, no admin perm required |
| `MyTicketsRedesign` | Tenant-side support ticket viewer |

---

## Key Conventions

### Layout Primitives
- `PageShell` from `ui/primitives.jsx` — props: `title`, `subtitle`, `right` (no `actions` prop)
- `SectionCard` from `ui/primitives.jsx` — props: `children`, `className` only (no `title` prop)

### API Calls
- Always `api.get/post/put/del` from `api.js` — never raw `fetch()` in redesign pages
- Paths must include `/api/` prefix: `api.get("/api/products")`
- For raw response access (`.ok`, `.status`, `.blob()`): use `api.raw`

### Feature Flag Pattern
```jsx
const { flags, loading } = useFeatureFlags(authHeaders);
if (loading) return null;
if (!flags.some_flag) return <Navigate to="/" replace />;
```
No `RequireFeature` wrapper exists — checks are always inline. Do NOT pass an inline `{}` as `authHeaders` each render — causes an infinite loop.

### Currency
Always `const { fmt } = useCurrency()` — never hardcode symbols.

### Timestamps
- UTC columns (sales, returns, shifts, adjustments): `fmtUtcDateTime` / `fmtUtcDate` / `fmtUtcTime`
- LOCAL columns (attendance, expenses, GRN, parked sales): `fmtLocalDateTime` / `fmtLocalDate` / `fmtLocalTime`
- Both from `utils/dates.js`. Never raw `new Date(timestamp)` on DB values. Exception: `KioskRedesign` uses LOCAL time explicitly.

### CSV Export
Use `downloadCsv(headers, rows, filename)` from `utils/csvExport.js` for new pages. Several existing pages (`SalesHistoryRedesign`, `CustomersRedesign`, `OrdersRedesign`, `InventoryRedesign`) still use inline Blob — refactor when touching them. `ReportsPowerUpPanel` has its own `toCsv()` with metadata header lines by design.

### Tailwind v4 Rules
- `(--css-var)` NOT `[var(--css-var)]`
- `shrink-0` NOT `flex-shrink-0`, `grow` NOT `flex-grow`
- `bg-linear-to-br` NOT `bg-gradient-to-br`
- `z-200` NOT `z-[200]`

### Dark Mode
Works automatically via CSS variables — no special handling needed in page components. POS is the exception (hardcoded colors).

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
| `usePOS()` | `pos/POSContext.jsx` | All POS state (~165 exports); throws if outside `POSProvider` |
