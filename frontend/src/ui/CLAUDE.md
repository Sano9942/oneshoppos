# UI Primitives — Claude Guide

- **10 files** — shared design system components, layout, and theme tokens
- **`primitives.jsx`** — core library. Exports: `PageShell({ title, subtitle, right })`, `SectionCard({ children, className })` (no `title` prop), `Button({ tone, size })` (tones: primary/danger/plain/default; sizes: md/sm), `Input`, `Select`, `Badge({ tone })` (success/warning/danger/default), `TableToolbar({ left, right })`, `BulkActionBar`, `EmptyState({ title, body })`, `Skeleton`
- **`nav-config.js`** — sidebar nav entries. Exports `SHOPIFY_NAV_GROUPS` + main groups. Each item: `{ name, path, icon, requiredPerm?, requiredFlag? }`. Used by `AppLayoutRedesign`. Setup group includes "Integrations" (`/settings/integrations`, perm: manage_inventory)
- **`Breadcrumbs.jsx`** — auto-derived from `useLocation().pathname`. Static `LABELS` map. Skipped on: `/dashboard`, `/pos`, `/kiosk`, `/customer-display`, `/`
- **`ErrorBoundary.jsx`** — class component, integrates with Sentry. Props: `onReset`
- **`AnnouncementBanner.jsx`** — fetches `/api/announcements/active`. Types: info/warning/maintenance. Dismissal in `sessionStorage`
- **`ImpersonationBanner.jsx`** — amber banner during admin impersonation. Exit calls `POST /api/admin/impersonate/:sessionId/end`
- **`SubscriptionBanner.jsx`** — trial/grace/expired warnings. Links to `/billing`. Hidden when `status === "active"`
- **`StarRating.jsx`** — `StarDisplay` (read-only) + `StarPicker` (interactive with hover)
- **`SupportWidget.jsx`** — floating support form with file upload (max 3 files, 5MB each). Types: bug/feature/question
- **`tokens.css`** — CSS custom property definitions for the design system (colors, spacing, typography tokens used across light/dark themes)
- **All components use CSS custom property classes** (`text-(--ui-text)`) for dark mode theming. POS is the exception — uses hardcoded colors
