# UI — Claude Guide

**14 files** — shared design system components, layout helpers, and theme tokens. Most use CSS custom property classes (`text-(--ui-text)`) for dark mode. **Exceptions with hardcoded Tailwind colors:** POS; and within `ui/`, several files also use fixed colors: `AnnouncementBanner.jsx`, `PwaInstallPrompt.jsx`, `MultiOutletEnabledBanner.jsx`, `SubscriptionBanner.jsx`, `StarRating.jsx`, and parts of `SupportWidget.jsx`. In `primitives.jsx`, `Badge`, `BulkActionBar`, and the modal backdrop use fixed colors.

---

## `primitives.jsx`

Core design system. All are named exports.

### Layout & Shell

| Export | Props | Notes |
|--------|-------|-------|
| `PageShell` | `{ title, subtitle?, right?, children }` | Page wrapper. `right` renders top-right (buttons/actions). **No `actions` prop.** |
| `SectionCard` | `{ children, className? }` | Card container with border + surface bg. **No `title` prop.** |

### Form Inputs

| Export | Props | Notes |
|--------|-------|-------|
| `Button` | `{ tone?, size?, iconOnly?, className?, ...props }` | Spreads all HTML button props |
| `Input` | `{ className?, ...props }` | Spreads all HTML input props. Full width by default |
| `Select` | `{ className?, children, ...props }` | Spreads all HTML select props |

**`Button` tones:**

| Tone | Style |
|------|-------|
| `default` (default) | Surface bg, border, default text |
| `primary` | `bg-(--ui-primary)` green, white text |
| `danger` | `bg-(--ui-danger)` red, white text |
| `plain` | Transparent, muted text |
| `link` | Transparent, primary color text, no padding |

**`Button` sizes:** `md` (px-4 py-2 text-sm), `sm` (px-3 py-1.5 text-xs). `iconOnly` → square padding (`p-2` md, `p-1.5` sm) — for table-row icon buttons.

### Display

| Export | Props | Notes |
|--------|-------|-------|
| `Badge` | `{ tone?, children }` | Inline label chip. Tones: `success` (emerald), `warning` (amber), `danger` (rose), `default` (slate) |
| `EmptyState` | `{ title, body? }` | Centered empty-state message |
| `Skeleton` | `{ className? }` | Animated pulse placeholder (`animate-pulse`) |

### Tables

| Export | Props | Notes |
|--------|-------|-------|
| `TableToolbar` | `{ left, right }` | Filter/action bar above tables — two flex groups |
| `BulkActionBar` | `{ children }` | Emerald-tinted action bar for multi-select bulk actions |

### Modals

| Export | Props | Notes |
|--------|-------|-------|
| `Modal` | `{ open, onClose, title?, size?, hideClose?, closeOnBackdrop?, children }` | Full modal with backdrop, Escape key, focus management, and focus restore on close |
| `ModalBody` | `{ children, className? }` | `space-y-3` content container |
| `ModalFooter` | `{ children, className? }` | Right-aligned flex row for action buttons |
| `ConfirmDialog` | `{ open, title?, body?, confirmLabel?, cancelLabel?, destructive?, busy?, onConfirm, onCancel }` | Wraps `Modal` at `size="sm"` with two action buttons |

**`Modal` sizes:** `sm` (max-w-sm), `md` (max-w-md, default), `lg` (max-w-lg), `xl` (max-w-2xl). Max height 90vh, overflow-auto.

**`Modal` focus management:** on open, auto-focuses first focusable child (input/button/etc) after 1 frame. On close, restores focus to element that was active before open. Escape key calls `onClose`.

**`closeOnBackdrop` (default `true`):** clicking the backdrop overlay calls `onClose`. Only fires when click target is the backdrop itself (not children bubbling up).

### Tabs

| Export | Props | Notes |
|--------|-------|-------|
| `TabBar` | `{ value, onChange, tabs, className? }` | Segmented tab control. Each tab: `{ value, label, count? }`. `count` renders as grey pill next to label |

---

## `tokens.css`

CSS custom property definitions for light and dark themes. Applied via `[data-theme="dark"]` on `<html>`.

**Light theme:**

| Token | Value | Role |
|-------|-------|------|
| `--ui-bg` | `#f6f6f7` | Page background |
| `--ui-surface` | `#ffffff` | Card / sidebar surface |
| `--ui-muted-surface` | `#f1f2f3` | Hover / disabled bg |
| `--ui-border` | `#d9dce1` | All borders |
| `--ui-text` | `#1f2937` | Body text |
| `--ui-text-muted` | `#6b7280` | Secondary text |
| `--ui-primary` | `#008060` | Shopify green |
| `--ui-primary-strong` | `#006e52` | Hover state |
| `--ui-danger` | `#d82c0d` | Red / destructive |
| `--ui-radius-sm/md/lg` | `8px / 12px / 16px` | Border radius |

**Dark theme overrides:** bg `#0f172a`, surface `#1e293b`, primary `#10b981`, danger `#ef4444`.

**Utility classes:** `.ui-shell-bg` (gradient used by `PageShell`), `.ui-focus-ring` (2px solid primary outline on focus-visible).

---

## `nav-config.js`

Single export: `SHOPIFY_NAV_GROUPS` — array of 19 nav group objects.

Each group: `{ label, items[] }`. Each item: `{ name, path, icon, requiredPerm?, requiredFlag?, requiredMode?, newTab? }`.

**Groups:** Overview, Commerce, Inventory, Stock Control, Procurement, Insights, Operations, Setup, Marketing & Billing, Restaurant, Appointments, Projects & Contracts, Service Tickets, Rentals, Rooms, Clinical, Online Store, Compliance, Admin.

**`newTab: true` items** (render as `<a target="_blank">`): POS (`/pos`), Kiosk (`/kiosk`), View Storefront (`__STOREFRONT__`).

**`__STOREFRONT__` path** — resolved to `/store/${tenantSlug}` at render time by `AppLayoutRedesign`.

**`requiredMode`** — item hidden when `hasMode(requiredMode)` returns false (e.g. `"restaurant"`, `"appointments"`, `"rentals"`).

Groups with all items filtered out are hidden entirely.

---

## `Breadcrumbs.jsx`

Default export. Auto-derived breadcrumbs from `useLocation().pathname`.

**Skipped on:** `/`, `/dashboard`, `/pos`, `/kiosk`, `/customer-display`, `/retail/home`

**Label resolution:** `LABELS[segment]` → fallback to segment title-cased with hyphens replaced by spaces. New routes get auto-labels without editing the LABELS map.

**When adding a new route:** add `"path-segment": "Display Name"` to the `LABELS` object.

---

## `ErrorBoundary.jsx`

**Named export** (not default): `import { ErrorBoundary } from "../ui/ErrorBoundary"`.

Props: `{ level?, onReset?, children }`

| `level` | Appearance |
|---------|-----------|
| `"page"` | Compact centered card (`max-w-md`) — use inside page content areas |
| (omitted) | Full-screen (`min-h-screen`) — use at app root |

- "Try Again" calls `handleReset` + `props.onReset`. "Reload" calls `window.location.reload()`
- In dev (`IS_DEV`): shows `error.message` + `error.stack` in a `<pre>` block
- **Sentry:** `componentDidCatch` calls `Sentry.captureException` when `SENTRY_DSN` is set
- **`Button` prop note:** action buttons here pass `variant="secondary"` but `Button` does not interpret a `variant` prop — it accepts `tone`, not `variant`. The `variant` prop is silently ignored by the primitive.

---

## `ImpersonationBanner.jsx`

Fixed amber bar at `top-0 z-100` during admin impersonation sessions.

Shows: `"You are viewing as <tenantName>"` + "Exit Impersonation" button.

**Exit flow:**
1. Reads `adminSession` from `localStorage` directly (not via `adminAuthStore`)
2. Calls `POST /api/admin/impersonate/:sessionId/end` using `window._nativeFetch` (bypasses the auth interceptor) with admin token
3. Clears `authSession` + `currentEmployee` from localStorage
4. Tries `window.close()` — falls back to `window.location.href = "/admin"` after 300ms

---

## `AnnouncementBanner.jsx`

Fetches `GET /api/announcements/active` on mount (no auth required). Shown above page content inside `AppLayoutRedesign`.

**Types + styles:**

| Type | Background | Text | Icon |
|------|-----------|------|------|
| `info` | blue-50/blue-200 | blue-800 | `Info` |
| `warning` | amber-50/amber-200 | amber-800 | `AlertTriangle` |
| `maintenance` | red-50/red-200 | red-800 | `Wrench` |

**Dismissal:** stored in `sessionStorage["dismissed_announcements"]` as a JSON array of IDs. Clears on tab close (not localStorage).

---

## `SubscriptionBanner.jsx`

Global billing state banner, rendered inside the router in `App.jsx`. Reads `subscriptionStatus` and `subscriptionDaysLeft` from `useAuth()`.

| Status | Condition | Style | CTA |
|--------|-----------|-------|-----|
| `trial` | `subscriptionDaysLeft <= 7` | Amber | "Subscribe now" → `/billing` |
| `grace` | always | Red | "Go to Billing" → `/billing` |
| `expired` | always | Red-600 | "Subscribe to continue" → `/billing` |
| `active` or `null` | — | hidden | — |

Trial banner only appears when ≤ 7 days remain, not for the full trial period.

---

## `SupportWidget.jsx`

Floating `?` button (`fixed bottom-4 right-4 z-50`, emerald-600) that opens a support ticket panel.

**Ticket types:** `bug`, `feature_request`, `question`

**File attachment:** max 3 files, 5MB each, `image/*` only. Object URLs for previews revoked on unmount.

**Submit flow:**
1. Upload each file via `api.upload("/api/support/upload", fd)` — continues if individual uploads fail
2. `api.post("/api/support/tickets", { type, message, page_url, browser, screenshots, last_req_id })`
3. `last_req_id` from `window.__lastFailedReqId` (set by `AuthProvider` on any failed API response)

---

## `StarRating.jsx`

Two named exports:

| Export | Props | Notes |
|--------|-------|-------|
| `StarDisplay` | `{ rating, size=16, className? }` | Read-only. Rounds `rating` to nearest integer |
| `StarPicker` | `{ value, onChange, size=24, className? }` | Interactive. Selected stars (≤ `value`) are highlighted yellow. Only the individual unselected star under the pointer gets `hover:text-yellow-300` — hover state is not maintained across all stars. Calls `onChange(n)` on click |

---

## `PwaInstallPrompt.jsx`

Default export. Dismissible install banner for Chrome/Edge desktop and Android Chrome.

- Listens for `beforeinstallprompt` on mount. No-ops on iOS Safari (event never fires) or when already installed.
- Renders a `fixed bottom-left` card with `Download` icon, "Install SanoPOS" heading, "Install" and "Not now" buttons.
- "Install" calls `prompt.prompt()` then awaits `prompt.userChoice`.
- **Persistence key:** `localStorage["pwa_install_dismissed"] = "1"` — banner never re-shows after any dismissal.

---

## `MultiOutletEnabledBanner.jsx`

Default export. Shown once after a tenant transitions from 1 → 2 outlets. Tells them multi-outlet flags were auto-enabled (context selection, outlet pricing, outlet visibility, price books). Has "Settings" CTA → `/settings/security`.

**Visibility conditions** (all must be true):
- `billing.multi_outlet_flags_seeded === true`
- `billing.max_outlets >= 2`
- Not dismissed this session

**Dismissal:** `sessionStorage["multi_outlet_banner_dismissed"] = "1"` — clears on tab close.

Fetches `GET /api/billing/status` on mount. Silently hides on error.

---

## `FBRPromptBanner.jsx`

Default export. Prompts PK tenants to set up FBR Digital Invoicing if not yet done.

**Props (all passed from parent — no internal fetch):**

| Prop | Notes |
|------|-------|
| `countryCode` | `string\|null` — banner only shows when `=== "PK"` |
| `fbrBannerDismissed` | `boolean` — `true` = permanently dismissed |
| `fbrIntegrationEnabled` | `boolean` — `true` = already set up, stop showing |

**CTAs:** "Set up FBR" → navigates to `/settings/fbr`. "Not required" → calls `PUT /api/company-profile/fbr-banner-dismiss` (best-effort), hides locally.

Dismiss is persisted server-side so it survives page reload (unlike session-based dismissal).
