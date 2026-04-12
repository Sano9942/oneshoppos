# Components — Claude Guide

**6 files** — shared layout shell and auth/context guard components.

---

## `RequireAuth.jsx`

Route guard — redirects to `/login` if not authenticated.

- Shows `"Loading session..."` fullscreen during `isBootstrapping`
- Saves `{ from: location }` in navigate state — downstream login pages can read `state.from` to redirect back after login
- Renders `children || <Outlet />` — works both as a wrapper and as a layout route element

---

## `RequirePerm.jsx`

Props: `{ perm, children, redirectTo? = "/dashboard" }`

- If `perm` is falsy → renders children (pass-through, no guard)
- If `hasPerm(perm)` → renders children
- Otherwise → redirects to `/access-denied` with `state: { from: location.pathname, redirectTo }`
- Note: `redirectTo` is passed as state, not used as the actual redirect target — the redirect always goes to `/access-denied`

---

## `RequireContext.jsx`

Enforces company/outlet context selection before rendering protected pages.

**Render sequence:**
1. While `useFeatureFlags` is loading → shows `"Loading context..."` fullscreen
2. If `flags.context_selection_required` is off → passes through (backward compatible)
3. Reads `context` via `readContext()` from `authStore`
4. Valid context = one of:
   - `context.scope_mode === "all_branches"` AND `hasPerm("all_access")` — admin-only scope
   - `context.active_outlet_id` is set — single branch scope
5. If invalid → redirects to `/context-select` with `state: { from: location }`

Passes `authHeaders` from `useAuth()` to `useFeatureFlags` to authenticate the flags fetch.

---

## `ContextSwitcher.jsx`

Dropdown in the top bar for switching active outlet/branch without going to `/context-select`.

**Behavior:**
- Fetches outlet list from `GET /api/context/bootstrap` on mount (when `employee.id` is set)
- "All Branches" option only shown for `hasPerm("all_access")` users
- `switchOutlet(id)` validates the outlet is in the allowed list before writing — prevents unauthorized context writes
- `switchToAll()` gated by `hasPerm("all_access")` — silently returns if not admin
- Returns `null` (renders nothing) if no context is set yet
- Context written via `writeContext()` from `authStore` — updates both state and localStorage atomically

**Context modes:**
- `scope_mode: "single_branch"` + `active_outlet_id: N` — standard per-outlet scope
- `scope_mode: "all_branches"` + `active_outlet_id: null` — admin cross-outlet view

---

## `NotificationBell.jsx`

Bell icon in top bar with unread badge and dropdown panel.

**Polling:** `GET /api/notifications/count` every **60 seconds** (always). Full rows loaded from `GET /api/notifications` only when dropdown is opened.

**Notification types + icons:**

| Type | Icon | Color |
|------|------|-------|
| `low_stock` | `AlertTriangle` | amber-500 |
| `po_received` | `PackageCheck` | emerald-500 |
| `shift_open` | `Bell` | blue-500 |
| `shift_close` | `Bell` | slate-500 |
| `leave_request` | `Calendar` | purple-500 |
| `quotation_accepted` | `FileCheck` | indigo-500 |
| (unknown type) | `Bell` | slate-500 |

**API endpoints used:**

| Endpoint | When |
|----------|------|
| `GET /api/notifications/count` | On mount + every 60s |
| `GET /api/notifications` | On dropdown open |
| `PUT /api/notifications/read-all` | "Mark all read" button |
| `PUT /api/notifications/:id/read` | Individual row click |

**UX details:**
- Badge caps at "99+" for unread > 99
- Unread rows have `bg-blue-50/30` background
- Row click: marks read (if unread), closes dropdown, navigates to `row.link` if set
- Message truncated to 80 characters in row preview

---

## `AppLayoutRedesign.jsx`

Main app shell — renders sidebar + top bar + page content area.

**Layout structure:**
```
flex h-screen
├── <aside> — collapsible sidebar (w-72 expanded / w-20 collapsed)
│   ├── SANOPOS brand header
│   └── Nav groups from SHOPIFY_NAV_GROUPS (filtered by perm + flag)
└── <div> — main content column
    ├── <header> — top bar: search, ContextSwitcher, NotificationBell, ProfileDropdown
    └── <main>
        ├── AnnouncementBanner
        ├── Breadcrumbs
        └── ErrorBoundary > Suspense > <Outlet />
└── SupportWidget (outside main content, fixed position)
```

**Nav filtering:** Each nav item is shown only if:
- `item.requiredPerm` is unset OR `hasPerm(item.requiredPerm)` is true
- `item.requiredFlag` is unset OR `flags[item.requiredFlag]` is truthy

**Special nav path:** `item.path === "__STOREFRONT__"` is resolved to `/store/${readTenantSlug()}` at render time — used for the tenant storefront link in the sidebar.

**`newTab` items** render as `<a target="_blank">` instead of `<NavLink>`.

**Active state:** `location.pathname.startsWith(resolvedPath)` — prefix match (not exact).

**`ProfileDropdown` (internal component):**
- Shows employee name + role label (hardcoded: role_id 1 = "Administrator", 2 = "Manager", else = "Cashier")
- "My Profile" → `/profile`
- Dark mode toggle via `toggleTheme()` from `utils/theme.js`
- Logout → calls `logout()`, then navigates to `/login`

**`<Outlet />` wrapping:** `ErrorBoundary level="page"` + `Suspense` with same "Loading..." pill as `RouteLoading.jsx`
