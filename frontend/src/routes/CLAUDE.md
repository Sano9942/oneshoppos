# Routes — Claude Guide

React Router route definitions, split by access level into 3 arrays + 1 shared fallback component. `App.jsx` imports `publicRoutes`, `appRoutes`, `adminRoutes` and spreads all three into a single `<Routes>` — it does not define any routes itself. Add new route logic here, not in `App.jsx`.

Almost every page component is `lazy()`-loaded. Exceptions that are NOT lazy: `HomeRedirect`, `SetupWizard`, `AccessDenied`, `ContextSelect`, `RequireAuth`, `RequirePerm`, `RequireContext`, `AppLayoutRedesign`, `PlaceholderPage`, `RouteLoading`.

---

## `publicRoutes.jsx`

Unauthenticated (or self-contained-auth) routes. Key groups:

- **Marketing**: `/` (via `HomeRedirect`), `/industries`, `/industries/:slug`, `/pricing`, `/why-sanopos`.
- **Auth entry points**: `/login`, `/reset-password`, `/signup`, `/verify-email`.
- **Legal**: `/terms`, `/privacy`.
- **Setup wizard**: `/setup` — NOT lazy, imported eagerly.
- **Public shareable pages**: `/receipt/:invoiceNumber`, `/gift-card/:code`.
- **`/access-denied`** — plain, no auth.
- **In-app but public-route-file routes that DO require auth**: `/context-select` (wraps in `<RequireAuth>` only), `/pos`, `/pos/restaurant`, `/kiosk` (attendance/POS kiosk) each wrap themselves individually in `<ErrorBoundary level="page"><Suspense><RequireAuth>...</RequireAuth></Suspense></ErrorBoundary>`. They live here rather than `appRoutes.jsx` because they render full-screen outside `AppLayoutRedesign` (no sidebar/shell).
- **`/customer-display`**: no auth at all — meant for a second unattended screen.
- **Storefront** (`/store/:tenantSlug`): public embedded shop. Parent `StorefrontLayout` + nested index/`products`/`products/:productId`/`cart`/`checkout`/`order/:orderToken`. Nested children are NOT individually wrapped in `<Suspense>` — only the parent layout is.
- **Public booking/menu/pay/reserve/forms/inquiry**: `/book/:tenantSlug`, `/book-room/:tenantSlug`, `/menu/:token`, `/pay/:token`, `/reserve/:tenantSlug`, `/forms/fill/:token`, `/member-checkin`, `/inquire/:tenantSlug` — QR-code/link driven, no auth.
- **Customer portal** (`/portal/:tenantSlug`): nested route tree under `PortalLayout` (dashboard/login/signup/verify-otp/forgot/reset/invoices/appointments/treatments/forms/stays/packages/subscriptions/contracts/tickets/orders/loyalty/wallet/profile/gallery). `PortalLayout` is NOT the main app's `AuthProvider` session — it uses its own `PortalAuthProvider` internally. `main.jsx` still wraps the whole app (including this route file) in the root `AuthProvider`, but the portal never reads from it.
- **Manufacturer portal** (`/manufacturer-portal/:tenantSlug`): parallel structure to the customer portal under `ManufacturerPortalLayout` (dashboard/login/setup/forgot-password/sales/promotions). Own JWT scope and session store, isolated from both the tenant app and the customer portal.

### `HomeRedirect` (element for `/`)

1. `isBootstrapping` → render `null` (wait for auth to resolve).
2. `isAuthenticated` → `<Navigate to="/context-select" replace />`.
3. If NOT `IS_MULTI_TENANT` → fire-and-forget `GET ${API_BASE}/api/setup/status` (raw `fetch`, not `api.js`); if `!setup_complete`, navigate to `/setup`. A `checkedRef` guard prevents this from re-running on re-renders.
4. Otherwise → render `MarketingHome` (lazy) inside its own `<Suspense>`.

The setup-status check never runs in MT mode (self-service tenants always land on the marketing page or dashboard, never the first-run wizard here).

---

## `appRoutes.jsx`

A single pathless parent route wraps every child:
```
RequireAuth > RequireContext > AppLayoutRedesign
```
So every route added to this file automatically gets auth, outlet/company context enforcement, and the app shell (sidebar, header, banners) for free — never add a per-route auth wrapper here.

**Local helpers** (defined at the top of the file):
- `wrap(Component)` → `<Suspense fallback={<RouteLoading />}><Component /></Suspense>` — use for any component not already using inline JSX.
- `perm(permString, element)` → `<RequirePerm perm={permString}>{element}</RequirePerm>` — gates a route on a single permission string (or `"all_access"`). Applied around the already-wrapped element, e.g. `perm("manage_inventory", wrap(SomeRoute))` or `perm("manage_orders", <OrdersRoute />)`.

**Conventions to follow when adding a route:**
- Routes with no `perm(...)` wrapper are available to any authenticated employee (e.g. `/dashboard`, `/profile`, `/sales-history`, `/customers`, `/attribute-sets`, `/reports`, `/notifications`, `/tax-lookup`, `/receipt-templates`, `/returns`).
- Several features expose multiple paths that all render the *same* route component — the component itself reads the path/tabId to decide what to show. Examples: `/rentals`, `/rentals/items`, `/rentals/contracts`, `/rentals/timeline`, `/rentals/deliveries` all render `RentalsRoute`; `/rooms/*` (rates/bookings/calendar/arrivals-departures/channels/night-audit) all render `RoomManagementRoute`; `/treatment-plans/*` (active/calendar/labs/templates/chart/:planId/:planId) all render `TreatmentPlansRoute`. Follow this pattern instead of creating a new lazy component per sub-tab.
- Report deep-links follow one pattern: `<Route path="/reports/<slug>" element={wrap(() => <ReportTabStandaloneRoute tabId="<id>" />)} />`. `ReportTabStandaloneRoute` is a **named export** from `pages/ReportsRoute.jsx` (not the default export) — imported via `lazy(() => import("../pages/ReportsRoute").then((mod) => ({ default: mod.ReportTabStandaloneRoute })))`.
- Feature-flag-gated pages (e.g. wholesale field-sales routes, V05 clinical `recalls`/`vaccination-card`/`handouts`, F03 `/settings/forms`) do NOT gate at the route level — the flag check happens inline inside the page component. The route only enforces the permission (or, for a few like `/recalls`, no permission at all — just `wrap(...)`, since front desk with `view_reports` can read).
- A handful of routes are intentional placeholders rendering `<PlaceholderPage />` directly (no lazy import): `/lookup`, `/custom-fields`, `/partners`, `/shopcast`, `/reports/parent-report` — these are stubbed nav entries, not bugs.
- Some paths are deliberate aliases for the same component — e.g. `/retail/home` renders `DashboardRoute`, same as `/dashboard` (a preference-friendly URL, not a duplicate page).

---

## `adminRoutes.jsx`

All routes nested under `/admin`. Auth is checked **inside `AdminLayout`** (super-admin session, separate from tenant auth) — there is no `<RequireAuth>` wrapper at the route level here. `/admin/login` sits outside the `/admin` parent route since it must render before a session exists.

Every page here uses the same `wrap(Component)` Suspense helper (redefined locally in this file, identical pattern to `appRoutes.jsx`'s). No `perm()` equivalent exists in this file — all super-admin pages get equal access once past `AdminLayout`'s own check.

When adding a new super-admin page: add the lazy import, then a child `<Route path="...">` inside the `/admin` parent route — it inherits `AdminLayout`'s own auth check automatically.

---

## `RouteLoading.jsx`

Default export — a single presentational component used as the `Suspense` fallback everywhere in this directory (every `wrap()` helper across all three route files references it, plus several routes reference it directly). Centered "Loading..." card, no props, no logic, no data-fetching. Keep it a pure, instant-render placeholder since it's shown during code-splitting chunk loads.

---

## Adding a new page — checklist

1. Build the page component under `pages/` (or `pages/redesign/`) and a thin `pages/<Name>Route.jsx` wrapper if following the existing lazy-route-wrapper convention.
2. Decide which file it belongs in:
   - Needs the app shell + auth + context → `appRoutes.jsx`, gated with `perm(...)` if it's not open to all authenticated employees.
   - Public, or has its own bespoke full-screen layout (POS, kiosk, storefront, portals) → `publicRoutes.jsx`.
   - Super-admin only → `adminRoutes.jsx`.
3. Add the `lazy(() => import(...))` declaration at the top, then the `<Route>` entry using the local `wrap(...)`/`perm(...)` helpers as appropriate.
4. If the route needs a breadcrumb label, add it to the label map in `ui/Breadcrumbs.jsx` separately — this directory does not handle breadcrumbs.
