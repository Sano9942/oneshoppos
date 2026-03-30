# Super Admin Enhancement — Design Document

**Date:** 2026-03-31
**Scope:** 22 items across 4 phases — wire up hidden features, new admin features, support enhancements, cleanup

---

## Problem Statement

The super admin panel at `sanopos.com/admin` has significant gaps:
- 7 backend features built but not exposed in UI (tax rates, tenant delete, pricing editor, FBR health, bulk migrate, end impersonation, email queue actions)
- No revenue/MRR tracking, admin activity log, worker monitoring, or tenant notes
- Support ticket system lacks reply capability and tenant-side visibility
- Dead code: unused backup utility, unscheduled cleanup job, orphaned DB schemas

## Phases

### Phase 1: Wire Up Hidden Features (7 items)

**1.1 Tax Rates Page in Sidebar**
- Add `AdminTaxRates` nav entry in `AdminLayout.jsx`
- Page and 6 backend endpoints already exist
- Zero new code beyond one nav link

**1.2 Delete Tenant Button**
- Add red Delete button on `AdminTenantList.jsx` (each row) and `AdminTenantDetail.jsx`
- Confirmation modal requiring tenant slug typed to confirm
- Calls existing `DELETE /api/admin/tenants/:id` (already drops schema as of today's fix)

**1.3 Plan Pricing Editor**
- Add Edit button next to each plan in tenant detail billing section
- Modal form: price, billing cycle, feature flags
- Calls existing `PUT /api/admin/plan-pricing/:id`

**1.4 FBR Health Card**
- New card on admin dashboard below Infrastructure
- Shows: FBR API status, pending/failed invoices, last successful post
- Calls existing `GET /api/admin/fbr-health`

**1.5 Email Queue Actions**
- **Delete:** Red trash icon per row (pending/failed only). New `DELETE /api/admin/email-queue/:id` — hard deletes from `email_queue`
- **Force Send Now:** Blue button per row (pending only). New `POST /api/admin/email-queue/:id/send-now` — sets `send_at = NOW()`, `attempts = 0`
- **Purge Deleted Tenants:** Bulk button in header. New `DELETE /api/admin/email-queue/purge-deleted` — deletes all emails where `tenant_id` references a deleted tenant

**1.6 End Impersonation Button**
- Show "Active Impersonation Sessions" section on dashboard when sessions exist
- "End Session" button per session
- Calls existing `POST /api/admin/impersonate/:sessionId/end`

**1.7 Migrate All Button**
- Add "Migrate All Tenants" button in Infrastructure section of dashboard
- Confirmation modal
- Calls existing `POST /api/admin/migrate-all`
- Shows progress/result count

---

### Phase 2: New Admin Features (9 items)

**2.1 Revenue/MRR Dashboard Card**
- New section on dashboard between "Needs Attention" and "Infrastructure"
- 4 cards: Monthly MRR (sum of Pro tenants × plan price), Tenant Revenue This Month (cross-schema sales sum), Paying Tenants count, Overdue Payments count
- New `GET /api/admin/revenue-stats` endpoint

**2.2 Admin Activity Log**
- New `admin_activity_log` table in public schema (admin_email, action, target_type, target_id, details JSONB, ip_address, created_at)
- New `admin_security_log` table in public schema (event_type, email, ip_address, user_agent, details JSONB, created_at)
- New admin sidebar page "Activity" with 3 tabs:
  - **Admin Actions:** from `admin_activity_log` — filterable by action type
  - **Tenant Activity:** cross-schema query of tenant `action_history` tables — aggregated view
  - **Security:** from `admin_security_log` — login attempts, IPs
- `logAdminAction(email, action, target, details, ip)` helper added to every existing admin route
- Security logging added to admin login endpoint (success + failure)
- New routes: `GET /api/admin/activity-log`, `GET /api/admin/security-log`, `GET /api/admin/tenant-activity` (all paginated, filterable)

**2.3 Feature Flag Toggles**
- New "Feature Flags" section on tenant detail page below billing
- ON/OFF toggle switches for each flag (ai_insights, fbr_integration, accounting, advanced_crm, approvals, etc.)
- Reads from `tenant_plans`, updates via existing `PUT /api/admin/tenants/:id`
- No new tables

**2.4 Worker Status Monitor**
- New card on dashboard below Infrastructure
- Shows Email Worker + FBR Worker: status (Running/Stopped), queue depth, last poll time, sent/posted today count
- Workers add in-memory heartbeat (lastPollAt + counters) on each poll cycle
- New `GET /api/admin/worker-status` endpoint
- "Stopped" = lastPollAt older than 2× poll interval

**2.5 Tenant Notes**
- New `tenant_notes` table in public schema (tenant_id, admin_email, note, created_at)
- New section on tenant detail page — text input + chronological list of previous notes
- Routes: `GET /api/admin/tenants/:id/notes`, `POST /api/admin/tenants/:id/notes`, `DELETE /api/admin/tenants/:id/notes/:noteId`

**2.6 Announcement Banner**
- New `announcements` table in public schema (message, type [info/warning/maintenance], active, starts_at, ends_at, created_by, created_at)
- Admin: announcement management on dashboard or dedicated section — form with message, type, optional end time
- Tenant: `GET /api/announcements/active` (public, no auth) — returns active announcements
- Tenant frontend: dismissible banner at top of dashboard — blue (info), amber (warning), red (maintenance)
- Routes: `GET/POST /api/admin/announcements`, `PUT/DELETE /api/admin/announcements/:id`

**2.7 Broadcast History**
- New `broadcast_log` table in public schema (admin_email, broadcast_type, subject, message, recipient_count, created_at)
- Log entry created on every `POST /api/admin/email/broadcast`
- New "Broadcasts" tab on Emails page showing history
- No new routes — broadcast_log queried via existing email-queue endpoint (add `?tab=broadcasts` param)

**2.8 CSV Export**
- Add download CSV button on: Tenant List, Email Queue, Activity Log, Payment History (tenant detail)
- Client-side generation using existing `utils/csvExport.js`
- No new backend routes

**2.9 Orphaned Schema Detector**
- New card in Infrastructure section of dashboard
- Shows healthy state or lists orphaned schemas with sizes
- "Clean Up" button to drop orphans
- Routes: `GET /api/admin/orphaned-schemas`, `POST /api/admin/orphaned-schemas/cleanup`

---

### Phase 3: Support Enhancements (4 items)

**3.1 Unread Ticket Count Badge**
- Admin sidebar "Support" nav entry shows red badge with open ticket count
- Fetch count from existing `GET /api/admin/support-tickets` on layout mount + poll

**3.2 Delete Ticket Button**
- Red trash icon per ticket row
- New `DELETE /api/admin/support-tickets/:tenantId/:ticketId`
- Deletes from tenant's `support_tickets` table

**3.3 Admin Reply to Tenant**
- "Reply" button on each ticket row opens text input
- New columns on `support_tickets`: `admin_reply TEXT`, `replied_at TIMESTAMPTZ`
- New `PUT /api/admin/support-tickets/:tenantId/:ticketId/reply`
- On reply: updates ticket, sends notification email to employee, creates in-app notification in tenant's `notifications` table

**3.4 Tenant-Side "My Tickets" Page**
- New page at `/support` or `/my-tickets` in tenant app
- Shows employee's submitted tickets with status, admin reply
- Backend `GET /api/support/tickets` already exists
- Frontend page needs building

---

### Phase 4: Cleanup (2 items)

**4.1 Database Backup Button**
- "Database Backup" card in Infrastructure section
- "Backup Now" button triggers existing `backup-pg.js`
- Backup file uploaded to Cloudflare R2 under `backups/` prefix
- Writes to existing `backup_log` table
- Shows backup history with timestamps
- New routes: `POST /api/admin/backup`, `GET /api/admin/backup-history`

**4.2 Schedule Cleanup Dead Tenants**
- `cleanup-dead-tenants.js` runs as inline worker in Express (same pattern as email/FBR workers)
- Polls every 24 hours
- Finds tenants: `setup_complete = false` AND `created_at < NOW() - 7 days`
- Drops schema + deletes tenant record
- Logs to `admin_activity_log`
- Gated by `CLEANUP_WORKER_ENABLED=1` env var
- Status added to Worker Status Monitor card

---

## Database Changes — Migration v12

### Public schema (new tables)

```sql
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id SERIAL PRIMARY KEY,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_security_log (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  email TEXT,
  ip_address TEXT,
  user_agent TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_notes (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id),
  admin_email TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  active BOOLEAN DEFAULT true,
  starts_at TIMESTAMPTZ DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broadcast_log (
  id SERIAL PRIMARY KEY,
  admin_email TEXT NOT NULL,
  broadcast_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  recipient_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Per-tenant schema changes

```sql
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS admin_reply TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;
```

---

## New Backend Routes Summary

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/admin/email-queue/:id` | DELETE | Delete email from queue |
| `/api/admin/email-queue/:id/send-now` | POST | Force send pending email |
| `/api/admin/email-queue/purge-deleted` | DELETE | Purge deleted tenant emails |
| `/api/admin/revenue-stats` | GET | MRR + revenue aggregation |
| `/api/admin/activity-log` | GET | Paginated admin actions |
| `/api/admin/security-log` | GET | Paginated security events |
| `/api/admin/tenant-activity` | GET | Cross-schema tenant activity |
| `/api/admin/worker-status` | GET | Worker heartbeat status |
| `/api/admin/tenants/:id/notes` | GET | List tenant notes |
| `/api/admin/tenants/:id/notes` | POST | Add tenant note |
| `/api/admin/tenants/:id/notes/:noteId` | DELETE | Delete note |
| `/api/admin/announcements` | GET | List announcements |
| `/api/admin/announcements` | POST | Create announcement |
| `/api/admin/announcements/:id` | PUT | Update/deactivate |
| `/api/admin/announcements/:id` | DELETE | Delete announcement |
| `/api/announcements/active` | GET | Public — active announcements |
| `/api/admin/orphaned-schemas` | GET | Detect orphans |
| `/api/admin/orphaned-schemas/cleanup` | POST | Drop orphans |
| `/api/admin/backup` | POST | Trigger DB backup |
| `/api/admin/backup-history` | GET | List backup log |
| `/api/admin/support-tickets/:tId/:id/reply` | PUT | Admin reply |
| `/api/admin/support-tickets/:tId/:id` | DELETE | Delete ticket |

---

## New/Modified Frontend Files

| File | Change |
|------|--------|
| `AdminLayout.jsx` | Add Tax Rates + Activity to sidebar, support badge |
| `AdminDashboard.jsx` | Add Revenue, FBR Health, Workers, Orphan Detector, Backup, Migrate All, Active Impersonation cards |
| `AdminTenantList.jsx` | Add Delete button per row with confirmation |
| `AdminTenantDetail.jsx` | Add Feature Flags section, Notes section, Plan Pricing edit modal |
| `AdminEmails.jsx` | Add Delete/Send Now/Purge buttons, Broadcasts tab |
| `AdminSupportTickets.jsx` | Add Delete button, Reply modal, unread count |
| **New: `AdminActivity.jsx`** | 3-tab activity log page |
| **New: `MyTicketsRedesign.jsx`** | Tenant-side submitted tickets view |

---

## Worker Changes

| Worker | Change |
|--------|--------|
| Email worker (`workers/email-worker.js`) | Add heartbeat: `global.__emailWorkerStatus = { lastPollAt, sentToday, queueDepth }` |
| FBR worker (`workers/fbr-worker.js`) | Add heartbeat: `global.__fbrWorkerStatus = { lastPollAt, postedToday, queueDepth }` |
| **New: Cleanup worker** | `cleanup-dead-tenants.js` polled every 24h, gated by `CLEANUP_WORKER_ENABLED=1`, logs to `admin_activity_log` |

---

## Summary

- **22 items** across 4 phases
- **5 new tables** in public schema
- **2 new columns** in per-tenant `support_tickets`
- **22 new API routes**
- **2 new frontend pages**, 6 modified
- **3 worker changes** (2 heartbeats, 1 new scheduled job)
- **Migration v12** handles all schema changes
