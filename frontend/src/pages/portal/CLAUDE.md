# Portal Pages — Claude Guide

Customer-facing self-service portal, mounted at `/portal/:tenantSlug`. Fully self-contained: separate auth (`PortalAuthProvider` + `../../auth/customerPortalStore`), separate API client (`portalApi`), no main-app `useAuth`, no permissions system, no `ui/primitives`, no `useCurrency`. All UI is inline Tailwind; currency via `toLocaleString()`.

Tab visibility is server-driven: `PortalLayout` fetches `GET /api/portal/config` and passes `enabled_tabs` down via `<Outlet context>`. Never assume a tab/page is reachable — always check `enabledTabs` before wiring new nav or cross-links.

---

## `portalApi` (`../../api/portalApi.js`)

Named export `portalApi`: `get(slug, path, query?)`, `post(slug, path, data)`, `put(slug, path, data)`, `del(slug, path)`, `logout(slug)`.

- Every request appends `?tenant=<slug>` and sends `credentials: "include"` (httpOnly refresh cookie).
- Attaches `Authorization: Bearer <access_token>` from the slug-scoped session if present.
- **Auto-refresh on 401**: silently POSTs `/api/portal/auth/refresh`, retries the original request once. If the retry also 401s, clears the session and throws `Error("Session expired")`.
- Non-ok responses throw `Error(body.error || "HTTP N")` with `.status` and `.body` attached (matches `api.js` conventions).
- Exception: `PortalAppointments.jsx`'s booking modal uses raw `fetch()` against `API_BASE` directly for the public, unauthenticated `/api/public/bookings/config` and `/api/public/bookings/availability` endpoints (not portal-scoped, no auth needed).

---

## Auth (`PortalAuthProvider.jsx`)

Exports `PortalAuthProvider({ tenantSlug, children })` and `usePortalAuth()` (throws if used outside the provider).

- On mount, attempts a silent refresh (`POST /api/portal/auth/refresh`) if a stored session has an `access_token`, to rotate the refresh cookie and confirm the tenant is still active. Clears the session on failure.
- `usePortalAuth()` returns: `tenantSlug`, `session`, `customer` (`session.customer`), `accessToken`, `isAuthenticated`, `bootstrapping` (true until the silent refresh settles — gate redirects on this), `setSession(next)`, `logout()`.
- Session persistence goes through `customerPortalStore.js` (`readPortalSession`/`writePortalSession`/`clearPortalSession`), keyed per tenant slug (`customerPortalSession:${slug}`) — one browser can hold sessions for multiple tenant portals simultaneously.

---

## `PortalLayout.jsx`

Default export wraps `PortalShell` in `<PortalAuthProvider tenantSlug={slug}>`.

`PortalShell` (internal):
- Fetches `GET /api/portal/config` on mount → `{ enabled_tabs, portal_labels, branding, tenant }`. Shows an "Portal unavailable" error state if this fails.
- Auth guard (runs once `auth.bootstrapping` is false): unauthenticated + non-public path → redirect to `login`. Authenticated + public path → redirect to portal root. Public path segments: `login`, `signup`, `forgot`, `reset`, `verify-otp`.
- Renders sticky header (logo/store name/customer name-or-email/sign-out), a tab nav (only when authenticated — Dashboard always first, then `enabled_tabs` in order), and `<Outlet context={{ config, enabledTabs, labels, storeName, tenantSlug }}>`.
- Known tab keys (path segment = key, all flat under `/portal/:slug/`): `invoices`, `orders`, `appointments`, `subscriptions`, `contracts`, `tickets`, `loyalty`, `wallet`, `profile`, `stays`, `treatments`. Only `invoices`, `orders`, `appointments`, `loyalty`, `profile`, `treatments`, `stays`, `wallet` currently have page components in this directory — `subscriptions`, `contracts`, `tickets` are recognized tab keys with no corresponding page yet.

---

## Auth pages (public, no session required)

### `PortalLogin.jsx`
Two modes toggled in-page: password (`POST /api/portal/auth/login` with `{ email, password }`) and OTP (`POST /api/portal/auth/request-otp` with `{ email, purpose: "login" }` → navigates to `verify-otp`). Fetches `GET /api/portal/config` on mount just to build a dynamic subtitle listing enabled tabs (fails open to a default subtitle). Password success calls `auth.setSession(res)` and navigates to portal root.

### `PortalSignup.jsx`
`POST /api/portal/auth/signup` with `{ name, email, mobile, password }`. On success navigates to `verify-otp?email=...&purpose=email_verify` (does NOT auto-login — verification is required first).

### `PortalOtpVerify.jsx`
Reads `?email=` and `?purpose=` (`login` default). `purpose=email_verify` → `POST /api/portal/auth/verify-email`; otherwise → `POST /api/portal/auth/verify-otp` with `{ email, code, purpose: "login" }`. Either path calls `auth.setSession(res)` on success and navigates to portal root. "Resend code" re-posts `/api/portal/auth/request-otp`.

### `PortalForgotPassword.jsx`
`POST /api/portal/auth/request-password-reset` with `{ email }`. Always shows a generic confirmation (no user-enumeration signal).

### `PortalResetPassword.jsx`
Reads `?token=`. `POST /api/portal/auth/reset-password` with `{ token, password }`. Redirects to login after a 2.5s delay on success. Shows an error state (no form) if `token` is missing.

---

## Authenticated pages

### `PortalDashboard.jsx`
Home screen. Reads `{ labels, storeName, enabledTabs }` via `useOutletContext()`. Fires up to 3 parallel fetches:
- Always: `GET /api/portal/me/invoices` → outstanding balance = sum of `balance_due` where `status` not in `paid`/`void`.
- If `enabledTabs` includes `appointments`: `GET /api/portal/me/appointments?scope=upcoming`.
- If `enabledTabs` includes `loyalty`: `GET /api/portal/me/loyalty`.

Renders conditional cards (invoices/appointments/loyalty) each linking to the matching tab. Greeting uses `labels.dashboard_heading || "Welcome back"`.

### `PortalInvoices.jsx`
List with client-side status filter (all/unpaid/partial/overdue/paid). Fetches `GET /api/portal/me/invoices`. Each row links to `PortalInvoiceDetail`.

### `PortalInvoiceDetail.jsx`
Params: `:tenantSlug`, `:invoiceId`. Fetches `GET /api/portal/me/invoices/:invoiceId` → `{ invoice_number, status, balance_due, items[], payments[] }`.

"Pay now" (shown when status not `paid`/`void` and `balance_due > 0`) posts `POST /api/portal/me/invoices/:invoiceId/pay` (no body) → `window.location.href = res.checkout_url`. Gateway redirects back to `invoice-paid?invoice=:id`.

### `PortalInvoicePaidPage.jsx`
Post-payment confirmation. Reads `?invoice=` from query params (errors immediately if missing). Polls `GET /api/portal/me/invoices/:id` every 1500ms (`POLL_INTERVAL_MS`) for up to 8 attempts (`MAX_POLLS`). Success condition: `status === "paid"` OR `Number(balance_due) === 0`. States: `polling` → `paid` | `timeout` | `error`.

### `PortalAppointments.jsx`
Fetches `?scope=upcoming` and `?scope=past` in parallel via `GET /api/portal/me/appointments`. Cancel: `PUT /api/portal/me/appointments/:id/cancel` with `{ reason }` (uses `window.confirm`). Includes two modals:
- **BookingModal**: uses raw `fetch()` (not `portalApi`) against public `GET /api/public/bookings/config?tenant=` and `GET /api/public/bookings/availability?tenant=&service_id=&date=` to pick service/date/slot, then submits via `portalApi.post(..., "/api/portal/me/appointments", { service_id, start_at, employee_id, notes })`.
- **RescheduleModal**: `PUT /api/portal/me/appointments/:id/reschedule` with `{ start_at }` (ISO string from a `datetime-local` input; UI note says must be ≥15 min from now — not enforced client-side beyond the hint text).

### `PortalOrders.jsx`
Fetches `GET /api/portal/me/order-history` (unified web + in-store order list, each row has a `source: "web"|"in-store"` field and composite key `${source}:${id}`). "Reorder" button posts `POST /api/portal/me/reorder` with `{ source, order_id }` → response includes `redirect_url` (storefront cart adopts the cart via a `?adopt=` query param) and optionally `items_added`/`items_skipped[]` (shown as a notice banner, including on partial failure via `err.body.items_skipped`).

### `PortalLoyalty.jsx`
Fetches `GET /api/portal/me/loyalty` → `{ loyalty_points, total_spend, tier }`. Read-only; redemption instructions point to in-store checkout.

### `PortalProfile.jsx`
Fetches `GET /api/portal/me` + `GET /api/portal/me/addresses` in parallel (address fetch swallows errors → `[]`). Editable fields: name, mobile, address, city, date_of_birth, gender, preferred_contact, email/sms/whatsapp consent checkboxes. Save: `PUT /api/portal/me` with the whole form. Address delete: `DELETE /api/portal/me/addresses/:id` (uses `window.confirm`) then reloads both fetches.

### `PortalTreatments.jsx`
Clinical treatment plan viewer, two-level UI (list → drill-down, no routing — just local state).

- **List**: `GET /api/portal/me/treatment-plans` → `res.plans`. Shows title, plan_number, subject_name, provider_name, sessions_completed/total_sessions_planned, status.
- **Detail**: `GET /api/portal/me/treatment-plans/:planId`. Renders 6 sections from the response: Sessions (SOAP `soap_subjective`, session_number, status, provider, scheduled_at), Prescriptions (medication_name, strength, dosage, frequency, duration, instructions), Chart (`chart_entries[]`: area_code, condition_code, severity, notes — table), Lab Results (`lab_orders[]`: test_name, lab_vendor, status, result_received_at, result_summary), Consent Documents (`consents[]`: title, signed_by_name/relation/at, `document_pdf_url` link), Shared Documents (`documents[]`: title, file_url, document_type — section only rendered if non-empty). Also shows an invoice reference block if `detail.plan.invoice_number` is set, with a balance_due warning.
- "Back to plans" just clears local `selected`/`detail` state — no re-fetch of the list.

### `PortalStays.jsx`
Hotel/hospitality stay history. Fetches `GET /api/portal/me/stays` → `data.stays[]`. Client-side filter: All / Upcoming (`check_in_date >= now` and `status !== "cancelled"`) / Past (`check_out_date < now` or `status === "checked_out"`). Columns: booking number, room (number · type), status badge, check-in/out dates (+nights), `folio_grand_total`, invoice link (only when `stay.invoice_id` is set, links to `PortalInvoiceDetail`).

### `PortalWallet.jsx`
Fetches `GET /api/portal/me/wallet` → `{ balance, ledger[] }`. Top-up: toggled inline amount input → `POST /api/portal/me/wallet/top-up-intent` with `{ amount }` → `window.location.href = res.checkout_url`. Ledger rows show date, `note || reference_type`, signed amount (`type === "credit"` → emerald `+`, else red `−`).

---

## Gotchas

- **Don't confuse `PortalInvoiceDetail`'s pay endpoint** (`/pay`) with `PortalWallet`'s / `PortalOrders`' checkout-intent-style endpoints (`/wallet/top-up-intent`) — they're not the same pattern; check the actual route file (`backend/routes/...portal...`) before assuming a naming convention.
- Every payment-initiating flow here (invoice pay, wallet top-up) follows redirect-to-gateway, not inline card entry — always `window.location.href = res.checkout_url`, never render a card form.
- `PortalOrders.jsx` is the only page that crosses into the storefront (`redirect_url` handoff via `?adopt=` cart token) — if working on storefront cart adoption, this is the other end of that handshake.
- Several pages use `window.confirm`/`alert` for destructive actions (cancel appointment, delete address) instead of the toast/modal system used elsewhere in the app — this is intentional isolation from `ui/primitives`, not an oversight to "fix" by importing app-level UI.
- Session bootstrap ordering: always check `auth.bootstrapping` before treating `isAuthenticated === false` as a real logged-out state — a false negative during the silent-refresh window causes a login-page flash/redirect loop if ignored.
