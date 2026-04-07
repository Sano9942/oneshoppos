# Utils — Claude Guide

- **6 files** — frontend utility helpers, no React dependencies
- **`dates.js`** — dual timestamp handling. `parseDbDate` (UTC), `parseLocalDate` (local). Formatters: `fmtUtcDateTime/Date/Time`, `fmtLocalDateTime/Date/Time`. **Gotcha**: `fmtDateTime` alias = UTC. Attendance/expenses/GRN use local time → must use `fmtLocalDateTime`
- **`csvExport.js`** — `downloadCsv(headers, rows, filename)`. Appends `_YYYY-MM-DD` date. Creates Blob + temporary anchor. No-ops on empty rows
- **`offlineQueue.js`** — POS offline sale queue in localStorage keyed by `pos_offline_queue_{employeeId}`. `MAX_QUEUED = 50`, `WARN_THRESHOLD = 40`. `enqueue` throws if full. `dequeue` filters by `idempotency_key`
- **`receipt.js`** — `buildReceiptSections(slip, template, currencySymbol)` + `buildReceiptHtml` + `printToHardware`. Single source of truth for receipt data shape. **Gotcha**: `slip.timestamp` must be pre-formatted display string — call `fmtDateTime()` first
- **`categoryTree.js`** — `sortCategories`, `leafCategories`, `parentOptions(rows, currentId)` (blocks circular hierarchy), `indentLabel`
- **`theme.js`** — `getTheme/setTheme/toggleTheme/initTheme`. Storage key: `"sanopos_theme"`. Sets `document.documentElement.dataset.theme`. Called at app boot
