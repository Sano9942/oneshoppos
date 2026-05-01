# Contexts — Claude Guide

**3 files** — React contexts. `CurrencyProvider` and `ToastProvider` wrap the app globally (outside `AuthProvider`); `PresetProvider` wraps inside `AuthProvider`.

---

## `CurrencyContext.jsx`

Exports `CurrencyProvider` + `useCurrency()`.

**`useCurrency()` return shape:**

| Field | Default | Notes |
|-------|---------|-------|
| `symbol` | `"$"` | From `GET /api/company-profile/currency` |
| `code` | `"USD"` | Currency code string |
| `denominations` | `[100,50,20,10,5,1]` | Array used by cash-denomination UI |
| `fmt(n)` | `"$ 1,234.00"` | `symbol + " " + toLocaleString(2dp)` |
| `refresh()` | — | Re-fetches currency; call after currency settings change |

**Gotchas:**
- In MT mode reads `localStorage["authSession"].tenant_slug` and appends `?tenant=slug` to the fetch URL — silently skips (uses defaults) if no slug is present yet (pre-login state)
- Fetch errors are swallowed silently — component always has a valid currency object
- `fmt` is memoized on `currency.symbol` only — changing `code` alone does not rebuild the formatter
- Uses raw `fetch()` directly (not `api.js`) — intentional, `CurrencyProvider` is outside `AuthProvider` so the interceptor is not wired yet

---

## `ToastContext.jsx`

Exports `ToastProvider` + `useToast()`.

**`useToast()` return shape:**

| Method | Signature | Notes |
|--------|-----------|-------|
| `toast(msg, type?)` | `(string, string) → id` | Returns numeric auto-increment `id` |
| `success(msg)` | `(string) → id` | Calls `toast(msg, "success")` |
| `error(msg)` | `(string) → id` | Calls `toast(msg, "error")` |
| `warning(msg)` | `(string) → id` | Calls `toast(msg, "warning")` |

**Behaviour:**
- Max 3 toasts visible — oldest dropped when a 4th arrives (slices to last 3)
- Auto-dismiss after 4000ms
- Manual dismiss button (`×`) on each toast
- Rendered at `fixed bottom-4 right-4 z-200` with `animate-in fade-in slide-in-from-right-4`

**Toast type colors:**

| Type | Classes |
|------|---------|
| `success` | `bg-emerald-600 text-white` |
| `error` | `bg-red-600 text-white` |
| `warning` | `bg-amber-500 text-white` |
| `info` (default) | CSS vars: `bg-(--ui-surface) text-(--ui-text) border-(--ui-border)` |

**Gotcha:** `useToast()` throws `"useToast must be inside ToastProvider"` if called outside the provider — hard error, not a silent null.

---

## `PresetContext.jsx`

Exports `PresetProvider` + `usePreset()`.

**`usePreset()` return shape:**

| Field | Type | Notes |
|-------|------|-------|
| `industry_type` | `string` | e.g. `"general_retail"`, `"dental_clinic"`, `"restaurant"` |
| `business_model` | `string` | e.g. `"buy_sell"`, `"service"` |
| `labels` | `object` | Industry-specific label overrides — use `label(key)` helper instead of direct access |
| `dashboard_widgets` | `object` | Which dashboard widget slots are enabled for this preset |
| `onboarding_steps` | `string[]` | Setup wizard step sequence |
| `pos_layout_mode` | `string` | `"grid"` or `"list"` — POS product display mode |
| `visible_report_groups` | `string[]\|null` | Report groups to show; `null` means show all |
| `pos_search_config` | `object` | `{ show_barcode, show_sku, show_price }` |
| `enabled_modes` | `string[]` | Active tenant modes (e.g. `"restaurant"`, `"appointments"`) |
| `unit_vocabulary` | `string[]` | Units available in product quantity fields |
| `presetLoaded` | `boolean` | `false` until first `/api/context/bootstrap` completes |
| `updatePreset(data)` | `fn` | Merges `data` over `DEFAULT_PRESET`, sets `presetLoaded = true` |
| `hasMode(modeName)` | `fn → boolean` | Returns `true` if `enabled_modes` includes the mode. Returns `true` before preset loads (fail-open — feature flags remain the sole gate until preset is ready) |
| `label(key)` | `fn → string` | Returns `preset.labels[key] \|\| key` — use for industry-aware UI text (e.g. `label("customer")` → `"Patient"` in clinic mode) |

**Bootstrap fetch:**
- Calls `GET /api/context/bootstrap` via `api.js` after `employee?.id` is set AND `isBootstrapping` is false
- Waits for `isBootstrapping = false` intentionally — child `useEffect`s run before parent `useEffect`s in React. Without this guard, the first fetch goes through unpatched `window.fetch` (interceptor not yet wired) and 401s, leaving the preset as `general_retail` — silently breaks clinic/restaurant tenants on direct `/pos` navigation
- Uses cancellation flag (`cancelled`) to handle unmount during in-flight fetch
- Always flips `presetLoaded = true` on completion whether success or error — consumers like `POSRoute` never hang

**Additional named exports:**

| Export | Type | Notes |
|--------|------|-------|
| `WEIGHTED_UNITS` | `string[]` | `["kg","g","lb","oz","m","cm"]` — mirrors `backend/config/industry-config.js` |
| `DEFAULT_UNIT_VOCABULARY` | `string[]` | `["pcs","kg","g","lb","oz","m","cm","dozen","pack"]` |
| `isWeightedUnit(unit)` | `fn → boolean` | Checks if unit string is in `WEIGHTED_UNITS` (case-insensitive) |
| `DEFAULT_PRESET` | `object` | Full default preset object — used as merge base in `updatePreset` and state init |
