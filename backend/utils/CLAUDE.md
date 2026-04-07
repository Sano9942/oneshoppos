# Utils — Claude Guide

- **7 files** — standalone utility helpers, no Express dependencies
- **`tz.js`** — `toUtcStart(dateStr, tz)`, `toUtcEnd(dateStr, tz)` — DST-safe UTC boundary conversion using binary search. All report date queries MUST use these. Also: `toLocalDateStr`, `getUtcOffsetMinutes`, `isValidTz`
- **`r2.js`** — Cloudflare R2 upload/delete. `uploadToR2(buffer, key, contentType)` → URL. Falls back to local filesystem (`backend/exports/`) if R2 credentials absent. `r2` client is `null` without credentials
- **`backup-pg.js`** — pg_dump/pg_restore wrappers. `backupSchema(name)` → stream. `restoreSchema(name, path)` uses `--clean`. Requires `pg_dump` on PATH. `MAX_BACKUP_SIZE = 50MB`
- **`receiptEmail.js`** — `buildReceiptEmailHtml(sale, items, payments, template, currencySymbol)` → raw HTML. Mirrors `frontend/src/utils/receipt.js`
- **`digestEmail.js`** — `buildDigestEmailHtml(data, companyName, dateStr)` → raw HTML. Takes `data.zReport`, `data.topSelling`, `data.lowStock`
- **`alertEmail.js`** — `sendAlertEmail({ subject, html })`. Silent no-op if `ALERT_EMAIL` or `RESEND_API_KEY` unset. Never throws. Prefixes subject with `[SanoPOS Alert]`
- **`resendEmail.js`** — `sendPasswordResetEmail()` (throws on error), `buildWelcomeEmailHtml()`. Direct Resend calls for auth/onboarding (outside template registry)
