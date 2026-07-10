# Admin Pages — Claude Guide

Super-admin panel at `/admin/*`. Completely separate auth system from tenant auth — no `AuthProvider`, no `api.js`, no permissions system, no `useCurrency`/tenant `ui/primitives`. Styled with the same `--ui-*` token classes as the rest of the app (light-only, Square design system), not a distinct dark theme.

**Auth pattern**: Bearer token stored in `localStorage["adminSession"]` via `auth/adminAuthStore.js` (`readAdminSession`, `writeAdminSession`, `clearAdminSession`, `getAdminToken`, `getAdminSession`). All pages call `adminFetch(path, options)` defined in `AdminLogin.jsx`, which reads the token and attaches `Authorization: Bearer <token>` + JSON content-type. **`adminFetch` now silently refreshes on 401**: if the response is 401 with `code: "TOKEN_EXPIRED"`, it POSTs `${API_BASE}/api/admin/auth/refresh` (httpOnly refresh cookie, `credentials: "include"`), coalesces concurrent refreshes into one in-flight promise, writes the new token, and retries the original request once. Only a refresh failure (or a 401 without that code) should be treated as "redirect to `/admin/login`" — not every page does this consistently.

**2FA (TOTP)** is layered on top of the password login: `POST /api/admin/auth/login` may return `{ totp_required: true, pending_token }` instead of a session, in which case `AdminLogin.jsx` shows a second step that posts `{ pending_token, code }` to `POST /api/admin/auth/totp`. See `AdminSecurity.jsx` for enrollment.

Most pages auto-refresh via `setInterval` in `useEffect`; noted per file below.

---

## `AdminLogin.jsx`

Login form + defines/re-exports the shared helpers every other admin page imports.

- Defines and exports `adminFetch(path, options)` — the canonical fetch wrapper (Bearer token + JSON headers + silent-refresh-on-401 described above).
- Re-exports `writeAdminSession`, `getAdminToken`, `clearAdminSession`, `getAdminSession` from `../../auth/adminAuthStore` — a backward-compat shim so other files can `import { adminFetch, getAdminToken, ... } from "./AdminLogin"` instead of the store directly.
- If a valid session already exists (`session.token && session.admin.id`), redirects to `/admin` immediately (`<Navigate>`).
- Login: `POST /api/admin/auth/login` with `{ email, password }`. Two outcomes: normal session (`{ token, admin }` → `writeAdminSession` → navigate `/admin`) or `{ totp_required: true, pending_token }` → switches to the TOTP step.
- TOTP step: `POST /api/admin/auth/totp` with `{ pending_token, code }` (accepts a 6-digit code or a recovery code). On `PENDING_EXPIRED`/`PENDING_INVALID` error codes, bounces back to the password step.

---

## `AdminLayout.jsx`

Shell: sidebar nav + `<Outlet>`. Imports `{ adminFetch, clearAdminSession, getAdminToken, getAdminSession }` from `./AdminLogin`.

- **Auth guard**: calls `getAdminToken()` directly at render time (no context, no effect) — redirects to `/admin/login` if missing.
- **Support badge**: polls `GET /api/admin/support-tickets?status=open` every 60s, shows open count on the "Support" nav item.
- **Nav items in order**: Dashboard (`/admin`, exact), Tenants, Support (badge), Emails, Activity, Adoption, Tax Rates, Dead Letters, Billing, Stuck Payments, Security.
- Logout: `POST /api/admin/auth/logout` (best-effort server-side refresh-session revoke, errors swallowed) then `clearAdminSession()` and navigate to `/admin/login`.

---

## `AdminDashboard.jsx`

Loads 9 endpoints in parallel on mount (mixed raw `fetch` + `adminFetch`):

| Endpoint | State | Fetch style |
|----------|-------|-------------|
| `GET /api/admin/stats` | `stats` | raw fetch — **401 redirects to login** |
| `GET /api/admin/attention` | `attention` | raw fetch (approaching limits, dormant tenants, setup_pending) |
| `GET /api/admin/billing-attention` | `billingAttention` | raw fetch (due_soon, overdue, past_grace, pending_upgrades) |
| `GET /api/admin/revenue-stats` | `revenue` | `adminFetch` |
| `GET /api/admin/worker-status` | `workers` | `adminFetch` |
| `GET /api/admin/orphaned-schemas` | `orphans` | `adminFetch` |
| `GET /api/admin/backup-history` | `backups` | `adminFetch` |
| `GET /api/admin/announcements` | `announcements` | `adminFetch` |
| `GET /api/admin/infra` | (see `InfrastructurePanel`) | raw fetch, manual header |

**`InfrastructurePanel`** (internal component, not exported): polls `GET /api/admin/infra` every 60s using raw `fetch` with a manual `Authorization` header (not `adminFetch`, so it does not get silent-refresh). Backend caches this endpoint 5 min server-side, so 60s client polling is safe. **Pauses when the tab is hidden** (`visibilitychange` listener) and immediately refetches + resumes on focus. Renders: connection pool usage (color-coded bar), DB size, cache hit ratio (flags <95%), dead tuple counts, schema sizes, currently-running slow queries, historical slow query stats (`pg_stat_statements`), and a `<details>` table of per-table dead-tuple health.

**`WorkerStatusPanel`** (internal component): groups `workers` data by domain (`WORKER_GROUPS` — Platform, Billing & subscriptions, Retail & inventory, Restaurant & reservations, Appointments & clinical, Rentals & lodging, Integrations & compliance, plus an "Other" bucket for ungrouped keys). Any worker with `w.alert` set (`env_var_missing`, `register_failed`, `enabled_but_stopped`) surfaces in an amber banner above the groups. Each row shows a status dot, queue depth, processed-today count, and last-poll-ago.

**Other actions on this page:**
- Orphaned schema cleanup: `POST /api/admin/orphaned-schemas/cleanup` (confirm dialog first)
- Manual backup: `POST /api/admin/backup`, then refreshes `backup-history`
- "Migrate All Tenants": `POST /api/admin/migrate-all` (confirm dialog first) — runs pending migrations across every tenant schema, reports `{ migrated, skipped, errors }`
- Announcements CRUD: create (`POST /api/admin/announcements` with `{ message, type, ends_at?, audience_plan?, audience_industry? }`, types: info/warning/maintenance, audience can target a plan and/or a comma-joined list of industry keys drawn from `INDUSTRY_LABELS`), deactivate (`PUT /api/admin/announcements/:id` with `{ active: false }`), delete (`DELETE /api/admin/announcements/:id`)

Also renders recent tenants list (click → `/admin/tenants/:id`) and recent audit log entries from `stats.recent_tenants` / `stats.recent_audit`.

---

## `AdminTenantList.jsx`

Search (name/slug) + status filter (all/active/suspended) + industry filter (built dynamically from `industry_type` values actually present in the loaded tenants, labeled via `industryLabel()` from `industryLabels.js`). `GET /api/admin/tenants`. Also loads `GET /api/admin/test-fleet` (tenants matching a test-prefix) for the fleet card below. Rows are clickable → `/admin/tenants/:id`.

**`healthDot` logic**: setup incomplete → muted "Setup pending"; never logged in → red "Never logged in"; last login <1d → green "Active today"; <7d → amber "`{n}d ago`"; ≥7d → red "`{n}d ago`".

**Columns**: checkbox, Name, Slug, Industry (+ mode count badge), Health, Plan, Revenue (this month), Status, Payment status, Expires, Last Activity, Created, Delete.

**Row selection + bulk action bar**: checkbox per row + "select all (filtered)" in the header. When any rows are selected, a bar appears with "Extend trial +30d" and "Expire now" (confirm dialog) — both call `POST /api/admin/tenants/bulk-lifecycle` with `{ tenant_ids, action, days? }`.

**Test fleet card**: shown when `fleet.count > 0` (tenants matching `fleet.prefix*`). "Extend all +30d" reuses `bulk-lifecycle`. "Delete fleet" opens a confirm modal requiring the exact prefix to be typed, then `POST /api/admin/test-fleet/delete` with `{ prefix, confirm }`.

**Create tenant modal**: fields `slug` (regex `^[a-z0-9_]{3,40}$`), `name`, `owner_email` (optional), `pin` (required admin PIN), `timezone` (default UTC), `plan` (free/pro). `POST /api/admin/tenants`. On success shows a copyable setup URL in a follow-up modal.

**Delete modal**: requires typing the exact tenant slug to enable the delete button. `DELETE /api/admin/tenants/:id`. Inline handler, not shared with any `doAction` helper.

**CSV export**: `downloadCsv` from `utils/csvExport.js`, exports the currently filtered rows (Name, Slug, Industry, Plan, Status, Created).

---

## `AdminTenantDetail.jsx`

Loads `GET /api/admin/tenants/:id` + `GET /api/admin/tenants/:id/stats` together, then fires off background fetches for: `setup-token`, `payments`, `plan-pricing` (global, not tenant-scoped), `feature-usage`, `upgrade-requests` (filtered client-side to this tenant's `tenant_id`), `feature-flags`, `notes`, `vertical-usage`, `modes`, `flag-drift`.

**Edit mode** (`editMode` toggle): editable fields are name, owner_email, plan, timezone, max_employees, max_products, max_outlets. `PUT /api/admin/tenants/:id`.

**Actions** (via a shared `doAction(actionPath, method, body)` helper that reloads tenant data on success):

| Button | Endpoint | Enabled when |
|--------|----------|--------------|
| Suspend | `POST /api/admin/tenants/:id/suspend` | status === active |
| Activate | `POST /api/admin/tenants/:id/activate` | status === suspended |
| Run Migrations | `POST /api/admin/tenants/:id/migrate` | active only |
| Reset PIN | `POST /api/admin/tenants/:id/reset-pin` | active only, resets to `"0000"`, confirm dialog |
| Delete | `DELETE /api/admin/tenants/:id` | always, confirm dialog |

**Impersonation** ("Log in as Tenant") is a separate inline handler, not `doAction`: `POST /api/admin/impersonate/:id` → opens a **new tab** at `/context-select?impersonate_token=...&impersonate_session=...&tenant_slug=...&tenant_name=...`. Only enabled when tenant is active.

**Setup status card**: shown when `setupInfo` present. If incomplete, shows setup URL + copy button + "Regenerate Token" (`POST /api/admin/tenants/:id/regenerate-setup-token`).

**Billing section**: shows plan/cycle/expiry/payment_status. "Record Payment" button opens a modal (plan, cycle, amount auto-filled from `planPricing`, payment_method, reference_note) → `POST /api/admin/tenants/:id/record-payment`. Pending upgrade requests shown inline with Approve/Dismiss (`PUT /api/admin/upgrade-requests/:id` with `{ status: "approved"|"dismissed" }`). Payment history table exportable via `downloadCsv`.

**Verticals card** (`verticalUsage`): shows industry label (`industryLabel()`), business model badge, enabled mode pills (`MODE_LABELS`), and per-feature usage counts (`u.count`, `u.label`, last-activity timestamp) filtered to `count > 0`.

**Modes card**: toggle switches per mode (`toggleMode` → `PUT /api/admin/tenants/:id/modes` with `{ mode, enabled }`) — enabling/disabling a mode also flips its whole registry-flag bundle, per the tooltip text.

**Feature flags card**: ~107 flags grouped client-side by key prefix via `flagGroup()` (Restaurant, Appointments & memberships, Projects & tickets, Rentals, Lodging, Clinical, Wholesale, Retail, Integrations & compliance, Reports, Platform (phase 2), Context enforcement, Billing & subscriptions, Marketing & messaging, Core — see `FLAG_GROUP_ORDER`). Searchable by key substring. Toggle a single flag: `toggleFlag()` → `PUT /api/admin/tenants/:id/feature-flags` with `{ key, enabled }`, optimistic local update, then re-fetches `flag-drift`.

**Preset drift detection** (`drift` state from `GET /api/admin/tenants/:id/flag-drift`): flags the preset expects ON but are currently OFF are tagged "expected on"; flags outside the preset's expected set that are manually ON are tagged "manual". A warning banner lists missing flags. "Re-apply preset" button opens a modal (`showReapply`) with an "also re-run signup flag bundles" checkbox, then calls `POST /api/admin/tenants/:id/reapply-preset` with `{ include_bundles }`.

**Tenant Notes**: `POST /api/admin/tenants/:id/notes` (add), `DELETE /api/admin/tenants/:id/notes/:noteId` (confirm dialog).

**Plan pricing editor**: inline edit of the global `planPricing` list (shared across all tenants, not tenant-specific) — `PUT /api/admin/plan-pricing/:id` with `{ price }`.

**Health Dashboard (right column)**: from `stats` — last login/sale/shift, active staff (7d/30d), sales+revenue for today/week/month, plan usage bars (employees/products/outlets vs max), schema size, total sales, customers, and feature usage (30d) with top users list (from `featureUsage`).

No auto-refresh polling on this page — data reloads only after an action completes.

---

## `AdminSupportTickets.jsx`

Auto-refreshes every 30s (background refetch, no loading spinner).

Status filter: all / open / acknowledged / resolved. Statuses styled: open=amber, acknowledged=muted, resolved=green.

Clicking a ticket row expands it to show full message, page URL, browser info, last request ID, employee ID, screenshots, and any existing admin reply.

**Actions per ticket:**
- Acknowledge / Resolve: `PUT /api/admin/support-tickets/:tenantId/:ticketId` with `{ status }`
- Reply: inline textarea → `PUT /api/admin/support-tickets/:tenantId/:ticketId/reply` with `{ reply }`
- Quick Impersonate: `POST /api/admin/impersonate/:tenantId` → opens new tab at `/context-select?...` and appends `&redirect=<page_url>` if the ticket recorded a `page_url`
- Delete: `DELETE /api/admin/support-tickets/:tenantId/:ticketId` (confirm dialog)

---

## `AdminEmails.jsx`

5 tabs: All / Pending / Sent / Failed / **Broadcasts**. `GET /api/admin/email-queue?status=<filter>`.

Auto-refreshes every 30s — **except** the Broadcasts tab, which loads from a different endpoint (`GET /api/admin/broadcast-history`) and does not poll (switching to it clears the queue timer).

**Email type badge colors**: receipt/digest/drip_*/support_*/announcement=muted (near-monochrome), billing_payment_recorded/billing_plan_changed=green, billing_expiry_warning/downtime=amber, billing_overdue=red.

**Per-email actions**: Send Now (`POST /api/admin/email-queue/:id/send-now`, pending only), Retry (`POST /api/admin/email-queue/:id/retry`, failed only), Delete (`DELETE /api/admin/email-queue/:id`, confirm dialog).

**Global actions**: "Purge Deleted Tenants" (`DELETE /api/admin/email-queue/purge-deleted`, confirm dialog, shows count purged), CSV export via `downloadCsv` (disabled on Broadcasts tab).

**Broadcast form**: type (downtime/announcement), subject, HTML message → `POST /api/admin/email/broadcast` with `{ type, subject, message }`, reports `enqueued` count.

---

## `AdminDeadLetters.jsx`

Renamed in practice to "Dead Letters & Queue Health" — 4 tabs, each with a distinct endpoint and its own table columns:

| Tab | Endpoint | Columns | Actions |
|-----|----------|---------|---------|
| Shopify | `GET /api/admin/dead-letters` | Topic, Status, Error, Retries | Retry (`POST .../:tenantId/:id/retry`); "Retry All" loops **sequentially** (not `Promise.all`) |
| Aggregators | `GET /api/admin/dead-letters/aggregator` | Type (entity_type), Idempotency Key, Error, Attempts | Dismiss (`POST /api/admin/dead-letters/aggregator/:tenantId/:id/dismiss`) |
| Channel Sync | `GET /api/admin/dead-letters/channel-sync` | External UID, Dates, Reason, Conflicting Booking | Resolve / Dismiss (`PUT /api/admin/dead-letters/channel-sync/:tenantId/:id` with `{ status }`) |
| FBR Health | `GET /api/admin/fbr-health` | Read-only per-tenant pending/failed/posted invoice counts + oldest-pending + avg delay | None — `FbrHealthPanel` is display-only |

Auto-refreshes every 30s (per active tab).

---

## `AdminActivity.jsx`

3 tabs: Admin Actions, Tenant Activity, Security. Page size fixed at 50 rows. Auto-refreshes every 30s. Switching tabs resets `offset` and `filter` to 0/none.

**Also renders `ImpersonationCard`** at the top of the page (independent of the tab state): shows currently-active impersonation sessions with a "Revoke" button per session (`POST /api/admin/impersonate/:sessionId/end` — blacklists the token's `jti`), polls `GET /api/admin/impersonation-sessions?active=1` every 30s, and has a togglable "Recent history" panel (`GET /api/admin/impersonation-sessions?limit=20`) showing active/revoked/ended state per session.

| Tab | Endpoint | Filter param | Response key fallback chain |
|-----|----------|-------------|------------------------------|
| Admin Actions | `GET /api/admin/activity-log` | `action` (30+-value `ACTION_TYPES` list, includes tax/backup/cleanup/orphan-schema actions) | `entries` \|\| `rows` \|\| `logs` \|\| `events` |
| Tenant Activity | `GET /api/admin/tenant-activity` | none | same |
| Security | `GET /api/admin/security-log` | `event_type` (login_success/login_failed) | same |

Pagination is offset-based (Previous/Next), page number derived from `offset/50 + 1`.

CSV export (`downloadCsv`) has distinct column sets per tab: Admin (time/admin/action/target_type/target_id/details), Tenant (time/tenant/action/entity_type/entity_id/performed_by), Security (time/event/email/ip_address/user_agent).

---

## `AdminAdoption.jsx`

Feature-adoption matrix — which tenants use which modes/flags. Reads a cached snapshot: `GET /api/admin/adoption` (cache) or `GET /api/admin/adoption?force=1` ("Recompute" button — a live cross-tenant fanout, shows a spin icon while in flight).

**Mode matrix table**: rows = tenants (sticky first column, name + industry label via `INDUSTRY_LABELS`), columns = modes (`MODE_LABELS`). Each cell shows a green check + usage count if the mode is on and has data, an amber count-only if data exists but the mode is disabled (drift signal), or a dot if neither.

**Flag adoption summary**: below the matrix, one row per flag key that's ON for at least one tenant, sorted by adoption count descending, showing `count/total · pct%`.

CSV export includes tenant/slug/industry/enabled-flag-count plus one column per mode (`"on (n)"` / `"off (n)"` format).

No auto-refresh polling — data is a point-in-time snapshot, refreshed only via "Recompute".

---

## `AdminBilling.jsx`

Billing overview page, separate from the per-tenant billing section in `AdminTenantDetail.jsx`. Loads on mount (no polling):

- `GET /api/admin/billing-attention` → three mini-tables: **Due within 7 days** (`plan_expires_at`), **Overdue (in grace)** (`grace_ends_at`), **Past grace** (`grace_ends_at`) — each a `TenantMiniTable` linking to `/admin/tenants/:id`.
- `GET /api/admin/plan-pricing` → editable price list (same shape/edit pattern as the one embedded in `AdminTenantDetail.jsx` — two independent UIs over the same global table). `PUT /api/admin/plan-pricing/:id` with `{ price }`.
- `GET /api/admin/upgrade-requests` → all requests (not tenant-filtered here); pending ones get Approve/Dismiss buttons (`PUT /api/admin/upgrade-requests/:id` with `{ status }`), non-pending show a status pill.
- `GET /api/admin/payments?limit=50` → recent payments table across all tenants, exportable via `downloadCsv`.

Links to `/admin/stuck-payments` in the header.

---

## `AdminSecurity.jsx`

Super-admin's own account security (not tenant-facing) — TOTP 2FA enrollment/disable + active-session management for the currently logged-in super-admin.

**2FA status**: `GET /api/admin/auth/totp/status` → `{ enabled, recovery_codes_remaining, enabled_at }`.

**Enrollment flow**: `POST /api/admin/auth/totp/setup` → `{ secret, otpauth_uri, qr_data_url }`, renders QR code + manual key. `POST /api/admin/auth/totp/verify` with `{ code }` → on success returns `recovery_codes` (shown once, copy-to-clipboard, never shown again) and flips status to enabled.

**Disable flow**: requires a current TOTP or recovery code — `POST /api/admin/auth/totp/disable` with `{ code }`.

**Active sessions card**: `GET /api/admin/auth/sessions` → list of this admin's other login sessions (user agent, IP, signed-in time, "This device" tag on the current one). "Sign out other sessions" (shown only when >1 session) calls `POST /api/admin/auth/sessions/revoke-others`.

---

## `AdminTaxRates.jsx`

**Exception to the shared pattern**: defines its own **local** `adminFetch` inline (does not import from `AdminLogin.jsx`). Uses `getAdminToken()` from `../../auth/adminAuthStore` directly and prepends `API_BASE` manually to every URL.

2 tabs: Tax Rates (CRUD on `tax_rate_reference`) and Suggestions (tenant-submitted correction review).

**Tax rate fields**: `hs_code`, `description_en`, `description_ur`, plus 5 province rate percentages: `federal_gst`, `punjab_pra`, `sindh_srb`, `kpk_kpra`, `balochistan_bra`, and `exemption_notes`. CRUD via `GET/POST/PUT/DELETE /api/admin/tax-rates[/:id]`.

**Suggestion review**: `PUT /api/admin/tax-rate-suggestions/:id` with `{ status: "approved"|"rejected", tenant_slug }`. Approving triggers a rates refetch (approved value becomes the new reference rate).

No auto-refresh polling.

---

## `AdminStuckPayments.jsx`

Payment-ops debug tool, two independent sections, both auto-refresh every 30s. Threshold selector (1h/2h/6h/24h) changes trigger an immediate refetch.

**Section 1 — Stuck Payment Intents**: `GET /api/admin/payment-intents/stuck?hours=<threshold>`. Shows tenant (linked to `/admin/tenants/:id`), plan/cycle, amount+currency, gateway, gateway_ref, status, and age (color: <2h muted, 2–6h amber, ≥6h red).

**Section 2 — Recent Payment Webhook Events (7 days)**: `GET /api/admin/webhooks/payment-dead-letters?limit=100`. Shows provider, event_type, payment_context+context_ref, event_id, processed status (green if `processed_at` set, else amber "Unprocessed"), created timestamp. **Read-only** — no retry/dismiss actions here (unlike `AdminDeadLetters.jsx`).

---

## `industryLabels.js`

Shared display-name maps, mirrored from `backend/config/industry-config.js` (`INDUSTRY_PRESETS[].display_name`) and `backend/config/mode-registry.js` — keep in sync when adding a preset/mode. Exports `INDUSTRY_LABELS` (industry key → display name, e.g. `general_retail` → "Retail Store"), `MODE_LABELS`, and helper functions `industryLabel(key)` / used inline elsewhere as `INDUSTRY_LABELS[key] || key`. Consumed by `AdminDashboard.jsx` (announcement audience picker), `AdminTenantList.jsx` (industry filter), `AdminTenantDetail.jsx` (verticals/modes cards), `AdminAdoption.jsx` (matrix labels).

---

## Cross-cutting gotchas

- **Two different `adminFetch` implementations exist**: the shared one in `AdminLogin.jsx` (used everywhere else, includes silent 401 refresh) and a local duplicate in `AdminTaxRates.jsx` (no refresh logic). Don't assume importing `adminFetch` from `AdminLogin` covers all admin pages.
- **Impersonation always opens a new tab** at `/context-select?impersonate_token=...&impersonate_session=...&tenant_slug=...&tenant_name=...` — implemented independently in `AdminTenantDetail.jsx` and `AdminSupportTickets.jsx` (the latter also appends `&redirect=<page_url>` when available). No shared helper — if impersonation behavior changes, update both call sites. Revocation lives in `AdminActivity.jsx`'s `ImpersonationCard` (`POST /api/admin/impersonate/:sessionId/end`), a third, independent code path.
- **Admin sessions can silently refresh** (unlike the old no-refresh model): `adminFetch` exchanges the httpOnly refresh cookie for a new access token on a `TOKEN_EXPIRED` 401 and retries once. A handful of raw `fetch()` call sites bypass this (the `stats`/`attention`/`billing-attention` calls in `AdminDashboard.jsx`, and the `infra` poll in `InfrastructurePanel`) — those still hard-redirect or silently fail on 401.
- **`plan-pricing` and `tax-rates` are global, not tenant-scoped** — edits from `AdminTenantDetail.jsx`, `AdminBilling.jsx`, or `AdminTaxRates.jsx` affect all tenants/currency-wide reference data, not just the one being viewed. Note `AdminTenantDetail.jsx` and `AdminBilling.jsx` each embed their own independent plan-pricing editor UI over the same table.
- **Feature flags have two layers**: individual flags (`GET/PUT .../feature-flags`) and coarser "modes" (`GET/PUT .../modes`) that bundle a set of flags — toggling a mode flips its whole registry-flag bundle. `flag-drift` compares the tenant's actual flags against what its industry preset expects, surfacing "expected on" (missing) and "manual" (extra) tags; "Re-apply preset" resets to the expected baseline.
- Destructive actions (delete tenant, delete ticket, delete note, purge emails, retry-all, delete fleet) all gate behind `window.confirm`/inline confirm modals — no custom `ConfirmDialog` component is used here (that's a tenant-app-only primitive).
- Most list/log pages (`AdminSupportTickets`, `AdminEmails`, `AdminDeadLetters`, `AdminActivity`, `AdminStuckPayments`) auto-refresh via `setInterval(fn, 30000)` in a `useEffect` keyed on the active tab/filter — a background refetch, not a full loading-state reset. `AdminAdoption.jsx` and `AdminTenantDetail.jsx` are point-in-time / action-triggered only, no polling.
