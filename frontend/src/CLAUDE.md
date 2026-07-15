# frontend/src — Claude Guide

React 19 + Vite 7 + Tailwind CSS v4 frontend source root. This doc orients the top level of `src/` — the bootstrap files and the two shared, no-directory modules (`api.js`, `config.js`, `hooks/`). Each subdirectory has its own `CLAUDE.md`; this file points to them rather than repeating their content.

---

## Core Files

### `main.jsx`

App bootstrap. Provider hierarchy (outermost → innermost), read directly from source:

```
ErrorBoundary → CurrencyProvider → ToastProvider → AuthProvider → PresetProvider → App
```

Also does three other things at boot: initializes Sentry from `SENTRY_DSN` (no-op if unset; filters Cloudflare Turnstile Trusted-Types console noise via `denyUrls`/`ignoreErrors` since the CAPTCHA iframe's internal scripts trip browser Trusted Types checks that aren't actionable bugs), installs stale-chunk recovery (listens for `vite:preloadError` and `unhandledrejection`, both routed through `utils/chunkReload.js` to reload the page once per 30s window when a deployed client is holding old chunk hashes), and registers the service worker (`/sw.js`) only when `IS_PROD`.

`App.jsx` is composition-plus — not pure route spreading. It calls `useAuth()` for `isImpersonating` (conditionally renders `ImpersonationBanner`), renders `SubscriptionBanner` and `PwaInstallPrompt` globally (inside the router, outside `<Routes>` — every authenticated and public page gets them), and spreads three route arrays (`publicRoutes`, `appRoutes`, `adminRoutes`) into one `<Routes>` with a catch-all `path="*"` redirect to `/`. It imports `{ ErrorBoundary }` but does not render it — the single app-wide boundary lives in `main.jsx`, wrapping everything including `App`. Route logic itself belongs in `routes/`, not here — see `pages/CLAUDE.md` and `routes/CLAUDE.md`.

**No dark mode.** `utils/theme.js` does not exist on disk; `App.jsx` calls no theme functions. The app is light-only (Square design system, `--ui-*` tokens). Any stray mention of `theme.js`/`initTheme`/`sanopos_theme` elsewhere is stale — don't reintroduce it without an explicit request.

### `api.js`

Centralized API client — the standard way authenticated tenant pages talk to the backend. Named export `api`:

| Method | Signature | Notes |
|--------|-----------|-------|
| `api.get` | `(path, query?)` | Appends `query` via `URLSearchParams` |
| `api.post` | `(path, data)` | JSON body |
| `api.put` | `(path, data)` | JSON body |
| `api.del` | `(path)` | No body |
| `api.upload` | `(path, formData)` | Multipart — no `Content-Type` header set, so the browser fills in the boundary |
| `api.raw` | `(path, options?)` | Returns the raw `Response`. Does **not** throw — caller must check `res.ok` itself. Used by POS checkout to branch on status codes (session expiry, insufficient stock, credit-limit exceeded) |

`get`/`post`/`put`/`del` all funnel through an internal `json()` helper that throws a plain `Error` on non-ok responses, with `.message` (`body.error` or `HTTP <status>`), `.status`, and `.body` attached. On a `403` with `body.code === "PLAN_LIMIT_REACHED"`, it first dispatches `window.dispatchEvent(new CustomEvent(PLAN_LIMIT_EVENT, { detail: { error, limit, current } }))` (`PLAN_LIMIT_EVENT = "sanopos:plan-limit-reached"`, exported) — a global listener mounted inside `AppLayoutRedesign` opens the upgrade modal — then still throws, so a per-call `catch` can show inline feedback in addition to the modal.

**`api.js` injects no auth headers itself.** `AuthProvider` (`auth/CLAUDE.md`) patches `window.fetch` globally, matching any URL containing `/api/`; every call through `api.js` (which always calls the global `fetch`) picks up `x-employee-id`/`Authorization`/`x-outlet-id`/etc. automatically as a side effect of that patch. This is why every path passed to `api.js` must include the `/api/` prefix — the interceptor's URL match depends on it.

**Callers that intentionally bypass `api.js`:** admin pages use `adminFetch` (`pages/admin/AdminLogin.jsx`); portal pages use `portalApi` (`api/portalApi.js`); `CurrencyContext` and `useFeatureFlags` (below) use raw `fetch()` because they run before or outside the tenant fetch interceptor; `NotificationBell`, `ContextSwitcher`, `AuthProvider` itself (the interceptor can't intercept itself), portal public booking-config probes, `utils/receipt.js`'s `printToHardware` (posts to an absolute cross-origin `API_BASE` URL), and at least one restaurant admin redesign file also use raw fetch by design. Don't "fix" these to use `api.js`.

### `config.js`

The **sole reader of `import.meta.env`** in the codebase — never read `import.meta.env` directly anywhere else.

| Export | Source | Notes |
|--------|--------|-------|
| `API_BASE` | `VITE_API_BASE` or `http://localhost:5000` | No trailing slash, no `/api` suffix |
| `IS_MULTI_TENANT` | `VITE_MULTI_TENANT === "1"` | Gates the Store Code login field and the JWT auth flow |
| `SENTRY_DSN` | `VITE_SENTRY_DSN` or `""` | Empty string disables Sentry entirely |
| `TURNSTILE_SITE_KEY` | `VITE_TURNSTILE_SITE_KEY` or `""` | Empty string disables the CAPTCHA widget on `SignupPage`; backend signup independently gates on `TURNSTILE_SECRET_KEY` being set — the two are configured together |
| `ENV_MODE` | `import.meta.env.MODE` | Vite mode string |
| `IS_PROD` | `import.meta.env.PROD` | Boolean |
| `IS_DEV` | `import.meta.env.DEV` | Boolean |

There is no `API` export here — `AuthProvider` locally aliases `API_BASE as API` inside its own module; that alias is not part of `config.js`'s public surface.

### `hooks/`

Two standalone hooks with no dedicated `CLAUDE.md` (small enough to cover here).

**`useFeatureFlags.js`** — default export `useFeatureFlags(authHeaders)` → `{ flags, loading, refresh }`. Fails closed: `DEFAULT_FLAGS` is an explicit map of every known flag key set to `false`, so an unreachable backend hides privileged features rather than exposing them. Uses raw `fetch()` (not `api.js`) against `${API_BASE}/api/feature-flags`, because it commonly runs before the auth interceptor is wired (e.g. login screen, first paint).

- Warm-cache: every successful fetch writes the resolved flag map to `localStorage["sanopos_feature_flags_cache_v1"]`; the initial state on mount reads that cache first (merged over `DEFAULT_FLAGS`) so the sidebar paints with last-known truth instead of flashing everything hidden while the network call is in flight. A fetch failure keeps whatever was already in state rather than resetting to all-false.
- Each flag row from the API may carry both `enabled` (company-level truth) and `effective` (outlet-aware truth for the caller's resolved outlet); the hook prefers `effective` when present, falling back to `enabled` for older backend responses without the field.
- Cross-component refresh: `refreshFeatureFlags()` (named export) dispatches the `sanopos:flags-refresh` window event (`FLAGS_REFRESH_EVENT`, exported). Every mounted `useFeatureFlags` instance listens for it and re-fetches, so a business-module toggle can update every open nav/gate in place without a re-login.
- **Gotcha**: never pass an inline `{}` (or any new object literal) as `authHeaders` on every render — the effect depends on the `authHeaders` reference, so a fresh object each render triggers an infinite fetch loop. Pass a stable function or memoized object.

**`useReportFilters.js`** — default export `useReportFilters(initial?)` → `{ filters, setFilters, query }`. `DEFAULT_REPORT_FILTERS` (also exported) is `{ date_from, date_to, outlet_id, employee_id, category_id }` all empty strings. `query` is a memoized `URLSearchParams`-encoded string built from only the non-empty, trimmed filter values — pass it straight into a report API call's query string. Shared across report-tab components so they don't each reinvent filter-state plumbing.

---

## Subdirectory Modules

Each of these has its own `CLAUDE.md` with full detail — summarized here just enough to know when to open it.

- **`auth/`** (`auth/CLAUDE.md`) — four independent auth scopes, four independent localStorage stores, never mixed: tenant (`AuthProvider.jsx` + `authStore.js`), super-admin (`adminAuthStore.js`), customer portal (`customerPortalStore.js`, slug-scoped), manufacturer portal (`manufacturerPortalStore.js`, slug-scoped). Only the tenant scope patches `window.fetch`.
- **`contexts/`** (`contexts/CLAUDE.md`) — `CurrencyContext`, `ToastContext`, `PresetContext`. Provider nesting `CurrencyProvider → ToastProvider → AuthProvider → PresetProvider`; `PresetContext` is the only one of the three that depends on `useAuth()`.
- **`utils/`** (`utils/CLAUDE.md`) — pure helpers: `dates.js` (UTC vs LOCAL timestamp formatters — a recurring bug source if the wrong one is used), `csvExport.js`, `offlineQueue.js` (IndexedDB POS offline queue), `receipt.js` (receipt rendering, single source of truth), `paperSizes.js`, `publicReceipt.js`, `categoryTree.js`, `chunkReload.js`, `errorLog.js`, `imageCompress.js`, `embeddedBarcode.js`, `scale.js`.
- **`ui/`** (`ui/CLAUDE.md`) — the Square design system: `primitives.jsx` (`PageShell`, `SectionCard`, `Button`, `Input`, `Select`, `Badge`, `Modal`, `Drawer`, `ConfirmDialog`, `TabBar`, `Toggle`, `Tooltip`, `FilterPill`, `EmptyState`), `tokens.css` (`--ui-*` variables), plus shared banners (`AnnouncementBanner`, `SubscriptionBanner`, `ImpersonationBanner`, `FBRPromptBanner`, `MultiOutletEnabledBanner`, `PwaInstallPrompt`), `ErrorBoundary.jsx` (named export, separate token namespace), `SupportWidget.jsx`, `StarRating.jsx`, `Breadcrumbs.jsx`, `nav-config.js`.
- **`routes/`** (`routes/CLAUDE.md`) — `publicRoutes.jsx` / `appRoutes.jsx` / `adminRoutes.jsx`, split by auth/shell requirement, all spread into `App.jsx`'s single `<Routes>`. `RouteLoading.jsx` is the shared Suspense fallback.
- **`types/`** (`types/CLAUDE.md`) — TypeScript declaration files (`allowJs + noEmit`, editor hints only, not imported anywhere in `frontend/src` today — treat as aspirational reference shapes, verify against real source before trusting).
- **`pages/`** (`pages/CLAUDE.md`) — most active tenant UI; see that doc and `pages/redesign/CLAUDE.md` for the bulk of the app's screens.

---

## Cross-Cutting Notes

- `config.js` has zero dependencies on anything else in `src/` — it's the leaf that everything else (including `auth/`, `contexts/`, `utils/`) reads from.
- `api.js` has zero dependencies on `auth/` — the auth/tenant header injection happens entirely via the `window.fetch` patch in `AuthProvider`, not via anything `api.js` does itself. This is why `api.js` can be imported from public pages too, though most public pages use raw `fetch()` instead since they don't need the interceptor's tenant-header behavior.
- `main.jsx` is the only file that imports all four top-level providers directly; every other file gets them via `useAuth()`/`useCurrency()`/`useToast()`/`usePreset()`.
