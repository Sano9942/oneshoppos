# Frontend — Claude Guide

React 19 + Vite 7 + Tailwind CSS v4. Dev server runs on port 5173. This is the top-level orchestrator doc — it tells you how the app is wired together and where to go for detail; it deliberately doesn't restate what's already covered per-directory.

---

## App Composition

`src/main.jsx` boots the provider hierarchy (outermost → innermost):

```
ErrorBoundary → CurrencyProvider → ToastProvider → AuthProvider → PresetProvider → App
```

It also initializes Sentry from `SENTRY_DSN` (no-op if unset; filters Cloudflare Turnstile Trusted-Types console noise, since the CAPTCHA iframe's internal scripts trip a browser check that isn't an actionable bug), installs stale-chunk recovery (`vite:preloadError` + `unhandledrejection` → `utils/chunkReload.js`, reloads once per 30s window so a post-deploy client holding old chunk hashes recovers instead of silently breaking), and registers the service worker (`/sw.js`) only when `IS_PROD`.

`src/App.jsx` (read in full — it is composition-plus, not pure):

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

It calls `useAuth()` for `isImpersonating` and conditionally renders `ImpersonationBanner`. `SubscriptionBanner` and `PwaInstallPrompt` render globally, inside the router but outside `<Routes>` (every page, public or authenticated, gets them). It spreads three route arrays (`publicRoutes`, `appRoutes`, `adminRoutes` — from `src/routes/`) into one `<Routes>`, with a catch-all `path="*"` redirecting to `/`. It imports `{ ErrorBoundary }` but does not render it — the single app-wide boundary lives in `main.jsx`, wrapping the whole tree including `App`. **Route logic belongs in `src/routes/*.jsx`, never in `App.jsx`** — see `src/routes/CLAUDE.md`.

**There is no dark mode.** `utils/theme.js` does not exist, and nothing in `App.jsx`/`main.jsx` calls a theme function. The app is light-only (Square design system). Any surviving reference to `theme.js`/`initTheme`/`sanopos_theme` elsewhere is stale — don't reintroduce dark-mode logic without an explicit request.

---

## Design System — Square, Light-Only

The whole app runs one design system: near-monochrome, black primary actions, hairline borders, flat (no shadow), pill buttons, Inter typeface. Tokens live in `ui/tokens.css` as `--ui-*` custom properties (`--ui-text`, `--ui-surface`, `--ui-border`, `--ui-primary`, `--ui-danger`, `--ui-radius-*`, etc.) — build every new or edited surface from `ui/primitives.jsx` (`PageShell`, `SectionCard`, `Button`, `Input`, `Select`, `Modal`, `Drawer`, `TabBar`, `Badge`, `Toggle`, `Tooltip`, `FilterPill`, `EmptyState`, …) plus those tokens. Never hardcode a Tailwind color class (`bg-slate-800`, `text-indigo-600`) or an arbitrary hex value in new work — when unsure, match an existing `*Redesign.jsx` page.

A handful of shared components in `ui/` still carry hardcoded colors by exception (banners, star ratings, the install prompt) — see `ui/CLAUDE.md` for the current precise list; don't treat those as templates. POS (`pages/redesign/pos/`) is the other long-standing hardcoded-color area, though it has migrated most of its surface to tokens — check `pages/redesign/pos/CLAUDE.md` for the current state before assuming either way.

There is no `RequireFeature`/theme-toggle wrapper component and no `[data-theme]` attribute anywhere in the codebase.

---

## Key Conventions

### Tailwind v4
CSS-first config — no `tailwind.config.js`. Rules:
- `(--css-var)` NOT `[var(--css-var)]`
- `shrink-0` NOT `flex-shrink-0`, `grow` NOT `flex-grow`
- `bg-linear-to-br` NOT `bg-gradient-to-br`
- `z-200` NOT `z-[200]`

### API Calls
- Always use `api.js` (`api.get/post/put/del/upload/raw`) for authenticated tenant pages. Never raw `fetch()` in `pages/redesign/`.
- Admin pages use `adminFetch` (`pages/admin/AdminLogin.jsx`); portal pages use `portalApi` (`api/portalApi.js`); public pages (`pages/public/`, `pages/marketing/`, `pages/storefront/`) use raw `fetch()` intentionally. Don't replace any of these with `api.js` — each targets a different auth scope or has no auth scope at all.
- Never manually set `x-employee-id` or `Authorization` on a tenant request — `AuthProvider`'s `window.fetch` patch does it for every call matching `/api/`.

### Timestamps (recurring bug source)
- UTC columns (sales, returns, shifts, adjustments): `fmtUtcDateTime` / `fmtUtcDate` / `fmtUtcTime`
- LOCAL columns (attendance, expenses, GRN, parked_sales): `fmtLocalDateTime` / `fmtLocalDate` / `fmtLocalTime`
- Both from `utils/dates.js`. Never pass a raw DB value to `new Date()` — pick the parser by the column, not by guessing.

### Currency
`const { fmt } = useCurrency()` from `contexts/CurrencyContext.jsx` — never hardcode a currency symbol.

### Toast Notifications
`const { success, error, warning } = useToast()` from `contexts/ToastContext.jsx`. Standard page pattern: `catch (err) { error(err.message || "Something went wrong") }`.

### Feature Flags
```jsx
const { flags, loading } = useFeatureFlags(authHeaders);
if (loading) return null;
if (!flags.some_flag) return <Navigate to="/" replace />;
```
No `RequireFeature` wrapper exists — checks are always inline. Do NOT pass an inline `{}` as `authHeaders` each render — it's a fresh reference every time and causes an infinite fetch loop. `refreshFeatureFlags()` (named export of the hook) lets one part of the app (e.g. a business-module toggle) push every other mounted instance to refetch in place.

### Permissions
`hasPerm("perm_name")` from `useAuth()` — true if `all_access` or the specific permission is present. The permission set is outlet-context-dependent: an employee can hold a different effective role at a different outlet. `AuthProvider`'s own boot path only loads the employee's *base* role; the outlet-*effective* set arrives via `GET /api/context/bootstrap` and is overlaid onto the session by `PresetContext` (`applyEffectiveSession`, exposed on `useAuth()` but called by `PresetContext`, not by pages). There is no permission cache anywhere in the chain — this overlay happens on boot, on outlet switch, and after a role-permission save.

### CSV Export
Use `downloadCsv(headers, rows, filename)` from `utils/csvExport.js`. Do not hand-roll `Blob`/anchor-click code in a new page.

### Route Wrappers
`pages/*Route.jsx` files are thin wrappers that lazy-load the corresponding `*Redesign.jsx`. Never edit these except `POSRoute.jsx`/`ReportsRoute.jsx` — all logic belongs in the `*Redesign.jsx`.

### Multi-Tenant
`IS_MULTI_TENANT` (from `config.js`) gates the Store Code login field and the JWT auth flow. In MT mode, login requires a tenant slug.

---

## POS Architecture (quick reference)

The POS terminal is the single most complex piece of frontend — full detail lives in `src/pages/redesign/pos/CLAUDE.md`. Headline facts: `POSContext.jsx` composes 8 domain hooks (`useShiftGate`, `useCart`, `useReceipt`, `useCustomerDisplay`, `useLoyaltyWallet`, `useFolioCharging`, `useOfflineQueue`, `useCheckout`) behind `usePOS()`. `completeSale` deliberately uses `api.raw` (never `api.post`) so it can branch on status codes mid-checkout — session expiry, insufficient stock, credit-limit exceeded all need different modal flows, not a thrown error. POS is offline-first: an IndexedDB queue (`utils/offlineQueue.js`) with an idempotency key via `crypto.randomUUID()` lets a sale complete without a network round trip and sync later.

---

## Provider Hierarchy (detail)

```
CurrencyProvider → ToastProvider → AuthProvider → PresetProvider
```

`CurrencyProvider`/`ToastProvider` sit outside `AuthProvider` and must never depend on the fetch interceptor or `useAuth()` — they need to render before login. `PresetProvider` sits inside `AuthProvider` and depends on it for `employee`/`isBootstrapping`/`applyEffectiveSession`. This ordering also carries a subtle race-condition guard: `PresetContext`'s bootstrap fetch yields one macrotask before its first call so `AuthProvider`'s fetch-interceptor effect (a child, so it commits first in React) has already patched `window.fetch` — otherwise the very first bootstrap call could fire unauthenticated. See `src/contexts/CLAUDE.md` for the full detail, and `src/auth/CLAUDE.md` for why only the tenant auth scope patches `window.fetch` at all (the other three scopes — super-admin, customer portal, manufacturer portal — are independent and don't).

---

## Social-preview middleware (`frontend/middleware.js`) — Vercel edge, NOT in the bundle

`frontend/middleware.js` is a **Vercel Routing Middleware** (edge runtime). It lives at the frontend root because that is the Vercel **project root** — it is a deploy-level file, not part of the Vite bundle, and nothing in `src/` imports it. Its one job: shareable tenant links previewed poorly on WhatsApp/Facebook because social crawlers don't run JS, so `Seo.jsx`'s client-side tags never applied and every link showed the generic SanoPOS ad. For **crawler User-Agents only**, on a short allow-list of *broadcast* links, it resolves the tenant slug, fetches branding from the no-auth `GET /api/storefront/config`, and stamps real `og:title`/`og:description`/`og:image` into the served shell (same string-replace shape as `scripts/prerender-meta.mjs`'s `rewrite()`, which is the sibling **build-time** mechanism for the 13 marketing routes). A **real browser short-circuits before any network call** — the SPA + `Seo.jsx` behave exactly as before; the crawler is the only consumer of these static tags.

Rules if you touch it:
- **Deny-list FIRST, allow-list SECOND (privacy).** BRAND set (safe — name + logo leak nothing): `/store`, `/book`, `/book-room`, `/reserve`, `/menu`, `/inquire`. NO-PREVIEW set (must stay the generic shell): `/receipt`, `/portal`, `/gift-card`, `/pay`. The no-preview set is matched first with a path-boundary check so a deep link like `/portal/:slug/invoices/:id` can **never** inherit a brand preview via a loose prefix. "No preview" returns the untouched shell = the generic SanoPOS card, which leaks nothing tenant-specific (that's the accepted outcome, not a bug). `/receipt` is `wa.me`-forwarded + WhatsApp caches previews; `/gift-card/:code` is a bearer secret — both must never preview tenant data.
- **Best-effort cache caveat.** Branding + the shell are cached in module-level `Map`s that are **per-edge-isolate only** (Vercel runs many isolates) — there is **no cross-isolate invalidation**; a branding change propagates within the TTL (10 min). Fine because the only consumer is a crawler.
- **Fail-closed.** On a branding lookup miss/non-200/timeout, it serves the untouched shell (generic), never a broken/partial tag set. Backend origin comes from the edge-visible `APP_PUBLIC_BASE_URL` env (falls back to the prod API host). Descriptions are **synthesized** per-route (the config endpoint returns name + logo, no description).
- **Testing.** `vite preview` / a local build does **NOT** execute Routing Middleware. Test with `vercel dev` (run it from the **repo root**, not `frontend/` — the linked project's Root Directory is already `frontend`, so running inside `frontend/` doubles the path) or a preview deploy, then `curl -A "facebookexternalhit/1.1" …`. Every response carries an `x-og-mw` header (`brand` / `no-preview` / `bypass-ua` / `passthrough` / `fail-open`) for quick verification. Passthrough uses `next()` from `@vercel/functions` (a frontend dependency added for this).

---

## Where To Go Next

| Topic | Doc |
|-------|-----|
| `src/` root files (`api.js`, `config.js`, `main.jsx`, `hooks/`) | `src/CLAUDE.md` |
| Every page directory (`redesign/`, `admin/`, `portal/`, `reports/`, `dashboard/`, `shopify/`, `storefront/`, `marketing/`, `public/`) | `src/pages/CLAUDE.md` |
| The bulk of tenant UI — every `*Redesign.jsx` page, grouped by domain | `src/pages/redesign/CLAUDE.md` |
| The POS terminal (hooks, modals, shortcuts, payload shape) | `src/pages/redesign/pos/CLAUDE.md` |
| The four independent auth scopes and their stores | `src/auth/CLAUDE.md` |
| Design system primitives, tokens, shared banners | `src/ui/CLAUDE.md` |
| Contexts (`Currency`, `Toast`, `Preset`) | `src/contexts/CLAUDE.md` |
| Pure utility helpers (`dates.js`, `receipt.js`, `offlineQueue.js`, …) | `src/utils/CLAUDE.md` |
| Route definitions (`publicRoutes`/`appRoutes`/`adminRoutes`) | `src/routes/CLAUDE.md` |
| TypeScript declaration files (editor hints only) | `src/types/CLAUDE.md` |
| Unit, E2E (Playwright), and smoke test suites | `frontend/tests/CLAUDE.md` |
