# Shopify Pages — Claude Guide

- **7 files** — Shopify integration UI, all driven by shared context
- All tabs are rendered inside `ShopifyIntegrationRedesign.jsx` which wraps children in `<ShopifyProvider>`

---

## `ShopifyContext.jsx`

Exports `ShopifyProvider` and `useShopify()`.

**Gotcha:** `useShopify()` throws if called outside `ShopifyProvider`.

**`apiFetch`** is `api.raw` wrapped in `useCallback` — returns raw `Response` objects. Every caller must check `res.ok` and call `res.json()` manually (unlike `api.get/post` which auto-parse and auto-throw).

**Context shape:**

| Field | Type | Notes |
|-------|------|-------|
| `loading` | boolean | Global loading state — set by `loadAll` |
| `setLoading` | setter | Exposed for tab-level use |
| `error` | string | Global error message (empty = no error) |
| `setError` | setter | Tabs set this on failure |
| `success` | string | Global success message |
| `setSuccess` | setter | Tabs set this on success |
| `config` | object | Connection state: `{ connected, shop_domain, access_token, api_version, webhook_secret, default_location_id }` |
| `setConfig` | setter | Mutated by settings form inputs |
| `status` | object or null | Event stats + queue health + last sync info (from `/api/integrations/shopify/status`) |
| `outlets` | array | POS outlet list (for location mapping) |
| `mappingCounts` | object | `{ products: N, locations: N, customers: N }` — counts from 3 mapping endpoints |
| `apiFetch` | fn | `(path, options?) → Promise<Response>` — raw fetch, caller parses |
| `loadAll` | fn | Parallel-fetches config, status, all 3 mapping counts, outlets — refreshes everything |

**`loadAll`** fires 6 parallel requests on mount:
1. `GET /api/integrations/shopify/config`
2. `GET /api/integrations/shopify/status`
3. `GET /api/integrations/mappings/products`
4. `GET /api/integrations/mappings/locations`
5. `GET /api/integrations/mappings/customers`
6. `GET /api/outlets`

**Config gotcha:** `access_token` and `webhook_secret` are always returned as empty strings (never populated from server to avoid leaking credentials). When connected, placeholder shows "Enter new token to rotate".

**`api_version` default:** `"2025-10"`

---

## `ShopifyOverview.jsx`

Status dashboard: 4 stat cards + inventory sync detail panel.

**4 stat cards:** Connection status, Event totals (processed/failed/pending), Mapping totals (products + locations + customers), Queue health (backlog/retry_due/dead_letter from `status.queue_health`).

**Last sync:** uses `fmtLocalDateTime(status.last_sync_at)`.

**Last error:** shows `status.last_error` in a rose banner at the bottom of the sync panel (conditional — only when set).

---

## `ShopifySettings.jsx`

**Form fields:** `shop_domain`, `api_version`, `access_token` (password, optional when already connected), `webhook_secret` (password, optional), `default_location_id`.

**Actions (each has its own loading state):**

| Button | Endpoint | Notes |
|--------|----------|-------|
| Save Connection | `POST /api/integrations/shopify/config` | Calls `loadAll()` after success |
| Disconnect | `DELETE /api/integrations/shopify/config` | `window.confirm` gate |
| Verify Connection | `POST /api/integrations/shopify/verify` | Calls `loadAll()` after success |
| Run Live Validation | `POST /api/integrations/shopify/validate` | Results visible in Mappings tab |
| Push Inventory (Dry Run) | `POST /api/integrations/shopify/sync/inventory` | Labeled as dry-run |
| Pull Orders (Dry Run) | `POST /api/integrations/shopify/sync/orders` | Labeled as dry-run |
| Process Pending Queue | `POST /api/integrations/shopify/queue/process` | |
| Retry Failed Events | `POST /api/integrations/shopify/queue/retry` | |

**Last run status chip:** reads `status.last_run.status` — color classes: `success`=emerald, `failed`=rose, `running`=blue, else slate.

---

## `ShopifyImport.jsx`

**3 actions, each with its own loading state:**

| Action | Endpoint | Confirmation | Notes |
|--------|----------|--------------|-------|
| Import Products from Shopify | `POST /api/integrations/shopify/import/products` | `window.confirm` | Matched by barcode; result shows created/updated/skipped counts |
| Sync Inventory Levels | `POST /api/integrations/shopify/import/inventory` | None | Result shows synced/failed counts |
| Delete All Shopify-Imported Products | `DELETE /api/integrations/shopify/import/products` | Critical `window.confirm` | Removes products + clears stock + clears mappings |

Both `importResult` and `inventorySyncResult` are kept in local state and shown in the right panel after each run. Errors array shows first error example. Buttons disabled when `!config.connected`.

---

## `ShopifyMappings.jsx`

Two sections:

**1. Location Mapping table:**
- Shows all POS outlets, each with a dropdown of live Shopify locations
- Live Shopify locations fetched on demand via `GET /api/integrations/shopify/locations/live` (not on mount)
- Dropdown disabled until live locations are fetched ("Fetch Live Shopify Locations" button)
- Per-row save via `POST /api/integrations/mappings/locations` — `savingLocationOutletId` tracks which row is saving
- `locationDraftByOutlet` state initialized from `status.location_mappings` when outlets load (via `useEffect`)

**2. Auto-Mapping Suggestions:**
- Generate suggestions via `GET /api/integrations/shopify/suggestions`
- Each suggestion has `confidence` field: `"exact_barcode"` (emerald badge) or other (blue badge)
- Suggestions individually approvable/excludable via toggle — excluded suggestions shown dimmed (opacity-60)
- `reviewedSuggestions` = non-excluded subset — count shown on "Apply Approved (N)" button
- Apply via `POST /api/integrations/shopify/suggestions/apply` with `{ suggestions: reviewedSuggestions }`
- `applySuggestionConflicts` shown as amber warning list after apply

---

## `ShopifyEvents.jsx`

Paginated webhook event log. Fetches up to **100 events** per request.

**Filters (all reactive — refetches on change):**

| Filter | Options |
|--------|---------|
| `status` | All / pending / processed / failed |
| `direction` | All / push (POS→Shopify) / pull (Shopify→POS) |
| `search` | Free text (ID/entity) |

**Per-row retry:** only shown when `ev.status === "failed"` — calls `POST /api/integrations/shopify/events/:id/retry`.

`fmtLocalDateTime` used for event timestamps.

---

## `ShopifyReconciliation.jsx`

Inventory reconciliation between POS and Shopify. Loads **two APIs in parallel** on mount:
1. `GET /api/integrations/shopify/reconciliation` — reconciliation rows
2. `GET /api/approvals` — cross-checks for pending approval workflow (rows with `reference_type === "reconciliation"` shown as "Pending Approval")

**Filters:** `status` (matched/mismatch/error), `resolution_status` (default "open"/resolved/ignored).

**Row actions (shown only when `resolution_status === "open"` AND not pending AND not matched):**
- "POS Wins" → `POST /api/integrations/shopify/reconciliation/:id/fix` with `{ mode: "pos_wins" }`
- "Shopify Wins" → same endpoint with `{ mode: "shopify_wins" }`
- "Ignore" → `PUT /api/integrations/shopify/reconciliation/:id` with `{ resolution_status: "ignored" }`

**Bulk actions (shown when rows selected):** Ignore, POS Wins, Shopify Wins — via `POST /api/integrations/shopify/reconciliation/bulk` with `{ ids, action, mode }`.

**CSV export:** inline blob export (does NOT use `utils/csvExport.js` — builds its own blob). Filename: `recon_YYYY-MM-DD.csv`. Columns: ID, Status, Product, Barcode, Outlet, POS Qty, Shopify Qty, Diff, Resolution.

**Diff display:** `pos_qty - shopify_qty` shown in status badge (e.g. "+3" or "-2").
