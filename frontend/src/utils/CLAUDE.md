# Utils — Claude Guide

**10 files** — frontend utility helpers. No React dependencies except `errorLog.js` (uses `api.js`).

---

## `dates.js`

Dual timestamp system: Postgres columns store timestamps two ways.

| Column type | Examples | Parser | Formatters |
|------------|---------|--------|-----------|
| UTC (`TIMESTAMPTZ`) | `sales.timestamp`, `returns.timestamp`, `shifts.*` | `parseDbDate` | `fmtUtcDateTime/Date/Time` |
| LOCAL (`TIMESTAMP`) | `attendance.*`, `expenses.*`, `grn.*`, `parked_sales.*` | `parseLocalDate` | `fmtLocalDateTime/Date/Time` |

**Exports:**

| Export | Notes |
|--------|-------|
| `parseDbDate(str)` | Handles native `Date` objects (Postgres), ISO strings, SQLite `"2026-03-06 08:56:04"` format. Returns `null` only for empty inputs or invalid native `Date` objects; invalid strings produce an `Invalid Date` object (formatters may display `"Invalid Date"` rather than `"—"`) |
| `parseLocalDate(str)` | Same but treats the value as local time (no `Z` suffix appended). Same `null`-vs-`Invalid Date` caveat applies |
| `fmtUtcDateTime(str)` | → locale date+time string |
| `fmtUtcDate(str)` | → locale date string |
| `fmtUtcTime(str, opts?)` | → locale time string; `opts` passed to `toLocaleTimeString` |
| `fmtLocalDateTime(str)` | → locale date+time string |
| `fmtLocalDate(str)` | → locale date string |
| `fmtLocalTime(str, opts?)` | → locale time string |
| `fmtDateTime` | Alias → `fmtUtcDateTime` (backward compat) |
| `fmtDate` | Alias → `fmtUtcDate` (backward compat) |
| `fmtTime` | Alias → `fmtUtcTime` (backward compat) |

**All formatters return `"—"` on null/empty input.**

**Gotcha:** Postgres `pg` driver returns UTC columns as native JS `Date` objects, not strings. Both parsers short-circuit on `instanceof Date`. Legacy SQLite strings (space-separated, no `T`/`Z`) are also handled.

---

## `csvExport.js`

Single export: `downloadCsv(headers, rows, filename)`

- **No-ops silently** if `rows.length === 0`
- Filename: `${filename}_YYYY-MM-DD.csv` (today's date appended automatically)
- Values are double-quote wrapped; inner `"` escaped as `""`
- Creates a Blob → temporary anchor → click → revokes object URL

---

## `offlineQueue.js`

POS offline queue backed by **IndexedDB** (via `idb` library), not localStorage. Queue is per-employee and supports both sales and returns (Bucket F).

**IndexedDB schema:** database `sanopos_pos`, store `sales_queue`, keyPath `idempotency_key`, indexes: `by_employee`, `by_state`, `by_queued_at`.

**Row shape:**

| Field | Notes |
|-------|-------|
| `idempotency_key` | Unique key per row (from payload) |
| `employee_id` | Used for all per-employee queries |
| `type` | `"sale"` or `"return"` (Bucket F — legacy rows default to `"sale"` on read) |
| `sync_state` | `"pending"` \| `"syncing"` \| `"failed"` |
| `retry_count` | Incremented by `markFailed` |
| `last_error` | Error message from last attempt |
| `queued_at` | ISO timestamp set on enqueue |
| `last_attempt_at` | Updated by `markSyncing` |
| `payload` | Full sale/return payload |

**Constants (exported):** `MAX_QUEUED = 50`, `WARN_THRESHOLD = 40`

**Exports:**

| Export | Notes |
|--------|-------|
| `getQueueKey(employeeId)` | `"pos_offline_queue_{employeeId}"` — used for localStorage migration only |
| `getQueue(employeeId)` | Returns all rows for employee (both sales + returns) |
| `getSalesQueue(employeeId)` | Filtered to `type === "sale"` |
| `getReturnsQueue(employeeId)` | Filtered to `type === "return"` |
| `getQueueByState(employeeId, state)` | Filtered by `sync_state` |
| `enqueue(employeeId, salePayload)` | Back-compat: enqueues as `type="sale"`. Throws if queue full or `idempotency_key` missing |
| `enqueueSale(employeeId, payload)` | Explicit sale enqueue |
| `enqueueReturn(employeeId, payload)` | Explicit return enqueue |
| `markSyncing(idempotencyKey)` | Sets `sync_state = "syncing"`, updates `last_attempt_at` |
| `markSynced(idempotencyKey)` | Deletes the row (success) |
| `markFailed(idempotencyKey, errorMessage)` | Sets `sync_state = "failed"`, increments `retry_count` |
| `markPending(idempotencyKey)` | Resets back to `sync_state = "pending"` |
| `clearQueue(employeeId)` | Deletes all rows for this employee |
| `migrateFromLocalStorage(employeeId)` | One-time migration: reads old `localStorage["pos_offline_queue_{id}"]`, writes to IDB as `type="sale"`, removes LS key. Returns count of imported rows |
| `dequeue(employeeId, idempotencyKey)` | **Deprecated** — calls `markSynced` with a console warning |

**Cap:** `MAX_QUEUED = 50` is shared across sales + returns combined. Throws on the 51st enqueue.

---

## `receipt.js`

Single source of truth for receipt rendering. Both browser popup (`buildReceiptHtml`) and screen display (`POSReceiptModal`) consume `buildReceiptSections`. Also re-exports `PAPER_SIZES` and `pxForChars` from `paperSizes.js` for backward compat.

### `formatPaymentMethodLabel(method)`

Normalizes payment method IDs to display strings.

| Input | Output |
|-------|--------|
| `"gift_card"` | `"Gift Card"` |
| `"return_credit"` | `"Return Credit"` |
| `"store_credit"` | `"Store Credit"` |
| `"Cash"` | `"Cash"` (passthrough) |
| `"my_custom_tender"` | `"My Custom Tender"` (generic title-case) |

### `buildReceiptSections(slip, template, currencySymbol?)`

Returns a plain data object — does not render anything. Both popup and modal consume this.

**`slip` key fields:**

| Field | Notes |
|-------|-------|
| `timestamp` | Must be a **pre-formatted display string** — call `fmtDateTime()` first, never pass a raw DB value |
| `cart` | `[{ name, price, quantity, unit?, tare_weight?, gross_weight?, seat_number?, serials?, serialDetails? }]` |
| `payments` | `[{ method, amount }]` — `"Return Credit"` entries are filtered out before display |
| `returnedItems` | Non-empty → exchange receipt mode |
| `balanceDue` | If set, overrides `total` as the displayed total (exchange balance) |
| `fbr_irn` | FBR invoice ref — shown on receipt when set |
| `fbr_status` | `"pending"` → shows `"FBR: Processing..."` line |
| `fbr_qr_code` | Raw QR payload or data URL — encoded client-side if raw string |
| `offline` | `true` → adds offline notice + `"PENDING (offline)"` invoice number |
| `isHoldSlip` | `true` → hold slip mode (deposit/balance instead of payments) |
| `issuedGiftCards` | `[{ code, initial_value }]` — gift card issue block |
| `orderNote` | Footer order note |
| `tax_breakdown` | `[{ rate, amount }]` sorted descending — P8 per-rate breakdown |
| `taxInclusive` | `true` → tax shown as `"GST (incl.)"` |

**Template fields used:**
- `header_text`, `footer_text`, `show_barcode`, `logo_url`, `paper_width`, `show_tax_breakdown`, `show_fbr`, `show_qr`
- All template fields default sensibly when missing (backward compat with pre-v76 tenants)

### `buildReceiptHtml(slip, template, currencySymbol?, labels?)`

Opens a browser popup (`window.open`) with the receipt rendered as HTML, then calls `w.print()`. Returns nothing. Alerts if popup is blocked.

- Popup width is calculated from `template.paper_width` via `pxForChars()` — 48 chars (80mm) → 341px, 32 chars (58mm) → 227px
- Barcode: CODE128 SVG via lazy `import("jsbarcode")` — only fetched for tenants with `show_barcode = true`
- FBR QR: lazy `import("qrcode")` — only when `show_qr = true` and `fbr_qr_code` is a raw string
- `labels` param passes industry-specific label overrides (e.g. `{ customer: "Patient" }`)

### `printToHardware(slip, template, labels?)`

`async → { ok: true } | { error: string, fallback: true }`

Posts to `/api/print/receipt` (relative URL — `AuthProvider` injects auth headers). Returns `{ fallback: true }` if printer offline or not configured. On failure, `useReceipt.printSlip()` sets `retryPrompt` rather than opening the browser fallback directly; `buildReceiptHtml()` is exposed separately via `printBrowserFallback()` or used by retry actions.

---

## `paperSizes.js`

Shared paper-width definitions for thermal printers and receipt templates.

**Exports:**

| Export | Notes |
|--------|-------|
| `PAPER_SIZES` | `[{ label, value }]` — 4 entries: 48 (80mm), 42 (76mm), 32 (58mm), 30 (57mm) |
| `pxForChars(chars)` | Converts char width to popup pixel width: `Math.round(chars * 7.1)`. Fallback to 48 if invalid |

Used by printer settings and receipt template editor to stay in sync.

---

## `publicReceipt.js`

Utilities for shareable receipt URLs and WhatsApp sharing.

| Export | Notes |
|--------|-------|
| `buildPublicReceiptUrl(invoiceNumber)` | Returns absolute URL: `/receipt/${invoiceNumber}` + `?tenant=slug` when `IS_MULTI_TENANT`. Reads slug from `authStore.readTenantSlug()` |
| `buildReceiptShareMessage({ invoiceNumber, totalLabel, outletName?, fallbackName? })` | Multi-line message body (NOT URL-encoded). Brand = `outletName \|\| fallbackName \|\| "SanoPOS"` |
| `buildWhatsAppShareUrl(args)` | Returns `wa.me/?text=...` URL. `args` same as `buildReceiptShareMessage` |

Used by POS post-checkout WhatsApp button and Sales History share panel.

---

## `categoryTree.js`

Category tree UI helpers. All operate on flat `rows` arrays from the API.

| Export | Notes |
|--------|-------|
| `sortCategories(rows)` | Sorts by `path_label` then `name` (locale-aware via `localeCompare`) |
| `leafCategories(rows)` | Filters to `is_leaf === true`, then sorts |
| `parentOptions(rows, currentId?)` | Returns valid parent choices — blocks current category AND all descendants (uses `path_ids` to find them) to prevent circular hierarchy |
| `indentLabel(row)` | Returns `path_label \|\| name \|\| ""` — use for dropdown display |

**`parentOptions` circular-safety:** blocks the current category ID plus any row whose `path_ids` includes `currentId`.

---

## `theme.js`

Dark mode management. Storage key: `localStorage["sanopos_theme"]`. Applied via `document.documentElement.dataset.theme`.

| Export | Notes |
|--------|-------|
| `getTheme()` | Returns `"light"` or `"dark"` (defaults `"light"` if unset) |
| `setTheme(theme)` | Persists to localStorage AND sets `dataset.theme` immediately |
| `toggleTheme()` | Toggles + returns the new theme value |
| `initTheme()` | Reads + applies persisted theme — called from `frontend/src/App.jsx` at module load (before rendering the app component), not from `main.jsx` |

---

## `chunkReload.js`

Stale-chunk recovery. After a deploy, clients holding an old Vite bundle hash try to lazy-load a chunk that no longer exists. This caused Sentry issue SANOPOS-FRONTEND-7 (2026-04-12).

| Export | Notes |
|--------|-------|
| `looksLikeChunkLoadFailure(err)` | Returns `true` for missing-chunk errors. The matcher includes `"failed to fetch"` which can also match real network failures — detection is broader than the name implies. The 30-second sessionStorage guard limits reload loops but does not fully exclude network outage scenarios |
| `reloadOnceForChunkFailure(opts?)` | Reloads at most once per 30s (persisted in `sessionStorage`). Returns `true` if reload triggered. Accepts `{ storage, reload, now }` for testability |
| `__test__` | `{ RELOAD_KEY, RELOAD_GUARD_MS }` — test internals |

**Guard:** `RELOAD_GUARD_MS = 30_000` — prevents reload storms. `sessionStorage` key: `"__sanopos_chunk_reload_at"`.

---

## `errorLog.js`

Best-effort error state logger for POS recovery paths.

| Export | Signature | Notes |
|--------|-----------|-------|
| `logErrorState(actionType, description, context?)` | `async → void` | POSTs to `/api/action-history`. Swallows all errors — never blocks the recovery flow |

Used by receipt retry, shift recovery, refund collision, cart resume, barcode miss, insufficient stock flows. Failures here are silently ignored by design.
