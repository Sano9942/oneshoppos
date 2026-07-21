# Public Surface Audit — 2026-07-15

Scope: every externally-reachable surface SanoPOS exposes — portals, the storefront, public
QR/link pages, unattended device screens, and the outbound links the system generates — plus the
config/security findings that fell out of checking them.

Method: source reads against the working tree at branch `docs/permission-rules-live-middleware`
(`8ea54848`), Railway variable **names** (values not dumped; three non-secret URL values read
explicitly), and one Cloudflare DNS API call. Nothing was browser-verified. Verification status is
marked per finding at the bottom.

Origin: started as a spot-check of one `audit-docs` suggestion (the POSContext `navigate` bug),
widened into "what customer-facing surfaces exist", then "what other screens exist", then "what
generated links exist", then a check of four recommendations.

**Companion files in this folder:**
- `SCREEN-GAPS.md` — which 14 of 23 presets have no vertical screen, what screens are buildable
  from already-existing endpoints, and whether the wholesale field-rep PWA transfers to other
  verticals (it mostly does — the blocker is one `CHECK` constraint).
- `GLOBAL-READINESS.md` — the owner stated on 2026-07-15 that the aim is now global software, not
  Pakistan-only. That file re-scores every finding below under a global lens (two get stronger,
  one flips) and inventories the verified PK coupling. It says its ordering supersedes the
  "Recommended order" at the bottom of this one **if the global pivot is confirmed**.
  **RESOLVED 2026-07-15 — it was not confirmed.** `docs/fable5/ai-platform-strategy/PLAN.md` D1
  ruled the global pivot **direction-of-travel, not committed**: keep shipping PK-first, and record
  the PK coupling as debt behind a single trigger rather than scheduled work. **The supersession
  therefore never fires — the "Recommended order" below stands** (as amended for `ADMIN_ALLOWED_IPS`;
  see §4.1).

---

## Part 1 — Surface inventory

### Auth scopes (4)

| Scope | Secret | Store |
|---|---|---|
| Tenant employee | `JWT_SECRET` | `auth/authStore.js` |
| Super-admin | own session + TOTP | `auth/adminAuthStore.js` |
| Customer portal | `CUSTOMER_PORTAL_JWT_SECRET` | `auth/customerPortalStore.js` (slug-scoped) |
| Manufacturer portal | `MANUFACTURER_PORTAL_JWT_SECRET` | `auth/manufacturerPortalStore.js` (slug-scoped) |

Only the tenant scope patches `window.fetch`.

### Portals (2 true, + storefront)

1. **Customer portal** — `/portal/:tenantSlug`, 21 routes, own JWT/session/API client.
2. **Manufacturer portal** — `/manufacturer-portal/:tenantSlug`, 6 routes, parallel structure.
3. **Storefront** — `/store/:tenantSlug` (index/products/products/:id/cart/checkout/order/:token).
   Not a portal: no login at all, anonymous cart token in localStorage. This is the landing side of
   the portal→storefront reorder handoff (`?adopt=` param).

### Public no-auth link/QR surfaces (8)

All tenant-resolved via `services/public-tenant-context.js:resolvePublicTenantDb()`, mounted
before tenant middleware.

| Surface | Path | Vertical |
|---|---|---|
| Appointment booking | `/book/:tenantSlug` | salon, clinic |
| Room booking | `/book-room/:tenantSlug` | lodging |
| Table reservations | `/reserve/:tenantSlug` | restaurant |
| QR menu ordering | `/menu/:token` | restaurant |
| Pay-at-table | `/pay/:token` | restaurant |
| Form fill | `/forms/fill/:token` | clinic, photography |
| Inquiry → lead | `/inquire/:tenantSlug` | photography |
| Member check-in kiosk | `/member-checkin` | gym |

Public read-only lookups: `/receipt/:invoiceNumber`, `/gift-card/:code`.

**The restaurant kiosk is ONE surface, not two.** `restaurant-kiosk.js` only mints/lists/revokes
tokens (admin CRUD, 4 endpoints at `/api/restaurant/kiosk-tokens`). Both counter-mode and
table-mode tokens resolve to the same `/menu/:token` page. `OrderKiosksRedesign` is the minting UI.

### Adjacent (not customer-facing)

Super-admin panel (`/admin`), marketing site (5 route groups), staff attendance kiosk (`/kiosk`),
field-rep PWA (`redesign/field/`).

### Industry parameterization

**Only the customer portal is industry-parameterized.** Everything else gates on feature flag or
mode. `GET /api/portal/config` reads `company_profile.industry_type` → `PORTAL_ENABLED_TABS_BY_PRESET`
(`backend/config/industry-config.js:715`), then filters against tenant flags via `TAB_FEATURE_FLAGS`
(`backend/routes/customer-portal/data.js:30`). All 23 presets mapped → 10 distinct shapes:

| Shape | Tabs | Presets |
|---|---|---|
| Retail + loyalty | invoices, orders, loyalty, profile | general_retail, grocery, sweet_shop |
| Retail plain | invoices, orders, profile | butcher, textile, wholesale |
| Food | orders, loyalty, profile | restaurant, cafe |
| Salon | appointments, packages, invoices, loyalty, profile | salon |
| Clinical | treatments, appointments, invoices, loyalty, profile | clinic, dental_clinic |
| Clinical variants | same ± loyalty/packages | veterinary, physiotherapy |
| Repair | tickets, invoices, profile | repair_shop |
| Gym | subscriptions, packages, invoices, appointments, profile | gym |
| Photography | invoices, orders, appointments, gallery, profile | photography_studio |
| Rental | contracts, invoices, profile | car_rental, equipment_hire, furniture_rental, party_supplies |
| Lodging | stays, invoices, profile | hotel, guesthouse, hostel |

`PORTAL_LABEL_OVERRIDES` re-labels per preset (same `stays` tab = "Book a bed" on hostel,
"Book a stay" on hotel; `contracts` = "Rental Agreements" on car_rental, "Event Bookings" on
party_supplies). `forms` is pushed in cross-vertically when `custom_forms` is on, not preset-mapped.

### Gaps found (both pre-existing, both already in an audit baseline)

- **`public-rentals.js` is backend-only.** 4 live endpoints (`config`, `items`,
  `items/:id/availability`, `reserve`), zero frontend consumers. Rooms/appointments/reservations
  each ship a public booking page; rentals does not. Already in
  `docs/fable5/frontend-coverage-audit/matrix.json` → disposed to E7. Also called out in
  [[frontend_coverage_audit]] second-eye report.
- **The portal `wallet` tab is unreachable.** `PortalWallet.jsx`, the `/portal/:slug/wallet` route,
  `GET /me/wallet` + `POST /me/wallet/top-up-intent`, the `wallet_tab: "Wallet"` label
  (`industry-config.js:706`), and frontend `TAB_LABEL_KEYS`/`TAB_PATHS` entries all exist — but
  `wallet` appears in **no** preset's tab list, so `enabled_tabs` never contains it and the nav
  link never renders for any of the 23 industries. URL-only. Likely one of the "dead portal tabs"
  from [[claim_audit_jul2026]].

---

## Part 2 — The unattended-screen layer

| Screen | Path | Auth | Shell | Industry |
|---|---|---|---|---|
| Customer display (dual POS screen) | `/customer-display?shift_id=&tenant=` | **none** | escaped | all |
| KDS | `/kds` | `manage_kds` | **full app chrome** | restaurant, cafe |
| QR/tablet order kiosk | `/menu/:token` | none | escaped | restaurant |
| Pay-at-table | `/pay/:token` | none | escaped | restaurant |
| Member check-in kiosk | `/member-checkin` | none | escaped | gym |
| Attendance kiosk | `/kiosk?tenant=` | RequireAuth | escaped | all |
| POS terminal | `/pos` | RequireAuth | escaped | all |
| Restaurant POS | `/pos/restaurant` | RequireAuth | escaped | restaurant |
| Field-rep PWA | `/field/*` | `execute_field_sales` | app chrome | wholesale |

### KDS renders the full merchant sidebar

Every other dedicated-device screen lives in `publicRoutes.jsx` specifically to escape
`AppLayoutRedesign`. KDS is the only one mounted in `appRoutes.jsx:284`, under the
`RequireAuth > RequireContext > AppLayoutRedesign` parent, with no shell escape of its own. And
`/kds` is **not** in the Breadcrumbs skip list (`ui/Breadcrumbs.jsx:103` covers `/dashboard`,
`/pos`, `/kiosk`, `/customer-display`, `/retail/home`).

Net: a wall-mounted kitchen screen renders the collapsible nav sidebar, top bar (search,
ContextSwitcher, NotificationBell, ProfileDropdown), breadcrumbs, SupportWidget, and global
banners. Competitors run 100% ticket grid.

### Customer display: no auth, enumerable key, in-memory

`backend/routes/customer-display.js`:
- `POST` checks `x-employee-id`, 401s without it.
- `GET` (line 56) checks **nothing**. Only scoping is `?shift_id=X&tenant=slug`. `shift_id` is a
  sequential integer; tenant slugs are public (they're in storefront/portal URLs).
- Anyone can poll `/api/pos/customer-display?shift_id=1&tenant=<slug>` and watch a live cart.
- **Blast radius is modest**: item names, qty, prices, subtotal, tax, total, status. No customer
  identity, no payment data, no PII. Realistic exposure = a competitor watching live sales.
- Deliberate — the file header says "NO auth — public-facing screen". But `/menu/:token` and
  `/pay/:token` solved the same public-screen problem with an unguessable token, so the
  inconsistency looks accidental.
- **The bigger issue**: `displayStore` is an in-process `Map` (line 13). See Part 4.5.

### The screen layer is restaurant-weighted

Restaurant/cafe: 5 dedicated surfaces. Gym: 1. Wholesale: 1 (field PWA). **Clinic, dental, vet,
physio, salon, lodging, rentals, repair, photography: zero** — shared POS + customer display +
portal only. Notable absences vs what those verticals normally run: no waiting-room/self-check-in
screen for clinical or salon, no front-desk/guest kiosk for lodging, no in-store status screen for
repair (despite tickets being the whole model there).

---

## Part 3 — Outbound links

### The finding: every tenant-shared link previews as a SanoPOS ad

`frontend/src/pages/marketing/Seo.jsx` sets meta tags client-side via `useEffect`. Its own comment
states the constraint correctly:

> Runtime SEO for the marketing pages (Google/Bing execute JS). Social scrapers don't — they're
> served per-route static shells emitted by frontend/scripts/prerender-meta.mjs at build time.

The team knew social crawlers don't run JS and solved it — via prerendered shells. But `ROUTES` in
`prerender-meta.mjs:24` covers **only the 13 marketing routes**. Grepping `storefront/` and
`portal/` for `Seo` / `og:title` / `document.title` returns **zero hits**.

So every shareable tenant link — `/store/:slug`, `/portal/:slug`, `/receipt/:invoice`,
`/book/:slug`, `/book-room/:slug`, `/reserve/:slug`, `/menu/:token`, `/gift-card/:code`,
`/inquire/:slug` — serves the static `index.html` and previews as:

> **SanoPOS — The POS that adapts to your industry**
> Retail · Restaurants · Salons · Clinics · Gyms · Wholesale…
> *(og-default.png)*

A shop sharing its own storefront on WhatsApp markets SanoPOS, not itself. No logo, no shop name.

#### Why the marketing trick doesn't transfer

`frontend/vercel.json` rewrites every extensionless path to `/index.html`. But **Vercel checks the
filesystem before applying rewrites**, so `/industries/retail` finds the prerendered
`dist/industries/retail/index.html` and the rewrite never fires. That only works for routes known
at build time. `/store/kfc-lahore` has no file on disk. You cannot prerender a dynamic tenant route.

No `middleware.js` exists anywhere. `.vercel` + `vercel.json` both live in `frontend/`, so that's
the Vercel root directory → Edge Middleware would go at `frontend/middleware.js`.

#### What makes it cheaper than expected

- **The tenant slug is already in every link.** Path param for `/store`, `/portal`, `/book`,
  `/book-room`, `/reserve`, `/inquire`. Query param for the token routes —
  `utils/publicReceipt.js:25` builds `?tenant=<slug>`, `OrderKiosksRedesign.jsx:36` does the same
  for `/menu/:token`. **No DB lookup needed to resolve the tenant.**
  (Unverified: whether `/pay/:token` and `/gift-card/:code` carry it.)
- **A public branding endpoint already exists.** `GET /api/storefront/config` → `company_name`,
  `logo_url`, no auth. `GET /api/portal/config` → same plus `industry_type`.
- **The tag-stamping logic already exists.** `prerender-meta.mjs`'s `rewrite()` string-replace
  would be reused verbatim with runtime values.

Shape: match shareable paths → sniff crawler User-Agent → resolve slug from path/query → fetch
branding (cached) → stamp tags. UA-gate it: middleware runs on every request and you don't want an
API round-trip to a possibly-cold Railway per page load. Safe to gate, because the crawler is the
only consumer of static OG tags — real browsers get `Seo.jsx`'s client-side behavior anyway.

#### Two decisions before writing code

1. **This is a privacy decision first.** WhatsApp/Facebook fetch previews server-side and cache
   them, so whoever a forwarded receipt link reaches sees the preview. A `/receipt/:invoice`
   preview must never carry items or totals; `/portal/:slug` must say nothing about the customer.
   Split the routes:
   - **Should be branded** (marketing surfaces): `/store`, `/book`, `/book-room`, `/reserve`,
     `/menu`, `/inquire`
   - **Should stay generic or have no preview**: `/receipt`, `/portal`, `/gift-card`, `/pay`

   Only the first group justifies the work — roughly halves it.
2. **`logo_url` is probably unusable as `og:image` directly.** It's crawler-fetchable (allowlisted
   R2 prefix, cross-origin CORP, 1yr cache). But OG wants 1200×630 and Facebook silently drops
   images under 200×200 — a square tenant logo previews badly or not at all. v1: use `logo_url`,
   fall back to `og-default.png`. Proper fix: generate a 1200×630 card (Vercel OG / satori)
   composing logo + shop name — its own chunk of work. Ship the middleware first; a correct title
   and description alone fixes most of the embarrassment.

Rough effort: middleware + tag stamping ≈ half a day. Generated card ≈ a day+. The privacy split
is a conversation, not code.

### Env-var URL landscape — healthy, with dormant landmines

`FRONTEND_URL=https://sanopos.com` and `APP_PUBLIC_BASE_URL=https://api.sanopos.com` are **both
set** on Railway, so all 37 link-building sites resolve correctly today. These are **not**
duplicates — frontend base vs backend base.

The latent risk: those 37 sites use **five different fallbacks** when the var is missing —
`https://sanopos.com`, the stale `https://sanopos.vercel.app` (3× in `admin/tenants.js`), `""`
(→ relative URL), bare `undefined`, and `http://localhost:5173` (`routes/customers.js:863`,
`routes/restaurant/pay-at-table.js:129`). All dormant. But a new environment (staging, preview, a
second region) that forgets the var silently emails customers `localhost` links rather than
failing. `backend/utils/r2.js:74` already models the right pattern: **throw** on misconfiguration.

`APP_PUBLIC_URL` (singular) is referenced once (`pay-at-table.js:129`, as a middle fallback) and
set nowhere — vestigial.

### SEO / PWA — clean

`sitemap.xml` + `robots.txt` generated at build (`prerender-meta.mjs`), marketing shells
prerendered, `manifest.webmanifest` + `sw.js` + icons + per-industry OG images all present. The
manual sync the script warns about ("keep ROUTES in sync with industries.js") **is actually in
sync** — slugs diffed both directions, zero drift across all 10 industry pages.

---

## Part 4 — Config & security findings

Common thread: **several security layers are coded correctly but inactive because the env var was
never set.** Ranked by severity.

### 4.1 — `ADMIN_ALLOWED_IPS` is unset and fails open (highest)

Not in the Railway var list. `backend/routes/admin/helpers.js:41-42`:

```js
const allowedIps = parseAllowedIps();
if (!allowedIps) return next();
```

Unset → `parseAllowedIps()` returns `null` → **every request waved through**. The IP allowlist on
`/admin/*` (impersonation, backups, tenant management) is entirely inactive in production.

`backend/index.js:308` already fires this at every production boot:

> `[SECURITY] ADMIN_ALLOWED_IPS is not set — super-admin routes (impersonation, backups, tenant
> management) are accessible from ANY IP`

It `console.error`s and continues. Two boot checks ~5 lines apart have opposite strictness:
`ensureCriticalRoutesRegistered()` **throws** and kills the process; this one only logs.

**Mitigation in place**: password + TOTP (2FA enrolled per [[admin_refresh_audit_jul2026]]). So not
open — but the intended defense-in-depth layer is off, and has been shouting into the logs on
every deploy. ~~**Fix = one env var.**~~

> **RULED 2026-07-15 — do NOT set the var.** `docs/fable5/ai-platform-strategy/PLAN.md` D3: **drop
> `ADMIN_ALLOWED_IPS` entirely** rather than keep false confidence — remove the allowlist code and
> the boot warning, don't activate them. D4 closes the follow-on question `GLOBAL-READINESS.md` §3
> raised (allowlist vs SSO): **TOTP alone for `/admin`, no SSO** — solo operator, TOTP already
> enrolled, an identity provider adds a dependency and a failure mode for no gain at one admin.
> Revisit on the first admin hire. So the finding stands as *diagnosis*, but the fix inverted:
> deletion, not configuration.

### 4.2 — Meta/WhatsApp/Daraz webhooks unsigned, plus an `undefined === undefined` bypass

> **RESOLUTION 2026-07-16 (PLAN-V3 W0a2, `a4a65655`) — this finding SPLIT; it is neither wholly
> resolved nor wholly open. Do not cite "4.2" as a single status.**
> - **4.2a — the `undefined === undefined` bypass: FIXED.** The handshake now refuses when the
>   expected token is **unset** and compares in constant time. Live-verified: 403 with
>   `no_verify_token_configured`, where the old expression was demonstrated to evaluate `true`.
> - **4.2b — meta + whatsapp POSTs: FIXED.** Signature-verified fail-closed (401 + alerting record),
>   `x-hub-signature-256` = `sha256=` + **hex** HMAC-SHA256 over the raw body, keyed on an **app-level**
>   `META_APP_SECRET` — so verification runs *before* tenant resolution. Plus an activation guard: a
>   Meta channel cannot be connected while that secret is missing (it would otherwise look connected
>   in the hub and drop every delivery). Implementation: `services/meta-webhook.js`.
> - **4.2c — daraz POST: STILL OPEN, deferred to V4-3 by owner ruling.** Its inbound push contract is
>   unpublished and could not be pinned; guessing a format would fail-close a tenant's first real
>   webhook. Left at its pre-existing trust-the-payload behaviour — **the unauthenticated
>   order-injection exposure described below remains true for `/api/webhooks/daraz` only.**
>
> **The "not verified" caveat at the end of this section is now RESOLVED, and it decided the
> severity**: 0 tenants have an active channel `integration_settings` row (verified 2026-07-16 via
> Supabase; only `tenant_livetest1` has one, `is_active=false`). So this was
> hardening-before-anyone-connects, not a live-fire fix — which is exactly why getting Meta's format
> *right* mattered, and why guessing Daraz's was worse than waiting. The daraz gap and a WhatsApp
> idempotency gap found during the same step now sit behind **one shared trigger** in PLAN-V3:
> *before any tenant activates a channel integration*.
>
> One correction to this section's own premise: the aggregator verifier praised below as "the good
> pattern already exists in this file" is **not** a drop-in. It is **base64**, with
> aggregator-specific headers and a **per-tenant** secret; Meta is **hex** with an **app-level** one.
> Reusing it verbatim would have silently rejected every real Meta webhook. Reuse its *shape*
> (verify-before-process, constant-time, fail-closed + alert), never its algorithm — see the
> per-provider table in `backend/routes/CLAUDE.md`.

Verified split in `backend/routes/webhooks.js`:
- `/api/webhooks/xpay` (559) — `paymentGateway.verifyWebhook`, 400 on bad signature. ✅
- Aggregator webhooks (foodpanda/Careem, ~808) — HMAC **plus replay window**, fail-closed 401 +
  alert. ✅ The good pattern already exists in this file.
- `/api/webhooks/meta` (606), `/whatsapp` (674), `/daraz` (739) — `webhookLimiter` only, **no
  signature verification**. ❌

The Meta handler does `INSERT INTO web_orders ... ON CONFLICT DO UPDATE` and writes
`facebook_order_map` — unauthenticated order injection if the caller knows the page/commerce id
used for routing. Rate limiting stops volume, not forgery.

**The bypass** (`webhooks.js:598` and the WhatsApp twin at ~666):

```js
if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
```

Neither `META_WEBHOOK_VERIFY_TOKEN` nor `WHATSAPP_WEBHOOK_VERIFY_TOKEN` is set on Railway → right
side is `undefined`. Omit `hub.verify_token` from the request → left side is `undefined` too →
`undefined === undefined` is **true**. `GET /api/webhooks/meta?hub.mode=subscribe&hub.challenge=x`
returns 200 and echoes `x`. Anyone passes Meta webhook verification.

Lesser half of the problem (the POST needs no handshake anyway), but a clean example of absent
config silently becoming a comparison against `undefined`.

**Caveat — not verified**: whether any tenant actually has the Meta/WhatsApp/Daraz integration
configured. If none do, the routing lookup finds nothing and these no-op. That changes this from
"live hole" to "hole that opens the day someone connects a channel." Ties to
[[v03_food_service_open_gates]] (real sig header + test order before foodpanda/Careem go live).

### 4.3 — Manufacturer portal shares the employee JWT secret

`CUSTOMER_PORTAL_JWT_SECRET` **is set**. `MANUFACTURER_PORTAL_JWT_SECRET` is **not** →
`backend/middleware/manufacturer-auth.js:33` falls back to `JWT_SECRET` (the same secret signing
employee tokens), with a boot warning.

`backend/middleware/tenant-auth.js:92` verifies with `JWT_SECRET` and **never checks
`decoded.scope`** — it goes straight to `req.employee = { id: decoded.eid }`.

**It holds, but by accident.** The manufacturer payload is `{ mid, tid, tslug, scope, jti }` —
there is no `eid`. So `req.employee.id` = `undefined`, the permission load finds nothing, guarded
routes 403. The manufacturer side explicitly rejects wrong scopes (`manufacturer-auth.js:104`);
the employee side does no scope check at all.

**Residual**: `req.tenantId = decoded.tid` **does** get set from a manufacturer token, so tenant DB
context attaches before anything notices. Any route without a permission guard is reachable with a
manufacturer token today.

This is exactly the "customer-auth and manufacturer-auth have drifted apart" warning in
`backend/CLAUDE.md`, now with a live config gap behind it. **Two fixes, both cheap**: set the
secret, AND add a scope check to `loadTenantAndPerms`.

### 4.4 — `api.sanopos.com` is grey-cloud; the R2 proxy runs on origin

Cloudflare API, verified 2026-07-15:

```
api.sanopos.com  CNAME  proxied=False
```

**No CDN in front of the API.** `R2_PUBLIC_URL` is also unset, so `backend/utils/r2.js:71` routes
every asset URL through `{APP_PUBLIC_BASE_URL}/r2/{key}` — every product image, logo, and support
screenshot streams through the single Railway Node process from R2.

The proxy itself (`index.js:157`) is **well built**: prefix allowlist (`products/`, `company/`,
`support/`) with `backups/` deliberately excluded so pg_dump archives can't be fetched, a 1-year
`Cache-Control`, explicit cross-origin CORP. But it mounts **before** `globalLimiter` (line 181),
so it's unthrottled; and the 1yr cache only helps repeat visitors — every first view by every new
visitor = 1 Railway request + 1 R2 GET.

**Do NOT just flip the orange cloud.** `index.js` sets a trust-proxy hop count tuned for Railway's
proxies; putting Cloudflare in front adds a hop, which would quietly break client-IP detection and
therefore IP-based rate limiting. **The clean fix is the one `r2.js:68` already prefers**: point an
R2 custom domain (e.g. `cdn.sanopos.com`) at the bucket and set `R2_PUBLIC_URL`. Images bypass the
backend entirely, the proxy stops being load-bearing, and the API path is never touched.

### 4.5 — In-memory process state (breaks silently at 2+ instances)

Precise list — most `new Map()` hits in `services/` are function-local per-request and irrelevant.
Actual process-lifetime state:

| Where | What | Breaks at 2+ instances as |
|---|---|---|
| `routes/customer-display.js:13` | `displayStore` cart state | POS pushes to A, display polls B → blank screen |
| `services/alerting.js:16` | error-spike / DB-pressure windows + tenant Sets | counts split → thresholds never trip, alerts go silent |
| `services/menu-schedule-resolver.js:12` | per-outlet schedule cache | instances disagree on the active menu |

Plus the feature-flag, mode, and company-profile caches in the middleware layer — same shape.

All correct at one Railway instance. All fail **quietly** at two: no error, just wrong answers.
Worth enumerating deliberately *before* any horizontal scaling, not after.

---

## Part 5 — POSContext `navigate` bug (the original trigger)

`audit-docs` suggested: `navigate` is read from `usePOS()` in two components but never exposed on
the context value. **Confirmed true, line numbers accurate** — but the impact is mis-stated in both
directions.

`POSContext.jsx:80` declares `const navigate = useNavigate()`; its only uses are its own
`handleLogout` (841-843). The exported `value` object (963) has no `navigate` key and no spread
that could supply one — `navigate` appears exactly 3× in the file. Both consumers destructure it:
`POSLockScreen.jsx:13`, `POSSessionExpiredModal.jsx:12`.

- **Lock screen is effectively fine.** The button awaits `logout()` first, which ends with
  `setSession(null)` (`AuthProvider.jsx:179`); `/pos` is wrapped in `RequireAuth`
  (`publicRoutes.jsx:144`), which redirects to `/login` the moment `isAuthenticated` goes false.
  The throw lands after the redirect is committed, as an unhandled rejection. `main.jsx`'s
  `unhandledrejection` listener only reloads on chunk-load messages, so it's ignored. Net: Sentry
  noise, correct on-screen behavior.
- **Session-expired modal genuinely breaks.** `handleCancel` (46-50) does
  `setSessionExpired(false)` → `await parkSale()` → `navigate(...)`. No `logout()`, so
  client-side `isAuthenticated` stays true and `RequireAuth` never fires. The cashier hits Cancel,
  the sale parks, the modal closes, and they're left on a POS screen with a dead session and no
  redirect. Nothing masks it.

Already documented as a known gotcha in `frontend/src/pages/redesign/pos/CLAUDE.md` by the same
`8ea54848` docs-audit pass that raised the suggestion — the two are not independent confirmations.

Fix: add `navigate` to the value object (the file has a comment block near the top enumerating
every key that must stay exported — update it in the same edit). Not applied; reported only.

---

## Verification status

**Verified by source read** (working tree @ `8ea54848`): all route/middleware/config file:line
claims, the portal preset→tab map, the `navigate` bug, the KDS shell/breadcrumb finding, the
customer-display auth asymmetry, the webhook verification split, the `undefined === undefined`
comparison, the `requireAllowedIp` fail-open, the manufacturer JWT fallback + missing scope check,
the in-memory state list, the OG/prerender gap, the sitemap↔industries slug diff (zero drift).

**Verified by Railway variable NAMES** (values not dumped; `FRONTEND_URL`, `APP_PUBLIC_BASE_URL`,
`CORS_ORIGIN` read explicitly as non-secret): `ADMIN_ALLOWED_IPS` absent,
`MANUFACTURER_PORTAL_JWT_SECRET` absent, `CUSTOMER_PORTAL_JWT_SECRET` present,
`META_WEBHOOK_VERIFY_TOKEN` / `WHATSAPP_WEBHOOK_VERIFY_TOKEN` / `R2_PUBLIC_URL` / `APP_PUBLIC_URL`
absent.

**Verified by Cloudflare DNS API** (2026-07-15): `api.sanopos.com CNAME proxied=False`.

**NOT verified — check before acting**:
- ~~Whether any tenant has Meta/WhatsApp/Daraz configured (decides 4.2's real exploitability).~~
  **RESOLVED 2026-07-16: none do** — 0 active channel `integration_settings` rows (only
  `tenant_livetest1`, `is_active=false`). 4.2 was latent, not live. Re-verify before relying on it;
  it is the tripwire for V4-3/V4-4 (see PLAN-V3's shared trigger).
- Whether `/pay/:token` and `/gift-card/:code` carry `?tenant=` (affects OG middleware scope).
- Whether grey-cloud on `api.sanopos.com` is deliberate.
- Nothing was browser-verified, including the session-expired modal break.

## Recommended order

**Still current as of 2026-07-15** — `GLOBAL-READINESS.md` §6's competing order does not supersede
this one, because the global pivot it was conditional on was ruled direction-of-travel-only (D1).
Item 1 is amended by the D3/D4 rulings; the rest are unchanged.

1. ~~**`ADMIN_ALLOWED_IPS`** — one env var~~ → **AMENDED: delete it** (D3 — the fix is removal, not
   configuration; TOTP is the layer, per D4). See §4.1.
2. **`MANUFACTURER_PORTAL_JWT_SECRET`** + a scope check in `loadTenantAndPerms` — both cheap.
3. **Signature-verify meta/whatsapp/daraz** — before any tenant connects a channel.
4. **OG middleware** — product-visible; do the privacy split first.
5. **`R2_PUBLIC_URL` + R2 custom domain** — performance, not security.
6. **In-memory state** — only matters the day you scale horizontally.

`navigate` and the KDS chrome are small, contained, and independent of all of the above.
