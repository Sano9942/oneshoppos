# UI — Claude Guide

Shared design system components, layout helpers, and theme tokens. Square-style design: **light-only** (no `[data-theme="dark"]`, no dark mode anywhere in this directory), near-monochrome — primary actions are **black**, color is reserved for text links, focus rings, and pale status badges. Components style via `--ui-*` custom-property classes (`text-(--ui-text)`, `bg-(--ui-surface)`, `border-(--ui-border)`), Tailwind v4 syntax (`(--var)` not `[var(--var)]`). **`primitives.jsx` is fully token-based** (including `Badge` and `BulkActionBar`).

**Remaining hardcoded-color exceptions (not yet tokenized):** `AnnouncementBanner.jsx`, `PwaInstallPrompt.jsx`, `MultiOutletEnabledBanner.jsx` (partially — CTA/dismiss buttons are tokenized, wrapper isn't styled with color), `SubscriptionBanner.jsx`, `StarRating.jsx`, `FBRPromptBanner.jsx` (mostly tokenized), and parts of `SupportWidget.jsx` (floating button is hardcoded emerald... actually uses `--ui-primary` — check before assuming). The `Modal`/`Drawer` backdrop scrim is an intentional `bg-black/45`. POS elsewhere in the app uses hardcoded colors by exception.

**Building new UI:** compose from these primitives + `--ui-*` tokens — never hardcode Tailwind color classes (`bg-slate-800`, `text-indigo-600`) or arbitrary hex.

---

## `primitives.jsx`

Core design system. All named exports.

### Layout & Shell

| Export | Props | Notes |
|--------|-------|-------|
| `PageShell` | `{ title, subtitle?, right?, children }` | Page header wrapper (`min-h-full w-full`): 25px bold title + optional muted subtitle, `right` renders top-right (buttons/actions). **No `actions` prop.** |
| `SectionCard` | `{ children, className? }` | Card container: `rounded-(--ui-radius-md)` + hairline `--ui-border` + `--ui-surface` bg. **Flat — no shadow.** **No `title` prop.** |

### Form Inputs

| Export | Props | Notes |
|--------|-------|-------|
| `Button` | `{ tone?, size?, iconOnly?, className?, ...props }` | Always a `rounded-full` pill, `font-semibold`. Spreads remaining HTML button props. |
| `Input` | `{ className?, ...props }` | Full width, `bg-white`, `--ui-border-strong` border, `rounded-(--ui-radius-sm)`. |
| `Select` | `{ className?, children, ...props }` | Same styling as `Input`. |

**`Button` tones:** `default` (`--ui-muted-surface` bg + `--ui-text`), `primary` (`--ui-primary`/black + white `--ui-on-primary` text), `danger` (`--ui-danger` red + white), `plain` (transparent, muted text, hover surface), `link` (transparent, `--ui-link` blue, no padding, underline on hover).

**No `variant` prop exists** — only `tone`. `ErrorBoundary.jsx` passes `variant="secondary"`, which is silently ignored (renders as `default` tone).

**Sizes:** `md` (default, `h-10 px-4 text-sm`), `sm` (`h-8 px-3 text-[13px]`). `iconOnly` forces a fixed square (`h-10 w-10` md / `h-8 w-8` sm). `tone="link"` always gets `p-0` regardless of size.

### Display

| Export | Props | Notes |
|--------|-------|-------|
| `Badge` | `{ tone?, children }` | Pill chip. Tones map to pale `--ui-*` status tokens: `success`, `warning`, `danger`, `default`. |
| `EmptyState` | `{ title, body?, icon?, action?, secondaryAction?, learnMoreHref?, variant? }` | 3-tier: `minimal` (icon + title + line + action), `standard` (adds secondaryAction + bordered "Learn more" row if `learnMoreHref`), `hero` (full-bleed black `--ui-primary` section for flagship first-run pages). |
| `Skeleton` | `{ className? }` | `animate-pulse` block, `--ui-muted-surface`. |
| `Toggle` | `{ checked?, onChange, disabled?, ...props }` | `role="switch"` pill. Grey track, monochrome knob (no colored "on" track); checked knob = `--ui-primary`. |
| `Tooltip` | `{ label, children }` | Pure-CSS black pill tooltip on `:hover` (no positioning library). |

### Tables

| Export | Props | Notes |
|--------|-------|-------|
| `TableToolbar` | `{ left, right }` | Two flex groups above tables, wraps on small screens. |
| `FilterPill` | `{ label, value?, active?, onClick, onClear?, className? }` | Clearable filter chip. When `active`, shows an inline ✕ (`onClear`) that stops propagation so it doesn't also fire `onClick`. |
| `BulkActionBar` | `{ children }` | Multi-select action bar, `--ui-muted-surface` bg + `--ui-border-strong` border. |

### Modals

| Export | Props | Notes |
|--------|-------|-------|
| `Modal` | `{ open, onClose, title?, size?, hideClose?, closeOnBackdrop?, children }` | Backdrop `bg-black/45`, Escape-to-close, focus trap on open + focus restore on close. Card `bg-white` + `shadow-(--ui-shadow-lg)`. |
| `Drawer` | `{ open, onClose, title?, actions?, size?, children }` | Right-anchored full-height slide-over. Header: X (left), title, optional `actions` (right); body scrolls. Same focus/Escape handling as `Modal`. Sizes `sm/md/lg` = `max-w-[360/420/560px]`. |
| `ModalBody` | `{ children, className? }` | `space-y-3` wrapper. |
| `ModalFooter` | `{ children, className? }` | Right-aligned flex row, `mt-4`. |
| `ConfirmDialog` | `{ open, title?, body?, confirmLabel?, cancelLabel?, destructive?, busy?, onConfirm, onCancel }` | Wraps `Modal` at `size="sm"`. `busy=true` disables both buttons, shows "Working..." on confirm, and disables backdrop/Escape close (`onClose` passed as `undefined` while busy). |

**`Modal` sizes:** `sm` (max-w-sm), `md` (max-w-md, default), `lg` (max-w-lg), `xl` (max-w-2xl). Always `max-h-[90vh] overflow-auto`.

**`Modal`/`Drawer` focus behavior:** on open, saves `document.activeElement`; next tick, focuses the first focusable descendant (`input, select, textarea, button, [tabindex]:not([tabindex='-1'])`) or the container itself if none. On close/unmount, restores focus to the saved element. Prefer these over hand-rolled `fixed inset-0` modal markup elsewhere in the codebase — those rarely handle Escape or focus restore.

**`closeOnBackdrop`** (default `true` on `Modal`): fires `onClose` only when the click target is the backdrop itself (`e.target === e.currentTarget`), so clicks bubbling up from modal content don't close it. `Drawer` has the same guard but no `closeOnBackdrop` prop (always on).

### Tabs

| Export | Props | Notes |
|--------|-------|-------|
| `TabBar` | `{ value, onChange, tabs, className? }` | Segmented pill control. `tabs`: `[{ value, label, count? }]`. `count` renders as a small pill next to the label. |

---

## `tokens.css`

Source of truth for design tokens. Light-only, no dark theme.

| Token | Value | Role |
|-------|-------|------|
| `--ui-text` | `#101010` | Body text (near-black) |
| `--ui-text-muted` | `#6b7280` | Secondary text |
| `--ui-bg` / `--ui-surface` | `#ffffff` | Content canvas / cards |
| `--ui-sidebar` | `#fafafa` | Sidebar bg |
| `--ui-muted-surface` | `#f5f5f5` | Hover / disabled / secondary-button bg |
| `--ui-border` | `#f0f0f0` | Near-invisible hairline — the flat-card cue |
| `--ui-border-strong` | `#e3e3e3` | Input borders, dividers that must read |
| `--ui-primary` / `--ui-primary-strong` | `#101010` / `#000000` | Primary action (black) / hover |
| `--ui-on-primary` | `#ffffff` | Text/icon on primary |
| `--ui-link` / `--ui-focus` | `#006aff` | Text links + focus ring only — never fills |
| `--ui-success-bg/fg` | `#e7f6ec` / `#0a7d33` | Pale success badge |
| `--ui-warning-bg/fg` | `#fdf1e3` / `#a5620a` | Pale warning badge |
| `--ui-danger-bg/fg` · `--ui-danger` | `#fdecea` / `#c0341d` · `#c0341d` | Pale danger badge · solid danger |
| `--ui-radius-sm/md/lg/pill` | `8px / 12px / 16px / 9999px` | Inputs / cards / large containers / pills |
| `--ui-shadow` / `--ui-shadow-lg` | `none` / `0 8px 30px rgba(0,0,0,.08)` | Elevation off by default (flatness from hairline borders); `-lg` reserved for drawers/modals |
| `--ui-font` | `"Inter Variable", "Inter", system-ui…` | Typeface |

**Legacy aliases** exist so pre-redesign call sites heal instead of resolving transparent: `--ui-muted`, `--ui-accent`, `--ui-bg-hover/-muted/-elevated`, `--ui-surface-muted`, plus an un-prefixed namespace (`--text-primary`, `--text-secondary`, `--text-muted`, `--accent`, `--border`, `--bg-input`, `--bg-card`, `--bg-subtle`) all mapped onto the same palette. Use the canonical `--ui-*` names in new code.

**Utility classes:** `.ui-shell-bg` (solid `--ui-bg` bg), `.ui-focus-ring` (2px `--ui-focus` outline on `:focus-visible`, used throughout `primitives.jsx`), `.ui-anim-drawer` / `.ui-anim-fade` (drawer slide-in / fade-in keyframe animations).

---

## `nav-config.js`

Single export: `SHOPIFY_NAV_GROUPS` — array of `{ label, items[] }`. Each item: `{ name, path, icon, requiredPerm?, requiredFlag?, requiredMode?, newTab? }`.

Groups in render order: Overview, Sell, Customers, Catalog, Inventory, Procurement, Fulfillment, Field Sales, Online Store, Restaurant, Appointments, Service Operations, Rentals, Rooms, Clinical, Finance, Insights, People, Compliance, Setup, Account.

- `requiredPerm` — hidden unless `hasPerm(perm)` (or `all_access`).
- `requiredFlag` — hidden unless the tenant feature flag is on.
- `requiredMode` — hidden unless `usePreset().hasMode(mode)` is true (e.g. `"restaurant"`, `"appointments"`, `"rentals"`, `"room_management"`, `"treatment_plans"`, `"commissions"`, `"subscriptions"`, `"workflow_tickets"`, `"service_projects"`).
- `newTab: true` — renders `<a target="_blank">` instead of a router `Link`. Used for POS (`/pos`), Kiosk (`/kiosk`), View Storefront (`__STOREFRONT__`).
- `__STOREFRONT__` is a sentinel path resolved by `AppLayoutRedesign` to `/store/${tenantSlug}` at render time — not a real route.
- A group whose every item fails its guard renders nothing (no empty group headers).

When adding a nav-gated feature, add the item here with the right guard combo — don't hardcode sidebar links elsewhere.

---

## `Breadcrumbs.jsx`

Default export. Auto-derives the breadcrumb trail from `useLocation().pathname`, translating `Customer(s)`/`Product(s)` label substrings via `usePreset().labels` (e.g. restaurant → Guest/Menu Item).

**Skipped entirely on:** `/`, `/dashboard`, `/pos`, `/kiosk`, `/customer-display`, `/retail/home`.

**Label resolution:** `LABELS[segment]` (large static map keyed by URL segment) → falls back to the segment auto-title-cased with hyphens replaced by spaces. New routes work without a `LABELS` entry but look worse (raw segment casing) until one is added.

Translation only rewrites `Customer`/`Customers`/`Product`/`Products` substrings — no other preset vocabulary is swapped here.

---

## `ErrorBoundary.jsx`

**Named export, not default:** `import { ErrorBoundary } from "../ui/ErrorBoundary"`.

Props: `{ level?, onReset?, children }`.

| `level` | Rendering |
|---------|-----------|
| `"page"` | Compact centered card (`max-w-md`) — use for page/section-level boundaries |
| omitted | Full-screen (`min-h-screen`) — used once at app root |

- Class component (`getDerivedStateFromError` + `componentDidCatch`).
- Reports to Sentry only if `SENTRY_DSN` is set (`SentryModule` import is nulled to `null` otherwise, so `componentDidCatch` no-ops without a DSN).
- "Try Again" resets local error state and calls `props.onReset` if provided. "Reload"/"Reload Page" calls `window.location.reload()`.
- In dev (`IS_DEV` from `../config`), renders `error.message` + `error.stack` in a `<pre>`; hidden in prod.
- Uses `--border-primary` / `--bg-primary` / `--text-primary` / `--text-secondary` tokens — a **different token namespace** than the rest of `ui/` (`--ui-*`). These two sets are not interchangeable/synced.
- Passes `variant="secondary"` to the "Try Again" `Button` — ignored (see `primitives.jsx` notes above); renders as `default` tone.

---

## `SupportWidget.jsx`

Default export, no props — fully self-contained (`useToast()` + `api` directly). Floating `?` button (`fixed bottom-4 right-4 z-50`, `bg-(--ui-primary)`) opens a ticket panel.

**Ticket types:** `bug`, `feature_request`, `question`.

**Screenshots:** max 3 files (`MAX_FILES`), 5 MB each (`MAX_SIZE`), no explicit MIME filter beyond the `accept="image/*"` input hint. Preview object URLs created via `useMemo`, revoked in a `useEffect` cleanup.

**Submit flow:** uploads each file individually via `api.upload("/api/support/upload", fd)` (continues even if one upload fails, catches per-file), then `api.post("/api/support/tickets", { type, message, page_url, browser, screenshots, last_req_id })`. `last_req_id` reads `window.__lastFailedReqId` (set by `AuthProvider` on any failed API response) so tickets self-attach the relevant request ID; cleared after successful submission.

---

## `ImpersonationBanner.jsx`

Default export, no props. Fixed amber bar (`top-0 z-100`) during super-admin impersonation. Reads `impersonationTenantName`/`impersonationSessionId` from `useAuth()`.

**Exit flow (`handleExit`):**
1. Reads `adminSession` directly from `localStorage` (bypasses `adminAuthStore.js` helpers).
2. Best-effort `POST /api/admin/impersonate/:sessionId/end` using `window._nativeFetch || window.fetch` — `_nativeFetch` is the pre-interceptor fetch reference, needed so the admin bearer token is sent without the tenant auth interceptor rewriting headers.
3. Clears `authSession` and `currentEmployee` from `localStorage` unconditionally (even if the API call failed — best-effort by design).
4. Calls `window.close()`; if blocked (tab wasn't script-opened), falls back to `window.location.href = "/admin"` after 300ms.

---

## `AnnouncementBanner.jsx`

Default export, no props. Fetches `GET /api/announcements/active` on mount via raw `fetch` against `API_BASE` (no auth header — public endpoint, works pre-login).

Appends `?tenant=<slug>` in MT mode when an `authSession` slug is available so plan/industry-targeted announcements narrow correctly; omitted pre-login (backend then returns only untargeted announcements).

**Types:** `info` (blue), `warning` (amber), `maintenance` (red) — hardcoded Tailwind, keyed off `a.type` with `info` fallback.

**Dismissal:** per-announcement ID in `sessionStorage["dismissed_announcements"]` (JSON array) — clears on tab close, so a fresh tab re-shows dismissed announcements.

---

## `SubscriptionBanner.jsx`

Default export, no props — reads `subscriptionStatus`, `subscriptionDaysLeft`, `tenantPlan` from `useAuth()`. Rendered globally in `App.jsx` (every authenticated page).

**Early-outs:** `tenantPlan === "free"` never shows a banner. `subscriptionStatus` of falsy or `"active"` also renders nothing.

| Status | Extra condition | Color | CTA |
|--------|------------------|-------|-----|
| `trial` | `subscriptionDaysLeft != null && <= 7` | amber-500 | "Subscribe now" → `/billing` |
| `grace` | always | red-500 | "Go to Billing" → `/billing` |
| `expired` | always | red-600 | "Subscribe to continue" → `/billing` |

Trial banner is intentionally suppressed until inside the last 7 days of the trial.

---

## `StarRating.jsx`

Two named exports, no default:

| Export | Props | Notes |
|--------|-------|-------|
| `StarDisplay` | `{ rating, size=16, className? }` | Read-only. Rounds `rating` to nearest integer for fill state. |
| `StarPicker` | `{ value, onChange, size=24, className? }` | Interactive. Filled stars are `n <= value`. Hover styling is per-star only (`hover:text-yellow-300` on the individual star), not cumulative like a typical widget. `onChange(n)` fires on click of star `n`. |

Both hardcode `text-yellow-400 fill-yellow-400` / `text-gray-300` — not token-driven.

---

## `PwaInstallPrompt.jsx`

Default export, no props. Listens for `beforeinstallprompt` (Chrome/Edge desktop, Android Chrome — **iOS Safari never fires this event**, and there is deliberately no fallback UI for it).

Renders a `fixed bottom-4 left-4 z-200` card once the event fires. "Install" calls `prompt.prompt()` then awaits `prompt.userChoice`; if the user declines the *native* prompt, dismissal is persisted too.

**Persistence:** `localStorage["pwa_install_dismissed"] = "1"` — permanent across sessions (explicit dismiss, X, or declining the native prompt all set it).

---

## `MultiOutletEnabledBanner.jsx`

Default export, no props. Shown once after a tenant transitions from 1 → 2 outlets, explaining that multi-outlet flags (context selection, outlet pricing, outlet visibility, price books) were auto-enabled.

**Visibility (all must hold):** `GET /api/billing/status` returns `multi_outlet_flags_seeded === true` AND `max_outlets >= 2`, AND not dismissed this session. Fetch failure hides the banner silently (fails safe, informational only).

**Dismissal:** `sessionStorage["multi_outlet_banner_dismissed"] = "1"` — clears on tab close (no server-side "seen" flag, unlike `FBRPromptBanner`).

CTA "Manage price lists" navigates to `/price-lists`.

---

## `FBRPromptBanner.jsx`

Default export. **Pure presentational — takes all state as props, does no internal fetching.** Caller (dashboard) passes:

| Prop | Type | Meaning |
|------|------|---------|
| `countryCode` | `string \| null` | Renders only when exactly `"PK"` |
| `fbrBannerDismissed` | `boolean` | `true` → never render |
| `fbrIntegrationEnabled` | `boolean` | `true` → never render (already configured) |

**CTAs:** "Set up FBR" navigates to `/settings/fbr`. "Not required" and the corner X both call `handleDismiss`, which best-effort `PUT`s `/api/company-profile/fbr-banner-dismiss` via `api.raw` (errors swallowed) then hides locally regardless of success — **server-persisted**, survives reload/new tabs, unlike `MultiOutletEnabledBanner`'s session-only dismissal.

---

## Cross-file notes

- **Two token systems coexist:** `--ui-*` (this directory's own components, `tokens.css`) vs `--border-primary`/`--bg-primary`/`--text-primary`/`--text-secondary` (used only by `ErrorBoundary.jsx`, from a separate global stylesheet). Don't assume one covers the other.
- **Dismissal persistence varies per banner, deliberately:** `AnnouncementBanner`/`MultiOutletEnabledBanner` use `sessionStorage` (re-nag per tab), `PwaInstallPrompt` uses `localStorage` (permanent, client-only), `FBRPromptBanner` persists server-side. Match the pattern to the new banner's urgency rather than defaulting to one mechanism.
- **`Button`'s `tone` vs `variant`** — only `tone` exists. Grep for `variant=` before assuming a `Button` usage does anything with that prop; it's silently dropped.
- Some banners import `api` from `../api` (authenticated tenant path); `AnnouncementBanner` uses raw `fetch` against `API_BASE` directly because it must also work pre-login. Match whichever pattern fits your banner's auth requirement.
- `Modal`/`Drawer`/`ConfirmDialog` are the preferred building blocks for any new modal — far more consistent (focus trap, Escape, backdrop-click guard) than hand-rolling `fixed inset-0` markup, which is still common elsewhere in the codebase.
