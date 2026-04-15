# Contexts — Claude Guide

- **3 files** — React contexts, both `CurrencyProvider` and `ToastProvider` wrap the app globally; `PresetProvider` wraps inside `AuthProvider`

## `CurrencyContext.jsx`

`CurrencyProvider` + `useCurrency()`.

**Provides:** `{ symbol, code, denominations, fmt, refresh }`

| Field | Default | Notes |
|-------|---------|-------|
| `symbol` | `"$"` | From `GET /api/company-profile/currency` |
| `code` | `"USD"` | Currency code string |
| `denominations` | `[100,50,20,10,5,1]` | Array used by cash-denomination UI |
| `fmt(n)` | `"$ 1,234.00"` | `symbol + " " + toLocaleString(2dp)` |
| `refresh()` | — | Re-fetches currency from API; call after currency settings change |

**Gotchas:**
- In MT mode reads `localStorage["authSession"].tenant_slug` and appends `?tenant=slug` to the fetch URL — silently skips the fetch (uses defaults) if no slug is present yet (pre-login state)
- Fetch errors are swallowed silently — component always has a valid currency object
- `fmt` is memoized on `currency.symbol` only — changing `code` alone does not rebuild the formatter

---

## `ToastContext.jsx`

`ToastProvider` + `useToast()`.

**Provides:** `{ toast, success, error, warning }`

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
- Rendered inside the provider at `fixed bottom-4 right-4 z-200` with `animate-in fade-in slide-in-from-right-4`

**Toast type colors:**

| Type | Classes |
|------|---------|
| `success` | `bg-emerald-600 text-white` |
| `error` | `bg-red-600 text-white` |
| `warning` | `bg-amber-500 text-white` |
| `info` (default) | CSS vars: `bg-(--ui-surface) text-(--ui-text) border-(--ui-border)` |

**Gotcha:** `useToast()` throws `"useToast must be inside ToastProvider"` if called outside the provider — this is a hard error, not a silent null return.

---

## `PresetContext.jsx`

`PresetProvider` + `usePreset()`.

**Provides:** `{ industry_type, business_model, labels, dashboard_widgets, onboarding_steps, pos_layout_mode, visible_report_groups, pos_search_config, enabled_modes, unit_vocabulary, presetLoaded, updatePreset, hasMode, label }`

Key methods:
- `hasMode(modeName)` — returns `true` if `enabled_modes` includes the mode. Returns `true` before preset loads (fail-open) so feature flags remain the sole gate
- `label(key)` — returns `preset.labels[key] || key` — use for industry-aware UI labels (e.g. `label("customer")` → "Patient" in clinic mode)
- `updatePreset(data)` — merges incoming data over `DEFAULT_PRESET` and sets `presetLoaded = true`

Also exports: `WEIGHTED_UNITS` (array of weight/length unit strings), `DEFAULT_UNIT_VOCABULARY` (array), `isWeightedUnit(unit)` (boolean), `DEFAULT_PRESET` (plain object).

Mounted in `main.jsx` inside `AuthProvider` (after auth loads). Called by `AppLayoutRedesign`, `DashboardRedesign`, `POSContext`, `CompanySettingsRedesign`, and many others.
