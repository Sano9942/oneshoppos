# Utils — Claude Guide

Frontend utility helpers. No React dependencies except `errorLog.js` (uses `api.js`).

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
| `parseDbDate(str)` | Handles native `Date` objects (Postgres driver), ISO strings, and legacy SQLite `"2026-03-06 08:56:04"` strings (assumed UTC, `Z` appended) |
| `parseLocalDate(str)` | Same but treats space-separated strings as local time (no `Z` appended) |
| `fmtUtcDateTime/Date/Time(str, opts?)` | Locale-formatted strings using `parseDbDate` |
| `fmtLocalDateTime/Date/Time(str, opts?)` | Locale-formatted strings using `parseLocalDate` |
| `fmtDateTime`, `fmtDate`, `fmtTime` | Back-compat aliases → the UTC variants |
| `localDateStr(d?)` | Local `YYYY-MM-DD` for a `Date` (defaults to now) |
| `todayLocalStr()` | Today, local, `YYYY-MM-DD` |
| `daysAgoLocalStr(n)` | N days ago, local, `YYYY-MM-DD` |
| `monthStartLocalStr()` | First of current local month, `YYYY-MM-DD` |

All formatters return `"—"` on null/empty input.

**Gotcha:** never use `toISOString().slice(0, 10)` for "today" — it returns the UTC date, which flips to tomorrow after ~19:00 PKT and silently breaks default date-filter ranges. Always use `todayLocalStr()`/`localDateStr()` instead.

**Gotcha:** never pass a raw DB value straight to `new Date()`. Pick UTC vs LOCAL based on the column, not by guessing.

---

## `csvExport.js`

Single export: `downloadCsv(headers, rows, filename)`.

- **This is the standard for every CSV export feature** — do not hand-roll `Blob`/anchor-click code in a new page.
- No-ops silently if `rows.length === 0`.
- Filename becomes `${filename}_YYYY-MM-DD.csv` (today's local date appended via `todayLocalStr()`).
- Cell values are double-quote wrapped; inner `"` escaped as `""`.

---

## `offlineQueue.js`

POS offline queue backed by **IndexedDB** (via the `idb` library) — not localStorage. Database `sanopos_pos`, store `sales_queue`, keyPath `idempotency_key`, indexes `by_employee` / `by_state` / `by_queued_at`.

Row `type` field distinguishes what's queued: `"sale"`, `"return"`, `"check_in"` (field-rep visits), `"field_order"` (field-rep orders, links back via `field_visit_uuid`). Legacy rows without a `type` are treated as `"sale"` on read (`normalizeRow`).

Row shape: `{ idempotency_key, employee_id, type, sync_state, retry_count, last_error, queued_at, last_attempt_at, payload }`. `sync_state` is one of `"pending" | "syncing" | "failed"`.

**Constants:** `MAX_QUEUED = 50` (shared cap across ALL types combined — sale+return+check_in+field_order), `WARN_THRESHOLD = 40`.

**Exports:**

| Export | Notes |
|--------|-------|
| `getQueue(employeeId)` | All rows for the employee, any type |
| `getSalesQueue` / `getReturnsQueue` / `getCheckInsQueue` / `getFieldOrdersQueue` | Type-filtered views |
| `getQueueByState(employeeId, state)` | Filtered by `sync_state` |
| `enqueue(employeeId, payload)` | Back-compat — enqueues as `type="sale"` |
| `enqueueSale` / `enqueueReturn` / `enqueueCheckIn` / `enqueueFieldOrder` | Explicit typed enqueue. All throw if queue is full (50) or `idempotency_key` is missing from payload |
| `markSyncing(key)` | Sets `sync_state="syncing"`, stamps `last_attempt_at` |
| `markSynced(key)` | Deletes the row (success path) |
| `markFailed(key, errorMessage)` | Sets `sync_state="failed"`, increments `retry_count` |
| `markPending(key)` | Resets to `sync_state="pending"` for retry |
| `clearQueue(employeeId)` | Deletes all rows for the employee |
| `migrateFromLocalStorage(employeeId)` | One-time migration from the old `localStorage["pos_offline_queue_{id}"]` key into IDB (as `type="sale"`); removes the LS key afterward |
| `dequeue(employeeId, key)` | **Deprecated** — calls `markSynced` with a console warning; kept for old callers |

New offline-capable features that queue-and-sync should add a new `type` value and typed helpers here rather than building a parallel queue.

---

## `receipt.js`

Single source of truth for receipt rendering. Both the browser print popup and the on-screen `POSReceiptModal` consume `buildReceiptSections` — never duplicate receipt-line logic in a component. Re-exports `PAPER_SIZES` and `pxForChars` from `paperSizes.js` for callers that already import them from here.

### `formatPaymentMethodLabel(method)`
Normalizes payment method ids to display labels. Known aliases: `gift_card` → "Gift Card", `return_credit` → "Return Credit", `store_credit` → "Store Credit". Anything else is generically title-cased (`my_custom_tender` → "My Custom Tender"); already-pretty strings like `"Cash"` pass through unchanged.

### `buildReceiptSections(slip, template, currencySymbol?)`
Pure function — returns a plain data object, renders nothing.

Key `slip` fields it reads: `timestamp` (**must already be a formatted display string** — call `fmtDateTime()`/`fmtUtcDateTime()` before building the slip, never pass a raw DB value), `cart` (line items, supports weighted units, tare/gross weight, seat numbers for dine-in, serials/serialDetails), `payments` (Return Credit entries filtered out of display), `returnedItems` (non-empty triggers exchange-receipt mode with a `Balance Due` label), `balanceDue`, `fbr_irn` / `fbr_status` / `fbr_qr_code`, `offline`, `isHoldSlip`, `issuedGiftCards`, `orderNote`, `tax_breakdown` (per-rate array, P8), `taxInclusive`.

Template fields (`header_text`, `footer_text`, `show_barcode`, `logo_url`, `paper_width`, `show_tax_breakdown`, `show_fbr`, `show_qr`) all default sensibly when the template is `null` or predates the receipt-designer migration.

### `buildReceiptHtml(slip, template, currencySymbol?, labels?)`
Opens a `window.open` popup, builds the receipt as DOM nodes, calls `w.print()`. Alerts (and returns) if the popup is blocked. Popup width tracks `template.paper_width` via `pxForChars()`. Barcode (CODE128) and FBR QR code are lazy-loaded (`import("jsbarcode")` / `import("qrcode")`) so those libraries are only fetched by tenants that actually enable them. `labels` lets callers override industry-specific terms (e.g. `{ customer: "Patient" }`).

### `printToHardware(slip, template, labels?)`
`async` — POSTs to `/api/print/receipt` via an absolute `API_BASE` URL (needed because frontend and backend are on different origins in production). Returns `{ ok: true }` on success or `{ error, fallback: true }` on any failure (network error, non-2xx, printer not configured). Callers should fall back to `buildReceiptHtml()` when `fallback: true` comes back.

---

## `paperSizes.js`

Shared paper-width definitions used by both Printer Settings and Receipt Templates so the two surfaces stay in sync.

| Export | Notes |
|--------|-------|
| `PAPER_SIZES` | `[{ label, value }]` — 4 entries: 48 chars/80mm (standard), 42/76mm, 32/58mm (mini), 30/57mm (narrow) |
| `pxForChars(chars)` | `Math.round(chars * 7.1)` — converts a char width to popup pixel width. Falls back to 48 chars if input is invalid |

---

## `publicReceipt.js`

Shareable receipt URL + WhatsApp share message builders. Centralizing this means every "share this receipt" entry point (POS post-checkout, Sales History) produces a URL that actually resolves.

| Export | Notes |
|--------|-------|
| `buildPublicReceiptUrl(invoiceNumber)` | `${origin}/receipt/${invoiceNumber}`, appends `?tenant=slug` when `IS_MULTI_TENANT` (reads slug via `authStore.readTenantSlug()`) |
| `buildReceiptShareMessage({ invoiceNumber, totalLabel, outletName?, fallbackName? })` | Plain multi-line message body (not URL-encoded). Brand line prefers `outletName`, then `fallbackName` (e.g. template `header_text`), then `"SanoPOS"` — deliberately NOT the receipt footer greeting |
| `buildWhatsAppShareUrl(args)` | Same args as above, returns a ready-to-open `wa.me/?text=...` URL |

---

## `categoryTree.js`

Category tree UI helpers. All operate on flat `rows` arrays from the API (hierarchical categories with leaf-only assignment).

| Export | Notes |
|--------|-------|
| `sortCategories(rows)` | Sorts by `path_label` (falls back to `name`) via `localeCompare` |
| `leafCategories(rows)` | Filters to `is_leaf` truthy, then sorts |
| `parentOptions(rows, currentId?)` | Valid parent choices for a category picker — excludes the current row and every descendant (walks `path_ids`) so a category can never become its own ancestor |
| `indentLabel(row)` | `path_label \|\| name \|\| ""` — use for dropdown display text |

---

## `theme.js`

Dark mode. Storage key `localStorage["sanopos_theme"]`, applied via `document.documentElement.dataset.theme`.

| Export | Notes |
|--------|-------|
| `getTheme()` | `"light"` or `"dark"`, defaults `"light"` |
| `setTheme(theme)` | Persists + applies immediately |
| `toggleTheme()` | Flips and returns the new value |
| `initTheme()` | Reads persisted theme and applies it — called once at module load in `App.jsx` (not `main.jsx`), before first render |

---

## `chunkReload.js`

Stale-chunk recovery for post-deploy clients holding an old Vite bundle hash whose lazy chunks 404.

| Export | Notes |
|--------|-------|
| `looksLikeChunkLoadFailure(err)` | Matches common chunk-load error strings. Note: the `"failed to fetch"` substring it checks can also fire on genuine network errors, so detection is intentionally broad, not exact |
| `reloadOnceForChunkFailure(opts?)` | Reloads at most once per 30s window (guard persisted in `sessionStorage["__sanopos_chunk_reload_at"]`) to avoid reload loops. Accepts `{ storage, reload, now }` overrides for testability |
| `__test__` | Exposes `RELOAD_KEY` / `RELOAD_GUARD_MS` for tests only |

Wired up in `main.jsx` against `vite:preloadError` and `unhandledrejection`.

---

## `errorLog.js`

| Export | Notes |
|--------|-------|
| `logErrorState(actionType, description, context?)` | `async` best-effort POST to `/api/action-history` via `api.js`. Swallows all errors — must never block the recovery flow it's logging (receipt retry, shift recovery, refund collision, cart resume, barcode miss, insufficient stock) |

---

## `imageCompress.js`

| Export | Notes |
|--------|-------|
| `compressImage(fileOrBlob, opts?)` | `async → Promise<string>` (base64 data URL). Draws the image to a canvas capped at `maxWidth`/`maxHeight` (default 800×800), re-encodes as JPEG at `quality` (default 0.7) |

Built for field-rep selfie check-ins (wholesale Tier 1.1) where phone cameras produce multi-MB JPEGs that are painful to upload over mobile data and bloat the IndexedDB offline queue. Typical output ~80-150KB.

Falls back to the raw, uncompressed base64 read (via `FileReader`) if `canvas`/`Image` are unavailable, or if the compressed output would somehow be larger than the raw input. Reusable anywhere an image needs client-side downsizing before upload, not just check-ins.
