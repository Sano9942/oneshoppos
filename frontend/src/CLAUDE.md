# frontend/src — Claude Guide

React 19 + Vite 7 + Tailwind CSS v4 frontend source root.

---

## Core Files

### `main.jsx`
App bootstrap. Provider hierarchy (outermost → innermost):
```
ErrorBoundary → CurrencyProvider → ToastProvider → AuthProvider → PresetProvider → App (BrowserRouter)
```
Initializes Sentry from `SENTRY_DSN` (no-op if unset). Registers service worker in prod only. Installs stale-chunk recovery handlers (`vite:preloadError`, `unhandledrejection`) via `utils/chunkReload.js`.

### `App.jsx`
Not purely composition-only — also calls `initTheme()` at module load (imported from `utils/theme.js`, runs before the component renders) and calls `useAuth()` to read `isImpersonating`. Spreads `publicRoutes`, `appRoutes`, `adminRoutes` into a single `<Routes>`. Renders `ImpersonationBanner` outside the router. `SubscriptionBanner` and `PwaInstallPrompt` render inside the router but outside `<Routes>` (global, every page). Catch-all `path="*"` redirects to `/`. Do not add route logic here.

### `api.js`
Centralized API client. Named export `api` object with 6 methods:

| Method | Signature | Notes |
|--------|-----------|-------|
| `api.get` | `(path, query?)` | Appends query via `URLSearchParams` |
| `api.post` | `(path, data)` | JSON body |
| `api.put` | `(path, data)` | JSON body |
| `api.del` | `(path)` | No body |
| `api.upload` | `(path, formData)` | Multipart — NO `Content-Type` header (browser sets boundary) |
| `api.raw` | `(path, options?)` | Returns raw `Response` — caller checks `res.ok`. Does NOT throw |

**Gotchas:**
- `api.js` does NOT inject auth headers itself. `AuthProvider` patches `window.fetch` globally — all calls through `api.js` get headers automatically.
- Paths must include `/api/` prefix (e.g. `api.get("/api/products")`) — the interceptor matches on `/api/`.
- On non-ok responses, `get/post/put/del` throw `Error` with `.message = body.error || "HTTP N"`, `.status`, and `.body`.
- On 403 with `code: "PLAN_LIMIT_REACHED"`, dispatches `CustomEvent("sanopos:plan-limit-reached")` before throwing — `PlanLimitModalInterceptor` in `AppLayoutRedesign` catches this.
- `api.raw` does NOT throw on non-ok — caller must check `res.ok`.
- Admin pages use `adminFetch` from `AdminLogin.jsx`, NOT `api.js`. Do not replace.
- Portal pages use `portalApi` from `api/portalApi.js`, NOT `api.js`.
- `CurrencyContext`, `useFeatureFlags`, admin pages (use `adminFetch`), `NotificationBell`, `ContextSwitcher`, `AuthProvider` (the interceptor itself), portal appointment public booking flows, `utils/receipt.js` (`printToHardware`), and at least one restaurant admin redesign file use raw `fetch()` or non-`api.js` paths intentionally — they run before the interceptor may be wired, bypass it by design, or live outside tenant auth scope. Do not replace these with `api.js`.

### `config.js`
Single source for all `import.meta.env` reads. Never read `import.meta.env` directly anywhere else.

| Export | Source | Notes |
|--------|--------|-------|
| `API_BASE` | `VITE_API_BASE` or `http://localhost:5000` | No trailing slash, no `/api` suffix |
| `IS_MULTI_TENANT` | `VITE_MULTI_TENANT === "1"` | Controls store-code field on login |
| `SENTRY_DSN` | `VITE_SENTRY_DSN` or `""` | Empty string = Sentry disabled |
| `TURNSTILE_SITE_KEY` | `VITE_TURNSTILE_SITE_KEY` or `""` | Empty string = CAPTCHA disabled |
| `ENV_MODE` | `import.meta.env.MODE` | `"production"` / `"development"` |
| `IS_PROD` | `import.meta.env.PROD` | Boolean |
| `IS_DEV` | `import.meta.env.DEV` | Boolean |

There is no `API` export. `AuthProvider` aliases `API_BASE as API` internally — that alias is not in `config.js`.

---

## Subdirectory Modules

### `auth/` — see `auth/CLAUDE.md`

Four independent auth scopes, four independent localStorage-backed stores: tenant (`AuthProvider.jsx` + `authStore.js`), super-admin (`adminAuthStore.js`), customer portal (`customerPortalStore.js`), manufacturer portal (`manufacturerPortalStore.js`). None of their tokens or storage keys overlap.

`useAuth()` key fields: `employee`, `session`, `permissions`, `isAuthenticated`, `isBootstrapping`, `login()`, `logout()`, `hasPerm(perm)`, `authHeaders(extra?)`, `token`, `isImpersonating`, `impersonationTenantName`, `subscriptionStatus` (`null|'trial'|'grace'|'expired'|'active'`), `subscriptionDaysLeft`, `tenantPlan`, `company` (includes `tax_mode`).

Only the tenant scope patches `window.fetch` (the global interceptor). Admin and portal pages call their own fetch wrappers instead.

**Interceptor gotcha:** only re-registered when `employee?.id` changes, NOT when `token` changes. Do NOT add `token` to any `useEffect` dep array wrapping the interceptor — causes a re-registration loop. Token reads live via `readToken()`.

---

### `contexts/` — see `contexts/CLAUDE.md`

Provider nesting (outermost → innermost): `CurrencyProvider → ToastProvider → AuthProvider → PresetProvider`. `CurrencyProvider`/`ToastProvider` sit outside `AuthProvider` and must not depend on the fetch interceptor.

- **`CurrencyContext.jsx`** → `useCurrency()` → `{ symbol, code, denominations, fmt(n), refresh() }`. Uses raw `fetch()` (intentional — outside `AuthProvider`). Appends `?tenant=slug` in MT mode.
- **`ToastContext.jsx`** → `useToast()` → `{ toast(msg, type?), success, error, warning }`. Max 3 visible, 4s auto-dismiss. Throws if used outside the provider.
- **`PresetContext.jsx`** → `usePreset()` → `{ industry_type, labels, hasMode(mode), label(key), enabled_modes, unit_vocabulary, pos_layout_mode, presetLoaded, updatePreset() }`. Fetches `GET /api/context/bootstrap` only after `employee?.id` set AND `isBootstrapping` false. `hasMode()` fail-opens to `true` before load.

---

### `utils/` — see `utils/CLAUDE.md`

No React dependencies except `errorLog.js`.

- **`dates.js`** — dual timestamp system. UTC columns (sales, returns, shifts) → `fmtUtcDateTime/Date/Time`. LOCAL columns (attendance, expenses, GRN, parked_sales) → `fmtLocalDateTime/Date/Time`. Never use `toISOString().slice(0,10)` for "today" — use `todayLocalStr()` instead. Never pass a raw DB value straight to `new Date()`.
- **`csvExport.js`** — single export `downloadCsv(headers, rows, filename)`. Standard for all new CSV exports — do not hand-roll Blob code.
- **`offlineQueue.js`** — POS offline queue, IndexedDB-backed (`idb` library, not localStorage). Types: `sale`, `return`, `check_in`, `field_order`. `MAX_QUEUED = 50` shared cap across all types.
- **`receipt.js`** — `buildReceiptSections`, `buildReceiptHtml`, `printToHardware`. Single source of truth for receipt rendering — never duplicate receipt-line logic elsewhere. `slip.timestamp` must be pre-formatted before passing.
- **`paperSizes.js`** — `PAPER_SIZES`, `pxForChars(chars)` — shared between printer settings and receipt templates.
- **`publicReceipt.js`** — `buildPublicReceiptUrl`, `buildReceiptShareMessage`, `buildWhatsAppShareUrl`.
- **`categoryTree.js`** — `sortCategories`, `leafCategories`, `parentOptions` (circular-safe), `indentLabel`.
- **`theme.js`** — dark mode: `getTheme()`, `setTheme()`, `toggleTheme()`, `initTheme()`. Stored in `localStorage["sanopos_theme"]`, applied via `document.documentElement.dataset.theme`. Called at module load in `App.jsx`, not `main.jsx`.
- **`chunkReload.js`** — stale-chunk recovery after deploys. Reloads at most once per 30s window.
- **`errorLog.js`** — `logErrorState()` — best-effort POST to `/api/action-history`, swallows all errors.
- **`imageCompress.js`** — `compressImage()` — client-side image downsizing before upload (field-rep selfies, etc).

---

### `ui/` — see `ui/CLAUDE.md`

Design system, shared banners, nav config. Most components use CSS custom property classes (`text-(--ui-text)`, `bg-(--ui-surface)`) for dark mode. Several files still use hardcoded Tailwind colors: `AnnouncementBanner.jsx`, `PwaInstallPrompt.jsx`, `MultiOutletEnabledBanner.jsx`, `SubscriptionBanner.jsx`, `StarRating.jsx`, parts of `SupportWidget.jsx`, plus `Badge`/`BulkActionBar`/modal backdrop in `primitives.jsx`.

Key primitives (`primitives.jsx`): `PageShell({ title, subtitle?, right? })` (no `actions` prop), `SectionCard({ children, className? })` (no `title` prop), `Button({ tone?, size?, iconOnly? })` (tones: `default`/`primary`/`danger`/`plain`/`link` — no `variant` prop), `Input`, `Select`, `Badge`, `Modal`/`ModalBody`/`ModalFooter`/`ConfirmDialog`, `TabBar`.

`ErrorBoundary` is a **named export**: `import { ErrorBoundary } from "../ui/ErrorBoundary"`. Uses a different CSS token namespace (`--border-primary` etc.) than the rest of `ui/` (`--ui-*`).

`nav-config.js` exports `SHOPIFY_NAV_GROUPS` — sidebar nav gated by `requiredPerm`/`requiredFlag`/`requiredMode`.

---

### `routes/` — see `routes/CLAUDE.md`

Route definitions split by access level. `App.jsx` only spreads these arrays — never add route logic there.

- **`publicRoutes.jsx`** — unauthenticated + self-contained-auth routes: landing, `/login`, `/signup`, `/reset-password`, `/receipt/:invoiceNumber`, `/store/:tenantSlug` (storefront), `/portal/:tenantSlug` (customer portal), `/manufacturer-portal/:tenantSlug`, public booking/menu/pay/reserve pages. Also hosts `/pos`, `/kiosk`, `/context-select` (full-screen, no app shell — each wraps itself in `<RequireAuth>`).
- **`appRoutes.jsx`** — single parent `RequireAuth > RequireContext > AppLayoutRedesign` wraps every child route. `wrap(Component)` adds Suspense; `perm(permStr, el)` gates on a permission string.
- **`adminRoutes.jsx`** — `/admin/*`. Auth checked inside `AdminLayout` via `getAdminToken()` — no `RequireAuth` wrapper.
- **`RouteLoading.jsx`** — shared Suspense fallback, pure presentational, no logic.

---

### `types/` — see `types/CLAUDE.md`

TypeScript declaration files (`allowJs + noEmit` — editor hints only, no runtime enforcement, nothing imports from here today). `auth.ts` (`AuthEmployee`, `JwtPayload` — reference shapes, may drift from real `AuthProvider`). `api.ts` (`ApiOk`/`ApiError`/`ApiResponse`, `isApiError()` — the one runtime-callable export, but `api.js` doesn't actually return this union shape).

---

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
Automatic via CSS variables on `[data-theme="dark"]`. POS is the exception — uses hardcoded colors.

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
