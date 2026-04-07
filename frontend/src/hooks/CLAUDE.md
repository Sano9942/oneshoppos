# Hooks — Claude Guide

- **2 files** — custom React hooks
- **`useFeatureFlags.js`** — `useFeatureFlags(authHeaders)`. Fetches `GET /api/feature-flags`. **Fail-closed**: all flags default to `false`. Returns `{ flags, loading }`. Used by `RequireContext` (waits for `loading: false` before enforcing context rules)
- **`useReportFilters.js`** — `useReportFilters(initial?)`. Returns `{ filters, setFilters, query }`. `query` is memoized URLSearchParams string with empty values omitted. Default keys: `date_from`, `date_to`, `outlet_id`, `employee_id`, `category_id`. Also exports `DEFAULT_REPORT_FILTERS`
