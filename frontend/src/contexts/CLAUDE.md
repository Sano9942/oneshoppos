# Contexts — Claude Guide

React contexts: `CurrencyContext.jsx`, `ToastContext.jsx`, `PresetContext.jsx`.

Provider nesting (outermost → innermost, see `main.jsx`):
```
CurrencyProvider → ToastProvider → AuthProvider → PresetProvider
```
`CurrencyProvider` and `ToastProvider` sit outside `AuthProvider` — they must not depend on the auth fetch interceptor. `PresetProvider` sits inside `AuthProvider` and depends on `useAuth()`.

---

## `CurrencyContext.jsx`

Exports `CurrencyProvider` + `useCurrency()`.

`useCurrency()` returns:

| Field | Default | Notes |
|-------|---------|-------|
| `symbol` | `"$"` | From `GET /api/company-profile/currency` |
| `code` | `"USD"` | Currency code string |
| `denominations` | `[100,50,20,10,5,1]` | For cash-denomination UI |
| `fmt(n)` | `"$ 1,234.00"` | `symbol + " " + toLocaleString(2dp)` |
| `refresh()` | — | Re-fetches currency; call after currency settings change |

Gotchas:
- Uses raw `fetch()`, not `api.js` — intentional, since this provider is outside `AuthProvider` and the fetch interceptor isn't wired yet.
- In MT mode, reads `localStorage["authSession"].tenant_slug` and appends `?tenant=slug`. If no slug exists yet (pre-login), the fetch is skipped entirely and defaults are kept.
- Fetch errors are swallowed silently — always returns a valid currency object.
- `fmt` is memoized on `currency.symbol` only; a `code`-only change won't rebuild it (doesn't matter since `fmt` never uses `code`).

---

## `ToastContext.jsx`

Exports `ToastProvider` + `useToast()`.

`useToast()` returns `{ toast(msg, type?), success(msg), error(msg), warning(msg) }`. `toast()` returns a numeric auto-increment id.

Behavior:
- Max 3 toasts visible — oldest is dropped when a 4th arrives.
- Auto-dismiss after 4000ms; manual `×` dismiss also available.
- Rendered fixed bottom-right (`z-200`).
- Type → color: `success` emerald, `error` red, `warning` amber, `info` (default) uses `--ui-surface`/`--ui-text`/`--ui-border` CSS vars.

Gotcha: `useToast()` throws `"useToast must be inside ToastProvider"` if called outside the provider — hard error, not a silent no-op. Standard page pattern: `catch(err) { error(err.message || "Something went wrong") }`.

---

## `PresetContext.jsx`

Exports `PresetProvider` + `usePreset()`. Also named exports `WEIGHTED_UNITS`, `DEFAULT_UNIT_VOCABULARY`, `isWeightedUnit(unit)`, `DEFAULT_PRESET`.

`usePreset()` returns:

| Field | Notes |
|-------|-------|
| `industry_type` | e.g. `"general_retail"`, `"dental_clinic"`, `"restaurant"` |
| `business_model` | e.g. `"buy_sell"`, `"service"` |
| `labels` | Industry-specific label overrides — prefer `label(key)` over direct access |
| `dashboard_widgets` | Which dashboard widget slots are enabled |
| `onboarding_steps` | Setup wizard step sequence |
| `pos_layout_mode` | `"grid"` or `"list"` |
| `visible_report_groups` | `string[]` or `null` (null = show all) |
| `pos_search_config` | `{ show_barcode, show_sku, show_price }` |
| `enabled_modes` | Active tenant modes, e.g. `"restaurant"`, `"appointments"` |
| `unit_vocabulary` | Units available in quantity fields |
| `presetLoaded` | `false` until first bootstrap completes (see below) |
| `updatePreset(data)` | Merges `data` over `DEFAULT_PRESET`, sets `presetLoaded = true` |
| `hasMode(modeName)` | `→ boolean`. Fail-open: returns `true` before `presetLoaded` |
| `label(key)` | `→ preset.labels[key] \|\| key` |

Bootstrap sequence (`GET /api/context/bootstrap` via `api.js`):
- Fires only once `employee?.id` is set AND `isBootstrapping` (from `useAuth()`) is false.
- The `isBootstrapping` gate exists because child `useEffect`s run before parent ones — without it, the first fetch would go out through the not-yet-patched `window.fetch` and 401 silently, leaving the tenant stuck on `general_retail` (breaks clinic/restaurant on direct `/pos` navigation).
- Additionally retries once on a 401 after a short delay, to absorb a race where `AuthProvider`'s interceptor effect commits after this provider's first fetch already fired.
- If `employee?.id` becomes falsy after bootstrapping finishes, `presetLoaded` is reset to `false` (no fetch attempted).
- On success, also auto-seeds a `single_branch` context (`writeContext`) using `primary_outlet_id` from the bootstrap response, if no context exists yet — needed so single-outlet/Free tenants that never visit `/context-select` still get `active_outlet_id` populated for outlet-scoped pages (Floor/Checks/KDS).
- Always flips `presetLoaded = true` on completion (success or error) — consumers like `POSRoute` never hang waiting on it.
- Uses a `cancelled` flag to guard against state updates after unmount.

Use `hasMode()` / `label()` for preset-aware UI decisions rather than reading `enabled_modes` / `labels` directly, to get the fail-open default behavior for free.
