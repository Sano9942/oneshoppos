# Reliability & Support Tooling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add error tracking, structured logging, alerting, support tickets, and tenant impersonation to SanoPOS.

**Architecture:** Layered Express middleware (request-id → Pino logger → Sentry) with in-house alerting via Resend. Frontend ErrorBoundary + support widget. Admin panel extensions for dead letters and impersonation.

**Tech Stack:** Pino, @sentry/node, @sentry/react, Resend (existing), R2 (existing), multer

---

## Task 1: Install dependencies

**Files:**
- Modify: `backend/package.json`
- Modify: `frontend/package.json`

**Step 1: Install backend deps**

Run:
```bash
cd backend && npm install pino pino-http @sentry/node uuid
```

**Step 2: Install frontend deps**

Run:
```bash
cd frontend && npm install @sentry/react
```

**Step 3: Install backend dev dep for pretty logs**

Run:
```bash
cd backend && npm install -D pino-pretty
```

**Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json
git commit -m "chore: add pino, sentry, uuid dependencies"
```

---

## Task 2: Request ID middleware + Pino logger

**Files:**
- Create: `backend/middleware/request-id.js`
- Create: `backend/services/logger.js`
- Modify: `backend/index.js` (~line 230, before CORS)

**Step 1: Create the logger service**

Create `backend/services/logger.js`:
```js
const pino = require("pino");

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(process.env.NODE_ENV !== "production" && {
    transport: { target: "pino-pretty", options: { colorize: true } },
  }),
});

module.exports = logger;
```

**Step 2: Create request-id middleware**

Create `backend/middleware/request-id.js`:
```js
const crypto = require("crypto");
const pinoHttp = require("pino-http");
const logger = require("../services/logger");

/**
 * Generates a request ID, attaches Pino child logger to req.log,
 * and auto-logs request completion with timing.
 */
function createRequestMiddleware() {
  const httpLogger = pinoHttp({
    logger,
    genReqId: (req) => req.headers["x-request-id"] || crypto.randomUUID(),
    customProps: (req) => ({
      tenantSlug: req.tenantSlug || undefined,
      employeeId: req.employee?.id || undefined,
    }),
    customSuccessMessage: (req, res) =>
      `${req.method} ${req.originalUrl} ${res.statusCode}`,
    customErrorMessage: (req, res) =>
      `${req.method} ${req.originalUrl} ${res.statusCode}`,
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 500 || err) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        reqId: req.id,
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
  });

  return (req, res, next) => {
    httpLogger(req, res);
    // Set response header so clients can reference the request ID
    res.setHeader("X-Request-Id", req.id);
    // Track for slow request logging
    req._startTime = Date.now();
    const originalEnd = res.end;
    res.end = function (...args) {
      const duration = Date.now() - req._startTime;
      if (duration > 2000) {
        req.log.warn({ duration_ms: duration }, "Slow request detected");
      }
      originalEnd.apply(this, args);
    };
    next();
  };
}

module.exports = { createRequestMiddleware };
```

**Step 3: Wire into index.js**

In `backend/index.js`, after the compression middleware (~line 267) and before the CORS setup (~line 230), add the request middleware. Specifically, add it right after `app.use(compression())` on line 267:

```js
// After existing: app.use(compression());
const { createRequestMiddleware } = require("./middleware/request-id");
app.use(createRequestMiddleware());
```

Import goes at the top of the file with other requires.

**Step 4: Verify**

Run backend:
```bash
cd backend && npm start
```

Then in another terminal:
```bash
curl -v http://localhost:5000/api/health 2>&1 | grep -i x-request-id
```

Expected: `X-Request-Id: <uuid>` in response headers, and a JSON log line in the backend terminal showing the request with `reqId`.

**Step 5: Commit**

```bash
git add backend/services/logger.js backend/middleware/request-id.js backend/index.js
git commit -m "feat: request ID middleware + Pino structured logging"
```

### ✅ Checkpoint 1: Verify before continuing
- [ ] Backend starts without errors
- [ ] `curl -v /api/health` shows `X-Request-Id` header
- [ ] Terminal shows JSON (prod) or pretty-printed (dev) log line with reqId
- [ ] Existing routes still work (test a few in browser)

---

## Task 3: Sentry backend integration

**Files:**
- Modify: `backend/index.js` (top of file + after routes)

**Step 1: Add Sentry init at top of index.js**

After `require("dotenv").config(...)` on line 1, before everything else:

```js
const Sentry = require("@sentry/node");
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    // No tracing — we use our own request timing
    tracesSampleRate: 0,
  });
}
```

**Step 2: Add Sentry error handler after routes**

After `registerAllRoutes(app, deps)` is called (~line 962), add a global error handler:

```js
// Global error handler — catches unhandled route errors
app.use((err, req, res, _next) => {
  const reqId = req.id || "unknown";
  if (req.log) {
    req.log.error({ err, reqId }, "Unhandled route error");
  } else {
    console.error("Unhandled route error:", err);
  }
  Sentry.captureException(err, {
    tags: { tenantSlug: req.tenantSlug, reqId },
    user: { id: req.employee?.id, username: req.employee?.name },
  });
  res.status(err.status || 500).json({ error: err.message || "Internal server error", reqId });
});
```

**Step 3: Enrich Sentry context in existing try-catch blocks**

In routes that already have try-catch (e.g., `routes/sales.js`), the global error handler catches errors that slip through. No need to modify every route — unhandled errors automatically go to Sentry via the global handler.

**Step 4: Verify (without Sentry account — just verify no crashes)**

Run backend:
```bash
cd backend && npm start
```

Confirm: no errors on startup (SENTRY_DSN not set = no-op). All existing routes work.

**Step 5: Commit**

```bash
git add backend/index.js
git commit -m "feat: Sentry backend integration (no-op without DSN)"
```

### ✅ Checkpoint 2: Verify before continuing
- [ ] Backend starts cleanly with no `SENTRY_DSN` set
- [ ] Error responses now include `reqId` field
- [ ] No regressions — test a sale or product fetch in browser

---

## Task 4: Sentry frontend integration + ErrorBoundary

**Files:**
- Modify: `frontend/src/main.jsx`
- Create: `frontend/src/ui/ErrorBoundary.jsx`
- Modify: `frontend/src/App.jsx`

**Step 1: Add Sentry init in main.jsx**

At the top of `frontend/src/main.jsx`, before `createRoot`:

```js
import * as Sentry from "@sentry/react";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    // No tracing or replay
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
  });
}
```

**Step 2: Create ErrorBoundary component**

Create `frontend/src/ui/ErrorBoundary.jsx`:
```jsx
import { Component } from "react";
import * as Sentry from "@sentry/react";
import { Button } from "./primitives";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    if (import.meta.env.VITE_SENTRY_DSN) {
      Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) this.props.onReset();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    // Page-level (compact) vs global (full-page)
    if (this.props.level === "page") {
      return (
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <div className="text-5xl mb-4">⚠</div>
          <h2 className="text-lg font-semibold text-(--text-primary) mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-(--text-secondary) mb-4 max-w-md">
            This page encountered an error. You can try reloading or navigate to another page.
          </p>
          {import.meta.env.DEV && this.state.error && (
            <pre className="text-xs text-left bg-red-50 dark:bg-red-900/20 p-3 rounded mb-4 max-w-lg overflow-auto">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex gap-3">
            <Button variant="secondary" onClick={this.handleReset}>
              Try Again
            </Button>
            <Button onClick={() => window.location.reload()}>
              Reload Page
            </Button>
          </div>
        </div>
      );
    }

    // Global (full-page fallback)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-(--bg-primary)">
        <div className="text-6xl mb-6">⚠</div>
        <h1 className="text-2xl font-bold text-(--text-primary) mb-3">
          Something went wrong
        </h1>
        <p className="text-(--text-secondary) mb-6 max-w-md">
          The application encountered an unexpected error. Please reload to continue.
        </p>
        {import.meta.env.DEV && this.state.error && (
          <pre className="text-xs text-left bg-red-50 dark:bg-red-900/20 p-4 rounded mb-6 max-w-lg overflow-auto">
            {this.state.error.stack}
          </pre>
        )}
        <Button onClick={() => window.location.reload()}>
          Reload Application
        </Button>
      </div>
    );
  }
}
```

**Step 3: Wrap App.jsx with ErrorBoundary**

In `frontend/src/main.jsx`, wrap the app tree:

```jsx
import { ErrorBoundary } from "./ui/ErrorBoundary";

// Inside render:
<StrictMode>
  <ErrorBoundary>
    <CurrencyProvider>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </CurrencyProvider>
  </ErrorBoundary>
</StrictMode>
```

In `frontend/src/App.jsx`, wrap each route's `<Suspense>` with a page-level boundary:

```jsx
import { ErrorBoundary } from "./ui/ErrorBoundary";

// Pattern for each lazy route:
<ErrorBoundary level="page">
  <Suspense fallback={<RouteLoading />}>
    <LazyComponent />
  </Suspense>
</ErrorBoundary>
```

**Step 4: Verify**

Run frontend:
```bash
cd frontend && npm run dev
```

Temporarily add `throw new Error("test boundary")` at the top of any page component's render. Confirm:
- Page-level boundary shows error card, sidebar still works
- Remove the throw, confirm normal rendering

**Step 5: Commit**

```bash
git add frontend/src/ui/ErrorBoundary.jsx frontend/src/main.jsx frontend/src/App.jsx
git commit -m "feat: Sentry frontend + ErrorBoundary (global + page-level)"
```

### ✅ Checkpoint 3: Verify before continuing
- [ ] Frontend starts cleanly with no `VITE_SENTRY_DSN`
- [ ] Throwing an error in a page shows error boundary (not white screen)
- [ ] Sidebar/header still work when a page crashes
- [ ] Removing the test throw restores normal behavior

---

## Task 5: In-house alert system

**Files:**
- Create: `backend/services/alerting.js`
- Create: `backend/utils/alertEmail.js`
- Modify: `backend/index.js` (wire into global error handler)

**Step 1: Create alert email utility**

Create `backend/utils/alertEmail.js`:
```js
const { sendEmail } = require("./resendEmail");
const logger = require("../services/logger");

const ALERT_EMAIL = process.env.ALERT_EMAIL;

async function sendAlertEmail({ subject, html }) {
  if (!ALERT_EMAIL) return;
  try {
    await sendEmail({
      to: ALERT_EMAIL,
      subject: `[SanoPOS Alert] ${subject}`,
      html,
    });
  } catch (err) {
    logger.error({ err }, "Failed to send alert email");
  }
}

module.exports = { sendAlertEmail };
```

**Step 2: Create alerting service**

Create `backend/services/alerting.js`:
```js
const { sendAlertEmail } = require("../utils/alertEmail");
const logger = require("./logger");

// Sliding window: Map<alertType, { count, errors[], firstAt, lastAlertAt }>
const windows = new Map();

const THRESHOLDS = {
  error_spike: { count: 10, windowMs: 5 * 60 * 1000, cooldownMs: 30 * 60 * 1000 },
  db_pressure: { count: 1, windowMs: 60 * 1000, cooldownMs: 60 * 60 * 1000 },
  backup_failed: { count: 1, windowMs: 60 * 1000, cooldownMs: 0 }, // one email per backup failure
  health_check_failed: { count: 1, windowMs: 60 * 1000, cooldownMs: 15 * 60 * 1000 },
};

function getWindow(type) {
  if (!windows.has(type)) {
    windows.set(type, { count: 0, errors: [], firstAt: null, lastAlertAt: 0 });
  }
  return windows.get(type);
}

function cleanWindow(win, windowMs) {
  const cutoff = Date.now() - windowMs;
  if (win.firstAt && win.firstAt < cutoff) {
    win.count = 0;
    win.errors = [];
    win.firstAt = null;
  }
}

/**
 * Record an error occurrence. Sends alert email if threshold breached.
 */
async function recordError({ tenant, message, reqId }) {
  const type = "error_spike";
  const threshold = THRESHOLDS[type];
  const win = getWindow(type);

  cleanWindow(win, threshold.windowMs);

  if (!win.firstAt) win.firstAt = Date.now();
  win.count++;
  // Keep top errors (deduped by message, max 10)
  if (win.errors.length < 10 && !win.errors.find((e) => e.message === message)) {
    win.errors.push({ message, tenant, reqId });
  }

  if (win.count >= threshold.count) {
    const now = Date.now();
    if (now - win.lastAlertAt > threshold.cooldownMs) {
      win.lastAlertAt = now;
      const tenants = [...new Set(win.errors.map((e) => e.tenant).filter(Boolean))];
      await sendAlertEmail({
        subject: `Error spike: ${win.count} errors in 5 min`,
        html: `
          <h2>Error Spike Alert</h2>
          <p><strong>${win.count}</strong> errors in the last 5 minutes.</p>
          <p><strong>Affected tenants:</strong> ${tenants.join(", ") || "unknown"}</p>
          <h3>Top errors:</h3>
          <ul>${win.errors.map((e) => `<li>${e.message} (tenant: ${e.tenant || "?"}, reqId: ${e.reqId || "?"})</li>`).join("")}</ul>
          <p><a href="https://sanopos.vercel.app/admin">Open Admin Panel</a></p>
        `,
      });
      logger.warn({ count: win.count, tenants }, "Error spike alert sent");
      // Reset window after alert
      win.count = 0;
      win.errors = [];
      win.firstAt = null;
    }
  }
}

/**
 * Record a DB pressure event.
 */
async function recordDbPressure({ active, max, longestQuery }) {
  const type = "db_pressure";
  const threshold = THRESHOLDS[type];
  const win = getWindow(type);
  const now = Date.now();

  if (now - win.lastAlertAt > threshold.cooldownMs) {
    win.lastAlertAt = now;
    await sendAlertEmail({
      subject: `DB connection pressure: ${active}/${max}`,
      html: `
        <h2>Database Connection Pressure</h2>
        <p><strong>Active:</strong> ${active} / ${max} (${Math.round((active / max) * 100)}%)</p>
        ${longestQuery ? `<p><strong>Longest running query:</strong> ${longestQuery}</p>` : ""}
        <p><a href="https://sanopos.vercel.app/admin">Open Admin Panel</a></p>
      `,
    });
  }
}

/**
 * Record a health check failure.
 */
async function recordHealthCheckFailure({ dependency, error }) {
  const type = "health_check_failed";
  const threshold = THRESHOLDS[type];
  const win = getWindow(type);
  const now = Date.now();

  if (now - win.lastAlertAt > threshold.cooldownMs) {
    win.lastAlertAt = now;
    await sendAlertEmail({
      subject: `Dependency down: ${dependency}`,
      html: `
        <h2>Health Check Failure</h2>
        <p><strong>Dependency:</strong> ${dependency}</p>
        <p><strong>Error:</strong> ${error}</p>
        <p><a href="https://sanopos.vercel.app/admin">Open Admin Panel</a></p>
      `,
    });
  }
}

module.exports = { recordError, recordDbPressure, recordHealthCheckFailure };
```

**Step 3: Wire alerting into the global error handler in index.js**

Update the global error handler from Task 3:

```js
const alerting = require("./services/alerting");

app.use((err, req, res, _next) => {
  const reqId = req.id || "unknown";
  if (req.log) {
    req.log.error({ err, reqId }, "Unhandled route error");
  } else {
    console.error("Unhandled route error:", err);
  }
  Sentry.captureException(err, {
    tags: { tenantSlug: req.tenantSlug, reqId },
    user: { id: req.employee?.id, username: req.employee?.name },
  });
  // Fire-and-forget alert check
  alerting.recordError({
    tenant: req.tenantSlug,
    message: err.message,
    reqId,
  }).catch(() => {});
  res.status(err.status || 500).json({ error: err.message || "Internal server error", reqId });
});
```

**Step 4: Verify**

Set `ALERT_EMAIL=your@email.com` in `.env`. Write a quick test route (temporary):
```js
app.get("/api/test-alert", (req, res, next) => { next(new Error("Test alert")); });
```
Hit it 10+ times in rapid succession. Confirm alert email arrives. Remove test route.

**Step 5: Commit**

```bash
git add backend/services/alerting.js backend/utils/alertEmail.js backend/index.js
git commit -m "feat: in-house alert system — error spikes, DB pressure, health failures"
```

### ✅ Checkpoint 4: Verify before continuing
- [ ] Backend starts without errors
- [ ] Alert email sent after 10 rapid errors (if ALERT_EMAIL set)
- [ ] No email sent if ALERT_EMAIL is unset
- [ ] Cooldown works — rapid repeat doesn't flood inbox

---

## Task 6: Deep health check

**Files:**
- Modify: `backend/routes/registerAllRoutes.js` (~line 51, existing `/api/health`)

**Step 1: Create deep health check logic**

Add a `checkDependencies` async function in `registerAllRoutes.js` (or a new `backend/services/health.js` if preferred). It runs checks in parallel with per-check timeouts:

```js
const logger = require("../services/logger");
const alerting = require("../services/alerting");

async function checkDependency(name, fn, timeoutMs = 5000) {
  const start = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs)),
    ]);
    return { status: "ok", latency_ms: Date.now() - start, ...result };
  } catch (err) {
    return { status: "down", error: err.message, latency_ms: Date.now() - start };
  }
}

async function deepHealthCheck(db) {
  const checks = {};

  // Always check Postgres
  checks.database = await checkDependency("database", async () => {
    await db.query("SELECT 1");
    return {};
  }, 3000);

  // Check Resend if configured
  if (process.env.RESEND_API_KEY) {
    checks.resend = await checkDependency("resend", async () => {
      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return {};
    });
  }

  // Alert on failures
  for (const [name, result] of Object.entries(checks)) {
    if (result.status === "down") {
      alerting.recordHealthCheckFailure({ dependency: name, error: result.error }).catch(() => {});
    }
  }

  const overall = checks.database?.status === "down"
    ? "down"
    : Object.values(checks).some((c) => c.status === "down")
      ? "degraded"
      : "ok";

  return { status: overall, timestamp: new Date().toISOString(), checks };
}
```

**Step 2: Extend existing /api/health endpoint**

Modify the existing handler (~line 51 of registerAllRoutes.js):

```js
app.get("/api/health", async (req, res) => {
  if (req.query.deep === "true") {
    const result = await deepHealthCheck(deps.db);
    return res.status(result.status === "down" ? 503 : 200).json(result);
  }
  // ... existing quick health check logic unchanged ...
});
```

**Step 3: Verify**

```bash
curl http://localhost:5000/api/health
# → existing response (unchanged)

curl http://localhost:5000/api/health?deep=true
# → { "status": "ok", "checks": { "database": { "status": "ok", "latency_ms": 2 } } }
```

**Step 4: Commit**

```bash
git add backend/routes/registerAllRoutes.js
git commit -m "feat: deep health check — Postgres + Resend dependency checks"
```

### ✅ Checkpoint 5: Verify before continuing
- [ ] `GET /api/health` still returns quick check (unchanged)
- [ ] `GET /api/health?deep=true` returns dependency check results
- [ ] Postgres check passes with latency
- [ ] Unconfigured dependencies are skipped (no errors)

---

## Task 7: DB migration v8 — support_tickets + impersonation_sessions

**Files:**
- Modify: `backend/migrate-pg.js` (add version 8)
- Modify: `backend/schema-pg.sql` (add tables for new tenants)
- Modify: `backend/master-db-pg.js` (add impersonation_sessions to master schema)

**Step 1: Add migration v8 to migrate-pg.js**

After the version 7 entry in the MIGRATIONS array:

```js
{
  version: 8,
  description: "Add support_tickets (tenant) + impersonation_sessions (master)",
  up: async (client) => {
    // support_tickets — tenant schema table
    await client.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id              SERIAL PRIMARY KEY,
        type            VARCHAR(20) NOT NULL DEFAULT 'bug',
        message         TEXT NOT NULL,
        page_url        TEXT,
        browser         TEXT,
        employee_id     INTEGER REFERENCES employees(id),
        screenshots     JSONB DEFAULT '[]',
        last_req_id     VARCHAR(64),
        status          VARCHAR(20) DEFAULT 'open',
        created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        resolved_at     TIMESTAMPTZ
      );
    `);

    // impersonation_sessions — only in public/master schema
    const { rows } = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'tenants' LIMIT 1"
    );
    if (rows.length) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS impersonation_sessions (
          id              SERIAL PRIMARY KEY,
          super_admin_id  INTEGER NOT NULL,
          tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
          started_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          ended_at        TIMESTAMPTZ,
          pages_visited   JSONB DEFAULT '[]',
          actions_taken   INTEGER DEFAULT 0
        );
      `);
    }
  },
},
```

**Step 2: Add support_tickets to schema-pg.sql**

Append before the `schema_version` table definition:

```sql
CREATE TABLE IF NOT EXISTS support_tickets (
  id              SERIAL PRIMARY KEY,
  type            VARCHAR(20) NOT NULL DEFAULT 'bug',
  message         TEXT NOT NULL,
  page_url        TEXT,
  browser         TEXT,
  employee_id     INTEGER REFERENCES employees(id),
  screenshots     JSONB DEFAULT '[]',
  last_req_id     VARCHAR(64),
  status          VARCHAR(20) DEFAULT 'open',
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  resolved_at     TIMESTAMPTZ
);
```

**Step 3: Add impersonation_sessions to master-db-pg.js MASTER_SCHEMA**

After the `tenant_refresh_tokens` table definition:

```sql
CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id              SERIAL PRIMARY KEY,
  super_admin_id  INTEGER NOT NULL,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  started_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ended_at        TIMESTAMPTZ,
  pages_visited   JSONB DEFAULT '[]',
  actions_taken   INTEGER DEFAULT 0
);
```

**Step 4: Verify**

```bash
cd backend && DATABASE_URL=your_dev_db node migrate-pg.js
```

Confirm migration v8 applies cleanly. Check tables exist:
```bash
psql $DATABASE_URL -c "\dt tenant_packagesmall.support_tickets"
psql $DATABASE_URL -c "\dt public.impersonation_sessions"
```

**Step 5: Commit**

```bash
git add backend/migrate-pg.js backend/schema-pg.sql backend/master-db-pg.js
git commit -m "feat: migration v8 — support_tickets + impersonation_sessions tables"
```

### ✅ Checkpoint 6: Verify before continuing
- [ ] Migration runs without errors
- [ ] `support_tickets` table exists in tenant schema
- [ ] `impersonation_sessions` table exists in public schema
- [ ] Backend starts cleanly after migration

---

## Task 8: Support ticket backend routes

**Files:**
- Create: `backend/routes/support.js`
- Modify: `backend/routes/registerAllRoutes.js` (register new routes)

**Step 1: Create support routes**

Create `backend/routes/support.js`:

```js
const express = require("express");
const multer = require("multer");
const { uploadToR2 } = require("../utils/r2");
const { sendAlertEmail } = require("../utils/alertEmail");
const logger = require("../services/logger");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});

module.exports = function supportRoutes(app, deps) {
  const { db } = deps;

  // Create support ticket
  app.post("/api/support/tickets", async (req, res) => {
    try {
      const { type = "bug", message, page_url, browser, screenshots = [], last_req_id } = req.body;
      if (!message || !message.trim()) return res.status(400).json({ error: "Message is required" });

      const { rows } = await db.query(
        `INSERT INTO support_tickets (type, message, page_url, browser, employee_id, screenshots, last_req_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [type, message.trim(), page_url, browser, req.employee?.id, JSON.stringify(screenshots), last_req_id]
      );

      // Send alert email (fire-and-forget)
      const tenant = req.tenantSlug || "unknown";
      const employee = req.employee?.name || "Unknown";
      sendAlertEmail({
        subject: `New ${type} ticket from ${tenant}`,
        html: `
          <h2>Support Ticket</h2>
          <p><strong>Tenant:</strong> ${tenant}</p>
          <p><strong>Employee:</strong> ${employee}</p>
          <p><strong>Type:</strong> ${type}</p>
          <p><strong>Page:</strong> ${page_url || "N/A"}</p>
          <p><strong>Request ID:</strong> ${last_req_id || "N/A"}</p>
          <p><strong>Message:</strong></p>
          <blockquote>${message}</blockquote>
          ${screenshots.length ? `<p><strong>Screenshots:</strong> ${screenshots.length} attached — view in admin panel</p>` : ""}
          <p><a href="https://sanopos.vercel.app/admin">Open Admin Panel</a></p>
        `,
      }).catch(() => {});

      res.status(201).json(rows[0]);
    } catch (err) {
      req.log?.error({ err }, "Failed to create support ticket");
      res.status(500).json({ error: err.message });
    }
  });

  // Upload screenshot to R2
  app.post("/api/support/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file provided" });
      const key = `support/${Date.now()}-${req.file.originalname}`;
      const url = await uploadToR2(req.file.buffer, key, req.file.mimetype);
      res.json({ filename: req.file.originalname, url });
    } catch (err) {
      req.log?.error({ err }, "Failed to upload support screenshot");
      res.status(500).json({ error: err.message });
    }
  });

  // List own tickets (any employee)
  app.get("/api/support/tickets", async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT * FROM support_tickets WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [req.employee?.id]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
```

**Step 2: Register routes in registerAllRoutes.js**

Add after other route registrations:

```js
require("./support")(app, deps);
```

**Step 3: Verify**

```bash
curl -X POST http://localhost:5000/api/support/tickets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt>" \
  -d '{"type":"bug","message":"Test ticket","page_url":"/returns"}'
```

Expected: 201 with ticket object. If `ALERT_EMAIL` set, email arrives.

**Step 4: Commit**

```bash
git add backend/routes/support.js backend/routes/registerAllRoutes.js
git commit -m "feat: support ticket backend — create, upload screenshots, list"
```

### ✅ Checkpoint 7: Verify before continuing
- [ ] POST /api/support/tickets creates a ticket
- [ ] POST /api/support/upload stores file in R2 (or local fallback)
- [ ] GET /api/support/tickets returns employee's own tickets
- [ ] Alert email sent to ALERT_EMAIL on ticket creation

---

## Task 9: Support widget frontend

**Files:**
- Create: `frontend/src/ui/SupportWidget.jsx`
- Modify: `frontend/src/App.jsx` (or `AppLayoutRedesign.jsx`) to include the widget

**Step 1: Create SupportWidget component**

Create `frontend/src/ui/SupportWidget.jsx` — floating button (bottom-right), expands into a form modal with:
- Type dropdown (bug, feature_request, question)
- Message textarea
- Screenshot upload (drag-and-drop + file picker, max 3 files, 5MB each)
- Auto-captures: current page URL, browser info (`navigator.userAgent`), last failed request ID (from a global ref)
- Submit calls `POST /api/support/upload` per screenshot, then `POST /api/support/tickets` with screenshot URLs
- Success toast via `useToast()`

**Step 2: Track last failed request ID**

In `frontend/src/auth/AuthProvider.jsx` (where the global fetch interceptor lives), capture `X-Request-Id` from error responses:

```js
// In the fetch interceptor, on error responses:
window.__lastFailedReqId = response.headers.get("X-Request-Id");
```

The SupportWidget reads `window.__lastFailedReqId` when opening the form.

**Step 3: Add widget to layout**

In `AppLayoutRedesign.jsx` (the main authenticated layout), add `<SupportWidget />` as a sibling to the main content. Skip rendering on kiosk and customer-display routes.

**Step 4: Verify**

- Open app in browser
- See floating help button in bottom-right
- Click it, fill form, attach a screenshot, submit
- Confirm ticket appears in DB and alert email sent
- Confirm it doesn't appear on kiosk pages

**Step 5: Commit**

```bash
git add frontend/src/ui/SupportWidget.jsx frontend/src/auth/AuthProvider.jsx frontend/src/pages/redesign/AppLayoutRedesign.jsx
git commit -m "feat: in-app support widget with screenshot upload"
```

### ✅ Checkpoint 8: Verify before continuing
- [ ] Floating button visible on all pages (except kiosk/customer-display)
- [ ] Form opens, validates, submits
- [ ] Screenshots upload to R2
- [ ] Ticket created with all context (page, browser, reqId)
- [ ] Toast shown on success

---

## Task 10: Admin panel — support tickets + dead letter queue

**Files:**
- Modify: `backend/routes/admin.js` (add admin ticket endpoints + dead letter endpoints)
- Create: `frontend/src/pages/admin/AdminSupportTickets.jsx`
- Create: `frontend/src/pages/admin/AdminDeadLetters.jsx`
- Modify: `frontend/src/pages/admin/AdminDashboard.jsx` (add tabs)

**Step 1: Add admin support ticket endpoints**

In `backend/routes/admin.js`:

```js
// List all tickets across tenants (super-admin)
app.get("/api/admin/support-tickets", requireSuperAdmin, async (req, res) => { ... });

// Update ticket status
app.put("/api/admin/support-tickets/:tenantId/:ticketId", requireSuperAdmin, async (req, res) => { ... });
```

These query each tenant's `support_tickets` table and aggregate results.

**Step 2: Add dead letter endpoints**

```js
// List failed webhook events across tenants
app.get("/api/admin/dead-letters", requireSuperAdmin, async (req, res) => { ... });

// Retry a dead letter
app.post("/api/admin/dead-letters/:tenantId/:id/retry", requireSuperAdmin, async (req, res) => { ... });

// Retry all dead letters
app.post("/api/admin/dead-letters/retry-all", requireSuperAdmin, async (req, res) => { ... });
```

**Step 3: Create admin ticket viewer component**

`AdminSupportTickets.jsx` — table with tenant, type, message preview, status, screenshots (inline thumbnails), created_at. Status update buttons (acknowledge, resolve). "Impersonate" button per ticket.

**Step 4: Create dead letter panel component**

`AdminDeadLetters.jsx` — table with event type, tenant, error message, failed_at, retry count. Retry/Retry All/Dismiss buttons.

**Step 5: Add tabs to admin dashboard**

Add "Support" and "Dead Letters" tabs alongside existing tabs in `AdminDashboard.jsx`.

**Step 6: Verify**

- Log in as super-admin at `/admin`
- See Support tab with any tickets created in Task 9
- See Dead Letters tab (empty if no failed webhooks)
- Update a ticket status, confirm it persists

**Step 7: Commit**

```bash
git add backend/routes/admin.js frontend/src/pages/admin/
git commit -m "feat: admin panel — support tickets viewer + dead letter queue management"
```

### ✅ Checkpoint 9: Verify before continuing
- [ ] Super-admin can see all tickets across tenants
- [ ] Ticket status can be updated (open → acknowledged → resolved)
- [ ] Screenshots visible inline
- [ ] Dead letter list renders (test with manual DB insert if needed)
- [ ] Retry button works

---

## Task 11: Tenant impersonation

**Files:**
- Modify: `backend/routes/admin.js` (add impersonation endpoint)
- Modify: `frontend/src/pages/admin/AdminTenantDetail.jsx` (add impersonate button)
- Create: `frontend/src/ui/ImpersonationBanner.jsx`
- Modify: `frontend/src/auth/AuthProvider.jsx` (detect impersonation token)
- Modify: `frontend/src/App.jsx` (render banner)

**Step 1: Add impersonation backend endpoint**

In `backend/routes/admin.js`:

```js
// POST /api/admin/impersonate/:tenantId
// Creates a 1-hour JWT as the tenant's admin, with impersonating flag
app.post("/api/admin/impersonate/:tenantId", requireSuperAdmin, async (req, res) => {
  const tenantId = parseInt(req.params.tenantId);
  // 1. Look up tenant in master DB
  // 2. Find tenant's admin employee (role_id = 1)
  // 3. Create JWT with { employeeId, tenantId, impersonating: true, realIdentity: { id, name } }
  // 4. Set 1-hour expiry
  // 5. Log to tenant_audit_log
  // 6. Create impersonation_sessions row
  // 7. Return { token, tenantSlug, sessionId }
});

// POST /api/admin/impersonate/:sessionId/end
// Ends impersonation session
app.post("/api/admin/impersonate/:sessionId/end", requireSuperAdmin, async (req, res) => {
  // Update impersonation_sessions.ended_at
});
```

**Step 2: Add impersonate button to tenant detail**

In `AdminTenantDetail.jsx`, add a button "Log in as tenant" that:
1. Calls `POST /api/admin/impersonate/:tenantId`
2. Opens new tab: `https://sanopos.vercel.app/?impersonate_token=<jwt>&impersonate_session=<id>`

**Step 3: Create ImpersonationBanner component**

`frontend/src/ui/ImpersonationBanner.jsx`:
- Fixed amber banner at top of viewport
- Shows "You are viewing as [Tenant Name] — Exit Impersonation"
- Exit button: calls end-session endpoint, clears impersonation token, closes tab

**Step 4: Detect impersonation in AuthProvider**

In `AuthProvider.jsx`:
- Check URL for `impersonate_token` param on mount
- If present, store as auth token, set `isImpersonating = true` in auth context
- Expose `isImpersonating` and `realIdentity` from `useAuth()`

**Step 5: Render banner in App.jsx**

```jsx
{isImpersonating && <ImpersonationBanner />}
```

**Step 6: Tag impersonated actions**

In the global fetch interceptor (AuthProvider), if `isImpersonating`, add header:
```
X-Impersonated-By: <superAdminName>
```

Backend middleware reads this header and appends "(impersonated by Super-Admin)" to `action_history` entries.

**Step 7: Verify**

- As super-admin, view a tenant → click "Log in as tenant"
- New tab opens showing tenant's dashboard with amber banner
- Navigate around — confirm tenant data is visible
- Perform an action (e.g., view products)
- Check `action_history` for impersonation tag
- Click "Exit Impersonation" — tab closes/redirects
- Check `impersonation_sessions` — `ended_at` is set

**Step 8: Commit**

```bash
git add backend/routes/admin.js frontend/src/pages/admin/AdminTenantDetail.jsx frontend/src/ui/ImpersonationBanner.jsx frontend/src/auth/AuthProvider.jsx frontend/src/App.jsx
git commit -m "feat: tenant impersonation — 1-hour sessions with audit trail"
```

### ✅ Checkpoint 10: Verify before continuing
- [ ] Impersonation opens tenant view in new tab
- [ ] Amber banner visible and cannot be missed
- [ ] Tenant data is correct (not super-admin data)
- [ ] Action history shows impersonation tag
- [ ] Exit ends session cleanly
- [ ] 1-hour expiry works (token rejected after)

---

## Task 12: Final integration + quick-impersonate from tickets

**Files:**
- Modify: `frontend/src/pages/admin/AdminSupportTickets.jsx` (add impersonate button per ticket)
- Modify: `backend/routes/admin.js` (add DB pressure check to infra endpoint)

**Step 1: Add "Impersonate" button on support tickets**

Each ticket row in AdminSupportTickets gets an "Impersonate" button that calls the impersonation endpoint with the ticket's tenant ID, and passes `page_url` from the ticket as the landing page.

**Step 2: Wire DB pressure alerting into infra endpoint**

In the existing `GET /api/admin/infra` handler, after fetching connection stats, check if active > 80% of max and call `alerting.recordDbPressure()`.

**Step 3: Full end-to-end verification**

Run through the complete flow:

1. Start backend + frontend
2. As tenant employee: trigger an error → check Pino logs have reqId + tenant
3. Submit a support ticket with screenshot → check admin panel
4. As super-admin: view ticket → click Impersonate → land on reported page
5. Check `X-Request-Id` in all responses
6. Check alert emails arrive for error spikes
7. Run `GET /api/health?deep=true` → verify dependency checks

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: reliability & support tooling — final integration"
```

### ✅ Final Checkpoint
- [ ] Request IDs in all responses
- [ ] Pino structured logs in terminal (pretty in dev, JSON in prod)
- [ ] Sentry no-ops gracefully without DSN
- [ ] ErrorBoundary catches page crashes
- [ ] Alert emails sent on error spikes
- [ ] Deep health check works
- [ ] Support widget submits tickets with screenshots
- [ ] Admin panel shows tickets + dead letters
- [ ] Tenant impersonation works end-to-end with audit trail
- [ ] Quick-impersonate from support ticket lands on reported page

---

## Post-Implementation: External Setup

These require no code — just account setup:

1. **Sentry**: Sign up at sentry.io → create Node.js project (get DSN) → create React project (get DSN) → set `SENTRY_DSN` on Railway, `VITE_SENTRY_DSN` on Vercel
2. **UptimeRobot**: Sign up → add HTTP monitor for `https://oneshoppos-production.up.railway.app/api/health` → set email alert contact
3. **Railway env vars**: Add `ALERT_EMAIL=your@email.com` and `SENTRY_DSN=<from sentry>`
4. **Vercel env vars**: Add `VITE_SENTRY_DSN=<from sentry>`
