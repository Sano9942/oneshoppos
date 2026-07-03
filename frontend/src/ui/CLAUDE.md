# UI — Claude Guide

Shared design system components, layout helpers, and theme tokens. Most use CSS custom property classes (`text-(--ui-text)`, `bg-(--ui-surface)`) for dark mode support via `[data-theme="dark"]`. **Exceptions with hardcoded Tailwind colors:** `AnnouncementBanner.jsx`, `PwaInstallPrompt.jsx`, `MultiOutletEnabledBanner.jsx`, `SubscriptionBanner.jsx`, `StarRating.jsx`, `FBRPromptBanner.jsx`, and parts of `SupportWidget.jsx`. In `primitives.jsx`, `Badge`, `BulkActionBar`, and the modal backdrop also use fixed colors. POS elsewhere in the app follows the same hardcoded-color exception.

---

## `primitives.jsx`

Core design system. All named exports.

### Layout & Shell

| Export | Props | Notes |
|--------|-------|-------|
| `PageShell` | `{ title, subtitle?, right?, children }` | Page wrapper with gradient bg (`.ui-shell-bg`). `right` renders top-right (buttons/actions). **No `actions` prop.** |
| `SectionCard` | `{ children, className? }` | Card container with border + surface bg + shadow. **No `title` prop.** |

### Form Inputs

| Export | Props | Notes |
|--------|-------|-------|
| `Button` | `{ tone?, size?, iconOnly?, className?, ...props }` | Spreads all HTML button props |
| `Input` | `{ className?, ...props }` | Spreads all HTML input props. Full width, white bg (not theme-aware bg) |
| `Select` | `{ className?, children, ...props }` | Spreads all HTML select props. Same white bg caveat as `Input` |

**`Button` tones:** `default` (surface + border, default), `primary` (`--ui-primary` green, white text), `danger` (`--ui-danger` red, white text), `plain` (transparent, muted text), `link` (transparent, primary-colored text, no padding, underline on hover).

**`Button` does not accept a `variant` prop** — only `tone`. Passing `variant="secondary"` (as `ErrorBoundary.jsx` does) is silently ignored.

**`Button` sizes:** `md` (default, `px-4 py-2 text-sm`), `sm` (`px-3 py-1.5 text-xs`). `iconOnly` switches to square padding (`p-2` md / `p-1.5` sm) for table-row icon buttons; `tone="link"` always gets `p-0` regardless of `iconOnly`/`size`.

### Display

| Export | Props | Notes |
|--------|-------|-------|
| `Badge` | `{ tone?, children }` | Inline label chip. Tones: `success` (emerald), `warning` (amber), `danger` (rose), `default` (slate) — all hardcoded Tailwind colors, not theme tokens |
| `EmptyState` | `{ title, body? }` | Centered empty-state message |
| `Skeleton` | `{ className? }` | `animate-pulse` placeholder block |

### Tables

| Export | Props | Notes |
|--------|-------|-------|
| `TableToolbar` | `{ left, right }` | Filter/action bar above tables — two flex groups, wraps on small screens |
| `BulkActionBar` | `{ children }` | Emerald-tinted (hardcoded) bar for multi-select bulk actions |

### Modals

| Export | Props | Notes |
|--------|-------|-------|
| `Modal` | `{ open, onClose, title?, size?, hideClose?, closeOnBackdrop?, children }` | Backdrop `bg-black/45` (hardcoded), Escape key, focus trap entry + focus restore on close |
| `ModalBody` | `{ children, className? }` | `space-y-3` wrapper |
| `ModalFooter` | `{ children, className? }` | Right-aligned flex row, `mt-4` |
| `ConfirmDialog` | `{ open, title?, body?, confirmLabel?, cancelLabel?, destructive?, busy?, onConfirm, onCancel }` | Wraps `Modal` at `size="sm"`; `busy=true` disables both buttons, shows "Working..." on confirm, and disables backdrop/Escape close |

**`Modal` sizes:** `sm` (max-w-sm), `md` (max-w-md, default), `lg` (max-w-lg), `xl` (max-w-2xl — note: not a literal "2xl" width, it's `max-w-2xl` Tailwind class). `max-h-[90vh] overflow-auto` always applied.

**`Modal` focus behavior:** on open, saves `document.activeElement`, then on next tick focuses the first focusable descendant (`input, select, textarea, button, [tabindex]`) or the card itself if none found. On unmount/close, restores focus to the saved element. This makes `Modal` a real accessibility upgrade over the ~100+ inline `fixed inset-0` modal patterns elsewhere in the codebase — prefer `Modal` for new modals rather than hand-rolling.

**`closeOnBackdrop`** (default `true`): clicking anywhere calls `onClose`, but only when the click target is the backdrop element itself (`e.target === e.currentTarget`), so clicks bubbling from modal content don't close it.

### Tabs

| Export | Props | Notes |
|--------|-------|-------|
| `TabBar` | `{ value, onChange, tabs, className? }` | Segmented control. `tabs`: `[{ value, label, count? }]`. `count` renders as a small pill next to the label |

---

## `tokens.css`

CSS custom properties for both themes, applied via `[data-theme="dark"]` on `<html>` (see `utils/theme.js`).

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--ui-bg` | `#f6f6f7` | `#0f172a` | Page background |
| `--ui-surface` | `#ffffff` | `#1e293b` | Card / sidebar surface |
| `--ui-muted-surface` | `#f1f2f3` | `#334155` | Hover / disabled bg |
| `--ui-border` | `#d9dce1` | `#475569` | All borders |
| `--ui-text` | `#1f2937` | `#f1f5f9` | Body text |
| `--ui-text-muted` | `#6b7280` | `#94a3b8` | Secondary text |
| `--ui-primary` | `#008060` | `#10b981` | Shopify-green accent |
| `--ui-primary-strong` | `#006e52` | `#059669` | Hover state |
| `--ui-danger` | `#d82c0d` | `#ef4444` | Destructive actions |
| `--ui-warning` | `#b98900` | `#f59e0b` | Warning accents (not consumed by `primitives.jsx` today — used ad hoc elsewhere) |
| `--ui-radius-sm/md/lg` | `8px / 12px / 16px` | same | Border radius |
| `--ui-shadow` / `--ui-shadow-lg` | subtle / larger | darker | Box shadows |

**Utility classes:** `.ui-shell-bg` (gradient background consumed by `PageShell`), `.ui-focus-ring` (2px solid `--ui-primary` outline on `:focus-visible`, used across `primitives.jsx` inputs/buttons).

`Input`/`Select` use a literal `bg-white` rather than `bg-(--ui-surface)` — they do not visually invert in dark mode the way `SectionCard`/`Button` do. Known, not yet fixed.

---

## `nav-config.js`

Single export: `SHOPIFY_NAV_GROUPS` — an array of nav group objects, each `{ label, items[] }`. Each item: `{ name, path, icon, requiredPerm?, requiredFlag?, requiredMode?, newTab? }`.

Groups (in render order): Overview, Sell, Customers, Catalog, Inventory, Procurement, Fulfillment, Field Sales, Online Store, Restaurant, Appointments, Service Operations, Rentals, Rooms, Clinical, Finance, Insights, People, Compliance, Setup, Account.

- `requiredPerm` — item hidden unless `hasPerm(perm)` (or `all_access`).
- `requiredFlag` — item hidden unless the tenant feature flag is on.
- `requiredMode` — item hidden unless `usePreset().hasMode(mode)` returns true (e.g. `"restaurant"`, `"appointments"`, `"rentals"`, `"room_management"`, `"treatment_plans"`, `"commissions"`, `"subscriptions"`, `"workflow_tickets"`, `"service_projects"`).
- `newTab: true` — item renders as `<a target="_blank">` instead of a router `Link`. Currently: POS (`/pos`), Kiosk (`/kiosk`), View Storefront (`__STOREFRONT__`).
- `__STOREFRONT__` is a sentinel path — `AppLayoutRedesign` resolves it to `/store/${tenantSlug}` at render time. Do not treat it as a real route.
- Groups where every item's guard fails are hidden entirely (no empty group headers).

When adding a new nav-gated feature, add the item here with the right `requiredPerm`/`requiredFlag`/`requiredMode` combo — do not hardcode sidebar links elsewhere.

---

## `Breadcrumbs.jsx`

Default export. Auto-derives breadcrumb trail from `useLocation().pathname`, consuming `usePreset().labels` to translate "Customer"/"Product" segments under active presets (e.g. restaurant/clinic terminology).

**Skipped entirely on:** `/`, `/dashboard`, `/pos`, `/kiosk`, `/customer-display`, `/retail/home`.

**Label resolution:** `LABELS[segment]` (a large static map keyed by URL segment) → falls back to the segment auto-title-cased with hyphens replaced by spaces. New routes work without a `LABELS` entry, but add one for correct capitalization/wording (e.g. `"crm": "CRM"`).

Translation only rewrites `Customer(s)` and `Product(s)` substrings — other preset-specific vocabulary is not swapped here.

---

## `ErrorBoundary.jsx`

**Named export, not default:** `import { ErrorBoundary } from "../ui/ErrorBoundary"`.

Props: `{ level?, onReset?, children }`.

| `level` | Rendering |
|---------|-----------|
| `"page"` | Compact centered card (`max-w-md`) — use for page/section-level boundaries |
| omitted | Full-screen (`min-h-screen`) — used once at app root in `main.jsx` |

- Class component using `getDerivedStateFromError` + `componentDidCatch`.
- `componentDidCatch` reports to Sentry only if `SENTRY_DSN` is set (`Sentry` import is conditionally nulled out otherwise — no-op without a DSN).
- "Try Again" button resets local error state and calls `props.onReset` if provided. "Reload" calls `window.location.reload()`.
- In dev (`IS_DEV` from `config.js`), renders `error.message` + `error.stack` in a `<pre>` block; hidden in production.
- Uses `--border-primary`/`--bg-primary`/`--text-primary`/`--text-secondary` tokens — a **different token namespace** than the rest of `ui/` (which uses `--ui-*`). Don't assume these two token sets are interchangeable.
- Passes `variant="secondary"` to the "Try Again" `Button` — `Button` doesn't read `variant`, so this renders as the `default` tone regardless.

---

## `SupportWidget.jsx`

Default export. Floating `?` button (`fixed bottom-4 right-4 z-50`, hardcoded emerald) that opens a ticket-submission panel. No props — fully self-contained, reads `useToast()` and calls `api` directly.

**Ticket types:** `bug`, `feature_request`, `question`.

**Screenshot attachment:** max 3 files, 5 MB each, `image/*` only. Preview object URLs are created via `useMemo` and revoked in a `useEffect` cleanup (memory-leak-safe).

**Submit flow:** uploads each file individually via `api.upload("/api/support/upload", fd)` (continues even if one upload fails), then `api.post("/api/support/tickets", { type, message, page_url, browser, screenshots, last_req_id })`. `last_req_id` reads `window.__lastFailedReqId`, which `AuthProvider` sets on any failed API response — lets support tickets self-attach the relevant request ID without the user hunting for it. Cleared after successful submission.

---

## `ImpersonationBanner.jsx`

Default export. Fixed amber bar (`top-0 z-100`) shown during super-admin impersonation sessions. Reads `impersonationTenantName`/`impersonationSessionId` from `useAuth()`.

**Exit flow (`handleExit`):**
1. Reads `adminSession` directly from `localStorage` (bypasses `adminAuthStore.js` helpers).
2. Best-effort `POST /api/admin/impersonate/:sessionId/end` using `window._nativeFetch || window.fetch` — `_nativeFetch` is the pre-interceptor fetch reference, used here to send the admin's bearer token without the tenant auth interceptor rewriting headers.
3. Clears `authSession` and `currentEmployee` from `localStorage` unconditionally (even if the API call failed).
4. Calls `window.close()`; if the browser blocks it (tab wasn't script-opened), falls back to `window.location.href = "/admin"` after 300ms.

---

## `AnnouncementBanner.jsx`

Default export, no props. Fetches `GET /api/announcements/active` on mount using raw `fetch` against `API_BASE` (no auth header — public endpoint, works pre-login too).

**Types:** `info` (blue), `warning` (amber), `maintenance` (red) — all hardcoded Tailwind, keyed off `a.type` with `info` as fallback style.

**Dismissal:** per-announcement ID stored in `sessionStorage["dismissed_announcements"]` (JSON array) — clears when the tab closes, so a re-opened tab sees dismissed announcements again.

---

## `SubscriptionBanner.jsx`

Default export, no props — reads `subscriptionStatus`, `subscriptionDaysLeft`, `tenantPlan` from `useAuth()`. Rendered inside the router in `App.jsx` (global, every authenticated page).

**Early-outs:** `tenantPlan === "free"` never shows a banner (free-forever tier has no subscription lifecycle). `subscriptionStatus` of `null` or `"active"` also renders nothing.

| Status | Extra condition | Color | CTA |
|--------|------------------|-------|-----|
| `trial` | `subscriptionDaysLeft <= 7` | amber-500 | "Subscribe now" → `/billing` |
| `grace` | always shown | red-500 | "Go to Billing" → `/billing` |
| `expired` | always shown | red-600 | "Subscribe to continue" → `/billing` |

Trial banner intentionally suppressed for the first 38 days of a 45-day trial — only nags in the final week.

---

## `StarRating.jsx`

Two named exports, no default:

| Export | Props | Notes |
|--------|-------|-------|
| `StarDisplay` | `{ rating, size=16, className? }` | Read-only. Rounds `rating` to nearest integer for fill state |
| `StarPicker` | `{ value, onChange, size=24, className? }` | Interactive. Filled stars are `n <= value`. **Hover state is per-star, not cumulative** — only the individual star under the cursor gets `hover:text-yellow-300`; hovering star 4 doesn't visually fill stars 1-3 the way a typical rating widget does. `onChange(n)` fires on click of star `n` |

Both hardcode `text-yellow-400 fill-yellow-400` / `text-gray-300` — not theme-token driven.

---

## `PwaInstallPrompt.jsx`

Default export, no props. Listens for the `beforeinstallprompt` browser event (Chrome/Edge desktop, Android Chrome only — **iOS Safari never fires this event** and gets no fallback UI by design).

Renders a `fixed bottom-4 left-4 z-200` card with "Install SanoPOS" copy once the event fires. "Install" calls `prompt.prompt()` then awaits `prompt.userChoice`; if the user dismisses the *native* prompt, that's also persisted so the banner doesn't reappear.

**Persistence:** `localStorage["pwa_install_dismissed"] = "1"` — permanent across sessions once set (either via explicit "Not now"/X, or via declining the native prompt).

---

## `MultiOutletEnabledBanner.jsx`

Default export, no props. Shown once after a tenant transitions from 1 → 2 outlets, explaining that multi-outlet flags (context selection, outlet pricing, outlet visibility, price books) were auto-enabled.

**Visibility (all must hold):** `GET /api/billing/status` returns `multi_outlet_flags_seeded === true` AND `max_outlets >= 2`, AND not dismissed this session. Fetch failures hide the banner silently (informational-only, fails safe).

**Dismissal:** `sessionStorage["multi_outlet_banner_dismissed"] = "1"` — clears on tab close, so it can reappear in a fresh tab until truly not needed (there's no server-side "seen" flag, unlike `FBRPromptBanner`).

CTA "Manage price lists" navigates to `/price-lists`.

---

## `FBRPromptBanner.jsx`

Default export. **Pure presentational component — takes all state as props, does no internal fetching.** Parent (dashboard) is expected to pass:

| Prop | Type | Meaning |
|------|------|---------|
| `countryCode` | `string \| null` | Banner only renders when exactly `"PK"` |
| `fbrBannerDismissed` | `boolean` | `true` → never render (permanent dismissal) |
| `fbrIntegrationEnabled` | `boolean` | `true` → never render (already configured) |

**CTAs:** "Set up FBR" navigates to `/settings/fbr`. "Not required" and the corner "X" both call the same `handleDismiss`, which does a best-effort `PUT /api/company-profile/fbr-banner-dismiss` (via `api.raw`, errors swallowed) then hides locally regardless of success.

Unlike `MultiOutletEnabledBanner`'s session-only dismissal, this one is **server-persisted** — survives reload and new tabs once dismissed.

---

## Cross-file notes

- **Two token systems coexist:** `--ui-*` (this directory's own components, `tokens.css`) vs `--border-primary`/`--bg-primary`/`--text-primary`/`--text-secondary` (used only by `ErrorBoundary.jsx`, sourced from a separate global stylesheet outside `ui/`). Don't assume one covers the other.
- **Dismissal persistence varies per banner** — deliberately, not an oversight: `AnnouncementBanner`/`MultiOutletEnabledBanner` use `sessionStorage` (re-nag per tab), `PwaInstallPrompt` uses `localStorage` (permanent), `FBRPromptBanner` persists server-side. Match the existing pattern for the banner's urgency level when adding a new one, rather than defaulting to one storage mechanism.
- **`Button`'s `tone` vs `variant`** — only `tone` exists. Grep for `variant=` before assuming a `Button` usage does anything with that prop.
- Several banner components import `api` from `../api` (authenticated tenant path) while `AnnouncementBanner` uses raw `fetch` against `API_BASE` directly (must work pre-auth). Follow whichever pattern matches your banner's auth requirement.
