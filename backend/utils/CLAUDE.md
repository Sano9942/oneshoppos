# Utils — Claude Guide

- **7 files** — standalone utility helpers, no Express dependencies
- **`tz.js`** — `toUtcStart(dateStr, tz)`, `toUtcEnd(dateStr, tz)` — DST-safe UTC boundary conversion using binary search. All report date queries MUST use these. Also: `toLocalDateStr`, `getUtcOffsetMinutes`, `isValidTz`
- **`r2.js`** — Cloudflare R2 upload/delete. `uploadToR2(buffer, key, contentType)` → URL. Falls back to local filesystem (`backend/exports/`) if R2 credentials absent. `r2` client is `null` without credentials. **Gotcha**: `deleteFromR2` is a no-op when using local fallback — files stay on disk
- **`backup-pg.js`** — pg_dump/pg_restore wrappers. `backupSchema(name)` → stream, `restoreSchema(name, path)` uses `--clean` (`--clean` accepts exit code 1 as success — warnings OK, only code 2+ is failure), `backupAllSchemas(schemaNames[])`, `listSchemasInBackup(filePath)`, `getSchemaName(tenantSlug)`, `isPgDumpAvailable()`. Requires `pg_dump` on PATH. `MAX_BACKUP_SIZE = 50MB` (constant defined, not enforced in code)
- **`receiptEmail.js`** — `buildReceiptEmailHtml(sale, items, payments, template, currencySymbol)` → raw HTML. Mirrors `frontend/src/utils/receipt.js`. **Gotcha**: `template.show_barcode` field is present but not used in HTML output
- **`digestEmail.js`** — `buildDigestEmailHtml(data, companyName, dateStr)` → raw HTML. Takes `data.zReport`, `data.topSelling` (top 5), `data.lowStock` (top 8)
- **`alertEmail.js`** — `sendAlertEmail({ subject, html })`. **Silent no-op** if `ALERT_EMAIL` or `RESEND_API_KEY` unset. Never throws. Prefixes subject with `[SanoPOS Alert]`
- **`resendEmail.js`** — `sendPasswordResetEmail()`, `sendWelcomeEmail()`. Direct Resend calls for auth/onboarding (outside template registry). **Throws** if `RESEND_API_KEY` missing — opposite behavior from `alertEmail.js`
