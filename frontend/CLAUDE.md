# Frontend — Claude Guide

React 19 + Vite 7 + Tailwind CSS v4. Dev server runs on port 5173.

---

## App Composition

`src/main.jsx` boots the provider hierarchy (outermost → innermost):

```
ErrorBoundary → CurrencyProvider → ToastProvider → AuthProvider → PresetProvider → App (BrowserRouter)
```

`src/App.jsx` is not purely composition-only — it also calls `initTheme()` at module load (imported from `utils/theme.js`, runs before the component renders) and calls `useAuth()` to read `isImpersonating`. It spreads three route arrays into a single `<Routes>`, renders `ImpersonationBanner` outside the router, and `SubscriptionBanner` + `PwaInstallPrompt` inside. Catch-all `path="*"` redirects to `/`. Do not add route logic here. Route definitions live in `src/routes/`.

---

## src/ Subdirectories

### `src/api.js` — centralized API layer
Named export `api` with 6 methods: `api.get(path, query?)`, `api.post(path, data)`, `api.put(path, data)`, `api.del(path)`, `api.upload(path, formData)`, `api.raw(path, options?)`.

- All paths must include `/api/` prefix (e.g. `api.get("/api/products")`) — the fetch interceptor matches on `/api/` to inject auth headers.
- `get/post/put/del` throw `Error` with `.message`, `.status`, `.body` on non-ok responses.
- `api.raw` returns the raw `Response` — does NOT throw. Caller must check `res.ok`.
- Does NOT inject auth headers itself — `AuthProvider` patches `window.fetch` globally; all calls through `api.js` pick up headers automatically.
- On 403 with `code: "PLAN_LIMIT_REACHED"`, dispatches `CustomEvent("sanopos:plan-limit-reached")` before throwing.
- Admin pages use `adminFetch` from `pages/admin/AdminLogin.jsx` — not `api.js`. Do not replace.
- Portal pages use `portalApi` from `api/portalApi` — not `api.js`. Do not replace.
- `CurrencyContext`, `useFeatureFlags`, admin pages (use `adminFetch`), `NotificationBell`, `ContextSwitcher`, `AuthProvider` (fetch interceptor itself), portal appointment public booking flows, `utils/receipt.js` (`printToHardware` posts directly), and at least one restaurant admin redesign file use raw `fetch()` or non-`api.js` paths intentionally. Do not replace these with `api.js`.

### `src/config.js` — sole env reader
Never read `import.meta.env` directly anywhere else. Exports: `API_BASE` (no trailing slash, no `/api` suffix), `IS_MULTI_TENANT`, `SENTRY_DSN`, `TURNSTILE_SITE_KEY`, `ENV_MODE`, `IS_PROD`, `IS_DEV`.

### `src/auth/` — see `src/CLAUDE.md`
Key files: `AuthProvider.jsx` (exports `AuthProvider` + `useAuth()`), `authStore.js` (tenant session helpers), `adminAuthStore.js` (super-admin session helpers), `customerPortalStore.js` (slug-scoped portal session).

`useAuth()` key fields: `employee`, `hasPerm(perm)`, `authHeaders()`, `isImpersonating`, `subscriptionStatus`, `company` (includes `tax_mode`).

**Interceptor gotcha**: do NOT add `token` to any `useEffect` dep array wrapping the interceptor — causes re-registration loop. Token is read live via `readToken()`.

### `src/contexts/` — see `src/CLAUDE.md`
- `CurrencyContext.jsx` → `useCurrency()` → `{ symbol, code, fmt, refresh, denominations }`. `fmt` = `symbol + " " + toLocaleString(2dp)`.
- `ToastContext.jsx` → `useToast()` → `{ toast, success, error, warning }`. Max 3 visible, 4s auto-dismiss. Throws if used outside provider.
- `PresetContext.jsx` → `usePreset()` → `{ labels, hasMode, label, enabled_modes, unit_vocabulary, pos_layout_mode, presetLoaded }`.

### `src/ui/` — see `src/CLAUDE.md`
Design system primitives, banners, and shared components. Most components use CSS custom property classes for dark mode (exception: POS uses hardcoded colors). However, several `ui/` files still use fixed Tailwind colors: `AnnouncementBanner.jsx`, `PwaInstallPrompt.jsx`, `MultiOutletEnabledBanner.jsx`, `SubscriptionBanner.jsx`, `StarRating.jsx`, and parts of `SupportWidget.jsx`. In `primitives.jsx`, `Badge`, `BulkActionBar`, and the modal backdrop also use fixed colors.

Key primitives (`primitives.jsx`): `PageShell({ title, subtitle?, right? })`, `SectionCard({ children, className? })`, `Button`, `Input`, `Select`, `Badge`, `Modal`, `ConfirmDialog`, `TabBar`. `PageShell` has no `actions` prop; `SectionCard` has no `title` prop.

`ErrorBoundary` is a **named export**: `import { ErrorBoundary } from "../ui/ErrorBoundary"`.

### `src/utils/` — see `src/CLAUDE.md`
- `dates.js` — UTC formatters (`fmtUtcDateTime/Date/Time`) for sales/returns/shifts; LOCAL formatters (`fmtLocalDateTime/Date/Time`) for attendance/expenses/GRN/parked_sales. Never use raw `new Date(timestamp)` on DB values.
- `csvExport.js` — `downloadCsv(headers, rows, filename)`. Use this for all new pages; do not write inline Blob code.
- `receipt.js` — `buildReceiptSections`, `buildReceiptHtml`, `printToHardware`. `slip.timestamp` must be a pre-formatted string — call `fmtDateTime()` before passing.
- `offlineQueue.js` — IndexedDB-backed POS offline queue.
- `theme.js` — dark mode: `getTheme()`, `setTheme()`, `toggleTheme()`, `initTheme()`. Stored in `localStorage["sanopos_theme"]`, applied via `document.documentElement.dataset.theme`.

### `src/routes/` — see `src/CLAUDE.md`
- `publicRoutes.jsx` — unauthenticated routes: `/login`, `/signup`, `/reset-password`, `/receipt/:invoiceNumber`, `/store/:tenantSlug`, `/portal/:tenantSlug`, public booking/menu pages.
- `appRoutes.jsx` — all app routes under `RequireAuth > RequireContext > AppLayoutRedesign`. Uses `wrap(Component)` for Suspense and `perm(permStr, el)` for permission gating.
- `adminRoutes.jsx` — `/admin/*` routes. Auth checked inside `AdminLayout`, not via `RequireAuth`.

### `src/types/` — see `src/CLAUDE.md`
TypeScript declaration files — reference-only for editor tooling, no runtime enforcement. `auth.ts` (employee shape), `api.ts` (response shape + `isApiError` runtime guard).

### `src/pages/` — see `pages/CLAUDE.md` and `pages/redesign/CLAUDE.md`
Most active tenant UI lives in `pages/redesign/` as `*Redesign.jsx` files. Route wrappers (`pages/*Route.jsx`) are 5-line lazy-load pass-throughs — never edit them. Other active subdirectories: `admin/`, `portal/`, `dashboard/`, `reports/`, `shopify/`, `storefront/`, `public/`.

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
- Additional intentional raw-`fetch()` / non-`api.js` callers: `CurrencyContext`, `useFeatureFlags`, `NotificationBell`, `ContextSwitcher`, `AuthProvider` (the interceptor itself), portal appointment public booking flows, `utils/receipt.js` (`printToHardware`), and at least one restaurant admin redesign file. Do not replace these.
- Never manually set `x-employee-id` or `Authorization` — the interceptor does it.

### Timestamps (recurring bug source)
- UTC columns (sales, returns, shifts, adjustments): `fmtUtcDateTime / fmtUtcDate / fmtUtcTime`
- LOCAL columns (attendance, expenses, GRN, parked_sales): `fmtLocalDateTime / fmtLocalDate / fmtLocalTime`
- Both from `utils/dates.js`. Never pass raw DB values to `new Date()`.

### Currency
`const { fmt } = useCurrency()` in components — never hardcode currency symbols.

### Dark Mode
Automatic via CSS variables on `[data-theme="dark"]`. No special handling needed in page components. POS is the exception — uses hardcoded colors.

### Toast Notifications
`const { success, error, warning } = useToast()` from `contexts/ToastContext.jsx`. Page-level error pattern: `catch(err) { toast.error(err.message || "Something went wrong") }`.

### Feature Flags
```jsx
const { flags, loading } = useFeatureFlags(authHeaders);
if (loading) return null;
if (!flags.some_flag) return <Navigate to="/" replace />;
```
No `RequireFeature` wrapper exists — checks are always inline. Do NOT pass an inline `{}` as `authHeaders` each render — causes an infinite loop. Hoist or memoize first.

### Permissions
`hasPerm("perm_name")` from `useAuth()`. Returns true if `all_access` or the specific permission.

### Route Wrappers
`pages/*Route.jsx` files are 5-line thin wrappers that lazy-load the corresponding `*Redesign.jsx`. Never edit these — all logic belongs in the `*Redesign.jsx`.

### Multi-Tenant
`IS_MULTI_TENANT` flag from `config.js`. In MT mode, login requires `tenantSlug`. Setup wizard check skipped for MT tenants (they go straight to dashboard).

### CSV Export
Use `downloadCsv(headers, rows, filename)` from `utils/csvExport.js`. Do not write inline Blob code in new pages.

---

## Tests

### Unit Tests
Location: `frontend/tests/unit/` — Vitest with `@vitest/coverage-v8`.
Run: `npx vitest run tests/unit/`
Tests cover: `auth_guards`, `contexts` (includes `cartMath.js` functions), `layout`, `primitives`, `dental_chart`, POS/offline/omni/loyalty tests including `pos-context-open-check.test.jsx`.

### E2E Tests (Playwright)
Location: `frontend/tests/*.spec.js` — targets `https://sanopos.com` (tenant `packagesmall`).
Config: `playwright.config.js` (single config, production target).
Run: `npx playwright test tests/auth.spec.js`
Global setup: `global-setup.js` logs in once, saves `auth.json` + `token.json` (gitignored).
Helpers: `helpers/auth.js` (credentials), `helpers/api.js` (REST), `helpers/nav.js` (navigation).

Key gotchas:
- Login form (`helpers/auth.js`): store-code placeholder matches `aceshardware`, employee placeholder `/employee name/i`, password placeholder `/password/i`, submit button `"Sign In"`.
- Clock-in: use `POST /api/attendance/pin-checkin?tenant=${slug}` with `{ pin_code, outlet_id }` — NOT `/clock-in`.
- Onboarding specs create real test tenants — delete from `/admin` after each run.

### Smoke Tests
Location: `frontend/tests/smoke/` — competitive feature coverage specs with shared helpers (`cleanup`, `featureFlags`, `mockPaymentGateway`, `smokeRunId`).
