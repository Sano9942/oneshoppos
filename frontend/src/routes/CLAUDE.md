# Routes — Claude Guide

**5 files** — React Router route definitions split by access level. Most components are `lazy()`-loaded, but several are NOT lazy, including `HomeRedirect`, `SetupWizard`, `AccessDenied`, `ContextSelect`, `RequireAuth`, `RequireContext`, `RequirePerm`, `AppLayoutRedesign`, `PlaceholderPage`, and `RouteLoading`.

---

## `publicRoutes.jsx`

Routes accessible without authentication (or with special auth handling):

| Path | Component | Notes |
|------|-----------|-------|
| `/` | `HomeRedirect` | See logic below |
| `/login` | `LoginPage` | Standalone login page |
| `/landing-preview` | `LandingPagePreview` | Marketing landing preview |
| `/preview/landing-v2` | `LandingEditorial` | |
| `/preview/landing-brutalist` | `LandingBrutalist` | |
| `/preview/landing-luxury` | `LandingLuxury` | |
| `/preview/landing-bazaar` | `LandingBazaar` | |
| `/preview/landing-truckart` | `LandingTruckart` | |
| `/preview/landing-y2k` | `LandingY2k` | |
| `/preview/landing-showroom` | `LandingShowroom` | |
| `/preview/landing-scrapbook` | `LandingScrapbook` | |
| `/setup` | `SetupWizard` | First-run wizard (not lazy) |
| `/reset-password` | `ResetPassword` | `?token=xxx&tenant=slug` |
| `/signup` | `SignupPage` | Self-service signup |
| `/verify-email` | `VerifyEmail` | Email verification link target |
| `/terms` | `Terms` | |
| `/privacy` | `Privacy` | |
| `/receipt/:invoiceNumber` | `ReceiptPublicPage` | Public shareable receipt |
| `/gift-card/:code` | `GiftCardBalancePage` | Public gift card balance check |
| `/access-denied` | `AccessDenied` | Permission error landing (not lazy) |
| `/context-select` | `ContextSelect` | Requires `RequireAuth` — outlet/company picker |
| `/pos` | `POSRoute` | Requires `RequireAuth` + `ErrorBoundary level="page"` |
| `/pos/restaurant` | `POSRestaurantRoute` | Restaurant mode POS. Requires `RequireAuth` + `ErrorBoundary level="page"` |
| `/kiosk` | `KioskRedesign` | Attendance kiosk — Requires `RequireAuth` + `ErrorBoundary`. **Not** the restaurant ordering kiosk (that's in `appRoutes`) |
| `/customer-display` | `CustomerDisplayPage` | No auth |
| `/store/:tenantSlug` | `StorefrontLayout` | Public storefront — 6 nested routes: `index`, `products`, `products/:productId`, `cart`, `checkout`, `order/:orderToken` |
| `/book/:tenantSlug` | `PublicBookingPage` | Public appointment booking |
| `/menu/:token` | `PublicRestaurantMenuPage` | Public restaurant QR menu |
| `/pay/:token` | `RestaurantPayPage` | Restaurant table self-pay |
| `/reserve/:tenantSlug` | `ReservationBookingPage` | Public restaurant reservation |
| `/portal/:tenantSlug` | `PortalLayout` | M8 customer portal — 16 nested routes. Portal pages do not use the main app auth/session flow (`PortalAuthProvider` handles portal auth). Note: `main.jsx` still wraps the entire app including public routes in the main `AuthProvider` — the isolation is at the portal-page level, not the root level |

### Portal nested routes (`/portal/:tenantSlug/...`)

| Sub-path | Component |
|----------|-----------|
| (index) | `PortalDashboard` |
| `login` | `PortalLogin` |
| `signup` | `PortalSignup` |
| `verify-otp` | `PortalOtpVerify` |
| `forgot` | `PortalForgotPassword` |
| `reset` | `PortalResetPassword` |
| `invoices` | `PortalInvoices` |
| `invoices/:invoiceId` | `PortalInvoiceDetail` |
| `invoice-paid` | `PortalInvoicePaidPage` |
| `appointments` | `PortalAppointments` |
| `treatments` | `PortalTreatments` |
| `stays` | `PortalStays` |
| `orders` | `PortalOrders` |
| `loyalty` | `PortalLoyalty` |
| `wallet` | `PortalWallet` |
| `profile` | `PortalProfile` |

All portal components in `pages/portal/`.

### `HomeRedirect` logic

1. If `isBootstrapping` → render null (wait)
2. If `isAuthenticated` → `<Navigate to="/context-select" replace />`
3. If NOT `IS_MULTI_TENANT` → fetch `GET /api/setup/status`; if `!setup_complete` → navigate to `/setup`
4. Otherwise → render `LandingPagePreview`

The setup check is **skipped in MT mode** — a `checkedRef` prevents it from running again on re-renders.

---

## `appRoutes.jsx`

All app routes nested under a single pathless layout route:
```
RequireAuth > RequireContext > AppLayoutRedesign
```
Every route in this file automatically gets auth, context enforcement, and the app shell. No per-route auth wrapper needed.

**Helpers:**
- `wrap(Component)` — wraps in `<Suspense fallback={<RouteLoading />}>`
- `perm(permString, element)` — wraps in `<RequirePerm perm={permString}>`

**Route → permission map:**

| Path | Perm | Notes |
|------|------|-------|
| `/dashboard` | — | All authenticated |
| `/retail/home` | — | Alias for `/dashboard` (2-G.16) |
| `/profile` | — | |
| `/my-tickets` | — | |
| `/sales-history` | — | |
| `/cash-management` | — | |
| `/customers` | — | |
| `/returns` | — | |
| `/reports` | — | |
| `/notifications` | — | |
| `/tax-lookup` | — | |
| `/crm`, `/quotations`, `/orders` | `manage_orders` | |
| `/parked-sales`, `/holds` | `manage_orders` | |
| `/supplier-payables`, `/returned-stock` | `manage_orders` | |
| `/suppliers`, `/purchase-orders` | `manage_orders` | |
| `/approvals` | `manage_orders` | |
| `/fulfillment`, `/cod-settlements` | `manage_orders` | |
| `/messaging/inbox`, `/customer-invoices` | `manage_orders` | |
| `/inventory`, `/products/new`, `/products/:id` | `manage_inventory` | |
| `/adjustments`, `/transfers`, `/stock-counts` | `manage_inventory` | |
| `/categories`, `/taxes`, `/brands` | `manage_inventory` | |
| `/promotions`, `/expenses`, `/barcode-templates` | `manage_inventory` | |
| `/reorder-alerts`, `/inventory-intelligence` | `manage_inventory` | |
| `/price-lists`, `/review-moderation` | `manage_inventory` | |
| `/settings/integrations` | `manage_inventory` | |
| `/accounting`, `/attendance` | `view_reports` | |
| `/report-builder` | `view_reports` | |
| `/credit-debit-notes`, `/postdated-cheques` | `view_reports` | |
| `/retail-risk` | `view_reports` | |
| `/employees`, `/outlets`, `/administrator` | `all_access` | |
| `/action-history`, `/import`, `/backup-restore` | `all_access` | |
| `/company-settings`, `/billing` | `all_access` | |
| `/settings/fbr`, `/fbr` | `all_access` | |
| `/hr`, `/scheduling` | `all_access` | |
| `/chart-of-accounts`, `/journal-entries` | `all_access` | |
| `/loyalty-tiers`, `/subscriptions` | `all_access` | |
| `/smart-collections`, `/scheduled-changes` | `all_access` | |
| `/settings/outlet-tax-profiles`, `/settings/pos-layouts` | `all_access` | |
| `/commissions` | `all_access` | |
| `/marketing/campaigns` | `all_access` | |
| `/return-policies` | `all_access` | |
| `/customer-groups`, `/customer-groups/:groupId/price-book` | `manage_customers` | |
| `/gift-cards` | `manage_gift_cards` | |
| `/restaurant/floor`, `/restaurant/checks` | `manage_restaurant` | |
| `/restaurant/availability`, `/restaurant/menu-schedules` | `manage_restaurant` | |
| `/restaurant/reservations`, `/restaurant/waitlist` | `manage_restaurant` | |
| `/restaurant/modifiers`, `/restaurant/inbox` | `manage_restaurant` | |
| `/restaurant/void-reasons` | `all_access` | |
| `/kds` | `manage_kds` | |
| `/tips` | `manage_tips` | |
| `/kiosk` | — | `KioskOrderingRoute` — restaurant ordering kiosk (no perm in route) |
| `/appointments/services`, `/appointments/calendar`, `/appointments/bookings` | `manage_bookings` | |
| `/projects`, `/contracts` | `manage_projects` / `manage_contracts` | |
| `/service-tickets` | `manage_tickets` | |
| `/rentals`, `/rentals/items`, `/rentals/contracts`, `/rentals/timeline` | `manage_rentals` | All render `RentalsRoute` |
| `/rooms`, `/rooms/rates`, `/rooms/bookings`, `/rooms/calendar`, `/rooms/arrivals-departures` | `manage_rooms` | All render `RoomManagementRoute` |
| `/treatment-plans`, `/treatment-plans/active`, `/treatment-plans/calendar`, `/treatment-plans/labs`, `/treatment-plans/templates`, `/treatment-plans/:planId`, `/treatment-plans/chart/:planId` | `manage_treatment_plans` | All render `TreatmentPlansRoute` |
| `/printer-settings`, `/courier-settings` | `all_access` | |
| `/receipt-templates` | — | No perm required |

**Placeholder routes (5):** `/lookup`, `/custom-fields`, `/partners`, `/shopcast`, `/reports/parent-report`

**Report deep-links (19 routes):**

| Path | tabId |
|------|-------|
| `/reports/sales-summary` | `sales-summary` |
| `/reports/sales-detail` | `sales-detail` |
| `/reports/sales-and-stock` | `sales-stock` |
| `/reports/inventory-dump` | `inventory-dump` |
| `/reports/category-wise` | `category-wise` |
| `/reports/product-specification` | `product-spec` |
| `/reports/order-wise` | `order-wise` |
| `/reports/replenishment` | `replenishment` |
| `/reports/on-hand-inventory` | `on-hand` |
| `/reports/customer-details` | `customer-details` |
| `/reports/customer-wise` | `customer-wise` |
| `/reports/supplier-wise` | `supplier-wise` |
| `/reports/inventory-loss` | `inventory-loss` |
| `/reports/item-wise` | `item-wise` |
| `/reports/wastage` | `wastage` |
| `/reports/product-movement` | `product-movement` |
| `/reports/product-performance` | `product-performance` |
| `/reports/kds-analytics` | `kds-analytics` |
| `/reports/menu-engineering` | `menu-engineering` |

`ReportTabStandaloneRoute` is loaded via `.then((mod) => ({ default: mod.ReportTabStandaloneRoute }))` from `pages/ReportsRoute.jsx` — it's a named export, not the default.

---

## `adminRoutes.jsx`

All routes nested under `/admin`. Auth is checked **inside `AdminLayout`** via `getAdminToken()` — no `RequireAuth` wrapper at the route level.

| Path | Component |
|------|-----------|
| `/admin/login` | `AdminLogin` |
| `/admin` (index) | `AdminLayout` → `AdminDashboard` |
| `/admin/tenants` | `AdminTenantList` |
| `/admin/tenants/:id` | `AdminTenantDetail` |
| `/admin/support` | `AdminSupportTickets` |
| `/admin/emails` | `AdminEmails` |
| `/admin/dead-letters` | `AdminDeadLetters` |
| `/admin/tax-rates` | `AdminTaxRates` |
| `/admin/activity` | `AdminActivity` |
| `/admin/stuck-payments` | `AdminStuckPayments` |

---

## `RouteLoading.jsx`

`Suspense` fallback — centered white card with `"Loading..."`:
- Container: `min-h-[40vh]`, centered flex
- Card: `rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-500 shadow-sm`
- Used by `appRoutes.jsx`, `adminRoutes.jsx`, and `publicRoutes.jsx` via their local `wrap()` helpers
