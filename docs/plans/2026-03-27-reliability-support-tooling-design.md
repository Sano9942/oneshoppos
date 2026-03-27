# Reliability & Support Tooling — Design Document

**Date:** 2026-03-27
**Branch:** `feature/reliability-support-tooling`
**Status:** Approved

## Goals

1. Know when something breaks before tenants report it
2. Debug production issues fast with request tracing and tenant impersonation
3. Give tenants a way to report problems with full context (screenshots, request IDs)
4. Monitor system health and external dependencies proactively

## Approach

**Layered Middleware** — reliability added as Express middleware layers that every request flows through automatically. Sentry for error aggregation, UptimeRobot for uptime, everything else built in-house.

**Zero new monthly costs** — Sentry free tier (5K errors/mo), UptimeRobot free (50 monitors), Resend (existing) for alert emails, R2 (existing) for screenshot uploads.

---

## Deliverables

### 1. Request ID + Structured Logging (Pino)

**New files:**
- `backend/middleware/request-id.js` — generates UUID per request, sets `X-Request-Id` header
- `backend/services/logger.js` — Pino instance, JSON in production, pretty-print in dev

**Flow:**
```
Request in → request-id middleware (crypto.randomUUID())
  → Pino child logger: req.log = logger.child({ reqId, tenantSlug, employeeId })
  → Route uses req.log.info("sale completed", { saleId })
  → Response finish: auto-log { method, url, status, duration_ms, reqId, tenantSlug }
  → Requests >2s logged at warn level
```

**Key decisions:**
- Pino over Winston — 5x faster, JSON by default, better Express integration via `pino-http`
- Request ID in response header — tenants can share in support tickets
- Tenant slug + employee ID in every log line
- Existing `console.log`/`console.error` continues to work — gradual migration

**Verification:** `curl -v http://localhost:5000/api/health` → check `X-Request-Id` header in response, JSON log line in terminal with reqId.

---

### 2. Sentry Integration (Backend + Frontend)

**Backend (`@sentry/node`):**
- Initialize in `backend/index.js` before any other middleware
- `SENTRY_DSN` env var — no-op if missing (safe for local dev)
- Sentry request handler early in chain, error handler after routes
- Context tags: `reqId`, `tenantSlug`, `employeeId`

**Frontend (`@sentry/react`):**
- Initialize in `frontend/src/main.jsx` before `ReactDOM.createRoot`
- `VITE_SENTRY_DSN` env var — no-op if missing
- Captures unhandled JS errors + promise rejections
- User context: tenant slug, employee name

**NOT enabled:** Performance/Tracing, Session Replay, Profiling (all eat into free quota or are paid).

**Error response change:** All error responses now include `reqId`:
```json
{ "error": "Something went wrong", "reqId": "abc-123-def" }
```

**Verification:** Throw a test error in a route, confirm it appears in Sentry dashboard with tenant tag + reqId. Frontend: trigger a JS error, confirm Sentry captures it.

---

### 3. Frontend ErrorBoundary

**New file:** `frontend/src/ui/ErrorBoundary.jsx`

**Two levels:**
1. **Global boundary** (in `App.jsx`) — catches app-wide crashes, shows full-page "Something went wrong" + Reload button. Prevents white-screen-of-death.
2. **Page-level boundary** (wraps each route's `<Suspense>`) — crashes in one page show error card, sidebar/header still work, user can navigate away.

**Behavior:**
- Sends error to Sentry via `componentDidCatch`
- Shows user-friendly message with reqId if available
- Respects dark mode via CSS variable theming
- Dev mode shows stack trace
- Uses existing primitives (Button) + Tailwind

**Verification:** Temporarily add `throw new Error("test")` in a page component, confirm error boundary renders fallback UI instead of white screen.

---

### 4. In-House Alert System

**New files:**
- `backend/services/alerting.js` — in-memory sliding window counter
- `backend/utils/alertEmail.js` — alert email templates via Resend

**Alert triggers:**

| Trigger | Threshold | Cooldown | Email contains |
|---------|-----------|----------|----------------|
| Error spike | 10+ errors in 5 min | 30 min | Count, top 3 errors, affected tenants |
| DB connection pressure | Active > 80% of max | 1 hour | Current/max connections, longest query |
| Failed backup | Any `status = 'error'` | Per-backup | Tenant, error, last successful backup |
| Deep health check failure | Any dependency down | 15 min | Which dependency, response/error |

**Architecture:**
- In-memory Map (no DB table) — counters reset on deploy (correct behavior)
- Cooldown per alert type prevents email flooding
- `ALERT_EMAIL` env var — disabled if not set
- Uses Resend (existing)

**Verification:** Call `alerting.recordError()` 10 times in quick succession, confirm alert email is sent to `ALERT_EMAIL`. Confirm second batch within cooldown does NOT send.

---

### 5. Deep Health Check

**Modified file:** `backend/routes/registerAllRoutes.js`

**Endpoint:** `GET /api/health?deep=true`

| Dependency | How | Timeout |
|------------|-----|---------|
| Postgres | `SELECT 1` (existing) | 3s |
| Resend | `GET https://api.resend.com/domains` | 5s |
| Shopify (if configured) | `GET /admin/api/shop.json` | 5s |
| WooCommerce (if configured) | System status endpoint | 5s |

**Response:**
```json
{
  "status": "degraded",
  "timestamp": "...",
  "checks": {
    "database": { "status": "ok", "latency_ms": 2 },
    "resend": { "status": "ok", "latency_ms": 180 },
    "shopify": { "status": "down", "error": "401 Unauthorized" }
  }
}
```

- Status: `ok` / `degraded` / `down`
- `Promise.allSettled` with per-check timeout — one slow dependency doesn't block others
- Only checks configured integrations
- Feeds into alerting system (Section 4)
- Quick `/api/health` (no `?deep`) unchanged — UptimeRobot uses this

**Verification:** Hit `GET /api/health?deep=true` locally, confirm Postgres check passes, other checks skip gracefully when not configured.

---

### 6. Support Widget + Ticket System

**New files:**
- `frontend/src/ui/SupportWidget.jsx` — floating help button (bottom-right)
- `backend/routes/support.js` — ticket CRUD + screenshot upload

**New table (tenant schema, migration v6):**
```sql
CREATE TABLE support_tickets (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL DEFAULT 'bug',  -- bug, feature_request, question
  message TEXT NOT NULL,
  page_url TEXT,
  browser TEXT,
  employee_id INTEGER REFERENCES employees(id),
  screenshots JSONB DEFAULT '[]',           -- [{ filename, url }]
  last_req_id VARCHAR(64),
  status VARCHAR(20) DEFAULT 'open',        -- open, acknowledged, resolved
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);
```

**Frontend widget:**
- Floating button bottom-right corner, always visible (except on kiosk/customer-display)
- Form: type dropdown, message textarea, screenshot upload (max 3, max 5MB each), auto-attached page URL + browser info + last failed reqId
- Screenshots uploaded to R2 via `POST /api/support/upload` → `uploadToR2(buffer, "support/<ticketId>/<filename>", contentType)`

**Backend endpoints:**
- `POST /api/support/tickets` — create ticket, email to `ALERT_EMAIL` via Resend
- `POST /api/support/upload` — multer memoryStorage → R2
- `GET /api/support/tickets` — list (admin) or own tickets (employee)

**Admin panel:**
- New "Support Tickets" tab in super-admin dashboard
- Table: tenant, type, message preview, status, created_at
- Detail view: full message, inline screenshot thumbnails, status update buttons
- **"Impersonate this tenant"** button on each ticket — one click to debug

**Verification:** Open the app as a tenant employee, click support widget, submit a ticket with a screenshot, confirm it appears in admin panel with screenshot visible.

---

### 7. Dead Letter Queue UI (Admin Panel)

**New admin endpoints:**
- `GET /api/admin/dead-letters?tenant=&limit=` — list failed webhook events across tenants
- `POST /api/admin/dead-letters/:id/retry` — re-enqueue single event
- `POST /api/admin/dead-letters/retry-all` — batch retry

**Frontend:** New DeadLetterPanel component in admin dashboard.
- Table: event type, tenant, payload preview, error message, failed_at, retry count
- Actions: Retry (single), Retry All (batch), Dismiss (mark ignored)
- No new tables — reads from existing `shopify_webhook_events` filtered by failed status

**Verification:** Manually insert a `status = 'dead_letter'` row in `shopify_webhook_events`, confirm it shows in admin UI, click Retry, confirm status changes.

---

### 8. Tenant Impersonation

**Backend:**
- `POST /api/admin/impersonate/:tenantId` — super-admin only
- Creates 1-hour JWT with tenant's admin credentials + `impersonating: true` + `realIdentity: { superAdminId, name }`
- Logs to `tenant_audit_log`

**New table (master/public schema, migration v6):**
```sql
CREATE TABLE impersonation_sessions (
  id SERIAL PRIMARY KEY,
  super_admin_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP,
  pages_visited JSONB DEFAULT '[]',
  actions_taken INTEGER DEFAULT 0
);
```

**Frontend:**
- "Log in as tenant" button on admin tenant detail page
- Opens new tab with impersonation JWT
- Amber banner at top: `⚠ You are viewing as [Tenant Name] — Exit Impersonation`
- "Exit Impersonation" ends session + closes tab/redirects to admin
- Quick impersonate from support ticket detail page

**Safety rails:**
- 1-hour JWT expiry
- All actions logged in `action_history` with `(impersonated by Super-Admin)` suffix
- `impersonation_sessions` tracks pages visited + action count
- Super-admin only (`requireSuperAdmin` middleware)

**Verification:** As super-admin, click "Log in as tenant" on a tenant, confirm new tab opens with tenant data + amber banner visible. Perform an action, confirm `action_history` shows impersonation tag. Exit, confirm `impersonation_sessions.ended_at` is set.

---

## Out of Scope

- APM (DataDog/New Relic) — overkill at current scale
- Public status page — needed at 10+ tenants
- Circuit breakers — external API volume too low
- Log aggregation service — Railway logs sufficient
- Slack/SMS/PagerDuty alerts — email only for now
- Third-party ticketing (Zendesk/Intercom)

## External Setup (no code, do later)

- **Sentry:** Sign up at sentry.io, create Node.js + React projects, get DSN strings → set `SENTRY_DSN` on Railway, `VITE_SENTRY_DSN` on Vercel
- **UptimeRobot:** Sign up, add HTTP monitor for `https://oneshoppos-production.up.railway.app/api/health`, set email alert

## DB Migration (v6)

- `support_tickets` table in tenant schemas
- `impersonation_sessions` table in public/master schema
- Run via `node backend/migrate-pg.js` (migrates public + all tenant schemas)
