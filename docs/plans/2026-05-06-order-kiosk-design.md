# Customer Order Kiosk — Design

**Date**: 2026-05-06
**Status**: Designed, ready for implementation plan
**Sequencing**: Ships **after** the sidebar regroup PR (`2026-05-06-sidebar-regroup-design.md`), so the new "Order Kiosks" entry lands into the already-tidied Restaurant group.
**Estimated size**: ~150 LOC backend + ~250 LOC frontend + ~200 LOC tests. Half a day of focused work.

## Why

Restaurant tenants currently have no way to deploy a tablet for customer self-service ordering — at a counter (juice shops, fast food) or at each table (full-service restaurants). The codebase contains a half-built attempt:

- `frontend/src/pages/redesign/KioskOrderingRedesign.jsx` exists with a working UI shell
- Its route `/kiosk` (registered at `frontend/src/routes/appRoutes.jsx:256`) is **shadowed** by the attendance kiosk in `frontend/src/routes/publicRoutes.jsx:136` — React Router takes the first declared match, so the attendance kiosk wins and the ordering kiosk is unreachable
- The three backend endpoints it calls (`/api/restaurant/kiosk/categories`, `/products`, `/orders`) **do not exist anywhere on the backend**
- No code anywhere in the repo navigates to or links the ordering kiosk

The actual customer-facing QR-menu flow that *does* work today lives at a different path: `/menu/:token` served by `frontend/src/pages/public/PublicRestaurantMenuPage.jsx`, backed by `backend/routes/public-restaurant.js`. Customers scan a per-table QR code and add items to a draft check; staff then manually accept the order from the Restaurant Inbox, which calls `sendToKitchen()` from `backend/services/restaurant-kds.js`.

This design **resurrects the customer ordering kiosk by reusing that working `/menu/:token` flow** rather than building parallel kiosk-specific endpoints. The half-built `KioskOrderingRedesign.jsx` is deleted, not finished.

## Use cases supported

- **Counter mode**: takeaway / quick-service. Tablet at counter, no table involved. Customer taps menu, places order, gets a counter number, pays at counter when collecting. Order lands in the Restaurant Inbox; staff Accept fires it to the kitchen via the existing `sendToKitchen()` path. Best fit for juice shops, fast food, food trucks, cafés.
- **Table mode**: full-service restaurants. Tablet at each table, pre-configured. Customer browses menu, places order — items go onto a check tied to that table session. Server reviews and fires from the Checks page (existing flow). Best fit for casual dining and full-service restaurants.

Both modes use the same `PublicRestaurantMenuPage` surface; the difference is whether the token is bound to a `restaurant_tables` row or has `table_id IS NULL` (counter).

## Decisions locked during brainstorm

| Decision | Choice |
|---|---|
| Auth model | Public + URL token (`/menu/:token`), gated by `phase4_restaurant_qr` flag, rate-limited per IP |
| Backend approach | Reuse `routes/public-restaurant.js`. Add three thin endpoints; no parallel kiosk-specific endpoints. |
| Frontend approach | Delete `KioskOrderingRedesign.jsx`, `KioskOrderingRoute.jsx`, and the shadow route in `appRoutes.jsx:256`. Existing `PublicRestaurantMenuPage` becomes the kiosk surface, with a "Place Order" CTA + post-submit auto-reset. |
| Launcher location | New "Order Kiosks" page under the Restaurant nav group |
| Token lifecycle | Never expire, manager-revocable |
| Counter tokens | Per-outlet (one token shared across all counter tablets at that outlet) |
| Table tokens | Per-table (one token per `restaurant_tables` row) |
| Counter→KDS routing | Lands in Restaurant Inbox; staff Accept fires to KDS via existing `sendToKitchen()` (matches `services/online-inbox.js:153`). No public fire-to-kitchen endpoint. |
| Table→KDS routing | Lands as check tied to table session; server fires from Checks page (existing flow) |
| Payment | Out of scope. Counter = pay at counter when collecting. Table = pay at end of meal via existing `/pay/:token` or server. |

## Source-level investigation findings

Verified directly against source (not CLAUDE.md):

1. **Token storage** is `draft_orders.source_token_id` (`backend/schema-pg.sql:3140-3154`). Column is nullable; UNIQUE partial index `WHERE source_token_id IS NOT NULL`. Tokens are generated as `crypto.randomUUID()` in `backend/services/restaurant-checks.js:14-20` for `dine_in` and `bar` contexts.
2. **Tokens are reusable** — customers can add items repeatedly; nothing single-use about them.
3. **`POST /api/public/restaurant/checks/:token/items`** at `backend/routes/public-restaurant.js:74-131` appends items to the draft order indefinitely. **There is no auto-fire to kitchen.**
4. **`GET /api/public/restaurant/menu/:token`** at `backend/routes/public-restaurant.js:11-72` uses an INNER JOIN on `restaurant_tables`. **Counter mode (table_id IS NULL) returns 404 today.** Need LEFT JOIN.
5. **Restaurant Inbox auto-fires on Accept** — `backend/routes/restaurant-inbox.js:36` calls `sendToKitchen()` via `backend/services/online-inbox.js:153`. This is the existing checkpoint and remains the trigger for kiosk orders.
6. **`PublicRestaurantMenuPage.jsx`** (`frontend/src/pages/public/PublicRestaurantMenuPage.jsx`) currently has no "Place Order" button or confirmation screen — items just accumulate with toast feedback. Tablet ergonomics are good (full-screen, large tap targets).

## Backend changes

### 1. LEFT JOIN fix for counter-mode menu fetch

**File**: `backend/routes/public-restaurant.js:18-24`

Change `JOIN restaurant_tables` to `LEFT JOIN restaurant_tables`. The endpoint must work for tokens with `table_id IS NULL`. Returned `table_label` becomes nullable; frontend handles the null gracefully.

### 2. Token mint / list / revoke endpoints

**File**: new section in `backend/routes/public-restaurant.js`, OR new file `backend/routes/restaurant-kiosk.js` mounted **inside** tenant middleware (manager creates these while logged in)

- `POST /api/restaurant/kiosk-tokens`
  Body: `{ outlet_id, table_id?: null, label? }`
  Action: insert a `draft_orders` row with `status='open'`, `source_token_id=randomUUID()`, `table_id` from body or NULL, `order_context = 'kiosk_counter'` (when table_id NULL) or `'dine_in'` (when table_id present), `outlet_id` validated against tenant.
  Returns: `{ token, url }` where `url = ${FRONTEND_BASE}/menu/${token}`.
- `GET /api/restaurant/kiosk-tokens?outlet_id=N`
  Returns: list of open kiosk-context draft_orders for the outlet, with table info if any.
- `DELETE /api/restaurant/kiosk-tokens/:tokenId`
  Soft-revokes by setting `status='cancelled'`. The UNIQUE partial index allows new tokens to be issued for the same table afterwards.

All three gated by `phase4_restaurant_qr` flag + `manage_restaurant` perm.

### 3. Place Order endpoint

**File**: `backend/routes/public-restaurant.js`, mounted before tenant middleware (it's public)

- `POST /api/public/restaurant/checks/:token/submit`
  Action:
  - Look up the draft order by token (must be `status='open'`)
  - For **counter-mode tokens** (`order_context = 'kiosk_counter'`):
    - Set `submitted_at = NOW()` on the draft order so the Inbox query picks it up
    - Mint a fresh `source_token_id` on a new draft order so the next customer can place an order from the same tablet (the same URL works because the new token replaces the old one in the lookup)
    - Wait — that's wrong. The URL is per-token, not per-tablet. Re-think: the **launcher table row holds the "active" token for that counter slot**. Submitting closes the current draft and opens a new one with the same `outlet_id`/null `table_id`, and the launcher page's "current URL" updates to the new token. **Tablet bookmark must point to a stable URL that resolves to "current open counter token for outlet N."** This is a meaningful design refinement — captured in "Open question 1" below.
  - For **table-mode tokens**: set `submitted_at = NOW()` so the order shows up in the Inbox and on the Checks page; the existing draft remains open so additional items can be added (matching today's behavior where multiple courses get added to one check).
  - Return `{ order_number, items, total }` for counter mode, `{ check_id, total }` for table mode.

This endpoint does NOT call `sendToKitchen()`. The Restaurant Inbox Accept action remains the kitchen trigger.

### 4. Inbox surfacing

**File**: `backend/routes/restaurant-inbox.js`

Confirm the inbox query includes draft orders with `order_context = 'kiosk_counter'` (and `submitted_at IS NOT NULL` so unsubmitted drafts don't pollute the inbox). If it filters by `source_channel`, add `'kiosk'` to the allowed list. Verify during implementation; small change.

### 5. Rate limiting

`app.use("/api/public/restaurant", publicLimiter)` if not already in place. 60 requests/min per IP for the customer-facing endpoints. Manager-facing token endpoints inherit the global limiter.

### Open question 1 — counter-mode tablet URL stability

**Issue**: A tablet at the counter has a URL bookmarked. If submitting an order rotates the token, the bookmark goes stale.

**Resolution options to evaluate during implementation planning**:

- **A. Stable per-outlet URL like `/order-kiosk/counter/<outlet-token>`** that resolves server-side to the currently-open counter token. Most stable; requires a small redirect endpoint.
- **B. Don't rotate the token on submit**. Keep the same token, mark items as submitted. Then re-use the same draft for the next customer. Simpler but means the draft accumulates state across customers; needs schema thinking.
- **C. Rotate token, but the launcher page URL is bookmarked, which redirects to current**. Same as A in effect.

The implementation plan must pick one. **Tentative recommendation: A** (stable URL with server-side resolution).

## Frontend changes

### 1. Delete dead code

- Remove the route registration `frontend/src/routes/appRoutes.jsx:256` (`<Route path="/kiosk" element={wrap(KioskOrderingRoute)} />`)
- Delete `frontend/src/pages/KioskOrderingRoute.jsx`
- Delete `frontend/src/pages/redesign/KioskOrderingRedesign.jsx`
- Remove the lazy import for `KioskOrderingRoute` at `appRoutes.jsx:103`

### 2. Modify `frontend/src/pages/public/PublicRestaurantMenuPage.jsx`

- Add a sticky **"Place Order"** CTA at the bottom of the cart panel, posting to `POST /api/public/restaurant/checks/:token/submit`
- Add a **confirmation screen** — counter mode shows the order number large, with a 5-second auto-reset to the menu; table mode shows "Sent to your server, please wait" and stays until the customer manually returns to the menu (covers the case where the customer keeps adding courses)
- **Suppress the "Table:" label** when `table_label` is null (counter mode shows just the company name and menu)
- Verify tablet ergonomics: full-screen at 1024×768 and 1280×800, all tap targets ≥ 44×44 pixels (already mostly satisfied per source review)

### 3. New page: `frontend/src/pages/redesign/OrderKiosksRedesign.jsx`

The launcher page where managers create / list / revoke kiosk tokens. Visible to restaurant-mode tenants only.

Layout:

- **Header** with "Order Kiosks" title and brief description ("Set up tablets at your counter or each table. Customers tap to order; orders land in the Restaurant Inbox for staff to accept.")
- **Outlet picker** at the top — defaults to current context outlet, can switch
- **Two action buttons**: "Launch Counter Kiosk" (one per outlet, replaces existing if any), "Launch Table Kiosk" (opens table picker → mints new token)
- **Table** with columns: Type (Counter / Table N) | Outlet | Created | URL | Actions (Copy URL, Revoke)
- **Empty state** when no tokens exist for the selected outlet

Routing:

- `frontend/src/pages/OrderKiosksRoute.jsx` — 3-line lazy wrapper
- Add to `frontend/src/routes/appRoutes.jsx`: `<Route path="/order-kiosks" element={perm("manage_restaurant", wrap(OrderKiosksRoute))} />`

### 4. Sidebar entry

In `frontend/src/ui/nav-config.js`, add to the Restaurant group:

```js
{
  name: "Order Kiosks",
  path: "/order-kiosks",
  icon: Monitor,
  requiredFlag: "phase4_restaurant_qr",
  requiredPerm: "manage_restaurant",
  requiredMode: "restaurant"
}
```

The triple gate (flag + perm + mode) ensures retail / clinic / hotel tenants and managers without `manage_restaurant` perm never see this entry. Filter logic at `frontend/src/components/AppLayoutRedesign.jsx:92-98` ANDs all three gates.

## Critical files

To read **before** implementing:

- `backend/routes/public-restaurant.js` (~131 lines, primary edit target)
- `backend/services/restaurant-kds.js:335,493` (`sendToKitchen` — reuse, do not duplicate)
- `backend/services/online-inbox.js:153` (reference for how Accept-from-Inbox calls sendToKitchen)
- `backend/services/restaurant-checks.js:14-20` (token generation pattern, reuse `crypto.randomUUID()`)
- `backend/schema-pg.sql:3140-3154` (`draft_orders.source_token_id` column + UNIQUE partial index)
- `backend/routes/restaurant-inbox.js` (verify the Inbox query picks up kiosk submissions)
- `frontend/src/pages/public/PublicRestaurantMenuPage.jsx` (the surface that becomes the kiosk)
- `frontend/src/components/AppLayoutRedesign.jsx:79-99` (nav filter logic — verify gate semantics)
- `frontend/src/ui/nav-config.js` (Restaurant group, after the sidebar regroup PR ships)
- `frontend/src/routes/appRoutes.jsx:103,256,284` (delete shadow route + add new kiosk route)

## Out of scope

- **Payment-at-kiosk** (terminal integration) — separate Phase 5+ feature
- **Customer login / loyalty on kiosk orders** — kiosk stays anonymous
- **Receipt printing from kiosk** — staff-side prints handle this today
- **Multi-language menu** — separate i18n project
- **Per-tenant kiosk theming** — keep it brand-neutral for v1
- **Per-tablet token diagnostics** — counter mode is per-outlet only; per-tablet adds knobs nobody asked for

## Verification

1. **Backend integration tests**: `npx vitest run backend/tests/integration/<new-kiosk-test>` — covers token mint, list, revoke; public submit endpoint counter+table modes; LEFT JOIN counter-mode menu fetch returns 200 with null `table_label`
2. **Frontend Playwright**: new spec `frontend/tests/order-kiosk.spec.js` — full flow: log in, navigate to Order Kiosks, launch counter kiosk, copy URL, open URL in new context (logged-out), browse menu, add items, place order, verify confirmation screen and auto-reset, then return to admin and verify the order appears in Restaurant Inbox
3. **Manual end-to-end on `livetest1`**: in admin, flip `phase4_restaurant` + `phase4_restaurant_qr` flags, change preset to `restaurant`, set up a few tables. Walk through Order Kiosks page → launch counter kiosk → open URL → place order → see it in Inbox → click Accept → verify it appears on KDS.
4. **Inbox visibility check**: manually submit a counter-mode order via curl, then GET the inbox endpoint and confirm the order appears with the right `source_channel`/`order_context`.

## Risk

Medium. Touches public endpoints (rate-limit posture matters), modifies a SQL JOIN that current tests rely on (regression risk on existing QR-menu flow), and adds new database state via tokens. Mitigations:

- Sidebar PR ships first, so this PR's diff is smaller and reviewer attention isn't split
- Existing QR-menu integration tests (`backend/tests/integration/pg-batch13-restaurant.test.js`) cover the LEFT JOIN change — must remain green
- Public submit endpoint is rate-limited and inbox-gated, so abuse impact is "staff sees junk in inbox," not "kitchen wastes food"
- `phase4_restaurant_qr` is the kill switch — flag off = entire feature dormant, no migrations to roll back
