# Routes — Claude Guide

React Router route definitions, split into three arrays plus one shared fallback component. `App.jsx` imports `publicRoutes`, `appRoutes`, `adminRoutes` and spreads all three into a single `<Routes>` — it does not define any routes itself. New route logic belongs here, not in `App.jsx`.

**Why the split**: each array corresponds to a different auth/shell requirement — `publicRoutes.jsx` is unauthenticated or self-contained-auth (including full-screen surfaces that skip the app shell entirely), `appRoutes.jsx` is everything inside the authenticated app shell with tenant/outlet context, `adminRoutes.jsx` is the separate super-admin session. Keeping them in different files means each file's routes can share one wrapper (`RequireAuth > RequireContext > AppLayoutRedesign` for `appRoutes`, `AdminLayout`'s internal check for `adminRoutes`) instead of repeating guards per route.

Almost every page component is `lazy()`-loaded. Exceptions that are NOT lazy: `HomeRedirect`, `SetupWizard`, `AccessDenied`, `ContextSelect`, `RequireAuth`, `RequirePerm`, `RequireContext`, `AppLayoutRedesign`, `PlaceholderPage`, `RouteLoading`.

---

## `publicRoutes.jsx`

Unauthenticated (or self-contained-auth) routes. Key groups:

- **Marketing**: `/` (via `HomeRedirect`), `/industries`, `/industries/:slug`, `/pricing`, `/why-sanopos`.
- **Auth entry points**: `/login`, `/reset-password`, `/signup`, `/verify-email`.
- **Legal**: `/terms`, `/privacy`.
- **Setup wizard**: `/setup` — imported eagerly (not lazy).
- **Public shareable pages**: `/receipt/:invoiceNumber`, `/gift-card/:code`.
- **`/access-denied`** — plain, no auth, not lazy.
- **In-app routes that live here because they render full-screen with no sidebar/shell**: `/context-select` (wraps only in `<RequireAuth>`); `/pos`, `/pos/restaurant`, `/kiosk` each individually wrap themselves in `<ErrorBoundary level="page"><Suspense><RequireAuth>...</RequireAuth></Suspense></ErrorBoundary>`. They can't live in `appRoutes.jsx` because that file's parent route forces `AppLayoutRedesign` (sidebar/header) on every child.
- **`/kds`** follows that same escaped-shell pattern but is the one route here that keeps the *full* guard stack, spelled out inline since there's no shared parent to inherit from: `<ErrorBoundary><Suspense><RequireAuth><RequireContext><RequirePerm perm="manage_kds">`. It's a wall-mounted kitchen screen, so it must escape the merchant chrome — but unlike `/customer-display` it is **not** public (it reads real ticket data and needs an outlet). If you touch this route, keep all three guards: dropping `RequirePerm` opens KDS to any employee, dropping `RequireAuth` exposes it outright. This is why `publicRoutes.jsx` imports `RequireContext`/`RequirePerm` at all — `/kds` is their only consumer in this file.
- **`/customer-display`**: no auth at all — a second unattended screen, paired with the POS via local state/websocket, not a login.
- **Storefront** (`/store/:tenantSlug`): public embedded shop. Parent `StorefrontLayout` + nested `index`/`products`/`products/:productId`/`cart`/`checkout`/`order/:orderToken`. Nested children are NOT individually `<Suspense>`-wrapped — only the parent layout is.
- **Public booking/menu/pay/reserve/forms/inquiry**: `/book/:tenantSlug`, `/book-room/:tenantSlug`, `/menu/:token`, `/pay/:token`, `/reserve/:tenantSlug`, `/forms/fill/:token`, `/member-checkin`, `/inquire/:tenantSlug` — QR-code/link driven, no auth.
- **Customer portal** (`/portal/:tenantSlug`): nested tree under `PortalLayout` (index/login/signup/verify-otp/forgot/reset/invoices/invoice-paid/appointments/treatments/forms/stays/packages/subscriptions/contracts/tickets/orders/loyalty/profile/gallery). `PortalLayout` uses its own `PortalAuthProvider` internally — it never reads from the root tenant `AuthProvider`, even though `main.jsx` wraps the whole app (including this route file) in it.
- **Manufacturer portal** (`/manufacturer-portal/:tenantSlug`): parallel structure under `ManufacturerPortalLayout` (index/login/setup/forgot-password/sales/promotions). Own JWT scope and session store, isolated from both the tenant app and the customer portal.

### `HomeRedirect` (element for `/`)

Not lazy — defined inline in this file.

1. `isBootstrapping` → render `null` (wait for auth to resolve).
2. `isAuthenticated` → `<Navigate to="/context-select" replace />`.
3. If NOT `IS_MULTI_TENANT` → fire-and-forget `GET ${API_BASE}/api/setup/status` (raw `fetch`, not `api.js`); if `!setup_complete`, navigate to `/setup`. A `checkedRef` guard stops this from re-running on re-renders.
4. Otherwise → render `MarketingHome` (lazy) inside its own `<Suspense>`.

The setup-status check never fires in MT mode — self-service tenants always land on the marketing page or dashboard, never this legacy first-run wizard check.

---

## `appRoutes.jsx`

A single pathless parent route wraps every child:
```
RequireAuth > RequireContext > AppLayoutRedesign
```
Every route added to this file automatically gets auth, outlet/company context enforcement, and the app shell (sidebar, header, banners) for free — never add a per-route auth wrapper here.

**Local helpers** (top of file):
- `wrap(Component)` → `<Suspense fallback={<RouteLoading />}><Component /></Suspense>`.
- `perm(permStringOrArray, element)` → `<RequirePerm perm={permStringOrArray}>{element}</RequirePerm>`. `perm` accepts either a single permission string (or `"all_access"`) or an array of alternatives (`RequirePerm` treats the array as "any of these") — e.g. `perm(["view_hr_reports", "view_financial_reports"], wrap(RetailRiskRoute))` or `perm(["execute_field_sales", "manage_field_sales"], wrap(FieldTodayRedesign))`.

**Conventions to follow when adding a route:**
- Routes with no `perm(...)` wrapper are available to any authenticated employee (e.g. `/dashboard`, `/profile`, `/sales-history`, `/customers`, `/reports`, `/notifications`, `/tax-lookup`, `/returns`).
- Several features expose multiple paths that all render the *same* route component — the component reads the path/tabId itself to decide what to show, instead of one lazy component per sub-tab. Examples: `/rentals`, `/rentals/items`, `/rentals/contracts`, `/rentals/timeline`, `/rentals/deliveries` all render `RentalsRoute`; `/rooms/*` (rates/bookings/calendar/arrivals-departures/channels/night-audit) all render `RoomManagementRoute`; `/treatment-plans/*` (active/calendar/labs/templates/chart/:planId/:planId) all render `TreatmentPlansRoute`. Follow this pattern for new sub-tabs rather than adding a new component.
- Report deep-links follow one pattern: `<Route path="/reports/<slug>" element={wrap(() => <ReportTabStandaloneRoute tabId="<id>" />)} />`. `ReportTabStandaloneRoute` is a **named export** from `pages/ReportsRoute.jsx` (not the default) — imported via `lazy(() => import("../pages/ReportsRoute").then((mod) => ({ default: mod.ReportTabStandaloneRoute })))`.
- Feature-flag-gated pages (wholesale field-sales, clinical `recalls`/`vaccination-card`/`handouts`, `/settings/forms`) do NOT gate at the route level — the flag check happens inline inside the page component. The route only enforces a permission (or, for `/vaccination-card/:subjectId`, no permission at all — it's reached from customer detail, not nav, and is read-only).
- A handful of routes intentionally render `<PlaceholderPage />` directly (no lazy import): `/lookup`, `/custom-fields`, `/partners`, `/shopcast`, `/reports/parent-report` — stubbed nav entries, not bugs.
- Some paths are deliberate aliases for the same component — e.g. `/retail/home` renders `DashboardRoute`, same as `/dashboard` (a preference-friendly URL, not a duplicate page).
- When a route's permission changes, keep it in sync with the corresponding nav-guard entry in `ui/nav-config.js` — a mismatch either hides a reachable route from nav, or leaves a hidden route open to direct URL access.

---

## `adminRoutes.jsx`

All routes nested under `/admin`. Auth is checked **inside `AdminLayout`** (a separate super-admin session, unrelated to tenant auth) — there is no `<RequireAuth>` wrapper at the route level here. `/admin/login` sits outside the `/admin` parent route since it must render before a session exists.

Every page here uses the same `wrap(Component)` Suspense helper, redefined locally in this file (identical pattern to `appRoutes.jsx`'s, but a separate copy — the two files don't share a helpers module). There is no `perm()` equivalent in this file — every page gets equal access once past `AdminLayout`'s own check.

To add a new super-admin page: add the lazy import, then a child `<Route path="...">` inside the `/admin` parent route — it inherits `AdminLayout`'s auth check automatically.

---

## `RouteLoading.jsx`

Default export — a single presentational component used as the `Suspense` fallback everywhere in this directory (every `wrap()` helper in all three route files references it, plus several routes reference it directly inline). Centered "Loading..." card, no props, no logic, no data-fetching. Keep it a pure, instant-render placeholder — it's shown during code-splitting chunk loads, so any added logic or async work here would delay every lazy route in the app.

---

## Adding a new page — checklist

1. Build the page component under `pages/` (or `pages/redesign/`) and, if following the existing convention, a thin `pages/<Name>Route.jsx` lazy-load wrapper.
2. Decide which file it belongs in:
   - Needs the app shell + auth + context → `appRoutes.jsx`, gated with `perm(...)` unless it should be open to all authenticated employees.
   - Public, or has its own bespoke full-screen layout (POS, kiosk, storefront, portals) → `publicRoutes.jsx`.
   - Super-admin only → `adminRoutes.jsx`.
3. Add the `lazy(() => import(...))` declaration at the top of the chosen file, then the `<Route>` entry using that file's local `wrap(...)`/`perm(...)` helpers as appropriate.
4. If the route needs a breadcrumb label, add it to the label map in `ui/Breadcrumbs.jsx` separately — this directory does not handle breadcrumbs.
