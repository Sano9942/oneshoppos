# Routes — Claude Guide

React Router route definitions, split by access level into 3 arrays + 1 shared fallback component. `App.jsx` imports `publicRoutes`, `appRoutes`, `adminRoutes` and spreads all three into a single `<Routes>` — it does not define any routes itself. Do not add route logic to `App.jsx`; add it here.

Most page components are `lazy()`-loaded. Exceptions that are NOT lazy: `HomeRedirect`, `SetupWizard`, `AccessDenied`, `ContextSelect`, `RequireAuth`, `RequireContext`, `RequirePerm`, `AppLayoutRedesign`, `PlaceholderPage`, `RouteLoading`.

---

## `publicRoutes.jsx`

Unauthenticated (or self-contained-auth) routes. Key groups:

- **Landing/marketing**: `/`, `/landing-preview`, `/preview/landing-*` (multiple design variants).
- **Auth entry points**: `/login`, `/signup`, `/reset-password`, `/verify-email`.
- **Legal**: `/terms`, `/privacy`.
- **Public shareable pages**: `/receipt/:invoiceNumber`, `/gift-card/:code`.
- **In-app but public-route-file routes that DO require auth**: `/context-select`, `/pos`, `/pos/restaurant`, `/kiosk` (attendance kiosk — not the restaurant ordering kiosk, which lives in `appRoutes.jsx`) all wrap themselves individually in `<RequireAuth>` (POS/kiosk also wrap in `<ErrorBoundary level="page">`). They live here rather than in `appRoutes.jsx` because they render full-screen outside `AppLayoutRedesign` (no sidebar/shell).
- **`/customer-display`**: no auth at all — meant for a second unattended screen.
- **Storefront** (`/store/:tenantSlug`): public embedded shop, nested routes for home/products/product-detail/cart/checkout/order-status.
- **Public booking/menu/pay/reserve**: `/book/:tenantSlug`, `/menu/:token`, `/pay/:token`, `/reserve/:tenantSlug` — QR-code/link driven, no auth.
- **Customer portal** (`/portal/:tenantSlug`): nested route tree (dashboard, login, signup, OTP verify, forgot/reset password, invoices, appointments, treatments, stays, orders, loyalty, wallet, profile). Uses its own `PortalAuthProvider`/`PortalLayout` — NOT the main app's `AuthProvider` session. `main.jsx` still wraps the whole app (including this route file) in the root `AuthProvider`, but the portal never reads from it; isolation happens at the `PortalLayout` level, not the router root.
- **Manufacturer portal** (`/manufacturer-portal/:tenantSlug`): parallel structure to the customer portal — own layout, login, setup, forgot-password, dashboard, sales, promotions (schemes). Own JWT scope and session store, isolated from both the tenant app and the customer portal.

### `HomeRedirect` (element for `/`)

1. `isBootstrapping` → render `null` (wait for auth to resolve).
2. `isAuthenticated` → `<Navigate to="/context-select" replace />`.
3. If NOT `IS_MULTI_TENANT` → fire-and-forget `GET /api/setup/status`; if `!setup_complete`, navigate to `/setup`. A `checkedRef` guard prevents this from re-running on re-renders.
4. Otherwise → render `LandingPagePreview`.

The setup-status check never runs in MT mode (self-service tenants always land on the marketing page or dashboard, never the first-run wizard here).

---

## `appRoutes.jsx`

A single pathless parent route wraps every child:
```
RequireAuth > RequireContext > AppLayoutRedesign
```
So every route added to this file automatically gets auth, outlet/company context enforcement, and the app shell (sidebar, header, banners) for free — never add a per-route auth wrapper here.

**Local helpers** (defined at the top of the file):
- `wrap(Component)` → `<Suspense fallback={<RouteLoading />}><Component /></Suspense>` — use for any component not already using inline JSX destructuring.
- `perm(permString, element)` → `<RequirePerm perm={permString}>{element}</RequirePerm>` — gates a route on a single permission string (or `"all_access"`).

**Conventions to follow when adding a route:**
- Routes with no `perm(...)` wrapper are available to any authenticated employee (e.g. `/dashboard`, `/profile`, `/sales-history`, `/customers`, `/reports`, `/notifications`, `/tax-lookup`, `/receipt-templates`).
- Several features expose multiple paths (e.g. `/rentals`, `/rentals/items`, `/rentals/contracts`, `/rentals/timeline`; `/rooms/*`; `/treatment-plans/*`) that all render the *same* route component — the component itself reads the path/tabId to decide what to show. Follow this pattern instead of creating a new lazy component per sub-tab.
- Report deep-links follow one pattern: `<Route path="/reports/<slug>" element={wrap(() => <ReportTabStandaloneRoute tabId="<id>" />)} />`. `ReportTabStandaloneRoute` is a **named export** from `pages/ReportsRoute.jsx` (not the default export) — imported via `.then((mod) => ({ default: mod.ReportTabStandaloneRoute }))`.
- Feature-flag-gated pages (e.g. Tier 1.1 field-sales routes) do NOT gate at the route level — the flag check happens inline inside the page component. The route only enforces the permission (e.g. `manage_field_sales`).
- A handful of routes are intentional placeholders: `<Route path="/lookup" element={<PlaceholderPage />} />` and similar for `/custom-fields`, `/partners`, `/shopcast`, `/reports/parent-report` — these are stubbed nav entries, not bugs.
- Some paths are deliberate aliases for the same component (e.g. `/retail/home` renders `DashboardRoute`, same as `/dashboard`) — a preference-friendly URL, not a duplicate page.

---

## `adminRoutes.jsx`

All routes nested under `/admin`. Auth is checked **inside `AdminLayout`** via `getAdminToken()` (super-admin session, separate from tenant auth) — there is no `<RequireAuth>` wrapper at the route level here. `/admin/login` sits outside `AdminLayout` since it must render before a session exists.

When adding a new super-admin page: add the lazy import, then a child `<Route path="...">` inside the `/admin` parent route — it inherits `AdminLayout`'s own auth check automatically.

---

## `RouteLoading.jsx`

Default export — a single presentational component used as the `Suspense` fallback everywhere in this directory (`wrap()` helpers in all three route files reference it). Centered "Loading..." card. Do not add data-fetching or logic here; it must stay a pure, instant-render placeholder since it's shown during code-splitting chunk loads.

---

## Adding a new page — checklist

1. Build the page component under `pages/` (or `pages/redesign/`) and a thin `pages/<Name>Route.jsx` wrapper if following the existing lazy-route-wrapper convention.
2. Decide which file it belongs in:
   - Needs the app shell + auth + context → `appRoutes.jsx`, gated with `perm(...)` if it's not open to all authenticated employees.
   - Public, or has its own bespoke full-screen layout (POS, kiosk, storefront, portals) → `publicRoutes.jsx`.
   - Super-admin only → `adminRoutes.jsx`.
3. Add the `lazy(() => import(...))` declaration at the top, then the `<Route>` entry using `wrap(...)`/`perm(...)` as appropriate.
4. If the route needs a breadcrumb label, add it to the `LABELS` map in `ui/Breadcrumbs.jsx` separately — this directory does not handle breadcrumbs.
