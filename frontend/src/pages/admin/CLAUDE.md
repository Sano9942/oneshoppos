# Admin Pages — Claude Guide

- **11 files** — super-admin portal at `/admin` (dark violet/slate-900 theme)
- **Auth system**: completely separate from tenant auth. Uses `adminFetch` (Bearer token from `adminAuthStore`). Session in `localStorage["adminSession"]`. No `api.js`, no `AuthProvider` interceptor.
- Most admin pages **auto-refresh every 30s** via `setInterval` in `useEffect` (exceptions noted per file).

---

## `AdminLogin.jsx`

Login form + **re-export shim**.

**Defines `adminFetch`** (the canonical helper used by all other admin pages):
```js
export function adminFetch(path, options = {}) {
  const token = getAdminToken(); // from adminAuthStore
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers },
  });
}
```

**Also re-exports from `adminAuthStore`** (backward-compat shim — keeps existing import paths working):
```js
export { writeAdminSession, getAdminToken } from "../../auth/adminAuthStore";
export { clearAdminSession, getAdminSession } from "../../auth/adminAuthStore";
```

**Login**: `POST /api/admin/auth/login` with `{ email, password }`. Stores `{ token, admin, loadedAt }` via `writeAdminSession`. On session already present, redirects to `/admin` immediately.

---

## `AdminLayout.jsx`

Shell with **8-item** sidebar nav. Imports `{ adminFetch, clearAdminSession, getAdminToken, getAdminSession }` from `./AdminLogin`.

**Auth guard**: calls `getAdminToken()` directly at render time — redirects to `/admin/login` if no token (no React context, no effect).

**Support badge**: polls `GET /api/admin/support-tickets?status=open` every **60 seconds**. Shows open ticket count on the "Support" nav item.

**Nav items (in order):** Dashboard (`/admin` exact), Tenants (`/admin/tenants`), Support (`/admin/support`), Emails (`/admin/emails`), Activity (`/admin/activity`), Tax Rates (`/admin/tax-rates`), Dead Letters (`/admin/dead-letters`), **Stuck Payments (`/admin/stuck-payments`)**.

---

## `AdminDashboard.jsx`

Loads **8 parallel endpoints** on mount:

| Endpoint | State | Notes |
|----------|-------|-------|
| `GET /api/admin/stats` | `stats` | Tenant totals, plan distribution. **401 → redirect to login** (raw fetch with token header) |
| `GET /api/admin/attention` | `attention` | Approaching limits, dormant tenants, setup_pending (raw fetch) |
| `GET /api/admin/billing-attention` | `billingAttention` | due_soon, overdue, past_grace, pending_upgrades (raw fetch) |
| `GET /api/admin/revenue-stats` | `revenue` | via `adminFetch` |
| `GET /api/admin/worker-status` | `workers` | via `adminFetch` |
| `GET /api/admin/orphaned-schemas` | `orphans` | via `adminFetch` |
| `GET /api/admin/backup-history` | `backups` | via `adminFetch` |
| `GET /api/admin/announcements` | `announcements` | via `adminFetch` — CRUD form for creating announcements |

**`InfrastructurePanel` (internal component):**
- Polls `GET /api/admin/infra` at **60 seconds** (backend caches for 5 min, so 60s is sufficient)
- **Pauses when browser tab is hidden** via `visibilitychange` event — resumes + immediately fetches on tab focus
- Uses raw `fetch` with `Authorization: Bearer` header (not `adminFetch`)
- Shows: DB connections (total/active/idle/idle-in-tx with color bar), DB size MB, cache hit ratio (warning if <95%), dead tuples, schema sizes, slow queries running now, historical slow queries (`pg_stat_statements`), table health

**Announcements CRUD:** Create with type (info/warning/maintenance) + message + ends_at. Form shown via `showAnnouncementForm` toggle.

**Other dashboard actions:** "Run Migrations" (`POST /api/admin/migrate`), "Trigger Backup", "Run Cleanup" (orphaned schemas).

---

## `AdminTenantList.jsx`

Search + status filter (all/active/suspended). Tenant rows clickable → navigate to `/admin/tenants/:id`.

**`healthDot` logic (internal helper):**
- Setup not complete → slate (Setup pending)
- Never logged in → red (Never logged in)
- Last login < 1d → emerald (Active today)
- Last login < 7d → amber (`${n}d ago`)
- Last login ≥ 7d → red (`${n}d ago`)

**Columns:** Name, Slug, Health, Plan, Revenue (this month), Status, Payment status, Expires, Last Activity, Created, Delete action.

**Create modal:** fields: slug (lowercase/numbers/underscores, 3-40 chars), name, owner_email (optional), pin (required), timezone (default UTC), plan (free/pro). After success, shows setup URL in a copy-link modal. `POST /api/admin/tenants`.

**Delete modal:** requires typing the tenant `slug` exactly to confirm. `DELETE /api/admin/tenants/:id`. Does NOT use `doAction` helper — inline async handler.

**CSV export:** uses `downloadCsv` from `utils/csvExport.js`. Exports filtered rows (columns: Name, Slug, Plan, Status, Created).

---

## `AdminTenantDetail.jsx`

Loads on mount: `GET /api/admin/tenants/:id` + `GET /api/admin/tenants/:id/stats` in parallel. Then fires 7 more background fetches:
- `GET /api/admin/tenants/:id/setup-token` → `setupInfo`
- `GET /api/admin/tenants/:id/payments` → `payments`
- `GET /api/admin/plan-pricing` → `planPricing`
- `GET /api/admin/tenants/:id/feature-usage` → `featureUsage`
- `GET /api/admin/upgrade-requests` → filtered to this tenant's `upgradeReqs`
- `GET /api/admin/tenants/:id/feature-flags` → `featureFlags`
- `GET /api/admin/tenants/:id/notes` → `notes`

**Edit mode:** `editMode` boolean — toggles between read view and form for name/email/plan/timezone/max_employees/max_products/max_outlets. `PUT /api/admin/tenants/:id`.

**Actions (via `doAction` helper):**

| Button | Endpoint | Condition |
|--------|----------|-----------|
| Suspend | `POST /api/admin/tenants/:id/suspend` | tenant.status === "active" |
| Activate | `POST /api/admin/tenants/:id/activate` | tenant.status === "suspended" |
| Run Migrations | `POST /api/admin/tenants/:id/migrate` | active only |
| Reset PIN | `POST /api/admin/tenants/:id/reset-pin` | active only, `window.confirm` — resets to "0000" |
| Log in as Tenant (impersonate) | `POST /api/admin/impersonate/:id` | active only |
| Delete | `DELETE /api/admin/tenants/:id` | always available, `window.confirm` |

**Impersonation flow:** opens `/context-select?impersonate_token=...&impersonate_session=...&tenant_slug=...&tenant_name=...` in a **new tab**.

**Setup URL:** shown if `setupInfo.setup_complete === false`. "Regenerate Token" → `POST /api/admin/tenants/:id/regenerate-setup-token`.

**Feature flags toggle:** `PUT /api/admin/tenants/:id/feature-flags` with `{ key, enabled }`. Optimistically updates local state.

**Plan pricing editor:** inline edit of `planPricing` rows. `PUT /api/admin/plan-pricing/:id` with `{ price }`.

**Record Payment modal:** fields: plan, cycle, amount (auto-filled from planPricing), payment_method (bank_transfer default), reference_note. `POST /api/admin/tenants/:id/payments`.

**CRM Notes:** `POST /api/admin/tenants/:id/notes` (add), `DELETE /api/admin/tenants/:id/notes/:noteId` (delete, `window.confirm`).

---

## `AdminSupportTickets.jsx`

Auto-refreshes every **30 seconds**.

**Status filter:** all / open / acknowledged / resolved. Filter change triggers refetch + resets interval.

**Ticket statuses + styles:** `open` (amber), `acknowledged` (blue), `resolved` (emerald).

**Expanded row:** clicking a ticket shows full message, screenshots, page URL, browser info.

**Actions per ticket:**

| Action | Endpoint |
|--------|----------|
| Update status | `PUT /api/admin/support-tickets/:tenantId/:ticketId` with `{ status }` |
| Reply | `PUT /api/admin/support-tickets/:tenantId/:ticketId/reply` with `{ reply }` |
| Quick Impersonate | `POST /api/admin/impersonate/:tenantId` → opens new tab at `/context-select?...&redirect=${ticket.page_url}` if `page_url` set |
| Delete | `DELETE /api/admin/support-tickets/:tenantId/:ticketId` + confirm |

---

## `AdminEmails.jsx`

5-tab filter: All / Pending / Sent / Failed / **Broadcasts**.

Auto-refreshes every **30 seconds** — BUT stops polling when "Broadcasts" tab is active (loads from a different endpoint, no interval).

**Email type colors:** receipt/digest (blue), drip_* (violet), billing_payment_recorded/billing_plan_changed (emerald), billing_expiry_warning (amber), billing_overdue (red), support_* (sky), downtime (orange), announcement (indigo).

**Actions per email:**

| Action | Endpoint |
|--------|----------|
| Retry | `POST /api/admin/email-queue/:id/retry` |
| Send Now | `POST /api/admin/email-queue/:id/send-now` |
| Delete | `DELETE /api/admin/email-queue/:id` + confirm |

**Global actions:** "Purge Deleted Tenants" (removes emails for deleted tenants), CSV export via `downloadCsv`.

**Broadcasts tab:** `GET /api/admin/broadcast-history` + send form. Broadcast types: `downtime`, `announcement`. `POST /api/admin/broadcast`.

---

## `AdminDeadLetters.jsx`

Auto-refreshes every **30 seconds**.

**Per-event retry:** `POST /api/admin/dead-letters/:tenantId/:eventId/retry` — removes event from list on success.

**"Retry All" button:** loops through all events sequentially (not parallel). Shown only when `events.length > 0`.

**Event fields shown:** tenant (name + slug), event type (topic), status (dead_letter / pending), error message (truncated to 120 chars), retry count, failed at timestamp.

---

## `AdminActivity.jsx`

3 tabs: Admin Actions, Tenant Activity, Security. Page size: **50 rows** (`LIMIT` constant). Auto-refreshes every **30 seconds**. Tab change resets offset + filter.

| Tab | Endpoint | Filter param | Response key |
|-----|----------|-------------|--------------|
| Admin Actions | `GET /api/admin/activity-log` | `action` (from ACTION_TYPES list) | `entries` \| `rows` \| `logs` \| `events` |
| Tenant Activity | `GET /api/admin/tenant-activity` | none (no filter) | same |
| Security | `GET /api/admin/security-log` | `event_type` (login_success/login_failed) | same |

**Pagination:** offset-based. "Previous/Next" buttons. Page number shown.

**CSV export:** uses `downloadCsv`. Different column sets per tab (Admin: time/admin/action/target/details; Tenant: time/tenant/action/entity/performed_by; Security: time/event/email/ip/user_agent).

**`ACTION_TYPES`** filter options (23 values): tenant_created, updated, suspended, activated, deleted, pin_reset, migrated, migrate_all, payment_recorded, pricing_updated, impersonation_started/ended, broadcast_sent, note_added, announcement_created/deleted, email_deleted/force_sent/purge_deleted, ticket_replied/deleted, backup_created, orphaned_schemas_cleanup.

---

## `AdminTaxRates.jsx`

**Exception: defines its own local `adminFetch`** — does NOT import from `AdminLogin.jsx`. Uses `getAdminToken()` from `../../auth/adminAuthStore` and prepends full `${API}` URL.

**2 tabs:** Tax Rates (CRUD on `tax_rate_reference`) + Suggestions (review tenant-submitted corrections).

**Tax rate fields:** `hs_code`, `description`, plus 5 province rate fields: `federal_gst`, `punjab_pra`, `sindh_srb`, `kpk_kpra`, `balochistan_bra`.

**Suggestion review:** `PUT /api/admin/tax-rate-suggestions/:id` with `{ status: "approved"|"rejected", tenant_slug }`. Approved suggestions trigger a rates refetch.

**No auto-refresh polling.**

---

## `AdminStuckPayments.jsx`

Two sections in one page — payment debug tooling for ops.

**Auto-refreshes every 30 seconds.** Threshold selector (1h/2h/6h/24h) — changes trigger immediate refetch + interval reset.

**Section 1 — Stuck Payment Intents:**
- `GET /api/admin/payment-intents/stuck?hours=${thresholdHours}`
- Shows `intents` array: tenant name (link to detail), slug, plan/cycle, amount + currency, gateway, gateway_ref, status, age
- Age badge colors: <2h = slate, 2–6h = amber, ≥6h = red

**Section 2 — Recent Payment Webhook Events (Last 7 Days):**
- `GET /api/admin/webhooks/payment-dead-letters?limit=100`
- Shows `events` array: provider, event_type, payment_context + context_ref, event_id, processed status badge, created timestamp
- Processed = emerald badge, unprocessed = amber badge
- Read-only view — no retry/dismiss actions (unlike `AdminDeadLetters`)
