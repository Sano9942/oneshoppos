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
Composition only — spreads `publicRoutes`, `appRoutes`, `adminRoutes` into a single `<Routes>`. Renders `ImpersonationBanner` outside the router. `SubscriptionBanner` is inside the router. Catch-all `path="*"` redirects to `/`. Do not add route logic here.

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
- `CurrencyContext` and `useFeatureFlags` use raw `fetch()` intentionally — they run before the interceptor may be wired.

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

### `auth/`

**`AuthProvider.jsx`** — exports `AuthProvider` + `useAuth()`.

`useAuth()` key fields:
- `employee`, `session`, `permissions`, `isAuthenticated`, `isBootstrapping`
- `login(username, password, tenantSlug?)`, `logout()`, `hasPerm(perm)`
- `authHeaders(extra?)` — returns `{ "x-employee-id", "Authorization" }` for manual header callers
- `token`, `isImpersonating`, `impersonationTenantName`, `impersonationSessionId`
- `subscriptionStatus` (`null|'trial'|'grace'|'expired'|'active'`), `subscriptionDaysLeft`, `tenantPlan`
- `company` — includes `tax_mode` (`'inclusive'|'exclusive'|'none'`)

**Fetch interceptor** patches `window.fetch`. Injects `x-employee-id`, `Authorization` (MT only), `x-company-id`, `x-outlet-id`, `x-scope-mode`. Also handles: offline guard (synthetic 503), token refresh on 401+`TOKEN_EXPIRED` (MT only, with `_refreshPromise` lock), subscription expiry on 403+`SUBSCRIPTION_EXPIRED`. Skips non-`/api/` URLs and public auth endpoints.

**Boot sequence:** restores impersonation, re-fetches permissions fresh (localStorage permissions not trusted), fetches billing status in MT mode.

**Interceptor gotcha:** only re-registered when `employee?.id` changes, NOT when `token` changes. Do NOT add `token` to any `useEffect` dep array wrapping the interceptor. Token reads live via `readToken()`.

---

**`authStore.js`** — localStorage helpers for tenant app session (`"authSession"` key). Never access localStorage directly for auth data.

Key exports: `readSession()`, `writeSession()`, `clearSession()`, `readContext()`, `writeContext()`, `clearContext()`, `readToken()`, `writeToken()`, `readTenantSlug()`. `writeSession` also writes `localStorage["currentEmployee"]` for backward compat.

---

**`adminAuthStore.js`** — localStorage helpers for super-admin session (`"adminSession"` key). Simpler — no context or token refresh.

Key exports: `readAdminSession()`, `writeAdminSession()`, `clearAdminSession()`, `getAdminToken()`, `getAdminSession()`.

---

**`customerPortalStore.js`** — slug-scoped portal session (`customerPortalSession:${slug}` key). One browser can be logged into multiple tenant portals simultaneously.

Key exports: `readPortalSession(slug)`, `writePortalSession(slug, session)`, `clearPortalSession(slug)`, `getPortalToken(slug)`, `getPortalCustomer(slug)`.

Used exclusively by `PortalAuthProvider` in `pages/portal/`. NOT interchangeable with `authStore.js` or `adminAuthStore.js`.

---

### `contexts/`

**`CurrencyContext.jsx`** — exports `CurrencyProvider` + `useCurrency()`.

`useCurrency()` returns: `{ symbol, code, denominations, fmt(n), refresh() }`. `fmt` is `symbol + " " + toLocaleString(2dp)`. Uses raw `fetch()` (not `api.js`) — intentional, `CurrencyProvider` is outside `AuthProvider`. In MT mode appends `?tenant=slug` to the fetch URL.

---

**`ToastContext.jsx`** — exports `ToastProvider` + `useToast()`.

`useToast()` returns: `{ toast(msg, type?), success(msg), error(msg), warning(msg) }`. Max 3 visible, 4s auto-dismiss. Throws if called outside `ToastProvider` — hard error.

---

**`PresetContext.jsx`** — exports `PresetProvider` + `usePreset()`.

`usePreset()` returns: `{ industry_type, business_model, labels, pos_layout_mode, enabled_modes, unit_vocabulary, presetLoaded, hasMode(modeName), label(key), updatePreset(data), ... }`.

Fetches `GET /api/context/bootstrap` via `api.js` after `employee?.id` is set AND `isBootstrapping` is false. The guard is intentional — without it, the first fetch goes through unpatched `window.fetch` and 401s, leaving clinic/restaurant tenants stuck on `general_retail`.

`hasMode(name)` returns `true` before preset loads (fail-open). Always flips `presetLoaded = true` on completion, success or error.

Additional named exports: `WEIGHTED_UNITS`, `DEFAULT_UNIT_VOCABULARY`, `isWeightedUnit(unit)`, `DEFAULT_PRESET`.

---

### `utils/`

**`dates.js`** — dual timestamp system. UTC columns (`TIMESTAMPTZ`: sales, returns, shifts) → use `fmtUtcDateTime/Date/Time`. LOCAL columns (`TIMESTAMP`: attendance, expenses, GRN, parked_sales) → use `fmtLocalDateTime/Date/Time`. Also exports `parseDbDate`, `parseLocalDate`. All formatters return `"—"` on null. Handles native JS `Date` objects (Postgres driver), ISO strings, and legacy SQLite space-separated strings.

**`csvExport.js`** — single export `downloadCsv(headers, rows, filename)`. No-ops if rows empty. Appends today's date to filename automatically.

**`offlineQueue.js`** — POS offline queue backed by IndexedDB (`idb` library). Supports `"sale"` and `"return"` types. `MAX_QUEUED = 50` (shared across both types). Key exports: `enqueue`, `enqueueSale`, `enqueueReturn`, `getQueue`, `markSyncing`, `markSynced`, `markFailed`, `markPending`, `clearQueue`, `migrateFromLocalStorage`.

**`receipt.js`** — receipt rendering. Key exports:
- `buildReceiptSections(slip, template, currencySymbol?)` — returns plain data object; both popup and modal consume this
- `buildReceiptHtml(slip, template, currencySymbol?, labels?)` — opens browser popup, calls `w.print()`
- `printToHardware(slip, template, labels?)` — POSTs to `/api/print/receipt`; returns `{ fallback: true }` if printer not configured; caller then calls `buildReceiptHtml` as fallback
- `formatPaymentMethodLabel(method)` — normalizes payment method IDs to display strings
- Re-exports `PAPER_SIZES` and `pxForChars` from `paperSizes.js`

`slip.timestamp` must be a pre-formatted display string — call `fmtDateTime()` before passing, never pass raw DB value.

**`paperSizes.js`** — `PAPER_SIZES` array + `pxForChars(chars)` for thermal printer width calculations.

**`publicReceipt.js`** — shareable receipt URLs and WhatsApp sharing: `buildPublicReceiptUrl`, `buildReceiptShareMessage`, `buildWhatsAppShareUrl`.

**`categoryTree.js`** — `sortCategories(rows)`, `leafCategories(rows)`, `parentOptions(rows, currentId?)` (circular-safe), `indentLabel(row)`.

**`theme.js`** — dark mode. Storage: `localStorage["sanopos_theme"]`. Applied via `document.documentElement.dataset.theme`. Exports: `getTheme()`, `setTheme(theme)`, `toggleTheme()`, `initTheme()` (call at boot in `main.jsx`).

**`chunkReload.js`** — stale-chunk recovery after deploys. `looksLikeChunkLoadFailure(err)`, `reloadOnceForChunkFailure(opts?)`. Guard: reloads at most once per 30s (sessionStorage). Installed in `main.jsx`.

**`errorLog.js`** — `logErrorState(actionType, description, context?)` → best-effort POST to `/api/action-history`. Swallows all errors — never blocks recovery flow.

---

### `ui/`

All components use CSS custom property classes (`text-(--ui-text)`, `bg-(--ui-surface)`) for dark mode. Exception: POS uses hardcoded colors.

**`primitives.jsx`** — core design system. Named exports:
- Layout: `PageShell({ title, subtitle?, right?, children })`, `SectionCard({ children, className? })`
- Forms: `Button({ tone?, size?, iconOnly?, className?, ...props })`, `Input({ className?, ...props })`, `Select({ className?, ...props })`
- Display: `Badge({ tone?, children })`, `EmptyState({ title, body? })`, `Skeleton({ className? })`
- Tables: `TableToolbar({ left, right })`, `BulkActionBar({ children })`
- Modals: `Modal({ open, onClose, title?, size?, hideClose?, closeOnBackdrop?, children })`, `ModalBody`, `ModalFooter`, `ConfirmDialog({ open, title?, body?, confirmLabel?, cancelLabel?, destructive?, busy?, onConfirm, onCancel })`
- Tabs: `TabBar({ value, onChange, tabs, className? })`

`PageShell` has no `actions` prop. `SectionCard` has no `title` prop. `Button` tones: `default`, `primary`, `danger`, `plain`, `link`. Modal sizes: `sm`, `md` (default), `lg`, `xl`. `closeOnBackdrop` defaults `true`.

**`tokens.css`** — CSS custom property definitions (`--ui-bg`, `--ui-surface`, `--ui-border`, `--ui-text`, `--ui-primary`, `--ui-danger`, etc.). Dark theme overrides via `[data-theme="dark"]`.

**`nav-config.js`** — single export `SHOPIFY_NAV_GROUPS` (18 nav group objects). Each item: `{ name, path, icon, requiredPerm?, requiredFlag?, requiredMode?, newTab? }`. `__STOREFRONT__` path resolved to `/store/${tenantSlug}` at render time by `AppLayoutRedesign`.

**`Breadcrumbs.jsx`** — default export. Auto-derived from `useLocation().pathname`. Skipped on `/`, `/dashboard`, `/pos`, `/kiosk`, `/customer-display`, `/retail/home`. When adding a new route, add `"path-segment": "Display Name"` to the `LABELS` map.

**`ErrorBoundary.jsx`** — **named export**: `import { ErrorBoundary } from "../ui/ErrorBoundary"`. Props: `{ level?, onReset?, children }`. `level="page"` → compact card; omitted → full-screen. Reports to Sentry when `SENTRY_DSN` set. Dev mode shows `error.stack`.

**`ImpersonationBanner.jsx`** — fixed amber bar during impersonation. Exit flow uses `window._nativeFetch` (bypasses auth interceptor) to call `/api/admin/impersonate/:sessionId/end` with admin token.

**`AnnouncementBanner.jsx`** — fetches `GET /api/announcements/active` on mount (no auth). Dismissal stored in `sessionStorage["dismissed_announcements"]`.

**`SubscriptionBanner.jsx`** — reads `subscriptionStatus` + `subscriptionDaysLeft` from `useAuth()`. Trial banner only appears when ≤ 7 days remain.

**`SupportWidget.jsx`** — floating `?` button. Submit flow: upload files via `api.upload`, then `api.post("/api/support/tickets", ...)`. Attaches `window.__lastFailedReqId` (set by `AuthProvider` on any failed response).

**`StarRating.jsx`** — named exports `StarDisplay({ rating, size?, className? })` and `StarPicker({ value, onChange, size?, className? })`.

**`PwaInstallPrompt.jsx`** — dismissible PWA install banner. Persistence: `localStorage["pwa_install_dismissed"]`.

**`MultiOutletEnabledBanner.jsx`** — shown once after 1→2 outlet transition. Dismissed via `sessionStorage`.

**`FBRPromptBanner.jsx`** — prompts PK tenants to set up FBR. All data passed as props (no internal fetch). CTA to `/settings/fbr`. Server-side persist via `PUT /api/company-profile/fbr-banner-dismiss`.

---

### `routes/`

All routes are `lazy()`-loaded unless noted.

**`publicRoutes.jsx`** — unauthenticated routes: `/login`, `/setup` (not lazy), `/reset-password`, `/signup`, `/receipt/:invoiceNumber`, `/store/:tenantSlug` (storefront with 6 nested routes), `/portal/:tenantSlug` (M8 portal with 16 nested routes using `PortalAuthProvider`), public booking/menu/pay/reserve pages.

`HomeRedirect` logic: bootstrapping → null; authenticated → `/context-select`; ST mode → check setup status; otherwise → `LandingPagePreview`. Setup check skipped in MT mode.

**`appRoutes.jsx`** — all app routes nested under `RequireAuth > RequireContext > AppLayoutRedesign`. Every route automatically gets auth, context, and app shell. `wrap(Component)` adds Suspense. `perm(permStr, el)` adds `RequirePerm`. Includes 19 report deep-link routes (e.g. `/reports/sales-summary` → `tabId="sales-summary"`). `ReportTabStandaloneRoute` is a named export from `pages/ReportsRoute.jsx` (not default).

**`adminRoutes.jsx`** — all `/admin/*` routes. Auth checked inside `AdminLayout` via `getAdminToken()` — no `RequireAuth` wrapper. Routes: `/admin/login`, `/admin` (dashboard), `/admin/tenants`, `/admin/tenants/:id`, `/admin/support`, `/admin/emails`, `/admin/dead-letters`, `/admin/tax-rates`, `/admin/activity`, `/admin/stuck-payments`.

**`RouteLoading.jsx`** — Suspense fallback component. Centered white card with `"Loading..."`.

---

### `types/`

TypeScript declaration files. `tsconfig` uses `allowJs + noEmit` — reference-only for editor tooling, no runtime enforcement.

**`auth.ts`** — `AuthEmployee` (employee object shape after login), `JwtPayload` (decoded JWT shape — server-side only, not decoded client-side).

**`api.ts`** — `ApiOk<T>`, `ApiError`, `ApiResponse<T>`, and `isApiError(res)` (runtime-callable type guard — narrows `ApiResponse` to error case).

---

## Key Conventions

### Tailwind v4 (linter enforced)
- `(--css-var)` NOT `[var(--css-var)]`
- `shrink-0` NOT `flex-shrink-0`, `grow` NOT `flex-grow`
- `bg-linear-to-br` NOT `bg-gradient-to-br`
- `z-200` NOT `z-[200]`

### API Calls
- Use `api.js` for all authenticated tenant API calls — `api.get("/api/products")`, `api.post("/api/sales", body)`, etc.
- Never use raw `fetch()` in redesign pages. Exceptions: `storefront/` pages, `pages/public/` pages, `hooks/useFeatureFlags.js`, `CurrencyContext`.
- Admin pages use `adminFetch` from `AdminLogin.jsx`. Do not replace with `api.js`.
- Never manually set `x-employee-id` or `Authorization` — the interceptor does it.
- Do NOT add `token` to `useEffect` deps wrapping the interceptor — causes re-registration loop.

### Timestamps (CRITICAL — recurring bug source)
- UTC columns (sales, returns, shifts): `fmtUtcDateTime / fmtUtcDate / fmtUtcTime`
- LOCAL columns (attendance, expenses, GRN, parked_sales): `fmtLocalDateTime / fmtLocalDate / fmtLocalTime`
- Never use `new Date(timestamp)` on a raw DB value
- Exception: `new Date(d + "T00:00:00")` is OK for `YYYY-MM-DD` display labels only
- `receipt.js` slip builder expects `slip.timestamp` as a pre-formatted string — call `fmtDateTime()` first

### Currency
- `const { fmt } = useCurrency()` in components — never hardcode currency symbol
- Pass `currencySymbol` as a param in non-component utilities (e.g. `receipt.js`)

### CSV Export
- Use `downloadCsv(headers, rows, filename)` from `utils/csvExport.js` — not inline Blob code
- New pages must use the shared utility; refactor old pages to it when touching them

### Error Handling
- All `api.get/post/put/del` errors throw with `err.message` = server's `{ error }` string
- Page-level pattern: `catch(err) { toast.error(err.message || "Something went wrong") }`
- Never swallow errors silently
