# Unit Tests — Claude Guide

- **10 files**, Vitest with ESM imports (`import { describe, it, expect, vi }`), no DB/network
- **`middleware.test.js`** — tests `validate` (Zod), `requirePerm`, `requireAnyPerm` with mocked req/res
- **`services.test.js`** — tests `alerting.js` service (module-level state, require-cache manipulation for isolation)
- **`tz.test.js`** — tests `toUtcStart`, `toUtcEnd`, `toLocalDateStr`, `getUtcOffsetMinutes`, `isValidTz`
- **`utils.test.js`** — tests `email-templates.js` `wrapEmailHtml` and `TEMPLATES`
- **`routes-admin-worker-status.test.js`** — tests `GET /api/admin/worker-status` in `routes/admin/system.js`
- **`routes-orders-transactions.test.js`** — tests `POST /api/orders/:id/transactions` in `routes/orders.js`
- **`services-booking-reminders.test.js`** — tests `services/booking-reminders.js` `processPendingReminders`
- **`services-catalog-scheduler.test.js`** — tests `services/catalog-scheduler.js` `applyScheduledChange`
- **`workers-email-worker-boss.test.js`** — tests tenant-scoped job handlers in `workers/email-worker-boss.js`
- **`workers-tenant-job-context.test.js`** — tests `workers/tenant-job-context.js` (Pattern A background worker helper)
- **Run**: `npx vitest run backend/tests/unit/`
- **Pattern**: Pure function testing with `vi.fn()` / `vi.mock()` / `vi.spyOn()`. No supertest, no Express
