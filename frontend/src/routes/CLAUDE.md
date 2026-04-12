# Routes — Claude Guide

**4 files** — React Router route definitions split by access level. All `lazy()`-loaded unless noted.

---

## `publicRoutes.jsx`

Routes accessible without authentication (or with special auth handling):

| Path | Component | Notes |
|------|-----------|-------|
| `/` | `HomeRedirect` | See logic below |
| `/login` | `LandingPage` | Alias for `/` login form |
| `/setup` | `SetupWizard` | First-run wizard |
| `/reset-password` | `ResetPassword` | `?token=xxx&tenant=slug` |
| `/signup` | `SignupPage` | Self-service signup |
| `/receipt/:invoiceNumber` | `ReceiptPublicPage` | Public shareable receipt |
| `/access-denied` | `AccessDenied` | Permission error landing |
| `/context-select` | `ContextSelect` | Requires auth — outlet/company picker |
| `/pos` | `POSRoute` | Requires auth + `ErrorBoundary level="page"` |
| `/kiosk` | `KioskRedesign` | Standalone attendance kiosk — requires auth + `ErrorBoundary`. **Not** the restaurant ordering kiosk (that's `KioskOrderingRoute` in `appRoutes`) |
| `/customer-display` | `CustomerDisplayPage` | No auth |
| `/store/:tenantSlug` | `StorefrontLayout` | Public storefront — 6 nested routes: `index`, `products`, `products/:productId`, `cart`, `checkout`, `order/:orderToken` |
| `/book/:tenantSlug` | `PublicBookingPage` | Public appointment booking |
| `/menu/:token` | `PublicRestaurantMenuPage` | Public restaurant QR menu |

### `HomeRedirect` logic
1. If `isBootstrapping` → render null (wait)
2. If `isAuthenticated` → redirect to `/context-select`
3. If NOT `IS_MULTI_TENANT` → fetch `GET /api/setup/status`; if `!setup_complete` → redirect to `/setup`
4. Otherwise → render `LandingPage`

The setup check is **skipped in MT mode** (`IS_MULTI_TENANT = true`) — tenants don't go through the setup wizard.

---

## `appRoutes.jsx`

All app routes nested under a single pathless layout route:
```
RequireAuth > RequireContext > AppLayoutRedesign
```
Every route in this file automatically gets auth, context enforcement, and the app shell layout. No per-route auth wrapper needed.

**Helpers:**
- `wrap(Component)` — wraps in `<Suspense fallback={<RouteLoading />}>`
- `perm(permString, element)` — wraps in `<RequirePerm perm={permString}>`

**Route → permission map (selected):**

| Path | Perm | Notes |
|------|------|-------|
| `/dashboard` | — | All authenticated |
| `/profile` | — | All authenticated |
| `/my-tickets` | — | All authenticated |
| `/sales-history` | — | All authenticated |
| `/customers` | — | All authenticated |
| `/crm` | `manage_orders` | |
| `/quotations` | `manage_orders` | |
| `/orders` | `manage_orders` | |
| `/parked-sales` | `manage_orders` | |
| `/inventory` | `manage_inventory` | |
| `/products/new`, `/products/:id` | `manage_inventory` | `ProductFormPage` |
| `/adjustments`, `/transfers` | `manage_inventory` | |
| `/categories`, `/taxes`, `/brands` | `manage_inventory` | |
| `/suppliers`, `/purchase-orders` | `manage_orders` | |
| `/employees`, `/outlets` | `all_access` | Admin only |
| `/administrator` | `all_access` | |
| `/import`, `/backup-restore` | `all_access` | |
| `/company-settings`, `/billing` | `all_access` | |
| `/settings/fbr`, `/fbr` | `all_access` | |
| `/settings/integrations` | `manage_inventory` | `IntegrationsHubRedesign` |
| `/accounting` | `view_reports` | Also feature-flagged `accounting_core` |
| `/attendance` | `view_reports` | |
| `/reports` | — | All authenticated |
| `/chart-of-accounts`, `/journal-entries` | `all_access` | Wave 2 |
| `/stock-counts`, `/price-lists` | `manage_inventory` | Wave 3 |
| `/loyalty-tiers` | `all_access` | Wave 4 |
| `/customer-groups` | `manage_customers` | Wave 4 |
| `/fulfillment`, `/cod-settlements` | `manage_orders` | Wave 5 |
| `/restaurant/floor`, `/restaurant/checks` | `manage_restaurant` | Phase 4 |
| `/kds` | `manage_kds` | Phase 4 |
| `/kiosk` | — | `KioskOrderingRoute` — restaurant ordering (no perm required in route, component may gate internally) |
| `/appointments/*` | `manage_bookings` | Phase 4 |
| `/projects` | `manage_projects` | Phase 4 |
| `/contracts` | `manage_contracts` | Phase 4 |

**Standalone report deep-links (16 routes):**
Each maps a URL to a `ReportTabStandaloneRoute` with a `tabId`:

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

`ReportTabStandaloneRoute` is a named export from `pages/ReportsRoute.jsx` (not the default export).

**Placeholder routes (5):** `/lookup`, `/custom-fields`, `/partners`, `/shopcast`, `/reports/parent-report` — all render `PlaceholderPage`.

---

## `adminRoutes.jsx`

All routes nested under `/admin`. Admin auth is checked **inside `AdminLayout`** via `getAdminToken()` — there is no `RequireAuth` wrapper at the route level.

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

---

## `RouteLoading.jsx`

`Suspense` fallback — a centered pill with `"Loading..."` text:
- `min-h-[40vh]` container, white card, `border-slate-200`, `shadow-sm`
- Used by both `appRoutes.jsx` and `adminRoutes.jsx` via their local `wrap()` helpers
