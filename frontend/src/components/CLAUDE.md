# Components — Claude Guide

- **6 files** — shared layout shell and auth/context guard components
- **`AppLayoutRedesign.jsx`** — main app shell. Collapsible sidebar (from `nav-config.js`), top bar (search, profile dropdown, notification bell, context switcher), breadcrumbs, announcement banner. Internal `ProfileDropdown` with theme toggle + logout. Wraps `<Outlet />` in `ErrorBoundary` + `Suspense`
- **`RequireAuth.jsx`** — route guard: redirects to `/login` if not authenticated. Shows "Loading session..." during bootstrap. Renders `children || <Outlet />`
- **`RequireContext.jsx`** — blocks render until feature flags load. If `context_selection_required` off, passes through. Checks `readContext()` for valid scope. Redirects to `/context-select` if missing
- **`RequirePerm.jsx`** — props: `{ perm, children, redirectTo }`. Renders children if `hasPerm(perm)`, otherwise redirects to `/access-denied`
- **`ContextSwitcher.jsx`** — dropdown for switching active outlet/branch. Reads/writes context via `authStore`. Fetches `/api/context/bootstrap` for outlet list
- **`NotificationBell.jsx`** — bell icon with unread badge. Notification types: `low_stock`, `po_received`, `shift_open`, `approval_required`, `schedule_event`. Click navigates to relevant page
