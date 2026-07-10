# Contexts — Claude Guide

Three React contexts: `CurrencyContext.jsx`, `ToastContext.jsx`, `PresetContext.jsx`.

Provider nesting (outermost → innermost, wired in `main.jsx`):
```
CurrencyProvider → ToastProvider → AuthProvider → PresetProvider
```
`CurrencyProvider` and `ToastProvider` sit **outside** `AuthProvider` — they must never depend on the auth fetch interceptor or `useAuth()`. `PresetProvider` sits **inside** `AuthProvider` and depends on `useAuth()` for `employee`/`isBootstrapping`. Don't reorder this nesting without checking both constraints.

---

## `CurrencyContext.jsx`

Exports `CurrencyProvider` + `useCurrency()`.

`useCurrency()` returns:

| Field | Default | Notes |
|-------|---------|-------|
| `symbol` | `"$"` | From `GET /api/company-profile/currency` |
| `code` | `"USD"` | Currency code string |
| `denominations` | `[100,50,20,10,5,1]` | Cash-denomination UI (e.g. change calculators) |
| `fmt(n)` | `"$ 1,234.00"` | `symbol + " " + toLocaleString(2dp)` |
| `refresh()` | — | Re-fetches currency; call after currency settings change |

Gotchas:
- Uses raw `fetch()`, not `api.js` — intentional, since this provider renders outside `AuthProvider` and the fetch interceptor isn't wired yet at that point in the tree.
- In multi-tenant mode (`IS_MULTI_TENANT`), reads `localStorage["authSession"].tenant_slug` and appends `?tenant=slug` to the request. If no slug exists yet (pre-login), the fetch is skipped entirely and defaults are kept — this is normal on the login screen, not a bug.
- All fetch errors are swallowed silently (`catch {}`) — the hook always returns a valid currency object, never throws.
- `fmt` is memoized on `currency.symbol` only.

---

## `ToastContext.jsx`

Exports `ToastProvider` + `useToast()`.

`useToast()` returns `{ toast(msg, type?), success(msg), error(msg), warning(msg) }`. `toast()` accepts `type` of `"info"` (default) / `"success"` / `"error"` / `"warning"` and returns a numeric auto-increment id.

Behavior:
- Max 3 toasts visible at once — array is sliced to the last 3 whenever a new one is pushed, so the oldest is silently dropped.
- Each toast auto-dismisses after 4000ms via `setTimeout`; a manual `×` button also dismisses immediately.
- Rendered as a fixed-position stack, bottom-left (`fixed bottom-4 left-4 z-200`).
- Type → icon color: `success` emerald `CheckCircle2`, `error` red `XCircle`, `warning` amber `AlertTriangle`, `info` white/70 `Info` (lucide-react icons). Toast pill itself is a solid `--ui-primary` background regardless of type — only the icon changes color (Square-style: near-black pill, white text).

Gotcha: `useToast()` throws `"useToast must be inside ToastProvider"` if called outside the provider (context default is `null`, not a fallback object) — this is a hard error, not a silent no-op, unlike `useCurrency()`/`usePreset()`. Standard page pattern: `catch (err) { error(err.message || "Something went wrong") }`.

---

## `PresetContext.jsx`

Exports `PresetProvider` + `usePreset()`. Also named exports: `WEIGHTED_UNITS`, `DEFAULT_UNIT_VOCABULARY`, `isWeightedUnit(unit)`, `DEFAULT_PRESET`.

`usePreset()` returns:

| Field | Notes |
|-------|-------|
| `industry_type` | e.g. `"general_retail"`, `"dental_clinic"`, `"restaurant"` |
| `business_model` | e.g. `"buy_sell"`, `"service"` |
| `labels` | Industry-specific label overrides — prefer `label(key)` over reading this directly |
| `dashboard_widgets` | Which dashboard widget slots are enabled |
| `onboarding_steps` | Setup wizard step sequence |
| `pos_layout_mode` | `"grid"` or `"list"` |
| `visible_report_groups` | `string[]` or `null` (`null` = show all) |
| `pos_search_config` | `{ show_barcode, show_sku, show_price }` |
| `enabled_modes` | Active tenant modes array, e.g. `"restaurant"`, `"appointments"` |
| `unit_vocabulary` | Units available in quantity fields — mirrors backend `DEFAULT_UNIT_VOCABULARY` |
| `clinical_config` | Clinic-specific config blob, `null` unless set |
| `presetLoaded` | `false` until first bootstrap attempt completes (success OR error) |
| `updatePreset(data)` | Merges `data` over `DEFAULT_PRESET`, sets `presetLoaded = true` |
| `hasMode(modeName)` | `→ boolean`. **Fail-open**: returns `true` before `presetLoaded` so feature flags remain the sole gate pre-load |
| `label(key)` | `→ preset.labels[key] \|\| key` |

Bootstrap sequence (`GET /api/context/bootstrap` via `api.js`, inside a `useEffect`):
- Fires only once `employee?.id` is truthy AND `isBootstrapping` (from `useAuth()`) is `false`. If `employee?.id` is falsy, `presetLoaded` resets to `false` and no fetch happens.
- **Race-condition guard**: child `useEffect`s commit before parent ones in React, so without care `PresetProvider`'s first fetch would fire through `AuthProvider`'s not-yet-patched `window.fetch` and 401 silently — leaving the tenant stuck on default `general_retail` (this silently breaks clinic/restaurant tenants navigating directly to `/pos`). Two mitigations: (1) yields one macrotask (`setTimeout(...,0)`) before the very first call to let `AuthProvider`'s interceptor effect commit first; (2) retries once more after a 600ms delay if the first attempt still 401s.
- Self-contained by design: any route outside `AppLayoutRedesign` (e.g. `/pos` opening in a new tab) still gets `presetLoaded` without a layout component having to fetch it first.
- On success, also auto-seeds a `single_branch` context via `writeContext()` using `primary_outlet_id` from the bootstrap response — but only if `readContext()` returns nothing yet. This exists so single-outlet/Free tenants that never visit `/context-select` still get `active_outlet_id` populated; without it, outlet-scoped pages (Floor/Checks/KDS) that gate on `readContext()?.active_outlet_id` silently bounce.
- Always flips `presetLoaded = true` on completion, success or failure — consumers like `POSRoute` never hang waiting on it.
- Uses a `cancelled` closure flag (set in the effect cleanup) to avoid state updates after unmount/re-run.

Prefer `hasMode()` / `label()` over reading `enabled_modes` / `labels` directly — they encode the fail-open default behavior that raw field access doesn't have.

---

## Cross-file notes

- None of the three contexts depend on each other directly; the only cross-dependency is `PresetContext` → `AuthProvider` (`useAuth()`) and `authStore` (`readContext`/`writeContext`).
- `CurrencyContext` and `ToastContext` have no auth dependency at all — safe to use in components that render before login.
- If you need both toast and currency in a component, order doesn't matter (no shared state), but both must render under their respective providers per the nesting above.
