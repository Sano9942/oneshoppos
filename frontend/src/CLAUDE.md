# frontend/src — Claude Guide

React 19 + Vite 7 + Tailwind CSS v4 frontend source root.

---

## Core Files

### `main.jsx`
App bootstrap. Provider hierarchy (outermost → innermost), verified directly from source:
```
ErrorBoundary → CurrencyProvider → ToastProvider → AuthProvider → PresetProvider → App (BrowserRouter, inside App.jsx)
```
Also: initializes Sentry from `SENTRY_DSN` (no-op if unset; filters out Cloudflare Turnstile Trusted-Types noise via `denyUrls`/`ignoreErrors`), installs stale-chunk recovery (`vite:preloadError` + `unhandledrejection` listeners via `utils/chunkReload.js`), and registers the service worker (`/sw.js`) only when `IS_PROD`.

### `App.jsx`
Not purely composition. Renders:
```
{isImpersonating && <ImpersonationBanner />}
<Router>
  <SubscriptionBanner />
  <PwaInstallPrompt />
  <Routes>{publicRoutes}{appRoutes}{adminRoutes}<Route path="*" element={<Navigate to="/" replace />} /></Routes>
</Router>
```
Calls `useAuth()` for `isImpersonating` only — no other side effects at module load. Imports `{ ErrorBoundary }` but does not render it here (the app-wide `ErrorBoundary` boundary is the one in `main.jsx`, wrapping everything including `App`). `SubscriptionBanner`/`PwaInstallPrompt` render globally (every page, inside the router but outside `<Routes>`). Do not add route logic here — route arrays live in `routes/`.

**Dark mode does not exist in this codebase.** There is no `utils/theme.js` file (confirmed: does not exist on disk) and `App.jsx` does not call any `initTheme()`/`toggleTheme()`. The app is light-only (Square design system, `--ui-*` tokens in `ui/tokens.css`, no `[data-theme]` attribute anywhere). If you see a stray mention of `theme.js`/`initTheme`/`sanopos_theme` in an older doc or comment, it is stale — dark mode was removed during the Square reskin.

### `api.js`
Centralized API client. Named export `api` object with 6 methods:

| Method | Signature | Notes |
|--------|-----------|-------|
| `api.get` | `(path, query?)` | Appends query via `URLSearchParams` |
| `api.post` | `(path, data)` | JSON body |
| `api.put` | `(path, data)` | JSON body |
| `api.del` | `(path)` | No body |
| `api.upload` | `(path, formData)` | Multipart — no `Content-Type` header (browser sets the boundary) |
| `api.raw` | `(path, options?)` | Returns the raw `Response` — caller checks `res.ok`. Does NOT throw |

**Gotchas:**
- `api.js` does not inject auth headers itself. `AuthProvider` patches `window.fetch` globally — every call through `api.js` picks up headers automatically as a side effect of that patch.
- Paths must include the `/api/` prefix (e.g. `api.get("/api/products")`) — the interceptor matches on `/api/`.
- On non-ok responses, `get/post/put/del` throw `Error` with `.message = body.error || "HTTP <status>"`, plus `.status` and `.body`.
- On `403` with `body.code === "PLAN_LIMIT_REACHED"`, dispatches `window` `CustomEvent(PLAN_LIMIT_EVENT)` (`"sanopos:plan-limit-reached"`) — with `{ error, limit, current }` detail — before throwing. A global listener (mounted inside `AppLayoutRedesign`) opens the upgrade modal; per-call `catch` handlers still run for inline feedback.
- `api.raw` does not throw on non-ok — caller must check `res.ok`.
- Admin pages use `adminFetch` from `pages/admin/AdminLogin.jsx`, not `api.js`. Portal pages use `portalApi` from `api/portalApi.js`, not `api.js`. Do not replace either.
- Other intentional non-`api.js` callers: `CurrencyContext`, `useFeatureFlags`, `NotificationBell`, `ContextSwitcher`, `AuthProvider` itself (the interceptor), portal public booking-config probes, `utils/receipt.js` (`printToHardware`), and at least one restaurant admin redesign file — these run before the interceptor is wired, bypass it by design, or live outside tenant auth scope entirely.

### `config.js`
Single source for every `import.meta.env` read. Never read `import.meta.env` directly anywhere else in the codebase.

| Export | Source | Notes |
|--------|--------|-------|
| `API_BASE` | `VITE_API_BASE` or `http://localhost:5000` | No trailing slash, no `/api` suffix |
| `IS_MULTI_TENANT` | `VITE_MULTI_TENANT === "1"` | Controls store-code field on login, JWT auth flow |
| `SENTRY_DSN` | `VITE_SENTRY_DSN` or `""` | Empty string = Sentry disabled |
| `TURNSTILE_SITE_KEY` | `VITE_TURNSTILE_SITE_KEY` or `""` | Empty string = CAPTCHA disabled on `SignupPage` |
| `ENV_MODE` | `import.meta.env.MODE` | `"production"` / `"development"` |
| `IS_PROD` | `import.meta.env.PROD` | Boolean |
| `IS_DEV` | `import.meta.env.DEV` | Boolean |

There is no `API` export — `AuthProvider` locally aliases `API_BASE as API` inside its own module; that alias does not exist in `config.js` itself.

---

## Subdirectory Modules

### `auth/` — see `auth/CLAUDE.md`
Four independent auth scopes, four independent localStorage-backed stores, never mixed: tenant (`AuthProvider.jsx` + `authStore.js`), super-admin (`adminAuthStore.js`), customer portal (`customerPortalStore.js`, slug-scoped), manufacturer portal (`manufacturerPortalStore.js`, slug-scoped).

`useAuth()` key fields: `employee`, `session`, `permissions`, `isAuthenticated`, `isBootstrapping`, `login()`, `logout()`, `hasPerm(perm)`, `authHeaders(extra?)`, `token`, `isImpersonating`, `impersonationTenantName`, `subscriptionStatus` (`null|'trial'|'grace'|'expired'|'active'`), `subscriptionDaysLeft`, `tenantPlan`, `company` (includes `tax_mode`).

Only the tenant scope patches `window.fetch`. **Interceptor gotcha**: never add `token` to a `useEffect` dep array wrapping the interceptor — it's keyed only on `employee?.id`, adding `token` causes a re-registration loop. Token is always read live via `readToken()`.

### `contexts/` — see `contexts/CLAUDE.md`
Provider nesting (outermost → innermost): `CurrencyProvider → ToastProvider → AuthProvider → PresetProvider`. `CurrencyProvider`/`ToastProvider` sit outside `AuthProvider` and must never depend on the fetch interceptor or `useAuth()`.

- `CurrencyContext.jsx` → `useCurrency()` → `{ symbol, code, denominations, fmt(n), refresh() }`. Uses raw `fetch()` intentionally (renders before the interceptor is wired). Appends `?tenant=slug` in MT mode.
- `ToastContext.jsx` → `useToast()` → `{ toast(msg, type?), success, error, warning }`. Max 3 visible, 4s auto-dismiss. Throws if used outside the provider.
- `PresetContext.jsx` → `usePreset()` → `{ industry_type, labels, hasMode(mode), label(key), enabled_modes, unit_vocabulary, pos_layout_mode, presetLoaded, updatePreset(), refreshPreset() }`. Fetches `GET /api/context/bootstrap` only once `employee?.id` is set and `isBootstrapping` is false. `hasMode()` fail-opens to `true` before load so feature flags remain the sole pre-load gate. `refreshPreset()` re-fetches the bootstrap payload in place (no logout) — used after business-module toggles; keeps the current preset on failure.

### `utils/` — see `utils/CLAUDE.md`
Pure/no-React helpers except `errorLog.js` (uses `api.js`). **No `theme.js`** — confirmed absent from disk.

- `dates.js` — dual timestamp system. UTC columns (sales, returns, shifts) → `fmtUtcDateTime/Date/Time`. LOCAL columns (attendance, expenses, GRN, parked_sales) → `fmtLocalDateTime/Date/Time`. Never `toISOString().slice(0,10)` for "today" — use `todayLocalStr()`. Never pass a raw DB value straight to `new Date()`.
- `csvExport.js` — single export `downloadCsv(headers, rows, filename)`. Standard for all new CSV exports — do not hand-roll Blob code.
- `offlineQueue.js` — POS offline queue, IndexedDB-backed (`idb` library). Types: `sale`, `return`, `check_in`, `field_order`. `MAX_QUEUED = 50` shared cap across all types.
- `receipt.js` — `buildReceiptSections`, `buildReceiptHtml`, `printToHardware`. Single source of truth for receipt rendering — never duplicate receipt-line logic elsewhere. `slip.timestamp` must be pre-formatted before passing in.
- `paperSizes.js` — `PAPER_SIZES`, `pxForChars(chars)` — shared between printer settings and receipt templates.
- `publicReceipt.js` — `buildPublicReceiptUrl`, `buildReceiptShareMessage`, `buildWhatsAppShareUrl`.
- `categoryTree.js` — `sortCategories`, `leafCategories`, `parentOptions` (circular-safe), `indentLabel`.
- `chunkReload.js` — stale-chunk recovery after deploys, wired from `main.jsx`. Reloads at most once per 30s window.
- `errorLog.js` — `logErrorState()` — best-effort POST to `/api/action-history`, swallows all errors.
- `imageCompress.js` — `compressImage()` — client-side image downsizing before upload (field-rep selfies, etc).
- `embeddedBarcode.js` — pure scale-label EAN-13 decode, mirrors a backend twin; zero imports by design.
- `scale.js` — Web Serial API lane-scale integration (POS "Weigh" button); adapter registry pattern.

### `ui/` — see `ui/CLAUDE.md`
Design system, shared banners, nav config. **Square design system: light-only** — near-monochrome, black primary, hairline borders, flat (no shadow), pill buttons. `primitives.jsx` is fully token-based (`--ui-*` from `tokens.css`, including `Badge`/`BulkActionBar`). Remaining hardcoded-color exceptions: `AnnouncementBanner.jsx`, `PwaInstallPrompt.jsx`, `MultiOutletEnabledBanner.jsx` (partially), `SubscriptionBanner.jsx`, `StarRating.jsx`, parts of `SupportWidget.jsx`.

Key primitives (`primitives.jsx`): `PageShell({ title, subtitle?, right? })` (no `actions` prop), `SectionCard({ children, className? })` (no `title` prop, flat), `Button({ tone?, size?, iconOnly? })` (tones: `default`/`primary`/`danger`/`plain`/`link` — no `variant` prop, only `tone`), `Input`, `Select`, `Badge`, `Modal`/`Drawer`/`ModalBody`/`ModalFooter`/`ConfirmDialog`, `TabBar`, `Toggle`, `Tooltip`, `FilterPill`, `EmptyState`.

`ErrorBoundary` is a **named export**: `import { ErrorBoundary } from "../ui/ErrorBoundary"`. Uses a different CSS token namespace (`--border-primary`/`--bg-primary`/`--text-primary`/`--text-secondary`) than the rest of `ui/` (`--ui-*`) — the two are not interchangeable.

`nav-config.js` exports `SHOPIFY_NAV_GROUPS` — sidebar nav gated by `requiredPerm`/`requiredFlag`/`requiredMode`.

### `routes/` — see `routes/CLAUDE.md`
Route definitions split by access level. `App.jsx` only spreads these three arrays — never add route logic there.

- `publicRoutes.jsx` — unauthenticated + self-contained-auth routes: landing, `/login`, `/signup`, `/reset-password`, `/receipt/:invoiceNumber`, `/store/:tenantSlug` (storefront), `/portal/:tenantSlug`, `/manufacturer-portal/:tenantSlug`, public booking/menu/pay/reserve pages. Also hosts `/pos`, `/kiosk`, `/context-select` (full-screen, no app shell — each self-wraps in `<RequireAuth>`).
- `appRoutes.jsx` — single parent `RequireAuth > RequireContext > AppLayoutRedesign` wraps every child route. `wrap(Component)` adds Suspense; `perm(permStr, el)` gates on a permission string.
- `adminRoutes.jsx` — `/admin/*`. Auth checked inside `AdminLayout`, not via a route-level `RequireAuth`.
- `RouteLoading.jsx` — shared Suspense fallback, pure presentational.

### `types/` — see `types/CLAUDE.md`
TypeScript declaration files (`allowJs + noEmit` — editor hints only, no runtime enforcement, nothing in `frontend/src` imports from here today). `auth.ts` (`AuthEmployee`, `JwtPayload` — reference shapes that may drift from the real `AuthProvider`). `api.ts` (`ApiOk`/`ApiError`/`ApiResponse`, `isApiError()` — the one runtime-callable export, but `api.js` doesn't actually return this union shape on success/failure — it throws a plain `Error`).

### `pages/` — see `pages/CLAUDE.md` and `pages/redesign/CLAUDE.md`
Most active tenant UI lives in `pages/redesign/` as `*Redesign.jsx` files. Route wrappers (`pages/*Route.jsx`) are thin lazy-load pass-throughs — never edit them (exceptions: `POSRoute.jsx`, `ReportsRoute.jsx` carry real logic). Other active subdirectories: `admin/`, `portal/`, `dashboard/`, `reports/`, `shopify/`, `storefront/`, `public/`.

---

## Key Conventions

### Tailwind v4
CSS-first config — no `tailwind.config.js`. Rules:
- `(--css-var)` NOT `[var(--css-var)]`
- `shrink-0` NOT `flex-shrink-0`, `grow` NOT `flex-grow`
- `bg-linear-to-br` NOT `bg-gradient-to-br`
- `z-200` NOT `z-[200]`

### API Calls
- Always use `api.js` for authenticated tenant pages. Never raw `fetch()` in `redesign/` pages.
- Admin pages: `adminFetch` from `AdminLogin.jsx`. Portal pages: `portalApi`. Public pages (`public/`, `storefront/`): raw `fetch()` is intentional.
- Never manually set `x-employee-id` or `Authorization` — the interceptor does it.

### Timestamps (recurring bug source)
- UTC columns (sales, returns, shifts, adjustments): `fmtUtcDateTime / fmtUtcDate / fmtUtcTime`
- LOCAL columns (attendance, expenses, GRN, parked_sales): `fmtLocalDateTime / fmtLocalDate / fmtLocalTime`
- Both from `utils/dates.js`. Never pass raw DB values to `new Date()`.

### Currency
`const { fmt } = useCurrency()` in components — never hardcode currency symbols.

### Dark Mode
There is no dark mode. The app is light-only (Square design system). Do not add `[data-theme]` logic or reintroduce `theme.js` without an explicit request — this was deliberately removed.

### Toast Notifications
`const { success, error, warning } = useToast()`. Page-level pattern: `catch(err) { toast.error(err.message || "Something went wrong") }`.

### Feature Flags
```jsx
const { flags, loading } = useFeatureFlags(authHeaders);
if (loading) return null;
if (!flags.some_flag) return <Navigate to="/" replace />;
```
No `RequireFeature` wrapper exists. Do NOT pass an inline `{}` as `authHeaders` each render — causes an infinite loop.

### Permissions
`hasPerm("perm_name")` from `useAuth()`. Returns true if `all_access` or the specific permission.

### CSV Export
Use `downloadCsv(headers, rows, filename)` from `utils/csvExport.js`. Do not write inline Blob code in new pages.
