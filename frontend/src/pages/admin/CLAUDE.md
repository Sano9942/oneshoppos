# Admin Pages — Claude Guide

Super-admin panel at `/admin/*` (dark violet/slate-900 theme). Completely separate auth system from tenant auth — no `AuthProvider`, no `api.js`, no permissions system, no `useCurrency`/`ui/primitives`.

**Auth pattern**: Bearer token stored in `localStorage["adminSession"]` via `auth/adminAuthStore.js` (`readAdminSession`, `writeAdminSession`, `clearAdminSession`, `getAdminToken`, `getAdminSession`). All pages call `adminFetch(path, options)` defined in `AdminLogin.jsx`, which reads the token and attaches `Authorization: Bearer <token>` + JSON content-type. There is no token refresh — a 401 means redirect to `/admin/login`.

Most pages auto-refresh via `setInterval` in `useEffect`; noted per file below.

---

## `AdminLogin.jsx`

Login form + defines/re-exports the shared helpers every other admin page imports.

- Defines and exports `adminFetch(path, options)` — the canonical fetch wrapper (Bearer token + JSON headers).
- Re-exports `writeAdminSession`, `getAdminToken`, `clearAdminSession`, `getAdminSession` from `../../auth/adminAuthStore` — a backward-compat shim so other files can `import { adminFetch, getAdminToken, ... } from "./AdminLogin"` instead of the store directly.
- If a valid session already exists (`session.token && session.admin.id`), redirects to `/admin` immediately (`<Navigate>`).
- Login: `POST /api/admin/auth/login` with `{ email, password }` → stores `{ token, admin, loadedAt }` via `writeAdminSession`, navigates to `/admin`.

---

## `AdminLayout.jsx`

Shell: sidebar nav + `<Outlet>`. Imports `{ adminFetch, clearAdminSession, getAdminToken, getAdminSession }` from `./AdminLogin`.

- **Auth guard**: calls `getAdminToken()` directly at render time (no context, no effect) — redirects to `/admin/login` if missing.
- **Support badge**: polls `GET /api/admin/support-tickets?status=open` every 60s, shows open count on the "Support" nav item.
- **Nav items in order**: Dashboard (`/admin`, exact), Tenants (`/admin/tenants`), Support (`/admin/support`), Emails (`/admin/emails`), Activity (`/admin/activity`), Tax Rates (`/admin/tax-rates`), Dead Letters (`/admin/dead-letters`), Stuck Payments (`/admin/stuck-payments`).
- Logout button calls `clearAdminSession()` then navigates to `/admin/login`.

---

## `AdminDashboard.jsx`

Loads 8 endpoints in parallel on mount (mixed raw `fetch` + `adminFetch`):

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

**`InfrastructurePanel`** (internal component, not exported): polls `GET /api/admin/infra` every 60s using raw `fetch` with a manual `Authorization` header (not `adminFetch`). Backend caches this endpoint 5 min server-side, so 60s client polling is safe. **Pauses when the tab is hidden** (`visibilitychange` listener) and immediately refetches + resumes on focus. Renders: connection pool usage (color-coded bar), DB size, cache hit ratio (flags <95%), dead tuple counts, schema sizes, currently-running slow queries, historical slow query stats (`pg_stat_statements`), and a `<details>` table of per-table dead-tuple health.

**Other actions on this page:**
- Orphaned schema cleanup: `POST /api/admin/orphaned-schemas/cleanup` (confirm dialog first)
- Manual backup: `POST /api/admin/backup`, then refreshes `backup-history`
- "Migrate All Tenants": `POST /api/admin/migrate-all` (confirm dialog first) — runs pending migrations across every tenant schema, reports `{ migrated, skipped, errors }`
- Announcements CRUD: create (`POST /api/admin/announcements` with `{ message, type, ends_at? }`, types: info/warning/maintenance), deactivate (`PUT /api/admin/announcements/:id` with `{ active: false }`), delete (`DELETE /api/admin/announcements/:id`)

Also renders recent tenants list (click → `/admin/tenants/:id`) and recent audit log entries from `stats.recent_tenants` / `stats.recent_audit`.

---

## `AdminTenantList.jsx`

Search (name/slug) + status filter (all/active/suspended). `GET /api/admin/tenants`. Rows are clickable → `/admin/tenants/:id`.

**`healthDot` logic**: setup incomplete → slate "Setup pending"; never logged in → red; last login <1d → emerald "Active today"; <7d → amber "`{n}d ago`"; ≥7d → red "`{n}d ago`".

**Columns**: Name, Slug, Health, Plan, Revenue (this month), Status, Payment status, Expires, Last Activity, Created, Delete.

**Create tenant modal**: fields `slug` (regex `^[a-z0-9_]{3,40}$`), `name`, `owner_email` (optional), `pin` (required admin PIN), `timezone` (default UTC), `plan` (free/pro). `POST /api/admin/tenants`. On success shows a copyable setup URL in a follow-up modal.

**Delete modal**: requires typing the exact tenant slug to enable the delete button. `DELETE /api/admin/tenants/:id`. Inline handler, not shared with any `doAction` helper.

**CSV export**: `downloadCsv` from `utils/csvExport.js`, exports the currently filtered rows (Name, Slug, Plan, Status, Created).

---

## `AdminTenantDetail.jsx`

Loads `GET /api/admin/tenants/:id` + `GET /api/admin/tenants/:id/stats` together, then fires off 6 more background fetches: `setup-token`, `payments`, `plan-pricing` (global, not tenant-scoped), `feature-usage`, `upgrade-requests` (filtered client-side to this tenant's `tenant_id`), `feature-flags`, `notes`.

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

**Feature flags**: toggle switches, `PUT /api/admin/tenants/:id/feature-flags` with `{ key, enabled }` — optimistic local update.

**Plan pricing editor**: inline edit of the global `planPricing` list (shared across all tenants, not tenant-specific) — `PUT /api/admin/plan-pricing/:id` with `{ price }`.

**CRM notes**: `POST /api/admin/tenants/:id/notes` (add), `DELETE /api/admin/tenants/:id/notes/:noteId` (confirm dialog).

**Health Dashboard (right column)**: from `stats` — last login/sale/shift, active staff (7d/30d), sales+revenue for today/week/month, plan usage bars (employees/products/outlets vs max), schema size, total sales, customers, and feature usage (30d) with top users list (from `featureUsage`).

No auto-refresh polling on this page — data reloads only after an action completes.

---

## `AdminSupportTickets.jsx`

Auto-refreshes every 30s (background refetch, no loading spinner).

Status filter: all / open / acknowledged / resolved. Statuses styled: open=amber, acknowledged=blue, resolved=emerald.

Clicking a ticket row expands it to show full message, page URL, browser info, last request ID, employee ID, screenshots, and any existing admin reply.

**Actions per ticket:**
- Acknowledge / Resolve: `PUT /api/admin/support-tickets/:tenantId/:ticketId` with `{ status }`
- Reply: inline textarea → `PUT /api/admin/support-tickets/:tenantId/:ticketId/reply` with `{ reply }`
- Quick Impersonate: `POST /api/admin/impersonate/:tenantId` → opens new tab at `/context-select?...` and appends `&redirect=<page_url>` if the ticket recorded a `page_url`
- Delete: `DELETE /api/admin/support-tickets/:tenantId/:ticketId` (confirm dialog)

---

## `AdminEmails.jsx`

5 tabs: All / Pending / Sent / Failed / **Broadcasts**. `GET /api/admin/email-queue?status=<filter>`.

Auto-refreshes every 30s — **except** the Broadcasts tab, which loads from a different endpoint (`GET /api/admin/broadcast-history`) and does not poll.

**Email type badge colors**: receipt/digest=blue, drip_*=violet, billing_payment_recorded/billing_plan_changed=emerald, billing_expiry_warning=amber, billing_overdue=red, support_*=sky, downtime=orange, announcement=indigo.

**Per-email actions**: Send Now (`POST /api/admin/email-queue/:id/send-now`, pending only), Retry (`POST /api/admin/email-queue/:id/retry`, failed only), Delete (`DELETE /api/admin/email-queue/:id`, confirm dialog).

**Global actions**: "Purge Deleted Tenants" (`DELETE /api/admin/email-queue/purge-deleted`, confirm dialog, shows count purged), CSV export via `downloadCsv` (disabled on Broadcasts tab).

**Broadcast form**: type (downtime/announcement), subject, HTML message → `POST /api/admin/email/broadcast` with `{ type, subject, message }`, reports `enqueued` count.

---

## `AdminDeadLetters.jsx`

Auto-refreshes every 30s.

Shows dead-lettered webhook/integration events: tenant (name+slug), event type/topic, status (dead_letter=red, pending=amber), error message (truncated 120 chars), retry count, failed-at timestamp.

- Per-event retry: `POST /api/admin/dead-letters/:tenantId/:eventId/retry` — removes from list on success.
- "Retry All" (shown only when events exist): loops through events **sequentially** (not `Promise.all`) calling the same endpoint for each.

---

## `AdminActivity.jsx`

3 tabs: Admin Actions, Tenant Activity, Security. Page size fixed at 50 rows. Auto-refreshes every 30s. Switching tabs resets `offset` and `filter` to 0/none.

| Tab | Endpoint | Filter param | Response key fallback chain |
|-----|----------|-------------|------------------------------|
| Admin Actions | `GET /api/admin/activity-log` | `action` (23-value `ACTION_TYPES` list) | `entries` \|\| `rows` \|\| `logs` \|\| `events` |
| Tenant Activity | `GET /api/admin/tenant-activity` | none | same |
| Security | `GET /api/admin/security-log` | `event_type` (login_success/login_failed) | same |

Pagination is offset-based (Previous/Next), page number derived from `offset/50 + 1`.

CSV export (`downloadCsv`) has distinct column sets per tab: Admin (time/admin/action/target_type/target_id/details), Tenant (time/tenant/action/entity_type/entity_id/performed_by), Security (time/event/email/ip_address/user_agent).

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

**Section 1 — Stuck Payment Intents**: `GET /api/admin/payment-intents/stuck?hours=<threshold>`. Shows tenant (linked to `/admin/tenants/:id`), plan/cycle, amount+currency, gateway, gateway_ref, status, and age (color: <2h slate, 2–6h amber, ≥6h red).

**Section 2 — Recent Payment Webhook Events (7 days)**: `GET /api/admin/webhooks/payment-dead-letters?limit=100`. Shows provider, event_type, payment_context+context_ref, event_id, processed status (emerald if `processed_at` set, else amber "Unprocessed"), created timestamp. **Read-only** — no retry/dismiss actions here (unlike `AdminDeadLetters.jsx`).

---

## Cross-cutting gotchas

- **Two different `adminFetch` implementations exist**: the shared one in `AdminLogin.jsx` (used everywhere else) and a local duplicate in `AdminTaxRates.jsx`. Don't assume importing `adminFetch` from `AdminLogin` covers all admin pages.
- **Impersonation always opens a new tab** at `/context-select?impersonate_token=...&impersonate_session=...&tenant_slug=...&tenant_name=...` — implemented independently in `AdminTenantDetail.jsx` and `AdminSupportTickets.jsx` (the latter also appends `&redirect=<page_url>` when available). No shared helper — if impersonation behavior changes, update both call sites.
- **No token refresh**: unlike the tenant `AuthProvider`, admin sessions don't silently refresh. A 401 from any endpoint should redirect to `/admin/login`; not every page currently checks for this consistently (e.g. some background fetches in `AdminTenantDetail.jsx` silently swallow errors with `.catch(() => {})`).
- **`plan-pricing` and `tax-rates` are global, not tenant-scoped** — edits from `AdminTenantDetail.jsx` or `AdminTaxRates.jsx` affect all tenants/currency-wide reference data, not just the one being viewed.
- Destructive actions (delete tenant, delete ticket, delete note, purge emails, retry-all) all gate behind `window.confirm` — no custom `ConfirmDialog` component is used here (that's a tenant-app-only primitive).
