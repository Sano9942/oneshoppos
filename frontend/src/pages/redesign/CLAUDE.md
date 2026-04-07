# Redesign Pages — Claude Guide

- **ALL active pages live here** as `*Redesign.jsx` — these are the real implementations
- **Use `PageShell`** from `ui/primitives.jsx` for page layout (props: `title`, `subtitle`, `right`)
- **Use `SectionCard`** for content sections (props: `children`, `className` only — no `title` prop)
- **Use `api.js`** for all API calls (`api.get`, `api.post`, `api.put`, `api.del`) — never raw `fetch()`
- **Dark mode** works automatically via CSS variables — no special handling needed
- **Permission gating**: Use `hasPerm("perm")` from `useAuth()` to conditionally show/hide UI
- **Feature flag gating**: Use `useFeatureFlags()` hook, check flag inside component, redirect if off
- **`IntegrationsHubRedesign.jsx`** — unified integrations hub (`/settings/integrations`). Requires `manage_inventory` perm + `marketplace_integrations` feature flag. Shows marketplace channels + courier integrations in one page
- **CSV export**: Use `downloadCsv(headers, rows, filename)` from `utils/csvExport.js`
- **Currency**: Always `const { fmt } = useCurrency()` — never hardcode symbols
- **Timestamps**: Use `fmtUtcDateTime`/`fmtLocalDateTime` from `utils/dates.js` — never raw `new Date()`
