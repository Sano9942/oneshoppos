# Utils — Claude Guide

Frontend utility helpers. Pure/no-React except `errorLog.js` (uses `api.js`). No `theme.js` here — dark mode was removed in the Square reskin; the app is light-only.

---

## `dates.js`

Dual timestamp system — Postgres stores timestamps two ways, and picking the wrong parser silently shifts the displayed time.

| Column type | Examples | Parser | Formatters |
|------------|---------|--------|-----------|
| UTC (`TIMESTAMPTZ`) | `sales.timestamp`, `returns.timestamp`, `shifts.*` | `parseDbDate` | `fmtUtcDateTime/Date/Time` |
| LOCAL (`TIMESTAMP`) | `attendance.*`, `expenses.*`, `grn.*`, `parked_sales.*` | `parseLocalDate` | `fmtLocalDateTime/Date/Time` |

- `parseDbDate(str)` / `parseLocalDate(str)` both accept native `Date` (Postgres driver already returns these), ISO strings, and legacy SQLite `"2026-03-06 08:56:04"` strings — UTC variant appends `Z` before parsing, LOCAL variant does not.
- `fmtDateTime` / `fmtDate` / `fmtTime` are back-compat aliases pointing at the UTC formatters — new code should call the explicit `fmtUtc*`/`fmtLocal*` names instead so the column choice is visible at the call site.
- All formatters return `"—"` on null/empty input.
- `localDateStr(d?)`, `todayLocalStr()`, `daysAgoLocalStr(n)`, `monthStartLocalStr()` — local `YYYY-MM-DD` helpers for date filters/defaults/filenames.

**Gotcha:** never use `toISOString().slice(0, 10)` for "today" — that's the UTC date, which flips to tomorrow after ~19:00 PKT. Use `todayLocalStr()` instead.

**Gotcha:** never hand a raw DB value straight to `new Date()`. Choose UTC vs LOCAL by the column, not by guessing.

---

## `csvExport.js`

`downloadCsv(headers, rows, filename)` — the only export. Use this for every CSV feature; do not hand-roll `Blob`/anchor-click code in a new page.

- No-ops if `rows.length === 0`.
- Filename becomes `${filename}_YYYY-MM-DD.csv` (today's local date via `todayLocalStr()` — depends on `dates.js`).
- Cells are double-quote wrapped, inner `"` escaped as `""`.

---

## `offlineQueue.js`

POS offline queue backed by **IndexedDB** (`idb` library), not localStorage. DB `sanopos_pos`, store `sales_queue`, keyPath `idempotency_key`, indexes `by_employee`/`by_state`/`by_queued_at`.

Row `type` distinguishes queued payload kind: `"sale"`, `"return"`, `"check_in"` (field-rep visit), `"field_order"` (field-rep order, links back via `field_visit_uuid`/`field_visit_id`). Legacy rows with no `type` are treated as `"sale"` on read (`normalizeRow`).

Row shape: `{ idempotency_key, employee_id, type, sync_state, retry_count, last_error, queued_at, last_attempt_at, payload }`. `sync_state` ∈ `"pending" | "syncing" | "failed"`.

Constants: `MAX_QUEUED = 50` (shared cap across ALL types combined), `WARN_THRESHOLD = 40`.

Key exports: `getQueue`/`getSalesQueue`/`getReturnsQueue`/`getCheckInsQueue`/`getFieldOrdersQueue`, `getQueueByState`, `enqueue` (back-compat, sale-only) / `enqueueSale`/`enqueueReturn`/`enqueueCheckIn`/`enqueueFieldOrder` (all throw if queue full or `idempotency_key` missing), `markSyncing`/`markSynced`/`markFailed`/`markPending`, `clearQueue`, `migrateFromLocalStorage` (one-time migration off the old `localStorage["pos_offline_queue_{id}"]` key). `dequeue` is **deprecated** — calls `markSynced` with a console warning, kept for old callers only.

New offline-capable features should add a new `type` value + typed helpers here rather than building a parallel queue.

---

## `receipt.js`

Single source of truth for receipt rendering — both the browser print popup and the on-screen `POSReceiptModal` consume `buildReceiptSections`. Never duplicate receipt-line logic in a component. Re-exports `PAPER_SIZES`/`pxForChars` from `paperSizes.js` for callers already importing them from here.

- `formatPaymentMethodLabel(method)` — normalizes tender ids to display labels (`gift_card`→"Gift Card", `return_credit`→"Return Credit", `store_credit`→"Store Credit"; anything else generically Title_Cased).
- `buildReceiptSections(slip, template, currencySymbol?)` — pure function, returns a plain data object, renders nothing. **`slip.timestamp` must already be a formatted display string** (call `fmtUtcDateTime()` etc. before building the slip) — never pass a raw DB value through here. Reads `cart` (weighted units, tare/gross weight, seat numbers, serials/serialDetails), `payments` (Return Credit rows filtered from display), `returnedItems` (non-empty → exchange mode, "Balance Due" label), `tax_breakdown` (per-rate array), `fbr_irn`/`fbr_status`/`fbr_qr_code`, `isHoldSlip`, `issuedGiftCards`, `offline`. Template fields (`header_text`, `footer_text`, `show_barcode`, `logo_url`, `paper_width`, `show_tax_breakdown`, `show_fbr`, `show_qr`) all default sensibly when `template` is null or predates the receipt-designer migration.
- `buildReceiptHtml(slip, template, currencySymbol?, labels?)` — opens a `window.open` popup, builds DOM nodes, calls `w.print()`. Alerts + returns if the popup is blocked. Popup width tracks `template.paper_width` via `pxForChars()`. Barcode (CODE128, `jsbarcode`) and FBR QR (`qrcode`) are dynamically `import()`ed so those libs are only fetched by tenants that use them. `labels` lets callers override industry terms (e.g. `{ customer: "Patient" }`).
- `printToHardware(slip, template, labels?)` — `async`, POSTs to `/api/print/receipt` via absolute `API_BASE` (frontend/backend are cross-origin in prod). Returns `{ ok: true }` or `{ error, fallback: true }` — on `fallback: true`, caller should fall back to `buildReceiptHtml()`. One of the few intentional raw-`fetch()` callers outside `api.js`.

---

## `paperSizes.js`

Shared paper-width definitions so Printer Settings and Receipt Templates stay in sync.

- `PAPER_SIZES` — `[{ label, value }]`, 4 entries: 48 chars/80mm (standard), 42/76mm, 32/58mm (mini), 30/57mm (narrow).
- `pxForChars(chars)` — `Math.round(chars * 7.1)`, converts char width to popup pixel width. Falls back to 48 if input invalid.

---

## `publicReceipt.js`

Shareable receipt URL + WhatsApp message builders — centralized so every "share this receipt" entry point (POS post-checkout, Sales History) produces a URL that actually resolves.

- `buildPublicReceiptUrl(invoiceNumber)` — `${origin}/receipt/${invoiceNumber}`, appends `?tenant=slug` when `IS_MULTI_TENANT` (slug via `authStore.readTenantSlug()`).
- `buildReceiptShareMessage({ invoiceNumber, totalLabel, outletName?, fallbackName? })` — plain multi-line body (not URL-encoded). Brand line prefers `outletName`, then `fallbackName` (e.g. template `header_text`), then `"SanoPOS"` — deliberately NOT the receipt footer greeting.
- `buildWhatsAppShareUrl(args)` — same args, returns a ready-to-open `wa.me/?text=...` URL.

---

## `categoryTree.js`

Category tree UI helpers operating on flat `rows` from the API (hierarchical, leaf-only assignment).

- `sortCategories(rows)` — sorts by `path_label` (falls back to `name`) via `localeCompare`.
- `leafCategories(rows)` — filters to `is_leaf` truthy, then sorts.
- `parentOptions(rows, currentId?)` — valid parent choices for a picker; excludes the current row and every descendant (walks `path_ids`) so a category can never become its own ancestor.
- `indentLabel(row)` — `path_label || name || ""`, for dropdown display text.

---

## `chunkReload.js`

Stale-chunk recovery for post-deploy clients holding an old Vite bundle hash whose lazy chunks 404 (Sentry SANOPOS-FRONTEND-7).

- `looksLikeChunkLoadFailure(err)` — matches common chunk-load error strings. The `"failed to fetch"` substring is intentionally broad (can also match genuine network errors) rather than exact.
- `reloadOnceForChunkFailure(opts?)` — reloads at most once per 30s window (guard in `sessionStorage["__sanopos_chunk_reload_at"]`) to avoid reload loops. Accepts `{ storage, reload, now }` overrides for testability.
- `__test__` — exposes `RELOAD_KEY`/`RELOAD_GUARD_MS` for tests only.

Wired up in `main.jsx` against `vite:preloadError` and `unhandledrejection`.

---

## `errorLog.js`

`logErrorState(actionType, description, context?)` — `async` best-effort POST to `/api/action-history` via `api.js`. Swallows all errors — must never block the recovery flow it's logging (receipt retry, shift recovery, refund collision, cart resume, barcode miss, insufficient stock).

---

## `imageCompress.js`

`compressImage(fileOrBlob, opts?)` — `async → Promise<string>` (base64 data URL). Draws the image to a canvas capped at `maxWidth`/`maxHeight` (default 800×800), re-encodes JPEG at `quality` (default 0.7). Built for field-rep selfie check-ins (wholesale field sales) where phone cameras shoot multi-MB JPEGs that are painful over mobile data and bloat the IndexedDB offline queue — typical output ~80-150KB. Falls back to the raw uncompressed base64 (via `FileReader`) if `canvas`/`Image` are unavailable, or if the compressed output would be larger than the raw input. Reusable anywhere an image needs client-side downsizing before upload, not just check-ins.

---

## `embeddedBarcode.js`

Frontend mirror of `backend/services/embedded-barcode.js` — the same pure price/weight-embedded EAN-13 decode algorithm, kept in sync so the POS gives instant on-screen feedback when a scale label is scanned, while the backend scan endpoint remains the authoritative decoder. No React, no side effects, no network — trivially unit-testable.

- `DEFAULT_EMBEDDED_SCHEME` — frozen default scheme shape (matches `company_profile.barcode_scheme`).
- `ean13CheckDigit(first12)` — standard EAN-13 mod-10 check digit.
- `normalizeScheme(raw)` — fills in defaults for a possibly-partial tenant scheme.
- `decodeEmbeddedBarcode(rawCode, rawScheme)` — returns `{ ok:true, embed:'price'|'weight', itemCode, itemCodeField, price?|weight? }` or `{ ok:false, reason }` (`'disabled'|'not_embedded'|'malformed'|'bad_check_digit'`).

**Gotcha:** if the backend decode algorithm changes, this file must be updated in lockstep or the POS's instant feedback will disagree with what the server actually charges.

---

## `scale.js`

Lane-scale integration for grocery/butcher/sweet-shop counters via the **Web Serial API** — reads a live weight from a bench scale so the cashier doesn't type it by hand. Mirrors the courier/marketplace adapter pattern: a base class with a throwing stub, named adapter subclasses, and a key→class registry.

- `isScaleSupported()` — `true` only when `navigator.serial` exists (Chrome/Edge on HTTPS or localhost; false on Safari, mobile, older browsers). Gate any "Weigh" button on this — nothing here is on the critical checkout path, weight fields stay hand-typable everywhere else.
- `BaseScaleAdapter` — `static parseFrame()` throws; subclass and override.
- `GenericSerialScaleAdapter` (registry key `"generic"`, aliased as `"cas"`) — parses one line of continuous-mode ASCII scale output (CAS/AND/generic Chinese clones @ 9600-8N1) into `{ weight, unit, stable }`.
- `SCALE_ADAPTERS` / `getScaleAdapter(key)` — registry lookup, defaults to generic.
- `weighOnce(opts?)` — connects (lazily, must be called from a user gesture the first time — `navigator.serial.requestPort()`) and resolves `{ weight, unit }` once `settleReads` (default 3) consecutive equal *stable* frames are seen, or rejects after `timeoutMs` (default 8000).
- `disconnectScale()` — closes the shared port; call on POS unmount / device change.

**Gotcha:** this is v1 covering exactly one scale protocol class (continuous-mode ASCII @ 9600-8N1). To support a different protocol, add and register a new adapter — don't fork the transport in `weighOnce`.

---

## Cross-file notes

- `csvExport.js` depends on `dates.js` (`todayLocalStr`).
- `receipt.js` depends on `paperSizes.js` (re-exports its two functions) and expects timestamps pre-formatted via `dates.js`.
- `publicReceipt.js` depends on `config.js` (`IS_MULTI_TENANT`) and `auth/authStore.js` (`readTenantSlug`).
- `errorLog.js` depends on `api.js`.
- `embeddedBarcode.js` has zero imports — keep it that way; it must stay a plain, portable algorithm mirroring the backend twin.
