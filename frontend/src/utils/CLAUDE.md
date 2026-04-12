# Utils — Claude Guide

**6 files** — frontend utility helpers, no React dependencies.

---

## `dates.js`

Dual timestamp system: PostgreSQL columns store timestamps two ways.

| Column type | Examples | Parser | Formatters |
|------------|---------|--------|-----------|
| UTC (`TIMESTAMPTZ`) | `sales.timestamp`, `returns.timestamp`, `shifts.*` | `parseDbDate` | `fmtUtcDateTime/Date/Time` |
| LOCAL (`TIMESTAMP`) | `attendance.*`, `expenses.*`, `grn.*`, `parked_sales.*` | `parseLocalDate` | `fmtLocalDateTime/Date/Time` |

**Gotcha:** Postgres `pg` driver returns UTC columns as native JS `Date` objects, not strings. Both parsers handle this (passthrough if already `Date`). Legacy SQLite strings (`"2026-03-06 08:56:04"` — no `T`, no `Z`) are also handled.

**All formatters return `"—"` on null/empty input.**

**`fmtUtcTime(str, opts)` / `fmtLocalTime(str, opts)`** accept an optional `opts` object passed to `toLocaleTimeString` for custom formatting.

**Backward-compat aliases** (UTC variants, safe to use in existing code):
- `fmtDateTime` → `fmtUtcDateTime`
- `fmtDate` → `fmtUtcDate`
- `fmtTime` → `fmtUtcTime`

---

## `csvExport.js`

Single export: `downloadCsv(headers, rows, filename)`

- **No-ops silently** if `rows.length === 0` — caller does not need to check
- Filename: `${filename}_YYYY-MM-DD.csv` (today's date appended automatically)
- Values are double-quote wrapped and inner `"` escaped as `""`
- Creates a `Blob` → temporary anchor → triggers download → revokes object URL

---

## `offlineQueue.js`

POS offline sale queue per employee, stored in `localStorage`.

**Constants (also exported):** `MAX_QUEUED = 50`, `WARN_THRESHOLD = 40`

**Exports:**

| Export | Signature | Notes |
|--------|-----------|-------|
| `getQueueKey(employeeId)` | `→ string` | `"pos_offline_queue_{employeeId}"` |
| `getQueue(employeeId)` | `→ array` | Returns `[]` on parse error |
| `enqueue(employeeId, salePayload)` | `→ queue.length` | Throws if queue is full (`>= 50`). Adds `queued_at` timestamp to payload |
| `dequeue(employeeId, idempotencyKey)` | `→ queue.length` | Removes the entry matching `idempotency_key`; writes back |
| `clearQueue(employeeId)` | `→ void` | Removes the entire queue key |

---

## `receipt.js`

Single source of truth for receipt rendering. Both browser popup and screen receipt (`POSReceiptModal`) consume `buildReceiptSections`.

### `buildReceiptSections(slip, template, currencySymbol?)`

Builds all receipt data as plain values. **Returns an object** — does not render anything.

**Critical gotcha:** `slip.timestamp` must already be a **formatted display string** (e.g. `new Date().toLocaleString()`). Do NOT pass a raw DB timestamp string — call `fmtDateTime()` first before building the slip.

**`slip` object shape (key fields):**

| Field | Notes |
|-------|-------|
| `cart` | Array of `{ name, price, quantity }` |
| `payments` | Array of `{ method, amount }` — `"Return Credit"` entries are filtered out |
| `returnedItems` | Array — non-empty means exchange receipt |
| `balanceDue` | Exchange balance; if set, overrides `total` |
| `fbr_irn` | FBR invoice reference number — rendered on receipt if set |
| `fbr_status` | `"pending"` shows "FBR: Processing..." line |
| `offline` | `true` adds offline notice + `"PENDING (offline)"` invoice number |

### `buildReceiptHtml(slip, template, currencySymbol?)`

Opens a browser popup window (`window.open("", "_blank", "width=360,height=620")`) and calls `w.print()`. **Returns nothing.** Alerts if popup is blocked.

Receipt width: 300px, monospace font — designed for 58mm thermal paper. Includes FBR IRN, exchange credit lines, offline notice.

### `printToHardware(slip, template)`

`async → { ok: true } | { error: string, fallback: true }`

Posts to `/api/print/receipt` (relative URL — `AuthProvider` injects auth headers). If printer offline, returns `{ fallback: true }`. **Caller must then call `buildReceiptHtml()` as fallback.** This is the pattern used by `POSContext.printSlip`.

---

## `categoryTree.js`

Category tree UI helpers. All operate on flat `rows` arrays from the API.

| Export | Signature | Notes |
|--------|-----------|-------|
| `sortCategories(rows)` | `→ rows[]` | Sorts by `path_label` then `name` (locale-aware) |
| `leafCategories(rows)` | `→ rows[]` | Filters to `is_leaf === true`, then sorts |
| `parentOptions(rows, currentId?)` | `→ rows[]` | Returns valid parent choices — **blocks current category AND all its descendants** (uses `path_ids` to find descendants) to prevent circular hierarchy |
| `indentLabel(row)` | `→ string` | Returns `path_label || name || ""` — use for display in dropdowns |

**`parentOptions` circular-safety:** blocks the current category ID plus any row whose `path_ids` includes `currentId` — prevents making a descendant the parent of its own ancestor.

---

## `theme.js`

Dark mode management. Storage key: `localStorage["sanopos_theme"]`. Applies by setting `document.documentElement.dataset.theme`.

| Export | Notes |
|--------|-------|
| `getTheme()` | Returns `"light"` or `"dark"` (defaults to `"light"` if unset) |
| `setTheme(theme)` | Persists to localStorage AND sets `dataset.theme` immediately |
| `toggleTheme()` | Toggles + returns the new theme value |
| `initTheme()` | Reads + applies persisted theme — call at app boot |
