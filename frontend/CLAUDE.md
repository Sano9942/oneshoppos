# Frontend — Claude Guide

React 19 + Vite 7 + Tailwind CSS v4. Dev server runs on port 5173.

---

## App Composition

`src/main.jsx` boots the provider hierarchy (outermost → innermost), verified directly from source:

```
ErrorBoundary → CurrencyProvider → ToastProvider → AuthProvider → PresetProvider → App
```

`main.jsx` also initializes Sentry from `SENTRY_DSN` (no-op if unset; filters Cloudflare Turnstile Trusted-Types noise), installs stale-chunk recovery (`vite:preloadError` + `unhandledrejection` → `utils/chunkReload.js`), and registers the service worker (`/sw.js`) only when `IS_PROD`.

`src/App.jsx`, read in full — it is not pure composition:

```jsx
function App() {
  const { isImpersonating } = useAuth();
  return (
    <>
      {isImpersonating && <ImpersonationBanner />}
      <Router>
        <SubscriptionBanner />
        <PwaInstallPrompt />
        <Routes>
          {publicRoutes}{appRoutes}{adminRoutes}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </>
  );
}
```

It calls `useAuth()` for `isImpersonating` and conditionally renders `ImpersonationBanner`. `SubscriptionBanner` and `PwaInstallPrompt` render globally, inside the router but outside `<Routes>` (every page). It spreads three route arrays (`publicRoutes`, `appRoutes`, `adminRoutes`) into one `<Routes>`, and the catch-all `path="*"` redirects to `/`. It imports `{ ErrorBoundary }` but does not render it — the single app-wide `ErrorBoundary` boundary lives in `main.jsx`, wrapping the whole tree including `App`. Do not add route logic here — route definitions live in `src/routes/`.

**There is no dark mode.** `utils/theme.js` does not exist on disk, and `App.jsx` does not call `initTheme()`/`toggleTheme()`/anything theme-related. The app is light-only (Square design system). Any surviving mention of `theme.js`/`initTheme`/`sanopos_theme` elsewhere is stale documentation from before the Square reskin — don't reintroduce dark-mode logic without an explicit request.

---

## src/ Subdirectories

See `src/CLAUDE.md` for the full synthesis of these — summary below.

### `src/api.js` — centralized API layer
Named export `api` with 6 methods: `api.get(path, query?)`, `api.post(path, data)`, `api.put(path, data)`, `api.del(path)`, `api.upload(path, formData)`, `api.raw(path, options?)`.

- All paths must include `/api/` prefix (e.g. `api.get("/api/products")`) — the fetch interceptor matches on `/api/` to inject auth headers.
- `get/post/put/del` throw `Error` with `.message`, `.status`, `.body` on non-ok responses.
- `api.raw` returns the raw `Response` — does NOT throw. Caller must check `res.ok`.
- Does NOT inject auth headers itself — `AuthProvider` patches `window.fetch` globally; all calls through `api.js` pick up headers automatically.
- On 403 with `code: "PLAN_LIMIT_REACHED"`, dispatches `CustomEvent("sanopos:plan-limit-reached")` before throwing.
- Admin pages use `adminFetch` from `pages/admin/AdminLogin.jsx` — not `api.js`. Do not replace.
- Portal pages use `portalApi` from `api/portalApi.js` — not `api.js`. Do not replace.
- `CurrencyContext`, `useFeatureFlags`, admin pages (use `adminFetch`), `NotificationBell`, `ContextSwitcher`, `AuthProvider` (fetch interceptor itself), portal appointment public booking flows, `utils/receipt.js` (`printToHardware` posts directly), and at least one restaurant admin redesign file use raw `fetch()` or non-`api.js` paths intentionally. Do not replace these with `api.js`.

### `src/config.js` — sole env reader
Never read `import.meta.env` directly anywhere else. Exports: `API_BASE` (no trailing slash, no `/api` suffix), `IS_MULTI_TENANT`, `SENTRY_DSN`, `TURNSTILE_SITE_KEY`, `ENV_MODE`, `IS_PROD`, `IS_DEV`.

### `src/auth/` — see `src/auth/CLAUDE.md`
Four independent auth scopes with four independent localStorage stores — never mix them: tenant (`AuthProvider.jsx` exports `AuthProvider` + `useAuth()`, `authStore.js`), super-admin (`adminAuthStore.js`), customer portal (`customerPortalStore.js`, slug-scoped), manufacturer portal (`manufacturerPortalStore.js`, slug-scoped).

`useAuth()` key fields: `employee`, `hasPerm(perm)`, `authHeaders()`, `isImpersonating`, `subscriptionStatus`, `company` (includes `tax_mode`).

**Interceptor gotcha**: do NOT add `token` to any `useEffect` dep array wrapping the interceptor — causes re-registration loop. Token is read live via `readToken()`.

### `src/contexts/` — see `src/contexts/CLAUDE.md`
Provider nesting: `CurrencyProvider → ToastProvider → AuthProvider → PresetProvider`.
- `CurrencyContext.jsx` → `useCurrency()` → `{ symbol, code, fmt, refresh, denominations }`. `fmt` = `symbol + " " + toLocaleString(2dp)`.
- `ToastContext.jsx` → `useToast()` → `{ toast, success, error, warning }`. Max 3 visible, 4s auto-dismiss. Throws if used outside provider.
- `PresetContext.jsx` → `usePreset()` → `{ labels, hasMode, label, enabled_modes, unit_vocabulary, pos_layout_mode, presetLoaded }`.

### `src/ui/` — see `src/ui/CLAUDE.md`
Design system primitives, banners, and shared components — the **Square design system** (light-only; dark mode was removed in the reskin, no `theme.js`, no `[data-theme]`). Components style via `--ui-*` tokens (`ui/tokens.css`): black primary, hairline borders, flat/no shadow, pill buttons, Inter. `primitives.jsx` is fully token-based (incl. `Badge`/`BulkActionBar`). Still-hardcoded exceptions: `AnnouncementBanner.jsx`, `PwaInstallPrompt.jsx`, `MultiOutletEnabledBanner.jsx`, `SubscriptionBanner.jsx`, `StarRating.jsx`, parts of `SupportWidget.jsx`, and the `Modal`/`Drawer` `bg-black/45` scrim. POS uses hardcoded colors by exception.

Key primitives (`primitives.jsx`): `PageShell({ title, subtitle?, right? })`, `SectionCard({ children, className? })`, `Button`, `Input`, `Select`, `Badge`, `Modal`, `Drawer`, `ConfirmDialog`, `TabBar`, `Toggle`, `Tooltip`, `FilterPill`, `EmptyState`. `PageShell` has no `actions` prop; `SectionCard` has no `title` prop and is flat (no shadow). `Button` primary tone is black; use `tone` not `variant`.

`ErrorBoundary` is a **named export**: `import { ErrorBoundary } from "../ui/ErrorBoundary"`.

### `src/utils/` — see `src/utils/CLAUDE.md`
- `dates.js` — UTC formatters (`fmtUtcDateTime/Date/Time`) for sales/returns/shifts; LOCAL formatters (`fmtLocalDateTime/Date/Time`) for attendance/expenses/GRN/parked_sales. Never use raw `new Date(timestamp)` on DB values.
- `csvExport.js` — `downloadCsv(headers, rows, filename)`. Use this for all new pages; do not write inline Blob code.
- `receipt.js` — `buildReceiptSections`, `buildReceiptHtml`, `printToHardware`. `slip.timestamp` must be a pre-formatted string — call `fmtUtcDateTime()`/`fmtLocalDateTime()` before passing.
- `offlineQueue.js` — IndexedDB-backed POS offline queue (sale/return/check_in/field_order types).
- No `theme.js` — it does not exist. Dark mode was removed in the Square reskin; the app is light-only.

### `src/routes/` — see `src/routes/CLAUDE.md`
- `publicRoutes.jsx` — unauthenticated routes: `/login`, `/signup`, `/reset-password`, `/receipt/:invoiceNumber`, `/store/:tenantSlug`, `/portal/:tenantSlug`, `/manufacturer-portal/:tenantSlug`, public booking/menu pages. Also hosts `/pos`, `/kiosk`, `/context-select` (full-screen, self-wrapped in `<RequireAuth>`).
- `appRoutes.jsx` — all app routes under `RequireAuth > RequireContext > AppLayoutRedesign`. Uses `wrap(Component)` for Suspense and `perm(permStr, el)` for permission gating.
- `adminRoutes.jsx` — `/admin/*` routes. Auth checked inside `AdminLayout`, not via `RequireAuth`.

### `src/types/` — see `src/types/CLAUDE.md`
TypeScript declaration files — reference-only for editor tooling, no runtime enforcement. `auth.ts` (employee shape), `api.ts` (response shape + `isApiError` runtime guard, not actually matched by `api.js`'s real error shape).

### `src/pages/` — see `pages/CLAUDE.md` and `pages/redesign/CLAUDE.md`
Most active tenant UI lives in `pages/redesign/` as `*Redesign.jsx` files. Route wrappers (`pages/*Route.jsx`) are thin lazy-load pass-throughs — never edit them (exceptions: `POSRoute.jsx`, `ReportsRoute.jsx`). Other active subdirectories: `admin/`, `portal/`, `dashboard/`, `reports/`, `shopify/`, `storefront/`, `public/`.

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

### Design System (Square) — light-only, no dark mode
The app runs the **Square design system**. **Light-only — there is no dark mode** (no `[data-theme]`, `theme.js` does not exist). Build every new/edited surface from `ui/primitives.jsx` (`PageShell`, `SectionCard`, `Button`, `Input`, `Modal`, `Drawer`, `TabBar`, `Badge`, …) and `--ui-*` tokens from `ui/tokens.css` — black primary (`#101010`), hairline borders, flat (no shadow), pill buttons, Inter. **Never** hardcode Tailwind color classes (`bg-slate-800`, `text-indigo-600`) or arbitrary hex. When unsure, match an existing `*Redesign.jsx` page. POS is the one long-standing hardcoded-color exception.

### Toast Notifications
`const { success, error, warning } = useToast()` from `contexts/ToastContext.jsx`. Page-level error pattern: `catch(err) { toast.error(err.message || "Something went wrong") }`.

### Feature Flags
```jsx
const { flags, loading } = useFeatureFlags(authHeaders);
if (loading) return null;
if (!flags.some_flag) return <Navigate to="/" replace />;
```
No `RequireFeature` wrapper exists — checks are always inline. Do NOT pass an inline `{}` as `authHeaders` each render — causes an infinite loop.

### Permissions
`hasPerm("perm_name")` from `useAuth()`. Returns true if `all_access` or the specific permission.

### Route Wrappers
`pages/*Route.jsx` files are thin wrappers that lazy-load the corresponding `*Redesign.jsx`. Never edit these (except `POSRoute.jsx`/`ReportsRoute.jsx`) — all logic belongs in the `*Redesign.jsx`.

### Multi-Tenant
`IS_MULTI_TENANT` flag from `config.js`. In MT mode, login requires `tenantSlug`. Setup wizard check skipped for MT tenants (they go straight to dashboard).

### CSV Export
Use `downloadCsv(headers, rows, filename)` from `utils/csvExport.js`. Do not write inline Blob code in new pages.

---

## POS Architecture (quick reference)

Full detail lives in `src/pages/redesign/pos/CLAUDE.md`. Headline facts: `POSContext.jsx` composes 8 domain hooks (`useShiftGate`, `useCart`, `useReceipt`, `useCustomerDisplay`, `useLoyaltyWallet`, `useFolioCharging`, `useOfflineQueue`, `useCheckout`) behind `usePOS()`. `completeSale` uses `api.raw` (never `api.post`) to inspect status codes mid-checkout — session expiry, insufficient stock, wholesale credit-limit exceeded. Offline-first: IndexedDB queue, idempotency key via `crypto.randomUUID()`. Most of POS has migrated to `--ui-*` design-system tokens; check `pos/CLAUDE.md` for the current, precise list of remaining hardcoded-color exceptions.

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
- Known reliability gap: the shared test tenant (`packagesmall`) has been deleted from production; `global-setup.js` only warns on login failure instead of failing the run, so a green E2E run does not guarantee no regressions.

### Smoke Tests
Location: `frontend/tests/smoke/` — competitive feature coverage specs with shared helpers (`cleanup`, `featureFlags`, `mockPaymentGateway`, `smokeRunId`).
