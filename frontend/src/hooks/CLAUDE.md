# Hooks — Claude Guide

- **2 files** — custom React hooks

## `useFeatureFlags.js`

`useFeatureFlags(authHeaders)` — fetches `GET /api/feature-flags` and returns flag state.

**Signature:** `useFeatureFlags(authHeaders) → { flags, loading }` (return is `useMemo`-memoized)

**`authHeaders` resolution (checked in order):**
1. Function → called at fetch time (`authHeaders()`)
2. Plain object → used directly
3. Anything else (null, undefined) → falls back to `{}`

**Fail-closed:** all flags default to `false` — privileged features are hidden if the backend is unreachable or returns an error. On error, state resets to `DEFAULT_FLAGS` (not left as partial).

**Known flags (17 total):**

| Flag key | Notes |
|----------|-------|
| `backup_restore` | |
| `e_invoicing_export` | |
| `supplier_payables` | |
| `approvals` | `ApprovalsRedesign.jsx` redirects to `/` if off |
| `notifications` | |
| `accounting_core` | Required by `/api/reports/accounting` |
| `crm_quotations` | |
| `advanced_hr` | |
| `multi_company` | |
| `reports_enhanced_filters` | |
| `reports_profit_layer` | |
| `reports_inventory_health_plus` | |
| `reports_exceptions` | |
| `reports_scheduled_exports` | |
| `context_selection_required` | Used by `RequireContext` |
| `context_header_enforced` | Used by `RequireContext` |
| `kiosk_context_locked` | `KioskRedesign.jsx` handles 401 gracefully on flags fetch |

**Gotchas:**
- Uses raw `fetch()` directly — NOT `api.js`. This is intentional: some callers (e.g. `RequireContext`) may call it before the `AuthProvider` interceptor is fully wired. Pass `authHeaders` explicitly.
- `mounted` cleanup flag prevents state updates after unmount — safe to use in short-lived components.
- The `useEffect` re-runs whenever `authHeaders` reference changes — if passing an inline object `{}` each render, it will loop. Memoize or hoist `authHeaders` before passing.

---

## `useReportFilters.js`

`useReportFilters(initial?)` — manages report filter state + builds query string.

**Signature:** `useReportFilters(initial?) → { filters, setFilters, query }`

**`DEFAULT_REPORT_FILTERS`** (named export):
```js
{ date_from: "", date_to: "", outlet_id: "", employee_id: "", category_id: "" }
```

**Behaviour:**
- `initial` is merged over `DEFAULT_REPORT_FILTERS` at init — `initial` wins on key conflicts
- `query` is `useMemo`-memoized — recalculates only when `filters` changes
- `query` omits keys whose value is empty or whitespace-only (`String(v || "").trim()` check)
- `query` returns a plain URL query string (no leading `?`) — append as `?${query}` at the call site
