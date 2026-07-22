# Portal Pages — Claude Guide

Customer-facing self-service portal, mounted at `/portal/:tenantSlug`. Fully self-contained: separate auth (`PortalAuthProvider` + `../../auth/customerPortalStore`, JWT scope `"customer"` — distinct from tenant `useAuth()` and the super-admin auth system), separate API client (`portalApi`), no main-app permissions system, no `ui/primitives`, no `useCurrency`. Backend routes live in `backend/routes/customer-portal/` and are mounted before tenant middleware — they never see `req.employee` or the ALS-proxied tenant `deps.db`; their own auth middleware resolves tenant DB routing directly.

Most pages are styled with the Square `--ui-*` tokens (same tokens as the rest of the app); `PortalForms.jsx` and `PortalPackages.jsx` still use raw Tailwind slate/emerald/red/amber classes instead — don't treat that as a bug to silently "fix", just be aware of the split when touching either file.

Tab visibility is server-driven: `PortalLayout` fetches `GET /api/portal/config` and passes `enabledTabs`/`labels`/`config`/`storeName`/`tenantSlug` down via `<Outlet context>`. Never assume a tab/page is reachable — always check `enabledTabs` before wiring new nav or cross-links.

---

## `portalApi` (`../../api/portalApi.js`)

Named export `portalApi`: `get(slug, path, query?)`, `post(slug, path, data)`, `put(slug, path, data)`, `del(slug, path)`, `logout(slug)`.

- Every request appends `?tenant=<slug>` and sends `credentials: "include"` (httpOnly refresh cookie).
- Attaches `Authorization: Bearer <access_token>` from the slug-scoped session if present.
- **Auto-refresh on 401**: silently POSTs `/api/portal/auth/refresh`, retries the original request once. If the retry also 401s, clears the session and throws `Error("Session expired")`.
- Non-ok responses throw `Error(body.error || "HTTP N")` with `.status` and `.body` attached (matches `api.js` conventions).
- Exceptions using raw `fetch()` against `API_BASE` directly (public, unauthenticated endpoints, not portal-scoped):
  - `PortalAppointments.jsx`'s booking modal → `GET /api/public/bookings/config?tenant=`, `GET /api/public/bookings/availability?tenant=&service_id=&date=`
  - `PortalStays.jsx` → probes `GET /api/public/rooms/config?tenant=` just to decide whether to show a "Book a stay" CTA (non-ok means the flag is off; hides the link, doesn't error)

---

## Auth (`PortalAuthProvider.jsx`)

Exports `PortalAuthProvider({ tenantSlug, children })` and `usePortalAuth()` (throws if used outside the provider).

- On mount, attempts a silent refresh (`POST /api/portal/auth/refresh`) if a stored session has an `access_token`, to rotate the refresh cookie and confirm the tenant is still active. Clears the session on failure.
- `usePortalAuth()` returns: `tenantSlug`, `session`, `customer` (`session.customer`), `accessToken`, `isAuthenticated`, `bootstrapping` (true until the silent refresh settles — gate redirects on this), `setSession(next)`, `logout()`.
- Session persistence goes through `customerPortalStore.js` (`readPortalSession`/`writePortalSession`/`clearPortalSession`), keyed per tenant slug — one browser can hold sessions for multiple tenant portals simultaneously.

---

## `PortalLayout.jsx`

Default export wraps an internal `PortalShell` in `<PortalAuthProvider tenantSlug={slug}>`.

`PortalShell`:
- Fetches `GET /api/portal/config` on mount → `{ enabled_tabs, portal_labels, branding, tenant }`. Shows a "Portal unavailable" error state if this fails.
- Auth guard (runs once `auth.bootstrapping` is false): unauthenticated + non-public path → redirect to `login`. Authenticated + public path → redirect to portal root. Public path segments: `login`, `signup`, `forgot`, `reset`, `verify-otp`.
- Renders a sticky header (logo/store name/customer name-or-email/sign-out), a tab nav (only when authenticated — Dashboard always first, then `enabled_tabs` in order), and `<Outlet context={{ config, enabledTabs, labels, storeName, tenantSlug }}>`.
- Full set of recognized tab keys (path segment = key, all flat under `/portal/:slug/`): `invoices`, `orders`, `appointments`, `subscriptions`, `contracts`, `tickets`, `loyalty`, `profile`, `stays`, `treatments`, `packages`, `gallery`. Every one of these has a matching page component in this directory. `profile` is always reachable via the header even if not in `enabled_tabs` — it's not gated the same way as the tab nav.

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
Reads `?token=`. `POST /api/portal/auth/reset-password` with `{ token, password }`. Redirects to login after a delay on success. Shows an error state (no form) if `token` is missing.

---

## Authenticated pages

### `PortalDashboard.jsx`
Home screen. Reads `{ labels, storeName, enabledTabs }` via `useOutletContext()`. Fires up to 3 parallel fetches:
- Always: `GET /api/portal/me/invoices` → outstanding balance = sum of `balance_due` where `status` not in `paid`/`void`.
- If `enabledTabs` includes `appointments`: `GET /api/portal/me/appointments?scope=upcoming`.
- If `enabledTabs` includes `loyalty`: `GET /api/portal/me/loyalty`.

Renders conditional cards (invoices/appointments/loyalty) each linking to the matching tab. Greeting uses `labels.dashboard_heading || "Welcome back"`. Does not fetch orders/stays/treatments/packages/gallery/contracts/subscriptions/tickets — dashboard summary is limited to those three domains.

### `PortalInvoices.jsx`
List with client-side status filter (all/unpaid/partial/overdue/paid). Fetches `GET /api/portal/me/invoices`. Each row links to `PortalInvoiceDetail`.

### `PortalInvoiceDetail.jsx`
Params: `:tenantSlug`, `:invoiceId`. Fetches `GET /api/portal/me/invoices/:invoiceId` → `{ invoice_number, status, balance_due, items[], payments[] }`.

"Pay now" (shown when status not `paid`/`void` and `balance_due > 0`) posts `POST /api/portal/me/invoices/:invoiceId/pay` (no body) → `window.location.href = res.checkout_url`. Gateway redirects back to `invoice-paid?invoice=:id`.

### `PortalInvoicePaidPage.jsx`
Post-payment confirmation. Reads `?invoice=` from query params (errors immediately if missing). Polls `GET /api/portal/me/invoices/:id` on an interval for a capped number of attempts. Success condition: `status === "paid"` OR `Number(balance_due) === 0`. States: `polling` → `paid` | `timeout` | `error`.

### `PortalAppointments.jsx`
Fetches `?scope=upcoming` and `?scope=past` in parallel via `GET /api/portal/me/appointments`. Cancel: `PUT /api/portal/me/appointments/:id/cancel` with `{ reason }` (uses `window.confirm`). Includes two modals:
- **BookingModal**: uses raw `fetch()` (not `portalApi`) against public `GET /api/public/bookings/config?tenant=` and `GET /api/public/bookings/availability?tenant=&service_id=&date=` to pick service/date/slot, then submits via `portalApi.post(..., "/api/portal/me/appointments", { service_id, start_at, employee_id, notes })`.
- **RescheduleModal**: `PUT /api/portal/me/appointments/:id/reschedule` with `{ start_at }` (ISO string from a `datetime-local` input; UI hint says must be ≥15 min from now — not enforced client-side beyond the hint text).

### `PortalOrders.jsx`
Fetches `GET /api/portal/me/order-history` (unified web + in-store order list, each row has a `source: "web"|"in-store"` field and composite key `${source}:${id}`) and, separately, `GET /api/portal/me/backorders` (wholesale-only — items reserved at order-time price, invoiced when stock arrives; fails silently to `[]` for non-wholesale tenants). "Reorder" button posts `POST /api/portal/me/reorder` with `{ source, order_id }` → response includes `redirect_url` (the reorder/cart-handoff flow: the storefront cart page reads `?adopt=` on mount, saves the cart token to `localStorage`, then strips the query param) and optionally `items_added`/`items_skipped[]` (shown as a notice banner, including on partial failure via `err.body.items_skipped`). No MOQ/case-pack UI here — MOQ enforcement (`services/moq.js`) applies to the storefront/field-rep cart the reorder hands off into, not to this page itself.

### `PortalLoyalty.jsx`
Fetches `GET /api/portal/me/loyalty` → `{ loyalty_points, total_spend, tier }`. Read-only; redemption instructions point to in-store checkout.

### `PortalProfile.jsx`
Fetches `GET /api/portal/me` + `GET /api/portal/me/addresses` in parallel (address fetch swallows errors → `[]`). Editable fields: name, mobile, address, city, date_of_birth, gender, preferred_contact, email/sms/whatsapp consent checkboxes. Save: `PUT /api/portal/me` with the whole form. Address delete: `DELETE /api/portal/me/addresses/:id` (uses `window.confirm`) then reloads both fetches.

### `PortalTreatments.jsx`
Clinical treatment plan viewer, two-level UI (list → drill-down, no routing — just local state).

- **List**: `GET /api/portal/me/treatment-plans` → `res.plans`. Also fetches `GET /api/portal/me/handouts` (clinic-shared documents, independent of any specific plan) — non-fatal if it 404s/is feature-gated off, section just doesn't render.
- **Detail**: `GET /api/portal/me/treatment-plans/:planId`. Renders sections from the response: Sessions (SOAP `soap_subjective`, session_number, status, provider, scheduled_at), Prescriptions, Chart (`chart_entries[]`: area_code, condition_code, severity, notes), Lab Results (`lab_orders[]`), Consent Documents (`consents[]`, with `document_pdf_url` link), Shared Documents (`documents[]`, only rendered if non-empty). If `plan.subject_type === "pet"`, also fetches `GET /api/portal/me/subjects/:subjectId/vaccination-card` and renders a Vaccination card section if records exist — non-fatal, hidden on failure. Also shows an invoice reference block if `plan.invoice_number` is set, with a balance_due warning.
- "Back to plans" just clears local `selected`/`detail` state — no re-fetch of the list.

### `PortalStays.jsx`
Hotel/hospitality stay history. Fetches `GET /api/portal/me/stays` → `data.stays[]`. Client-side filter: All / Upcoming (`check_in_date >= now` and `status !== "cancelled"`) / Past (`check_out_date < now` or `status === "checked_out"`). Columns: booking number, room (number · type), status badge, check-in/out dates (+nights), `folio_grand_total`, invoice link (only when `stay.invoice_id` is set, links to `PortalInvoiceDetail`). Also probes `GET /api/public/rooms/config?tenant=` (raw `fetch`, not `portalApi` — public endpoint) purely to decide whether to show a "Book a stay" CTA linking to the public room-booking engine; a non-ok response just hides the CTA.

### `PortalForms.jsx`
Digital intake/consent forms. List: `GET /api/portal/me/forms` → `res.forms` (each has `status: "pending"|"submitted"`). Detail/fill: `GET /api/portal/me/forms/:id` → fields rendered via `components/forms/FormFieldRenderer` from `fields_snapshot` (a frozen copy of the form's field definitions at share-time). If `active.require_signature`, requires drawing on `components/forms/SignaturePad` (ref-based `isEmpty()`/`clear()`/`toDataURL()`) before submit — converts to base64 via `signatureToBase64()`. Submit: `POST /api/portal/me/forms/:id/submit` with `{ answers, signature_image_base64 }`. Already-submitted forms show a read-only "already submitted" message instead of the form. Uses raw Tailwind slate/emerald/red classes, not `--ui-*` tokens — an outlier vs. the rest of this directory.

### `PortalPackages.jsx`
Prepaid session/credit package balances (salon/gym-style). Fetches `GET /api/portal/me/packages` → `res.packages` (each: `template_name`, `credits_remaining`, `credits_total`, `expires_at`, `status`, optional `history[]` of redemptions). Renders a progress bar (`remaining/total`) per package and an expandable redemption history table (date, credits, redeemed/reversed status). Read-only — no purchase/redeem action here. Also uses raw Tailwind classes, not `--ui-*` tokens.

### `PortalGallery.jsx`
Photography proofing gallery. Two-level UI (project list → photo grid, local state, mirrors `PortalTreatments`' pattern). List: `GET /api/portal/me/projects` → `res.projects` (each: `gallery_count`, `selected_count`). Grid: `GET /api/portal/me/projects/:id/gallery` → `res.files` (R2-direct image URLs, never proxied). Clicking a photo toggles selection optimistically then persists via `PUT /api/portal/me/projects/:id/gallery/:fileId` with `{ selected }` (reverts on failure). "Submit selection" posts `POST /api/portal/me/projects/:id/gallery/submit` with an empty body, then reloads the project list (to refresh `selected_count`).

### `PortalContracts.jsx`
Rental agreement history (read-only). Reads `labels.contracts_tab` heading override via `useOutletContext()`. Fetches `GET /api/portal/me/contracts` (tolerant of both array and `{ contracts: [] }` response shapes). Client-side filter: all / active (`reserved`/`confirmed`/`checked_out`) / past (everything else). Columns include contract number, items, status, rental start, due-back (uses `actual_return` if set, else `expected_return`), total (`final_total` if present and > 0, else `rental_fee_total`). No edit/cancel actions — footer text says agreements are store-managed.

### `PortalSubscriptions.jsx`
Recurring plan history (read-only). Reads `labels.subscriptions_tab` heading override. Fetches `GET /api/portal/me/subscriptions` (tolerant of array or `{ subscriptions: [] }`). Columns: plan name + billing interval, status badge, current period (start–end), "Renews" (shows "Cancelled" if `cancelled_at` set, else the period-end date if `auto_charge`, else "Manual"), price (`formatMoney` with optional `plan_currency` prefix). No plan-change actions — footer says to contact the store.

### `PortalTickets.jsx`
Repair/service ticket history (read-only). Reads `labels.tickets_tab` heading override. Fetches `GET /api/portal/me/tickets` (tolerant of array or `{ tickets: [] }`). Client-side filter: all / open (not `completed`/`invoiced`/`cancelled`) / closed. Each ticket rendered as a card: title/ticket_number, status badge, description (`line-clamp-3`), opened/expected/actual completion dates, deposit amount if > 0. No status-change or messaging actions.

---

## Gotchas

- Every payment-initiating flow here (invoice pay) follows redirect-to-gateway, not inline card entry — always `window.location.href = res.checkout_url`, never render a card form.
- `PortalOrders.jsx` is the only page that crosses into the storefront (`redirect_url` handoff via `?adopt=` cart token) — if working on storefront cart adoption, this is the other end of that handshake. It's also the only page here surfacing wholesale backorders.
- Several pages use `window.confirm`/`alert` for destructive actions (cancel appointment, delete address) instead of the toast/modal system used elsewhere in the app — this is intentional isolation from `ui/primitives`, not an oversight to "fix".
- Styling is inconsistent across the directory: most pages use `--ui-*` tokens (matching the app's Square design system), but `PortalForms.jsx` and `PortalPackages.jsx` use raw Tailwind slate/emerald/red classes. Match whichever convention the file you're editing already uses — don't silently "fix" one without being asked.
- Several read-only pages (`PortalContracts`, `PortalSubscriptions`, `PortalTickets`, `PortalPackages`) tolerate two response shapes (bare array vs. `{ <key>: [] }`) — if a backend route changes its response envelope, check these `Array.isArray(data) ? data : data?.foo || []` guards before assuming a page is broken.
- Vertical-specific sections are additive and fail closed: `PortalTreatments`' vaccination-card fetch and handouts fetch, and `PortalStays`'/`PortalOrders`' probe-then-hide-CTA pattern, all swallow errors and just omit the UI rather than showing an error state — don't "fix" a silently-empty section without first checking whether the underlying feature is actually enabled for that tenant.
- Session bootstrap ordering: always check `auth.bootstrapping` before treating `isAuthenticated === false` as a real logged-out state — a false negative during the silent-refresh window causes a login-page flash/redirect loop if ignored.
