# Portal Pages — Claude Guide

- **18 files** — customer-facing self-service portal at `/portal/:tenantSlug`
- All API calls use `portalApi` from `../../api/portalApi` (not the main `api.js`). `portalApi` attaches the portal JWT automatically and routes to the correct tenant.
- Auth is fully self-contained: `PortalAuthProvider` + `../../auth/customerPortalStore`. No main-app `useAuth`, no permissions system.
- Tab visibility is server-driven: `PortalLayout` fetches `GET /api/portal/config` and passes `enabled_tabs` array down via `<Outlet context>`. Pages should not assume a tab is available.
- No `ui/primitives`, no `useCurrency` — all UI is inline Tailwind, currency via `toLocaleString()`.

---

## `PortalLayout.jsx`

Root layout. Default export wraps `PortalShell` in `<PortalAuthProvider>`.

`PortalShell` (internal component):
- Fetches `GET /api/portal/config` on mount — provides `enabled_tabs`, `portal_labels`, `branding`, tenant name/logo.
- Auth guard: unauthenticated users redirect to `.../login`; authenticated users on public paths redirect to portal root.
- Renders: sticky header (logo/store name/sign-out) → tab nav → `<Outlet context={{ config, enabledTabs, labels, storeName, tenantSlug }}>`.
- Public paths that bypass auth guard: `login`, `signup`, `forgot`, `reset`, `verify-otp`.

Known tabs and path segments: `invoices`, `orders`, `appointments`, `loyalty`, `wallet`, `profile`, `stays`, `treatments`, `subscriptions`, `contracts`, `tickets`.

---

## `PortalAuthProvider.jsx`

Exports `PortalAuthProvider` component and `usePortalAuth()` hook.

On mount: attempts a silent refresh via `POST /api/portal/auth/refresh`. On success session is rotated; on failure stored session is cleared.

`usePortalAuth()` returns:

| Field | Notes |
|-------|-------|
| `tenantSlug` | From `useParams` |
| `customer` | `session.customer` |
| `accessToken` | `session.access_token` |
| `isAuthenticated` | boolean |
| `bootstrapping` | True until silent refresh resolves — guard against premature redirects |
| `setSession(next)` | Persists + updates session |
| `logout()` | Calls `portalApi.logout`, clears session |

---

## Auth Pages (public, no session required)

### `PortalLogin.jsx`
Two modes on the same page: email+password (`POST /api/portal/auth/login`) and OTP magic-link (`POST /api/portal/auth/request-otp` → redirects to `verify-otp`). Calls `auth.setSession()` on success.

### `PortalSignup.jsx`
Self-registration. `POST /api/portal/auth/signup`. Calls `auth.setSession()` and navigates to portal root on success.

### `PortalOtpVerify.jsx`
OTP code entry. Reads `?email=` and `?purpose=` from query params. `purpose=login` completes auth via `POST /api/portal/auth/verify-otp`. Resend CTA re-posts to `POST /api/portal/auth/request-otp`.

### `PortalForgotPassword.jsx`
Email input → `POST /api/portal/auth/request-password-reset`. Shows confirmation after submit.

### `PortalResetPassword.jsx`
Reads `?token=` from query string → `POST /api/portal/auth/reset-password`. Navigates to login on success.

---

## `PortalDashboard.jsx`

Home screen after login. Fires up to 3 fetches in `Promise.all`:
- Always: `GET /api/portal/me/invoices` → computes outstanding balance (sum of `balance_due` on non-paid/non-void invoices)
- If `appointments` tab enabled: `GET /api/portal/me/appointments?scope=upcoming`
- If `loyalty` tab enabled: `GET /api/portal/me/loyalty`

Cards: Outstanding Balance → `/invoices`, Next Appointment → `/appointments`, Loyalty Points → `/loyalty`. Each card only renders if the respective tab is in `enabledTabs`.

---

## `PortalInvoices.jsx`

Filterable invoice list (All / Unpaid / Paid). Fetches `GET /api/portal/me/invoices`. Each row links to `PortalInvoiceDetail`.

---

## `PortalInvoiceDetail.jsx`

Single invoice view. Params: `:tenantSlug`, `:invoiceId`. Fetches `GET /api/portal/me/invoices/:invoiceId`.

Pay CTA: `POST /api/portal/me/invoices/:invoiceId/pay-intent` → redirects to `checkout_url` from gateway. Gateway redirects back to `.../invoice-paid?invoice=:id` after payment.

---

## `PortalInvoicePaidPage.jsx`

Post-payment confirmation page. Reads `?invoice=` from query params.

Polls `GET /api/portal/me/invoices/:id` every 1.5 s for up to 8 attempts (`MAX_POLLS = 8`, `POLL_INTERVAL_MS = 1500`) waiting for `status === "paid"`. Shows success, pending, or error state.

---

## `PortalAppointments.jsx`

Upcoming and past appointments fetched in parallel (`?scope=upcoming` + `?scope=past`). Includes inline book-new-appointment form → `POST /api/portal/me/appointments` (collects service, date/time, notes).

---

## `PortalOrders.jsx`

Order history list. Fetches `GET /api/portal/me/orders`. Read-only.

---

## `PortalLoyalty.jsx`

Points balance, current tier, tier progress. Fetches `GET /api/portal/me/loyalty`.

---

## `PortalProfile.jsx`

Account info + address management. Fetches `GET /api/portal/me` and `GET /api/portal/me/addresses` in parallel. Allows editing name/phone and managing address records.

---

## `PortalTreatments.jsx`

Clinical treatment plan viewer. Two-level UI — list then drill-down.

- **List**: `GET /api/portal/me/treatment-plans` — plan title, number, provider, session progress, status.
- **Detail**: `GET /api/portal/me/treatment-plans/:planId` — five sections: Sessions (SOAP notes), Prescriptions, Chart (area/condition/severity), Lab Results, Consent Documents. Back button returns to list without re-fetching.

---

## `PortalStays.jsx` *(Wave 3)*

Hotel/hospitality stay history. Fetches `GET /api/portal/me/stays`.

Client-side filter: All / Upcoming (check-in >= now, not cancelled) / Past (check-out < now or status = checked_out). Columns: booking number, room (number + type), status badge, check-in, check-out (with nights count), folio total, invoice link. Status badge colors: `checked_in`=emerald, `confirmed`=blue, `pending`=amber, `checked_out`=slate, `cancelled`=red.

---

## `PortalWallet.jsx` *(Wave 3)*

Wallet balance + top-up flow. Fetches `GET /api/portal/me/wallet` → `{ balance, ledger[] }`.

Top-up: inline amount input → `POST /api/portal/me/wallet/top-up-intent` → redirects to `res.checkout_url` from payment gateway.

Ledger list: date, note/reference_type, amount. credit=emerald / debit=red coloring.
