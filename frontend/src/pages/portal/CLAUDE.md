# Portal Pages — Claude Guide

- **18 files** — customer-facing self-service portal at `/portal/:tenantSlug`
- All API calls use `portalApi` from `../../api/portalApi` (not the main `api.js`). `portalApi` attaches the portal JWT automatically, appends `?tenant=<slug>` to every request, and handles silent refresh on 401.
- Auth is fully self-contained: `PortalAuthProvider` + `../../auth/customerPortalStore`. No main-app `useAuth`, no permissions system.
- Tab visibility is server-driven: `PortalLayout` fetches `GET /api/portal/config` and passes `enabled_tabs` array down via `<Outlet context>`. Pages should not assume a tab is available.
- No `ui/primitives`, no `useCurrency` — all UI is inline Tailwind, currency via `toLocaleString()`.

---

## `portalApi` (at `../../api/portalApi.js`)

Named export `portalApi` object with methods:

| Method | Signature | Notes |
|--------|-----------|-------|
| `portalApi.get` | `(slug, path, query?)` | Appends `?tenant=slug` + optional query params |
| `portalApi.post` | `(slug, path, data)` | JSON body |
| `portalApi.put` | `(slug, path, data)` | JSON body |
| `portalApi.del` | `(slug, path)` | DELETE |
| `portalApi.logout` | `(slug)` | `POST /api/portal/auth/logout` + clears session |

**Auto-refresh on 401:** On any 401 during a data call, `portalApi` silently calls `POST /api/portal/auth/refresh` with the httpOnly cookie, then retries the original request once. If retry also 401s, clears session and throws `"Session expired"`. All portal fetches use `credentials: "include"` for the httpOnly refresh cookie.

---

## `PortalLayout.jsx`

Root layout. Default export wraps `PortalShell` in `<PortalAuthProvider tenantSlug={slug}>`.

**`PortalShell` (internal component):**
- Fetches `GET /api/portal/config` on mount — provides `enabled_tabs`, `portal_labels`, `branding`, tenant name/logo.
- Auth guard (fires after `auth.bootstrapping` is false): unauthenticated users on non-public paths → `navigate(/portal/${slug}/login)`. Authenticated users on public paths → `navigate(/portal/${slug})`.
- Public paths that bypass auth guard: `login`, `signup`, `forgot`, `reset`, `verify-otp`.
- Tab nav only rendered when `auth.isAuthenticated`. Dashboard always shown first; `enabled_tabs` drive remaining tabs.
- Renders: sticky header (logo/store name/customer email/sign-out) → tab nav → `<Outlet context={{ config, enabledTabs, labels, storeName, tenantSlug }}>`.
- Error state: "Portal unavailable" shown if config fetch fails.

**Known tab keys and their paths:**

| Key | Path segment |
|-----|-------------|
| `invoices` | `invoices` |
| `orders` | `orders` |
| `appointments` | `appointments` |
| `subscriptions` | `subscriptions` |
| `contracts` | `contracts` |
| `tickets` | `tickets` |
| `loyalty` | `loyalty` |
| `wallet` | `wallet` |
| `profile` | `profile` |
| `stays` | `stays` |
| `treatments` | `treatments` |

---

## `PortalAuthProvider.jsx`

Exports `PortalAuthProvider` component and `usePortalAuth()` hook. Throws if `usePortalAuth()` called outside provider.

On mount: attempts a silent refresh via `POST /api/portal/auth/refresh`. On success session is rotated; on failure stored session is cleared.

**`usePortalAuth()` returns:**

| Field | Type | Notes |
|-------|------|-------|
| `tenantSlug` | string | From props |
| `session` | object\|null | Full session object |
| `customer` | object\|null | `session.customer` |
| `accessToken` | string\|null | `session.access_token` |
| `isAuthenticated` | boolean | `!!session?.access_token` |
| `bootstrapping` | boolean | True until silent refresh resolves — guard against premature redirects |
| `setSession(next)` | function | Persists + updates session via `writePortalSession` |
| `logout()` | async function | Calls `portalApi.logout`, clears session state |

---

## Auth Pages (public, no session required)

### `PortalLogin.jsx`
Two modes on the same page: email+password (`POST /api/portal/auth/login`) and OTP magic-link (`POST /api/portal/auth/request-otp` → redirects to `verify-otp`). Calls `auth.setSession()` on password login success. OTP flow redirects to `verify-otp` page.

### `PortalSignup.jsx`
Self-registration. `POST /api/portal/auth/signup`. Calls `auth.setSession()` and navigates to portal root on success.

### `PortalOtpVerify.jsx`
OTP code entry. Reads `?email=` and `?purpose=` from query params. `purpose=login` completes auth via `POST /api/portal/auth/verify-otp`. Resend CTA re-posts to `POST /api/portal/auth/request-otp`.

### `PortalForgotPassword.jsx`
Email input → `POST /api/portal/auth/request-password-reset`. Shows confirmation message after submit.

### `PortalResetPassword.jsx`
Reads `?token=` from query string → `POST /api/portal/auth/reset-password`. Navigates to login on success.

---

## `PortalDashboard.jsx`

Home screen after login. Uses `useOutletContext()` for `{ labels, storeName, enabledTabs }`.

Fires up to 3 fetches in `Promise.all`:
- Always: `GET /api/portal/me/invoices` → computes outstanding balance (sum of `balance_due` on non-paid/non-void invoices)
- If `appointments` in `enabledTabs`: `GET /api/portal/me/appointments?scope=upcoming`
- If `loyalty` in `enabledTabs`: `GET /api/portal/me/loyalty`

Cards shown conditionally by `enabledTabs`:
- `invoices` → Outstanding Balance card → `/portal/{slug}/invoices`
- `appointments` → Next Appointment card (first from upcoming list) → `/portal/{slug}/appointments`
- `loyalty` → Loyalty Points + tier name → `/portal/{slug}/loyalty`

Greeting uses `labels.dashboard_heading || "Welcome back"` + `auth.customer?.name`.

---

## `PortalInvoices.jsx`

Filterable invoice list (All / Unpaid / Paid). Fetches `GET /api/portal/me/invoices`. Each row links to `PortalInvoiceDetail`.

---

## `PortalInvoiceDetail.jsx`

Single invoice view. Params: `:tenantSlug`, `:invoiceId`. Fetches `GET /api/portal/me/invoices/:invoiceId`.

Pay CTA: `POST /api/portal/me/invoices/:invoiceId/pay-intent` → `window.location.href = res.checkout_url`. Gateway redirects back to `.../invoice-paid?invoice=:id` after payment.

---

## `PortalInvoicePaidPage.jsx`

Post-payment confirmation page. Reads `?invoice=` from query params.

Polls `GET /api/portal/me/invoices/:id` every **1500ms** for up to **8 attempts** (`MAX_POLLS = 8`, `POLL_INTERVAL_MS = 1500`). Success condition: `inv.status === "paid"` OR `Number(inv.balance_due) === 0`. Shows 4 states: `polling` (confirming), `paid` (success + link to invoice), `timeout` (still processing after max polls), `error` (missing invoice param).

---

## `PortalAppointments.jsx`

Upcoming and past appointments fetched in parallel (`?scope=upcoming` + `?scope=past`). Includes inline book-new-appointment form → `POST /api/portal/me/appointments` (collects service, date/time, notes).

---

## `PortalOrders.jsx`

Order history list. Fetches `GET /api/portal/me/orders`. Read-only.

---

## `PortalLoyalty.jsx`

Points balance, current tier, tier progress bar. Fetches `GET /api/portal/me/loyalty`.

---

## `PortalProfile.jsx`

Account info + address management. Fetches `GET /api/portal/me` and `GET /api/portal/me/addresses` in parallel. Allows editing name/phone and managing address records.

---

## `PortalTreatments.jsx`

Clinical treatment plan viewer. Two-level UI — list then drill-down.

**List level:** `GET /api/portal/me/treatment-plans` → `res.plans`. Each plan shows: title, plan_number, subject_name, provider_name, sessions_completed/total_sessions_planned, status. Click → loads detail.

**Detail level:** `GET /api/portal/me/treatment-plans/:planId`. Shows 6 sections:
1. Sessions — SOAP notes (subjective field), session number, status, provider, scheduled_at
2. Prescriptions — medication_name, strength, dosage, frequency, duration, instructions
3. Chart — `detail.chart_entries[]`: area_code, condition_code, severity, notes (table format)
4. Lab Results — `detail.lab_orders[]`: test_name, lab_vendor, status, result_received_at, result_summary
5. Consent Documents — `detail.consents[]`: title, signed_by_name/relation/at, document_pdf_url link
6. Shared Documents — `detail.documents[]`: title, file_url link, document_type (only rendered if non-empty)

Also shows invoice section if `detail.plan.invoice_number` is set (with balance_due warning if > 0).

"Back to plans" button resets `selected`/`detail` to null — returns to list without re-fetching.

---

## `PortalStays.jsx`

Hotel/hospitality stay history. Fetches `GET /api/portal/me/stays` → `data.stays[]`.

Client-side filter: All / Upcoming (`check_in_date >= now` AND `status !== "cancelled"`) / Past (`check_out_date < now` OR `status === "checked_out"`).

Columns: Booking (booking_number or #id), Room (room_number · room_type_name), Status badge, Check-in, Check-out (with nights count), Folio (folio_grand_total), Invoice link (to PortalInvoiceDetail when `stay.invoice_id` set).

Status badge colors: `checked_in`=emerald, `confirmed`=blue, `pending`=amber, `checked_out`=slate, `cancelled`=red.

---

## `PortalWallet.jsx`

Wallet balance + top-up flow. Fetches `GET /api/portal/me/wallet` → `{ balance, ledger[] }`.

Top-up: inline amount input (toggle button to show/hide) → `POST /api/portal/me/wallet/top-up-intent` with `{ amount }` → `window.location.href = res.checkout_url`.

Ledger list: date + `l.note || l.reference_type`, amount with +/− prefix. `type === "credit"` = emerald, else = red-600.
