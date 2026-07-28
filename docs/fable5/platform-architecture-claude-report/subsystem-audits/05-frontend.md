# Subsystem Audit 05 — Frontend

> **RAW EVIDENCE — read with care.**
> Produced by a read-only source-code audit on **2026-07-29** at commit **`3b84732d`**.
> Findings are graded **REPORTED** unless the [main report](../01-architecture-report.md) marks them CONFIRMED.
> Where this document and the main report disagree, **the main report wins**.
> Line numbers drift: **grep the named symbol, don't trust the number.**

Scope: `frontend/`. ~461 `.jsx` + 39 `.js` = **~118,551 LOC** in `src/`.

---

## 1. Build & tooling

### `package.json`
| | |
|---|---|
| React | `react`/`react-dom` `^19.2.0` (:36-37) |
| Build | `vite ^7.3.1` (:61), `@vitejs/plugin-react ^5.1.1` (:52) |
| CSS | `tailwindcss ^4.2.0` + `@tailwindcss/vite ^4.2.0` (:30, :40) |
| Router | `react-router-dom ^7.13.0` (:38) |
| Observability | `@sentry/react ^10.46.0` (:29) |
| Charts / sheets | `recharts ^3.7.0`, `xlsx ^0.18.5` |
| POS-specific | `idb ^8.0.0`, `jsbarcode ^3.12.3`, `qrcode ^1.5.4` |
| Edge | `@vercel/functions ^3.7.5` — used **only** by `middleware.js` |
| Test | `vitest ^4.0.18`, `@playwright/test ^1.58.2`, `@axe-core/playwright`, `fake-indexeddb`, `jsdom`, Testing Library |

Scripts: `build` = `vite build && node scripts/prerender-meta.mjs` (:8); `typecheck` = `tsc --noEmit` (:23); `lint:baseline` (:24-25); three **dead** `parity:*` scripts (:11-13).

### `vite.config.js`
- Plugins `react()`, `tailwindcss()` (:9-10); alias `@shared → ../shared` (:14)
- **Manual chunking** (:20-31) deliberately minimal — only `recharts` (incl. `d3-*`), `xlsx` (incl. `codepage`), `reports`. Comment at :30: no catch-all vendor chunk; everything else splits via `lazy()`
- ⚠️ Vitest config is embedded here (:35-39) with **no `include`/`exclude`**

### Tailwind v4 — CSS-first, no JS config
**No `tailwind.config.js` exists.** Configuration is CSS-first via `src/index.css:1-3`:
```css
@import "tailwindcss";
@import "@fontsource-variable/inter";
@import "./ui/tokens.css";
```
Exactly two CSS files in `src/`: `index.css` and `ui/tokens.css`.

### `vercel.json`
- One rewrite: `/((?!.*\.[^/]+$).*)` → `/index.html` (:2-7) — SPA fallback for extensionless paths only
- Security headers on `/(.*)` (:8-18): `X-Content-Type-Options: nosniff`, **`X-Frame-Options: DENY`**, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `X-DNS-Prefetch-Control: on`
- ⚠️ **No `Cache-Control`, no CSP, no HSTS**

### Edge middleware — `frontend/middleware.js` (283 lines, not in the Vite bundle)
Vercel Routing Middleware importing `next` from `@vercel/functions` (:55).
- Backend origin from `APP_PUBLIC_BASE_URL`, falling back to `https://api.sanopos.com` (:62); comment (:60-61) explains `VITE_API_BASE` is build-inlined and invisible to the edge runtime
- Crawler UA regex (:71-72) covers facebookexternalhit/Twitterbot/WhatsApp/Slackbot/LinkedInBot/Discordbot/TelegramBot/Pinterest/redditbot/Applebot/SkypeUriPreview/vkShare/Embedly. Non-crawlers short-circuit (:235) with `x-og-mw: bypass-ua`
- **Deny-list first** (:76): `["/receipt", "/portal", "/gift-card", "/pay"]`, path-boundary matched (:242) → untouched shell with `x-og-mw: no-preview`
- **Allow-list second** (:83-90): `/store`, `/book-room`, `/book`, `/reserve`, `/inquire` (slug from path); `/menu` (slug from `?tenant=`)
- Slug validated against `/^[a-z0-9_]{3,40}$/` (:65)
- `matcher` (:96-110) lists exactly those 10 route families — the recursion guard
- ⚠️ Caches are module-level `Map`s, **per-edge-isolate only, no cross-isolate invalidation**, `BRANDING_TTL_MS = 10 min` (:113-117), FIFO eviction (:201-203)
- Fail-closed: branding miss → `fail-open`, shell miss → `fail-open-shell`, success → `brand`

Build-time sibling `scripts/prerender-meta.mjs` (94 lines) copies `dist/index.html` into `dist/<route>/index.html` with rewritten title/description/OG for **13 marketing routes** (:25-39) and emits sitemap.xml + robots.txt.

### PWA
- `index.html:12` links `/manifest.webmanifest`
- `manifest.webmanifest`: `display: standalone`, `background_color: "#0f172a"`, `theme_color: "#10b981"`, three PNG icons
- SW registered **only in prod**, on `window load`, errors swallowed (`main.jsx:67-71`)
- `public/sw.js` (81 lines): caches `sanopos-static-v2` / `sanopos-api-v1` (:4-5); precache list (:6-15); `install` → `skipWaiting()`; `activate` purges any cache not equal to those two names then `clients.claim()`. A `message` handler deletes `API_CACHE` on `{type:"AUTH_LOGOUT"}` (:37-41), posted by `AuthProvider.logout` (:175-177). Fetch (:52-81): GET only; same-origin `navigate` → **network-first with `/` shell fallback**; `/assets/*` or `.js/.css/.svg/.png` → **cache-first, never revalidated** (:69-79)
- ⚠️ `API_CACHE` is created and purged but **nothing ever writes to it**

---

## 2. App composition

### `src/main.jsx` (71 lines)
Provider hierarchy, exact order (:51-65):
```
StrictMode
└ ErrorBoundary            (ui/ErrorBoundary.jsx, named export)
  └ CurrencyProvider
    └ ToastProvider
      └ AuthProvider
        └ PresetProvider
          └ App
```
Three boot side effects:
1. **Sentry** (:13-31) — only if `SENTRY_DSN`. `tracesSampleRate: 0`, `replaysSessionSampleRate: 0`. `denyUrls` for Cloudflare Turnstile iframes; `ignoreErrors` for Trusted-Types noise
2. **Stale-chunk recovery** (:41-49) — `vite:preloadError` → `preventDefault()` + `reloadOnceForChunkFailure()`; `unhandledrejection` routed through `looksLikeChunkLoadFailure`
3. **SW registration** gated on `IS_PROD` (:67-71)

### `src/App.jsx` (31 lines)
```jsx
{isImpersonating && <ImpersonationBanner />}   // :16 — OUTSIDE <Router>
<Router>                                        // :17 BrowserRouter
  <SubscriptionBanner /> <PwaInstallPrompt />   // :18-19
  <Routes>{publicRoutes}{appRoutes}{adminRoutes}
    <Route path="*" element={<Navigate to="/" replace />} />  // :24
```
⚠️ `App.jsx:2` imports `{ ErrorBoundary }` but **never renders it** — the only app-wide boundary is in `main.jsx:53`.

**ErrorBoundary export shape:** `export class ErrorBoundary extends Component` — **named export, no default** (:8). Props `{level, onReset, children}`; `level === "page"` renders a compact card, anything else full-screen. Sentry aliased to `null` when `SENTRY_DSN` falsy (:6), making `componentDidCatch` a silent no-op. Nesting sites: `main.jsx:53`, `AppLayoutRedesign.jsx:323` (`level="page"`), `POSRedesign.jsx:435`, `POSRestaurantRedesign.jsx:205`, and 5 inline in `publicRoutes.jsx`.

---

## 3. Routing — `src/routes/`

| File | Route elements | Guard model |
|---|---|---|
| `publicRoutes.jsx` (303 lines) | 32 top-level + 33 nested = **65** | Per-route, ad-hoc |
| `appRoutes.jsx` (345) | 1 pathless parent + **159** children | Single shared parent wrapper |
| `adminRoutes.jsx` (41) | **15** | Auth checked *inside* `AdminLayout` |

**`appRoutes.jsx`** — one pathless parent (:137-146):
```jsx
<Route element={<RequireAuth><RequireContext><AppLayoutRedesign /></RequireContext></RequireAuth>}>
```
Local helpers (:133-134): `wrap(C)` = Suspense + RouteLoading; `perm(p, el)` = `<RequirePerm perm={p}>`. **118 `lazy()` imports**; `perm(...)` on ~123 lines. `perm` accepts arrays for any-of gating (e.g. `["view_hr_reports","view_financial_reports"]` :162; a 5-perm array for `/report-builder` :257).

Notable patterns: 5 stubbed `<PlaceholderPage />` routes; 18 report deep-links as `wrap(() => <ReportTabStandaloneRoute tabId="…" />)` where the component is a **named** export unwrapped via `lazy(… .then(m => ({default: m.ReportTabStandaloneRoute})))` (:79-80); multi-path/single-component sub-tabs for `/rentals/*` (5), `/rooms/*` (7), `/treatment-plans/*` (7).

**`publicRoutes.jsx`** — no shared parent. Auth-requiring full-screen surfaces are hand-wrapped: `/pos`, `/pos/restaurant`, `/kiosk` each get `ErrorBoundary → Suspense → RequireAuth` (:140-172); **`/kds` alone keeps the full stack** `RequireAuth → RequireContext → RequirePerm perm="manage_kds"` (:179-193); ⚠️ **`/customer-display` (:194-198) has no auth at all**. `HomeRedirect` (:98-121) is defined inline (not lazy).

**Guards** (`src/components/`):
- `RequireAuth.jsx` — fullscreen loader while bootstrapping, `<Navigate to="/login" state={{from}}>` if unauthenticated
- `RequirePerm.jsx` — returns **`null`** (not a spinner) during bootstrap (:8-10); falsy `perm` passes through; failure → `/access-denied`
- `RequireContext.jsx` — ⚠️ **passes through entirely if `flags.context_selection_required` is off** (:22); otherwise requires `scope_mode === "all_branches" && all_access` or an `active_outlet_id`

---

## 4. Auth — `src/auth/`

### `AuthProvider.jsx` (526 lines) — the only scope that patches `window.fetch`

Effect keyed on **`[employee?.id]` only** (:344, dep at :469 — token read live via `readToken()`).

```js
const nativeFetch = window.fetch.bind(window);  // :345
window._nativeFetch = nativeFetch;              // :347 — escape hatch
window.fetch = async (input, init = {}) => {…}  // :349
```
Match rule (:355-356): `rawUrl.includes(`${API}/api/`) || rawUrl.startsWith("/api/")`.

Pipeline:
1. **Offline write guard** (:358-376) — non-GET/HEAD/OPTIONS while `!navigator.onLine` returns a *synthetic* `Response` with status **503** and header `X-Offline-Mode: 1`, never touching the network
2. **Public-auth bypass** (:379-385) — signup/forgot-password/reset-password fall through untouched
3. **Header injection** (:387-412) — `x-employee-id` always; MT adds `Authorization: Bearer`; from `readContext()`: `x-company-id`, `x-outlet-id`, `x-scope-mode`. MT also sets `credentials: "include"` (:417)
4. **Silent refresh** (:423-441) — MT only, on `401`: clones response, parses JSON, and if `body.code === "TOKEN_EXPIRED"` calls `refreshAccessToken()`, then replays the original request once
5. **Failed-request tracking** (:444-447) — `!res.ok` stashes `X-Request-Id` into `window.__lastFailedReqId`
6. **Subscription expiry** (:450-460) — `403` + `SUBSCRIPTION_EXPIRED` sets state

Cleanup restores `window.fetch` and deletes `window._nativeFetch` (:465-468).

**Silent refresh** (`refreshAccessToken`, :86-113): module-level `_refreshPromise` lock coalesces concurrent callers (:87); uses `window._nativeFetch` to avoid recursing into the patch (:91); `POST /api/auth/refresh` with `credentials:"include"`; writes token + session (:99-100).

**Boot sequence** (:206-342):
1. `?impersonate_token=` → verify server-side via `GET /api/auth/me` (:219-222), then `history.replaceState` to strip params (:243-248)
2. Stored impersonation session → restore as-is
3. No session → done
4. Otherwise **re-fetch permissions from the server** (`GET /api/roles/:id/permissions`, :68-80) — localStorage perms are never trusted. Best-effort `GET /api/auth/me` refreshes `company` (:283-296). Any throw → `clearSession()` (:330-332)
5. MT only: `GET /api/billing/status` (:312-329)

**`applyEffectiveSession(emp)`** (:49-66) — the outlet-effective permission overlay. Guards: no-ops unless `Array.isArray(emp.permissions)` **and** `Number(stored.employee.id) === Number(emp.id)` (:50-52) — a stale/foreign bootstrap response cannot hijack identity. Called by `PresetContext`, not pages.

**`hasPerm`** (:185-192): `all_access` → true; array → `.some()`; string → `.includes()`.

### Stores (all localStorage, mutually independent)
| File | Key | Notes |
|---|---|---|
| `authStore.js` | `"authSession"` | Only store with struct validation (:3-10); mirrors employee into legacy `"currentEmployee"`; `clearSession` also removes the flags cache |
| `adminAuthStore.js` | `"adminSession"` | No validation. ⚠️ `readAdminSession()` and `getAdminSession()` are **identical** (:15-17, :31-33) |
| `customerPortalStore.js` | `` `customerPortalSession:${slug}` `` | Slug-scoped; no-ops without a slug |
| `manufacturerPortalStore.js` | `` `manufacturerPortalSession:${slug}` `` | Byte-for-byte parallel |

---

## 5. API layer

### `src/api.js` (75 lines)
```js
const res = await fetch(`${API_BASE}${path}`, {
  headers: { "Content-Type": "application/json", ...options.headers },
  ...options,      // :14  ⚠️ see risk #1
});
```
`json()` (:19-46) throws on `!res.ok` with an `Error` carrying `.message`, **`.status`**, **`.body`** (:40-43). Before throwing, a `403` with `PLAN_LIMIT_REACHED` dispatches `CustomEvent("sanopos:plan-limit-reached")` (:8, :23-38), consumed by `PlanLimitModalInterceptor`.

Surface: `get(path, query)`, `post`/`put`, `del`, `upload` (passes `headers: {}` so the browser sets the multipart boundary), `raw` (returns the `Response`, **never throws**).

`api.js` injects **zero** auth headers itself — every call inherits them from the `window.fetch` patch, which is why every path must contain `/api/`.

### `src/config.js` (19 lines) — sole reader of `import.meta.env`
| Export | Env var | Fallback |
|---|---|---|
| `API_BASE` | `VITE_API_BASE` | `http://localhost:5000` |
| `IS_MULTI_TENANT` | `VITE_MULTI_TENANT === "1"` | — |
| `SENTRY_DSN` | `VITE_SENTRY_DSN` | `""` → disables Sentry |
| `TURNSTILE_SITE_KEY` | `VITE_TURNSTILE_SITE_KEY` | `""` → disables CAPTCHA |
| `ENV_MODE`/`IS_PROD`/`IS_DEV` | `import.meta.env.*` | |

⚠️ **No `VITE_SENTRY_DSN` in either `.env.development` or `.env.production`** — Sentry is off unless injected by Vercel project env.

---

## 6. State / contexts / hooks

### `CurrencyContext.jsx` (58)
`{symbol, code, denominations, fmt, refresh}`. Defaults `$`/`USD`. Loads from `GET /api/company-profile/currency` using **raw `fetch`** (:28) because it renders outside `AuthProvider`. In MT it reads `localStorage["authSession"].tenant_slug` **directly**, bypassing `authStore` (:22-27). All errors swallowed.

### `ToastContext.jsx` (66)
`{toast, success, error, warning}`. Stack capped at 3 (:18); auto-dismiss 4000 ms. Pill is always `bg-(--ui-primary)` with only the icon colour varying. `useToast()` **throws** outside the provider (:63).

### `PresetContext.jsx` (199)
Holds the industry preset + `presetLoaded`, `updatePreset`, `refreshPreset`, `hasMode`, `label`.

Bootstrap effect (:102-169), gated on `!isBootstrapping && employee?.id`:
- ⚠️ **Race guard** (:145-157): `await new Promise(r => setTimeout(r, 0))` before the first `api.get("/api/context/bootstrap")`, because child effects commit before parent effects — `PresetProvider`'s effect would otherwise run against the **pre-patch** `window.fetch`. A **second** mitigation retries once after `600 ms` if the first attempt still returns `err.status === 401` (:151-153)
- `apply()` (:111-129) merges the preset, calls **`applyEffectiveSession(data.employee)`** (:115) — *this is where per-outlet effective permissions land* — and auto-seeds a `single_branch` context when `readContext()` is empty
- ⚠️ `presetLoaded` flips true on **both** success and failure (:128, :166)
- ⚠️ `hasMode(mode)` is **fail-open**: returns `true` while `!presetLoaded` (:174-175)

### `hooks/useFeatureFlags.js` (123)
- **Fail-closed defaults** — `DEFAULT_FLAGS` is 17 keys all `false` (:6-24)
- **Warm cache** in `localStorage["sanopos_feature_flags_cache_v1"]`; a fetch failure **keeps current state** rather than resetting (:104-109)
- Uses raw `fetch` (:88) — accepts `authHeaders` as function or object
- Per-flag resolution: **`f.effective !== undefined ? f.effective : f.enabled`**, then coerced (:98-99) — outlet-aware truth wins
- Cross-component refresh via `FLAGS_REFRESH_EVENT` + `refreshFeatureFlags()` (:56-60)
- ⚠️ **Effect deps `[authHeaders, refreshTick]`** — a fresh object literal each render causes an infinite fetch loop

### `hooks/useReportFilters.js` (21)
`{filters, setFilters, query}` where `query` is a memoized `URLSearchParams` built only from non-empty trimmed values.

### Flag/permission/preset → UI gating
Three orthogonal gates converge in `AppLayoutRedesign.jsx:122-134`:
```js
group.items.filter((it) =>
  (!it.requiredPerm || hasPerm(it.requiredPerm)) &&      // AuthProvider
  (!it.requiredFlag || Boolean(flags[it.requiredFlag])) && // useFeatureFlags
  (!it.requiredMode || hasMode(it.requiredMode)))          // usePreset
).filter((g) => g.items.length)
```
Path sentinel `__STOREFRONT__` resolves at render (:116). Active state is a **prefix** match (:138-139). Labels are preset-translated via `translateNavLabel` (:92-111).

---

## 7. Design system — `src/ui/` (13 files)

### `primitives.jsx` (17.5 KB) — 19 named exports, no default
`PageShell`, `SectionCard`, `Button`, `Input`, `Select`, `Badge`, `TableToolbar`, `FilterPill`, `BulkActionBar`, `EmptyState`, `Skeleton`, `Toggle`, `Tooltip`, `Modal`, `Drawer`, `ModalBody`, `ModalFooter`, `ConfirmDialog`, `TabBar`.

`Button` API (:33-69): `{children, tone = "default", size = "md", iconOnly, className}`. Tones `primary`/`danger`/`plain`/`link`/default. Always `rounded-full font-semibold` + `.ui-focus-ring`. ⚠️ **There is no `variant` prop** — yet `ErrorBoundary.jsx:60` passes `variant="secondary"`, silently forwarded to the DOM.

### `tokens.css` (108 lines) — light-only, `:root` only
No `@media (prefers-color-scheme)`, no `[data-theme]`. `--ui-text: #101010`, `--ui-bg`/`--ui-surface: #fff`, `--ui-border: #f0f0f0`, `--ui-primary: #101010`, `--ui-link`/`--ui-focus: #006aff`. **`--ui-shadow: none`** — flatness is the design (:66).
⚠️ Two **legacy alias namespaces** remain live (:40-57): prefixed (`--ui-muted`, `--ui-accent`, …) and **un-prefixed** (`--text-primary`, `--accent`, `--border`, `--bg-card`, …). Any component referencing a token *not* defined resolves to nothing, so these aliases are load-bearing patches.

### `nav-config.js` (19 KB) — single export `SHOPIFY_NAV_GROUPS`
**21 groups**: Overview, Sell, Customers, Catalog, Inventory, Procurement, Fulfillment, Field Sales, Online Store, Restaurant, Appointments, Service Operations, Rentals, Rooms, Clinical, Finance, Insights, People, Compliance, Setup, Account.
**122 items**: 110 carry `requiredPerm`, 76 `requiredFlag`, 35 `requiredMode`, 3 `newTab`.

### Custom ESLint rules enforce the design system
- `sano/no-raw-interactive` — error, scoped to `src/pages/redesign/**`
- `sano/no-raw-palette-color` — error, app-wide, with an explicit 8-file ignore list (each justified in-comment) and `allow: ["text-yellow-400","fill-yellow-400"]` for star gold
- `lint-baseline.json` (27 KB) records grandfathered violations per file+rule

---

## 8. POS architecture

`POSRedesign.jsx` (440 lines) is composition + a status bar: imports **29 modal/panel components** (:4-35), mounts them all, wraps in `<POSProvider>` + `<ErrorBoundary>` (:435-437).

### `pos/POSContext.jsx` (1,272 lines)
`usePOS()` throws outside the provider (:73-77). Composes **8 domain hooks** (:16-23):

| Hook | LOC | Owns |
|---|---|---|
| `useShiftGate` | 133 | outlets, `activeShift`, `canOpenShift`, `isReadyForCheckout`, opening float |
| `useCart` | 394 | search, cart array, `taxInclusive`, price-list resolution, layout tiles, auto-promotions, totals (→ `cartMath`) |
| `useReceipt` | 78 | slip state, active template, recent sales, `printSlip`, `retryPrompt` |
| `useCustomerDisplay` | 29 | pure side effect — pushes cart to the second screen |
| `useLoyaltyWallet` | 82 | wallet balance, points earn/redeem |
| `useFolioCharging` | 54 | charge-to-room / charge-to-treatment-plan |
| `useOfflineQueue` | 147 | IndexedDB queue wrapper, auto-sync |
| `useCheckout` | 640 | payments, `completeSale`, tips, session-expiry recovery, credit retry, backorders |

A 44-line comment block (:26-69) enumerates every key that must remain on the exported `value` — an in-source contract snapshot.

⚠️ Context-owned POS feature flags are fetched separately into a `{key: f.enabled}` map (:100-106) — **uses `enabled`, not `effective`**, unlike `useFeatureFlags`.

### `pos/cartMath.js` (64 lines) — pure, zero React
- `calcGrossTotal` (:11-13), `calcDiscountValue` (:22-26)
- `calcTaxTotal(cart, taxInclusive)` — **per-line `effectiveTaxRate`** so mixed-rate carts work; inclusive backs tax out, exclusive adds on top (:39-51). Header records that pre-fix this returned 0 in exclusive mode
- `calcTotal` — `Math.max(0, gross - discount + (taxInclusive ? 0 : tax))` (:62-64)

### `pos/omniInputRouter.js` (33 lines) — pure classifier
`#`-prefix → `customer`; all-digits of length 8/12/13/14 → `barcode` (EAN-8/UPC-A/EAN-13/GTIN-14); 4-5 digits → `plu`; `<2` chars → `noop`; else `text`.

### Keyboard shortcuts (`POSContext.jsx:934-970`)
Single `window` keydown listener. F1 help, F2 discount, F3 park, F4 focus customer search, F5 parked sales, F8 remove last, F9 checkout, F10 clear cart (with confirm), Esc close. **F-keys are checked *before* the input-focus bail-out** (:948-950), so they fire even inside a text field.
**Barcode-scanner buffer** (:953-965): only when focus is not in an input. `Enter` flushes if `code.length >= 3`; single chars append with a 100 ms inter-key reset. Ref indirection keeps the once-registered listener calling current closures.

### `completeSale` (`useCheckout.js`)
Payload includes `idempotency_key: crypto.randomUUID()` (:328), folio/treatment-folio ids, tip (lowercased per a DB CHECK), restaurant shell fields, `tax_inclusive`, `manager_pin` (cleared immediately after stamping, :365), `appointment_id`, `backorder_items`.

Dispatch:
- `!navigator.onLine` → `queueSaleOffline()` **before any network call** (:401-405); shows a slip with `invoiceNumber: "PENDING"`, `offline: true`
- Online → **`api.raw("/api/sales", …)`** (:408-411), never `api.post`, so it can branch on status: `401` → park payload + `setSessionExpired`; `400 insufficient_stock` → `onInsufficientStock(...)`; `403 CREDIT_LIMIT_EXCEEDED` → park + open modal; `CREDIT_REQUIRES_CUSTOMER`; `catch (TypeError || !onLine)` → offline queue (:499)

### Offline queue — `utils/offlineQueue.js` (245) + `hooks/useOfflineQueue.js` (147)
IndexedDB via `idb`: DB `sanopos_pos` v1, store `sales_queue`, `keyPath: "idempotency_key"`, three indexes. Row shape `{idempotency_key, employee_id, type, sync_state, retry_count, last_error, queued_at, last_attempt_at, payload}`. `MAX_QUEUED = 50`, `WARN_THRESHOLD = 40` — ⚠️ the cap is **shared across all types**. Types: `sale`, `return`, `check_in`, `field_order`. One-time `migrateFromLocalStorage`.

`syncQueue` (:75-128): serial loop, routes by type to `/api/returns` or `/api/sales`, posts via `api.raw`, treats `body.duplicate || code === "duplicate_return" || "duplicate"` as **success** and drops the row (:99-105). `syncingRef` prevents re-entrancy. Auto-sync bound to the window `online` event.

### Scale — `utils/scale.js` (193), Web Serial
`isScaleSupported()` = `Boolean(navigator.serial)`. `GenericSerialScaleAdapter` at 9600-8N1 covering CAS ER/SE/PR, AND FG/SG and generic clones. `weighOnce({timeoutMs = 8000, settleReads = 3})` lazily calls `navigator.serial.requestPort()` (must originate in a user gesture) and resolves after **3 consecutive equal stable frames** (:180) or rejects at the deadline. Consumed by `POSCartTable.jsx` with a fallback toast and a `tare_locked` flag for deli-label lines.

### Receipt printing — `utils/receipt.js` (429)
`buildReceiptSections` (:42) is the pure renderer shared by the on-screen modal and the print popup. `buildReceiptHtml` (:122) opens a window and **dynamically `import()`s** `jsbarcode` (:336) and `qrcode` (:375) so only tenants using them pay the bytes. `printToHardware` (:417) POSTs via **raw `fetch`** with an absolute URL (:419) — comment at :408 explains frontend/backend are cross-origin in prod.
`useReceipt.printSlip` (:44-52) calls `printToHardware` first; on failure it **arms `retryPrompt` rather than silently opening the browser popup**, returning `{ok:false, error, fallback:true}`.

---

## 9. Page inventory

| Directory | Files | Significant members |
|---|---|---|
| `src/pages/` (top) | 103 `.jsx` | Mostly thin `*Route.jsx` lazy wrappers; real logic in `Reports.jsx`, `SetupWizard.jsx`, `LoginPage`, `SignupPage`, `ContextSelect`, `CustomerDisplayPage`, `ReceiptPublicPage` |
| `pages/redesign/` | **110** + 9 subdirs | `POSRedesign`, `POSRestaurantRedesign`, `KioskRedesign`, `DashboardRedesign`, `BusinessModulesRedesign`, `IntegrationsHubRedesign`, … |
| `pages/redesign/pos/` | **45** | 29 `POS*Modal`, `POSContext` (1272), `cartMath.js`, `omniInputRouter.js`, `hooks/` (8) |
| `pages/reports/` | 29 | 14 domain barrels + sub-barrels + standalone tabs + `ReportShared.jsx` |
| `pages/admin/` | 17 | `AdminLayout` (owns the auth check), `AdminLogin` (defines `adminFetch`), 13 more |
| `pages/portal/` | 24 | `PortalLayout` (own `PortalAuthProvider`), 6 auth pages, 15 tab pages |
| `pages/manufacturer-portal/` | 7 | Layout, Login, Setup, ForgotPassword, Dashboard, Sales, Schemes |
| `pages/storefront/` | 8 | `StorefrontLayout` + `useStorefrontCart.js` |
| `pages/marketing/` | 8 | `HomePage` (the actual public landing page), `IndustryPage`, `PricingPage`, `Seo.jsx` |
| `pages/public/` | 10 | Booking, room booking, reservation, menu, pay, inquiry, form fill, member kiosk, Terms, Privacy |
| `pages/dashboard/` | 24 | Widgets for `DashboardRedesign` |
| `pages/shopify/` | 7 | Tab modules under a local `ShopifyProvider` |
| `src/components/` | 10 | `AppLayoutRedesign` (351), the three guards, `ContextSwitcher`, `NotificationBell`, `PlanLimitModalInterceptor` |
| `src/utils/` | 13 | `receipt.js` (429), `offlineQueue.js` (245), `scale.js` (193), `embeddedBarcode.js`, `dates.js`, `csvExport.js`, `chunkReload.js`, … |

Tests: 25 Vitest unit files in `tests/unit/`, ~30 Playwright `.spec.js` at `tests/`, `tests/smoke/`, `tests/sweep/` — 79 total.

---

## 10. TypeScript posture

**Effectively zero.** `src/types/` holds exactly **2 `.ts` files, 0 `.tsx`** against 461 `.jsx` + 39 `.js`.

`tsconfig.json`: `allowJs: true`, **`checkJs: false`**, `noEmit: true`, **`strict: false`** (:6-9), `include: ["src/**/*"]`. With `checkJs: false`, `npm run typecheck` type-checks **only the two `.ts` files** — ~55 lines out of ~118,500.

- `types/api.ts` (24 lines) — `ApiOk<T>`, `ApiError`, `ApiResponse<T>`, `isApiError` guard
- `types/auth.ts` (31 lines) — `AuthEmployee`, `JwtPayload`

⚠️ **Neither file is imported anywhere in `src/`** (verified by grep). Both have already drifted: `AuthEmployee` declares `token` and `permissions` **on the employee object**, whereas `AuthProvider.jsx:38-41` reads them off the **session**. `ApiResponse` doesn't describe how `api.js` actually signals failure (a thrown `Error` with `.status`/`.body`).

---

## 11. Notable risks & oddities

1. **`api.js` spread order silently drops `Content-Type`.** `:12-14` places `...options` *after* `headers: {...}`, so `options.headers` **overwrites** rather than merges. `api.upload` relies on this deliberately, but `POSContext.jsx:897-898` calls `api.raw(…, {headers: {"x-employee-id": …}})` and loses `Content-Type`. It's a GET today; any future JSON POST through `raw`/`get` with a custom header silently sends without a content type.
2. **Two divergent feature-flag readers.** `useFeatureFlags:98` prefers outlet-aware `f.effective`; `POSContext:103` builds its own map from `f.enabled` only. A flag disabled at one outlet but on company-wide hides the sidebar entry yet leaves the POS feature live.
3. **The PresetContext ↔ AuthProvider effect-ordering race is worked around, not fixed** (`PresetContext:145-157`). Load-bearing timing: if the event loop is slower than one macrotask + a 600 ms retry, the tenant silently stays on `general_retail`, which changes POS behaviour for clinic/restaurant tenants.
4. **Two independent silent-refresh implementations** — `AuthProvider.refreshAccessToken` and a separate `adminFetch` in `pages/admin/AdminLogin.jsx`. `adminAuthStore` also exports two byte-identical functions.
5. **Boot loads *base*-role permissions; effective perms arrive later** via `PresetContext` → `applyEffectiveSession`. If `/api/context/bootstrap` ever fails, the overlay never applies for the whole session. Not a privilege hole (the server re-resolves), but nav can transiently show entries an outlet doesn't grant.
6. **`RequireContext` fails open** (:22) — and `useFeatureFlags` fails *closed* to `false`. So a backend outage that makes flags unfetchable **skips context enforcement entirely** for every `appRoutes` page.
7. **`hasMode()` fails open too** (:174-175), and `presetLoaded` flips true even on bootstrap **failure** (:166). A failed bootstrap leaves every `requiredMode` nav gate open against an empty preset.
8. **Route/nav permission drift is manual.** `appRoutes.jsx` and `nav-config.js` encode the same permission twice; in-source comments (:157, :207, :320-326) record past cases where nav hid an item while the route stayed reachable by direct URL. No test ties the two tables together.
9. **`/customer-display` is completely unauthenticated** (`publicRoutes.jsx:194-198`) and receives POSTed cart/total data — the one route with no guard reading live sale data.
10. **`vercel.json` has no `Cache-Control` and no CSP.** The SW's `cacheFirst` caches *every* same-origin asset forever with no revalidation and no size bound; `STATIC_CACHE` only purges when its version constant is manually bumped. `API_CACHE` is dead code.
11. **`X-Frame-Options: DENY` on `/(.*)`** blocks the public storefront and booking pages from ever being embedded in a merchant's own site — a hard constraint on an ostensibly embeddable surface.
12. **Manifest theming contradicts the design system** — `theme_color: "#10b981"` (emerald) and `background_color: "#0f172a"` (slate-900) against a light-only near-monochrome palette with `--ui-primary: #101010` and `index.html` declaring `theme-color: #ffffff`.
13. **Stale-chunk auto-reload can loop under a real outage** — `main.jsx:47-49` routes *any* `unhandledrejection` through the chunk-failure check; the guard is a 30 s `sessionStorage` window, so a sustained network failure reloads every 30 s.
14. **The global `window.fetch` monkey-patch is the most invasive mechanism in the app** — reinstalled on every `employee?.id` change, leaks `window._nativeFetch`, and synthesises fake `503`s that any caller must handle. Anything mounting before its effect commits sees unpatched fetch (see #3).
15. **`window.__lastFailedReqId`** is a mutable global written on every failed API call and read by the support widget — a cross-module implicit channel with no ownership.
16. **`primitives.jsx` has no `variant` prop**, yet `ErrorBoundary.jsx:60` passes one. No propTypes/TS guard catches this class of mistake anywhere in the design system.
17. **Two full legacy CSS-variable namespaces are still live** (`tokens.css:40-57`), including un-prefixed `--border`/`--accent`/`--text-primary`. Undefined tokens resolve to nothing (not a fallback), so these aliases are load-bearing patches rather than deprecations.
18. **Edge middleware caches are per-isolate with no invalidation** — a tenant rebrand shows stale crawler previews up to 10 min on warm isolates. `vite preview` never runs Routing Middleware, so the deny-list privacy split is untestable without `vercel dev` or a preview deploy.
19. **`lint-baseline.json` grandfathers real hook violations**, including `AuthProvider.jsx::react-hooks/exhaustive-deps` and `AppLayoutRedesign.jsx::react-hooks/set-state-in-effect` — the two most central files both carry suppressed debt in exactly the areas where the known races live.
20. **`typecheck` is theater** — ~55 of ~118,500 lines checked, and both type files have already drifted from the runtime shapes they claim to describe.
