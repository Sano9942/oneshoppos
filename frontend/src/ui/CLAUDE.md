# UI — Claude Guide

**10 files** — shared design system components, layout helpers, and theme tokens. All components use CSS custom property classes (`text-(--ui-text)`) for dark mode theming. **Exception: POS uses hardcoded colors.**

---

## `primitives.jsx`

Core design system components. All are named exports.

| Export | Props | Notes |
|--------|-------|-------|
| `PageShell` | `{ title, subtitle?, right?, children }` | Standard page wrapper. `right` renders top-right (buttons/actions). `children` renders below the title bar. |
| `SectionCard` | `{ children, className? }` | Card container. **No `title` prop.** |
| `Button` | `{ tone?, size?, ...props }` | Spreads all HTML button props (type, disabled, onClick, etc.) |
| `Input` | `{ className?, ...props }` | Spreads all HTML input props |
| `Select` | `{ className?, children, ...props }` | Spreads all HTML select props |
| `Badge` | `{ tone?, children }` | Inline label chip |
| `TableToolbar` | `{ left, right }` | Filter/action bar above tables |
| `BulkActionBar` | `{ children }` | Emerald-tinted action bar for multi-select bulk actions |
| `EmptyState` | `{ title, body? }` | Centered empty-state message |
| `Skeleton` | `{ className? }` | Animated pulse placeholder |

**`Button` tones:**

| Tone | Style |
|------|-------|
| `primary` (default intent) | `bg-(--ui-primary)` green, white text |
| `danger` | `bg-(--ui-danger)` red, white text |
| `plain` | Transparent, muted text |
| `default` | Surface bg, border, default text |

**`Button` sizes:** `md` (px-4 py-2 text-sm), `sm` (px-3 py-1.5 text-xs)

**`Badge` tones:** `success` (emerald), `warning` (amber), `danger` (rose), `default` (slate)

---

## `tokens.css`

CSS custom property definitions for light and dark themes. Applied via `[data-theme="dark"]` on `<html>`.

**Light theme values:**

| Token | Value |
|-------|-------|
| `--ui-bg` | `#f6f6f7` (page background) |
| `--ui-surface` | `#ffffff` (card/sidebar surface) |
| `--ui-muted-surface` | `#f1f2f3` (hover/disabled bg) |
| `--ui-border` | `#d9dce1` |
| `--ui-text` | `#1f2937` |
| `--ui-text-muted` | `#6b7280` |
| `--ui-primary` | `#008060` (Shopify green) |
| `--ui-primary-strong` | `#006e52` (hover state) |
| `--ui-danger` | `#d82c0d` |
| `--ui-radius-sm/md/lg` | `8px / 12px / 16px` |

**Dark theme overrides:** bg `#0f172a`, surface `#1e293b`, primary `#10b981`, danger `#ef4444`.

**Utility classes:** `.ui-shell-bg` (gradient on `PageShell`), `.ui-focus-ring` (2px solid primary outline on focus-visible).

---

## `nav-config.js`

Single export: `SHOPIFY_NAV_GROUPS` — array of nav group objects. Each group: `{ label, items[] }`. Each item: `{ name, path, icon, requiredPerm?, requiredFlag?, newTab? }`.

**15 groups:** Overview, Commerce, Inventory, Stock Control, Procurement, Insights, Operations, Setup, Marketing & Billing, Restaurant, Appointments, Service Work, Online Store, Compliance, Admin.

**`newTab: true` items** (render as `<a target="_blank">` in sidebar): POS (`/pos`), Kiosk (`/kiosk`), Storefront (`__STOREFRONT__`).

**`__STOREFRONT__` path** — resolved to `/store/${tenantSlug}` at render time by `AppLayoutRedesign`.

Groups with empty items after perm/flag filtering are hidden entirely.

---

## `Breadcrumbs.jsx`

Auto-derived breadcrumbs from `useLocation().pathname`.

**Skipped entirely on:** `/`, `/dashboard`, `/pos`, `/kiosk`, `/customer-display`

**Label resolution:** `LABELS[segment]` → if not found, falls back to `segment.replace(/-/g, " ")` title-cased. New routes get reasonable auto-labels without editing LABELS.

**When adding a new page:** add `"path-segment": "Display Name"` to the `LABELS` map in this file.

---

## `ErrorBoundary.jsx`

React class component. **Named export** (not default): `import { ErrorBoundary } from "../ui/ErrorBoundary"`.

Props: `{ level?, onReset?, children }`

| `level` | Appearance |
|---------|-----------|
| `"page"` | Compact centered card (`max-w-md`) — use inside page content areas |
| (omitted) | Full-screen (`min-h-screen`) — use at app root |

**Both levels:**
- Amber `!` badge, "Something went wrong" heading
- "Try Again" (calls `handleReset` + `props.onReset`) + "Reload" buttons
- In dev (`IS_DEV`): shows `error.message` + `error.stack` in a pre block

**Sentry integration:** `componentDidCatch` calls `Sentry.captureException` if `SENTRY_DSN` is set. No-op otherwise.

---

## `ImpersonationBanner.jsx`

Fixed amber bar at `top-0 z-100` during admin impersonation sessions.

Shows: `"You are viewing as <tenantName>"` + "Exit Impersonation" button.

**Exit flow:**
1. Reads `adminSession` from `localStorage` directly (not via `adminAuthStore`)
2. Calls `POST /api/admin/impersonate/:sessionId/end` using `window._nativeFetch` (bypasses interceptor) with admin token
3. Clears `authSession` + `currentEmployee` from localStorage
4. Tries `window.close()` — falls back to `window.location.href = "/admin"` after 300ms

---

## `AnnouncementBanner.jsx`

Fetches `GET /api/announcements/active` on mount (no auth required). Shows above page content inside `AppLayoutRedesign`.

**Types + styles:**

| Type | Background | Text | Icon |
|------|-----------|------|------|
| `info` | blue-50/blue-200 | blue-800 | `Info` |
| `warning` | amber-50/amber-200 | amber-800 | `AlertTriangle` |
| `maintenance` | red-50/red-200 | red-800 | `Wrench` |

**Dismissal:** stored in `sessionStorage["dismissed_announcements"]` as a JSON array of IDs — clears on browser tab close (not localStorage).

---

## `SubscriptionBanner.jsx`

Global billing state banner, rendered inside the router in `App.jsx`.

| Status | Condition | Style | CTA |
|--------|-----------|-------|-----|
| `trial` | `subscriptionDaysLeft <= 7` | Amber | "Subscribe now" → `/billing` |
| `grace` | always | Red | "Go to Billing" → `/billing` |
| `expired` | always | Red-600 | "Subscribe to continue" → `/billing` |
| `active` or `null` | — | hidden | — |

Trial banner only shows when ≤ 7 days remain — not for the full trial period.

---

## `SupportWidget.jsx`

Floating `?` button (`fixed bottom-4 right-4 z-50`, emerald-600) that opens a support ticket panel.

**Ticket types:** `bug`, `feature_request`, `question`

**File attachment:** max 3 files, 5MB each, `image/*` only. Object URLs for previews are created with `URL.createObjectURL` and revoked on unmount.

**Submit flow:**
1. Upload each file via `api.upload("/api/support/upload", fd)` — continues if individual uploads fail
2. `api.post("/api/support/tickets", { type, message, page_url, browser, screenshots, last_req_id })`
3. `last_req_id` comes from `window.__lastFailedReqId` (set by `AuthProvider` on any failed API response)

---

## `StarRating.jsx`

Two named exports:

| Export | Props | Notes |
|--------|-------|-------|
| `StarDisplay` | `{ rating, size=16, className? }` | Read-only. Rounds `rating` to nearest integer. |
| `StarPicker` | `{ value, onChange, size=24, className? }` | Interactive. Stars hover to yellow-300 on hover. Calls `onChange(n)` on click. |
