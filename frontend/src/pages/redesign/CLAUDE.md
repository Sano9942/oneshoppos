# Redesign Pages — Claude Guide

`redesign/` is the primary tenant UI directory. All active tenant-facing page implementations live here as `*Redesign.jsx`. Route wrappers (`*Route.jsx` in `pages/`) are 5-line pass-throughs — never edit them.

---

## POS Module (`pos/` subdirectory)

### `POSRedesign.jsx`

Entry point for the POS terminal. Wraps `POSContent` with `<POSProvider>` + `<ErrorBoundary>`. All POS modals are mounted here, not inside individual components. Two layouts:
- **Desktop**: Header → SubHeader + SearchArea + CartTable + Sidebar (side-by-side)
- **Mobile**: Tab-driven (Cart / Search / Pay) with sticky Pay button

Phase 2B features rendered inline: POS Layout tiles from `posLayout.layout_json` (above `POSCartTable`), item suggestions from `suggestions` (below, max 4). Offline amber/emerald banners shown at top when queued sales exist.

### `POSRestaurantRedesign.jsx`

Restaurant/table-service variant of the POS. Gated by `phase4_restaurant` flag. Integrates with POS checkout via `draftOrderId`, `orderContext`, `tableSessionId`, `seatCount`. Uses components from `pos/restaurant/` subdirectory (floor grid, seat/course picker, split check, table transfer, etc.).

### `POSContext.jsx` — ~165 exports, `usePOS()` hook

Central orchestrator composed from 8 domain hooks:

| Hook | File | Owns |
|------|------|------|
| `useShiftGate` | `hooks/useShiftGate.js` | outlets, selectedOutletId, activeShift, attendanceStatus, openShift, closeShift |
| `useCart` | `hooks/useCart.js` | cart, search, price lists, POS layout, suggestions, promotions, discount, note, tax toggle |
| `useReceipt` | `hooks/useReceipt.js` | slip, slipOpen, receiptTemplate, recentSales, printSlip |
| `useCustomerDisplay` | `hooks/useCustomerDisplay.js` | customer display sync (debounced POST to `/api/pos/customer-display`) |
| `useLoyaltyWallet` | `hooks/useLoyaltyWallet.js` | wallet balance, loyalty points, earnRate, redeemRate |
| `useFolioCharging` | `hooks/useFolioCharging.js` | chargeToRoomFolioId, chargeToTreatmentFolioId, openBookings, openTreatmentPlans |
| `useOfflineQueue` | `hooks/useOfflineQueue.js` | offlineQueueCount, queuedSalesCount, queuedReturnsCount, syncQueue |
| `useCheckout` | `hooks/useCheckout.js` | completeSale, addPayment, payments, submitting, handleQuickCreateCustomer |

### POS Critical Gotchas

- **`completeSale` uses `api.raw` (not `api.post`)** — detects 401 mid-checkout. On 401, stores payload in `pendingSaleRef.current`, sets `sessionExpired=true`. Do NOT refactor to `api.post`.
- **Park sale is feature-flagged** — `posFlags.phase2_draft_orders` → parks to `POST /api/draft-orders` instead of `POST /api/parked-sales`.
- **F-key shortcuts use ref indirection** — `parkSaleRef`, `openCheckoutRef`, `removeFromCartRef` updated each render so the keyboard `useEffect` (stale closure) calls the current function.
- **Offline queue is IndexedDB-backed** (`utils/offlineQueue.js`). Supports returns (`type: "return"`). Legacy `localStorage` migration runs on mount. Auto-sync fires on `window.online`.
- **Offline idempotency** — `completeSale` generates `crypto.randomUUID()` as `idempotency_key`. Backend returns `{ duplicate: true }` on replay → dequeued without error.
- **Opening denominations** — `OPENING_DENOMS = [5000, 1000, 500, 100, 50, 20, 10]` hardcoded in `useShiftGate.js`. Closing denominations from `useCurrency().denominations`.
- **Loyalty rates** — fetched from `GET /api/loyalty/config` on mount; falls back to earn=1pt/100, redeem=PKR10/100pts if endpoint errors.
- **Price list priority** — customer price list takes priority over outlet price list. Outlet price list only fetched when `posFlags.phase2_outlet_pricing` is on.
- **Barcode scanner (global keydown)** — 100ms inter-key timeout buffer, fires `handleBarcodeScanned` on `Enter` with buffer ≥ 3 chars. Separate from `POSOmniInput`.
- **Cart checkpoint/resume** — debounced 1s write to `sessionStorage["pos_cart_checkpoint_${employeeId}"]`. On mount (empty cart), if checkpoint ≤ 8h old, `POSCartResumeModal` prompts restore.
- **Stale-shift recovery** — `POSShiftRecoveryModal` opens when active shift is >20h old.
- **Tax mode** — `taxInclusive` default derived from `company.tax_mode`. Re-syncs when mode loads async but only resets if cart is empty.
- **`isReadyForCheckout`** — `Boolean(selectedOutletId && activeShift && attendanceCode === "clocked_in")`. All three required.
- **New POS components**: call all hooks BEFORE any conditional early return. Mount new modals in `POSRedesign.jsx`.

### POS Styling Convention

POS does NOT use design system tokens. Uses hardcoded `#8066FF` accent, `slate-*` classes, `#0A0A0A`/`#111` sidebar dark background.

**Exceptions** (use CSS variable tokens): `POSShortcutsOverlay`, `EndlessAisleModal`, `POSApprovalModal`.

### POS Modals

All modals null-guard with `if (!open) return null` using `usePOS()` — **except** `POSStuckQueueModal`, `POSRefundThresholdModal`, `POSApprovalModal`, `POSEmailReceiptModal` which receive all data via **props**.

Key modals:
- `POSCheckoutModal` — multi-payment tenders; loyalty/wallet toggles; quick-create customer inline
- `POSReturnExchangeModal` — most complex; exchange mode: POST sale first, return second; fetches `/api/return-reasons`; 409 `duplicate_return` → opens `POSCartCollisionModal`; supports `policyQuote`/`approvalEventId`
- `POSSessionExpiredModal` — PIN re-auth via `POST /api/employees/validate-pin`; on success retries pending sale
- `POSOpeningGateModal` — 3-state gate: needsOutlet → needsShift → needsClockIn
- `POSModifierModal` — single (radio) / multi (checkbox) modifier selection; `is_default` pre-selects; `price_delta` per option
- `POSHoldCreateModal` — `POST /api/holds`; deposit amount, method, days (default 14), customer name/phone/notes
- `POSRefundThresholdModal` — props: `{ open, threshold, refundAmount, currency, error, loading, onSubmit(pin), onClose }`; shown when `/api/returns` returns `{ code: "manager_pin_required" }`
- `POSApprovalModal` — props: `{ actionType, referenceType, referenceId, outletId, metadata, onApproved, onDenied, onClose }`; `POST /api/approvals/pos-authorize`; usable outside POS

### POS Keyboard Shortcuts

| Key | Action |
|-----|--------|
| F1 | Help overlay |
| F2 | Discount modal |
| F3 | Park sale |
| F4 | Focus customer search (`data-pos-customer-search` attribute) |
| F5 | Parked sales |
| F8 | Remove last cart item |
| F9 | Open checkout |
| F10 | Clear cart |
| Esc | Close modal |
| `/` | Focus omni-input (when no input active) |

F-keys work even when focus is in an input field.

### `completeSale` Payload (`POST /api/sales`)

```js
{
  outlet_id, shift_id, employee_id, customer_id?,
  cartItems: [{ id, variant_id?, price, quantity, modifier_ids?, serial_numbers?, seat_number?, course_name?, staff_id? }],
  payments: [{ method, amount }],
  discount_type, discount_value,
  tax_inclusive, tax_total,
  order_note?,
  redeem_points?, points_redeemed?,
  wallet_payment_amount?,
  charge_to_room_folio_id?, charge_to_treatment_folio_id?,
  promo_discount?, applied_promotions?,
  idempotency_key,
  // restaurant fields:
  draft_order_id?, order_context?, table_session_id?, seat_count?, signature_svg?
}
```

### `cartMath.js` — pure utility, zero React

`calcGrossTotal`, `calcDiscountValue` (percent/flat), `calcTaxTotal` (inclusive backs tax out, exclusive adds on top), `calcTotal` (always ≥ 0).

### `omniInputRouter.js` — pure pattern classifier

`classifyOmniInput(raw)` returns `{ kind, value?, format? }`. Kinds: `noop`, `barcode` (EAN-8/12/13/14 by digit length), `plu` (4-5 digit numeric), `customer` (`#`-prefixed), `text` (everything else).

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
| `ProductFormPage` | Standalone product create/edit. NOT `*Redesign.jsx`. Uses `useParams()` for edit mode. Has `cartesian()` for auto-generating variant combos. Imports `StarDisplay`/`StarPicker` from `ui/StarRating.jsx`. Uses `API_BASE` aliased as `API`. |
| `PromotionsRedesign` | Promotions CRUD |
| `SmartCollectionsRedesign` | Smart collections; `phase2_smart_collections` flag |
| `AttributeSetsRedesign` | Product attribute sets; `manage_orders` perm |
| `BrandsRedesign` | Brand management |
| `CategoriesRedesign` | Hierarchical category tree; leaf-only product assignment |
| `ReturnPoliciesRedesign` | Return policy rules; `phase2_return_policies` flag |
| `ReturnedStockRedesign` | Returned inventory disposition |
| `PriceListsRedesign` | Outlet/customer price lists; `phase2_outlet_pricing` flag |

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
| `CustomersRedesign` | Customer list + detail panel (Profile, Ledger, Order History tabs). Wallet: `GET /api/customers/:id/wallet`, top-up `POST .../topup`. Clinical preset detection: shows medical fields when `industryType` in `{ clinic, dental_clinic, veterinary, physiotherapy }`. Blacklist modal. CSV inline blob. |
| `CustomerGroupsRedesign` | Customer group management; no flag guard |
| `CustomerGroupPriceBookRedesign` | Price overrides per customer group |
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
| `AccountingRedesign` | Accounting overview; `accounting_core` flag; params are `from`/`to` (not `start`/`end`) |
| `JournalEntriesRedesign` | Journal entry management; `accounting_core` flag |
| `ChartOfAccountsRedesign` | Chart of accounts; `accounting_core` flag |
| `PostdatedChequesRedesign` | Postdated cheque tracking; `accounting_core` flag |
| `CreditDebitNotesRedesign` | Credit/debit note management; `accounting_core` flag |
| `CustomerInvoicesRedesign` | Customer invoices; `customer_invoicing` flag |

### Reports

| File | What it does / notes |
|------|---------------------|
| `ReportsRedesign` | Thin wrapper. **Two exports**: default `ReportsRedesign` (full page with Power-Up panel + tabs), named `ReportsTabStandaloneRedesign({ tabId })` (delegates to `ReportTabStandalone` from `pages/Reports.jsx`) |
| `ReportBuilderRedesign` | Custom report builder; `phase2_report_builder` flag |
| `ReportsPowerUpPanel` | Accepts `{ flags }` prop. Returns null if none of `reports_profit_layer`, `reports_inventory_health_plus`, `reports_exceptions` enabled. Collapsible; has its own inline `toCsv()` with metadata header lines (NOT `downloadCsv`). Uses `useReportFilters()` from `hooks/useReportFilters.js`. |

### Settings/Config

| File | What it does / notes |
|------|---------------------|
| `OutletsRedesign` | Outlet management; admin-only |
| `CompanySettingsRedesign` | Company/store profile and logo |
| `PrinterSettingsRedesign` | Thermal printer config. Paper sizes hardcoded (80mm/48, 76mm/42, 58mm/32, 57mm/30, Custom). Default: `192.168.1.100:9100`. Test via `POST /api/print/test`. `all_access` gated. |
| `BillingRedesign` | Trial/subscription billing. After payment redirect, polls `GET /api/billing/status` every 2s up to 15 attempts. Cleans URL params via `window.history.replaceState`. Plans from `GET /api/billing/pricing`. |
| `BackupRestoreRedesign` | DB backup management; admin-only |
| `OutletTaxProfilesRedesign` | Per-outlet tax profiles; `phase2_outlet_tax_profiles` flag |
| `POSLayoutsRedesign` | POS layout configuration; `phase2_pos_layouts` flag |
| `TaxesRedesign` | Tax rate management |
| `BarcodeTemplatesRedesign` | Barcode label template designer; wraps legacy `BarcodeTemplates.jsx` |
| `ReceiptTemplatesRedesign` | Receipt template designer; wraps legacy `ReceiptTemplates.jsx` |

### Integrations

| File | What it does / notes |
|------|---------------------|
| `IntegrationsHubRedesign` | Unified hub. **12 providers in PROVIDER_META**: daraz, shopify, woocommerce, facebook, instagram, whatsapp, google_merchant, xpay, jazzcash, easypaisa, zong_sms, jazz_sms, twilio. Tabs: all/marketplace/social/messaging/feeds/courier/payment/sms. Shopify + WooCommerce cards use `link` (navigate to dedicated page). xPay shows "configured via env vars" note (no form). |
| `WooCommerceIntegrationRedesign` | WooCommerce sync; consumer key/secret |
| `ShopifyIntegrationRedesign` | Thin wrapper around legacy `ShopifyIntegration.jsx`. Does NOT use `PageShell`. Uses CSS variable tokens for header strip. All Shopify logic in the legacy component. |
| `CourierSettingsRedesign` | Courier adapter configuration (13 courier adapters) |
| `ImportRedesign` | **5 tabs** (products, customers, suppliers, expenses, payments). Workflow: select → `api.upload .../preview=1` → confirm → `api.upload`. Template download uses `API_BASE` directly (not `api.js`). Resets file input on tab switch. |
| `ImportFromCompetitorRedesign` | Competitor data migration import |

### FBR/Tax

| File | What it does / notes |
|------|---------------------|
| `FBRSettingsRedesign` | FBR config: NTN, STRN, province, API token, environment (sandbox/live), default HS code. Provinces hardcoded: `["Punjab", "Sindh", "KPK", "Balochistan", "ICT", "AJK", "Gilgit-Baltistan"]`. `GET/PUT /api/fbr/config`. |
| `FBRDashboardRedesign` | FBR invoice queue: summary cards, filters, retry, auto-refresh |
| `TaxLookupRedesign` | Province-aware HS code search, export, suggest correction |

### Orders/Fulfillment

| File | What it does |
|------|-------------|
| `OrdersRedesign` | Web/channel orders; CSV inline blob |
| `FulfillmentRedesign` | Pick-list and dispatch; perm-gated only (no flag guard) |
| `CODSettlementsRedesign` | COD reconciliation; `phase5_cod_reconciliation` flag. Orchestrates `cod/` subdirectory (BatchList, ImportWizard, BatchDetail). View state machine: `list` → `import` → `detail`. See cod/ subdirectory section below. |

#### `cod/` subdirectory

Batch lifecycle: `imported` → `matching` → `review` → `approved`/`rejected`. Approve gated: `all_access` only.

ImportWizard 4-step flow: (1) select courier → (2) upload CSV/XLSX → (3) map columns → (4) preview + confirm. **Step 3 skipped automatically** if courier has saved `cod_csv_mapping` AND uploaded file headers match. `config_json` is stored as TEXT — always `JSON.parse()` it defensively.

### Vertical/Specialty

| File | Flag | What it does |
|------|------|-------------|
| `ServiceTicketsRedesign` | `phase4_workflow_tickets` | Service ticket management |
| `AppointmentsRedesign` | `phase4_appointments` | Appointment list and booking |
| `AppointmentServicesRedesign` | `phase4_appointments` | Bookable service catalog |
| `AppointmentsCalendarRedesign` | `phase4_appointments` | Calendar view of appointments |
| `RentalsRedesign` | `phase4_rentals` + `manage_rentals` perm | Rental contract management |
| `RoomManagementRedesign` | `phase4_room_management` | Room booking management |
| `TreatmentPlansRedesign` | `phase4_treatment_plans` + `manage_treatment_plans` perm | Multi-tab (Plans, Calendar, Lab Orders, Templates); detail + chart views via `useParams().planId`; imports `DentalChart`/`BodyChart` from `treatment/` subdirectory |
| `ProjectsRedesign` | `phase4_service_projects` | Project management |
| `ContractsRedesign` | `phase4_service_contracts` | Service contracts |
| `SubscriptionsRedesign` | `subscription_billing` | Customer subscription management |

### Restaurant

| File | Flag | What it does |
|------|------|-------------|
| `RestaurantFloorRedesign` | `phase4_restaurant` | Table floor plan management |
| `RestaurantChecksRedesign` | `phase4_restaurant` | Restaurant check/tab management |
| `RestaurantInboxRedesign` | `phase4_restaurant` | Kitchen/server order inbox |
| `ModifierGroupsRedesign` | `phase4_restaurant` | Product modifier group management |
| `KDSRedesign` | `phase4_restaurant_kds` | Kitchen display system |
| `TipPoolsRedesign` | `phase4_restaurant` | Tip pool configuration |

### Operations/Admin-Facing

| File | What it does / notes |
|------|---------------------|
| `ApprovalsRedesign` | Approval workflow; `flags.approvals` check, redirects to `/` if off. Wraps legacy `Approvals` component. |
| `KioskRedesign` | Public route (no auth). Reads `?tenant=<slug>` + `?outlet=<id>` params. PIN entry via `POST /api/attendance/pin-status`. Max PIN 8 digits. Confirmation auto-resets after 5s. Gracefully handles 401 on feature-flags fetch. Uses `fmtLocalTime` + `parseLocalDate` (LOCAL time). |
| `KioskOrderingRedesign` | `phase4_restaurant` — customer-facing kiosk ordering |
| `ActionHistoryRedesign` | Audit log viewer; params are `date_from`/`date_to` |
| `ReviewModerationRedesign` | Product review moderation; no flag guard |
| `RetailRiskRedesign` | Risk and loss prevention analytics |
| `ScheduledChangesRedesign` | Scheduled price/product changes; `phase2_scheduled_changes` flag |
| `NotificationsRedesign` | In-app notifications. Mark-read: `PUT /api/notifications/read-all` (not POST). No flag guard. |
| `MessagingInboxRedesign` | Customer messaging inbox; `customer_messaging` flag |
| `MarketingCampaignsRedesign` | Marketing campaign management; `marketing_campaigns` flag |

### User Pages

| File | What it does / notes |
|------|---------------------|
| `DashboardRedesign` | Role-aware orchestrator. Auto-refreshes every 60s via `refreshKey`. Roles: `isAdmin` (`all_access`), `isManager` (`view_reports` but not `all_access`), `isCashier` (neither). `DashboardOutletRanking` only in all-branches mode (`ctx.scope_mode !== "all_branches"`). `AIChatPanel` gated by `ai_insights` flag. `BackupStatusCard` admin-only. Fetches `GET /api/reports/dashboard` + `GET /api/sales?limit=10` in parallel. |
| `ProfileRedesign` | Self-service employee profile. No admin perm required. PIN change: `PUT /api/employees/:id/change-pin` (min 4 digits, requires current_pin). Password change: `PUT .../change-password` (min 8 chars). |
| `MyTicketsRedesign` | Tenant-side support ticket viewer. Fetches `GET /api/support/tickets`. Shows status badges + admin reply column. No permission gate. |

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
- No `RequireFeature` wrapper exists — checks are always inline inside the component
- **Do NOT pass an inline `{}` as `authHeaders` each render** — it causes an infinite loop. Hoist or memoize first.

### Currency
- Always `const { fmt } = useCurrency()` — never hardcode symbols

### Timestamps
- **UTC columns** (sales, returns, shifts, adjustments): `fmtUtcDateTime` / `fmtUtcDate` / `fmtUtcTime`
- **LOCAL columns** (attendance, expenses, GRN, parked sales): `fmtLocalDateTime` / `fmtLocalDate` / `fmtLocalTime`
- Both from `utils/dates.js`. Never raw `new Date(timestamp)` on DB values.
- Exception: `KioskRedesign` uses LOCAL time explicitly (attendance records are local).

### CSV Export
- Use `downloadCsv(headers, rows, filename)` from `utils/csvExport.js` for new pages
- Several existing pages (`SalesHistoryRedesign`, `CustomersRedesign`, `OrdersRedesign`, `InventoryRedesign`) still use inline Blob — refactor when touching them
- Exception: `ReportsPowerUpPanel` has its own `toCsv()` with metadata header lines

### Tailwind v4 Rules
- `(--css-var)` NOT `[var(--css-var)]`
- `shrink-0` NOT `flex-shrink-0`, `grow` NOT `flex-grow`
- `bg-linear-to-br` NOT `bg-gradient-to-br`
- `z-200` NOT `z-[200]`

### Dark Mode
Works automatically via CSS variables — no special handling needed in page components.

### Permission Gating
- `hasPerm("perm")` from `useAuth()` to conditionally show/hide UI
- `useAuth()` returns `{ session, employee, permissions, hasPerm, authHeaders, subscriptionStatus, ... }`

### Hooks Available
| Hook | Source | Key returns |
|------|--------|-------------|
| `useAuth()` | `auth/AuthProvider.jsx` | `hasPerm`, `authHeaders`, `employee`, `isImpersonating` |
| `useCurrency()` | `contexts/CurrencyContext.jsx` | `{ symbol, code, fmt, denominations }` |
| `useToast()` | `contexts/ToastContext.jsx` | `{ toast, success, error, warning }` |
| `useFeatureFlags()` | `hooks/useFeatureFlags.js` | `{ flags, loading }` |
| `usePreset()` | `contexts/PresetContext.jsx` | `{ labels, hasMode, label, enabled_modes, unit_vocabulary, pos_layout_mode }` |
| `usePOS()` | `pos/POSContext.jsx` | All POS state (~165 exports); throws if outside `POSProvider` |
