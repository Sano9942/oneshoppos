# UI — Claude Guide

Shared design system components, layout helpers, and theme tokens. This is the **Square redesign** system (merged to `main` 2026-07-06, tag `v-square-redesign-merged`): **light-only** (dark mode was dropped — there is no more `[data-theme="dark"]` styling), near-monochrome — primary actions are **black**, color is reserved for text links, focus rings, and pale status badges. Components style via `--ui-*` custom-property classes (`text-(--ui-text)`, `bg-(--ui-surface)`, `border-(--ui-border)`), Tailwind v4 syntax. **`primitives.jsx` is fully token-based** (including `Badge` and `BulkActionBar`, which now use pale `--ui-*` status/surface tokens — no longer hardcoded).

**Remaining hardcoded-color exceptions (not yet tokenized):** `AnnouncementBanner.jsx`, `PwaInstallPrompt.jsx`, `MultiOutletEnabledBanner.jsx`, `SubscriptionBanner.jsx`, `StarRating.jsx`, `FBRPromptBanner.jsx`, and parts of `SupportWidget.jsx`. The `Modal`/`Drawer` backdrop scrim is an intentional `bg-black/45`. POS elsewhere in the app uses hardcoded colors by exception (except `POSShortcutsOverlay` + `EndlessAisleModal`).

**Building new UI:** compose from these primitives + `--ui-*` tokens — never hardcode Tailwind color classes (`bg-slate-800`, `text-indigo-600`) or arbitrary hex. Spec: `docs/fable5/redesign-spec.md`.

---

## `primitives.jsx`

Core design system. All named exports.

### Layout & Shell

| Export | Props | Notes |
|--------|-------|-------|
| `PageShell` | `{ title, subtitle?, right?, children }` | Page header wrapper (`min-h-full w-full`): 25px bold title + optional muted subtitle, `right` renders top-right (buttons/actions). No background/gradient of its own. **No `actions` prop.** |
| `SectionCard` | `{ children, className? }` | Card container: `rounded-(--ui-radius-md)` + hairline `--ui-border` + `--ui-surface` bg. **Flat — no shadow** (flatness is the Square look). **No `title` prop.** |

### Form Inputs

| Export | Props | Notes |
|--------|-------|-------|
| `Button` | `{ tone?, size?, iconOnly?, className?, ...props }` | Spreads all HTML button props. Always a `rounded-full` pill, `font-semibold` |
| `Input` | `{ className?, ...props }` | Spreads all HTML input props. Full width, `bg-white`, `--ui-border-strong` border, `rounded-(--ui-radius-sm)` |
| `Select` | `{ className?, children, ...props }` | Spreads all HTML select props. Same styling as `Input` |

**`Button` tones:** `default` (`--ui-muted-surface` bg + `--ui-text`), `primary` (**`--ui-primary` = black `#101010`**, white `--ui-on-primary` text), `danger` (`--ui-danger` red, white text), `plain` (transparent, muted text, hover surface), `link` (transparent, `--ui-link` blue text, no padding, underline on hover).

**`Button` does not accept a `variant` prop** — only `tone`. Passing `variant="secondary"` (as `ErrorBoundary.jsx` does) is silently ignored.

**`Button` sizes:** `md` (default, `h-10 px-4 text-sm`), `sm` (`h-8 px-3 text-[13px]`). `iconOnly` switches to a fixed square (`h-10 w-10` md / `h-8 w-8` sm) for table-row/toolbar icons; `tone="link"` always gets `p-0`.

### Display

| Export | Props | Notes |
|--------|-------|-------|
| `Badge` | `{ tone?, children }` | Inline pill chip. Tones map to **pale `--ui-*` status tokens**: `success` (`--ui-success-bg/fg`), `warning` (`--ui-warning-bg/fg`), `danger` (`--ui-danger-bg/fg`), `default` (`--ui-muted-surface` / `--ui-text-muted`) |
| `EmptyState` | `{ title, body?, icon?, action?, secondaryAction?, learnMoreHref?, variant? }` | 3-tier empty state. `variant`: `minimal` (default — icon + title + one line + action), `standard` (adds secondaryAction + optional bordered "Learn more" row), `hero` (full-bleed **black `--ui-primary`** section for flagship first-run pages) |
| `Skeleton` | `{ className? }` | `animate-pulse` placeholder block (`--ui-muted-surface`) |
| `Toggle` | `{ checked?, onChange, disabled?, ...props }` | `role="switch"` pill toggle. Grey track, monochrome knob — no colored "on" track. Checked knob = `--ui-primary` |
| `Tooltip` | `{ label, children }` | Pure-CSS black pill tooltip on hover (no positioning lib) |

### Tables

| Export | Props | Notes |
|--------|-------|-------|
| `TableToolbar` | `{ left, right }` | Filter/action bar above tables — two flex groups, wraps on small screens |
| `FilterPill` | `{ label, value?, active?, onClick, onClear?, className? }` | Clearable filter chip for `TableToolbar`. Active (non-default) pills show an inline ✕ (`onClear`) so they clear without opening the picker |
| `BulkActionBar` | `{ children }` | Multi-select bulk-action bar — `--ui-muted-surface` bg + `--ui-border-strong` (tokenized, no longer hardcoded) |

### Modals

| Export | Props | Notes |
|--------|-------|-------|
| `Modal` | `{ open, onClose, title?, size?, hideClose?, closeOnBackdrop?, children }` | Backdrop `bg-black/45` scrim, Escape key, focus trap entry + focus restore on close. Card `bg-white` + `shadow-(--ui-shadow-lg)` |
| `Drawer` | `{ open, onClose, title?, actions?, size?, children }` | Right-anchored full-height slide-over with scrim (Square account-menu / notifications / record-detail pattern). Header: X (left), title, optional `actions` (right); body scrolls. Same focus/Escape handling as `Modal`. Sizes `sm`/`md`/`lg` = `max-w-[360/420/560px]` |
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

The Square design tokens. **Light-only, near-monochrome** — no dark theme, no `[data-theme]` (dark mode was dropped in the redesign). This file is the source of truth; the values below are the real ones.

| Token | Value | Role |
|-------|-------|------|
| `--ui-text` | `#101010` | Body text (near-black, not pure `#000`) |
| `--ui-text-muted` | `#6b7280` | Secondary text |
| `--ui-bg` | `#ffffff` | Main content canvas |
| `--ui-surface` | `#ffffff` | Cards |
| `--ui-sidebar` | `#fafafa` | Sidebar bg (subtly separates nav from content) |
| `--ui-muted-surface` | `#f5f5f5` | Hover / disabled / secondary-button bg |
| `--ui-border` | `#f0f0f0` | Near-invisible hairline — THE flat-card cue |
| `--ui-border-strong` | `#e3e3e3` | Input borders, dividers that must read |
| `--ui-primary` | `#101010` | **Primary action = black** |
| `--ui-primary-strong` | `#000000` | Primary hover |
| `--ui-on-primary` | `#ffffff` | Text/icon on primary |
| `--ui-link` / `--ui-focus` | `#006aff` | Text links + focus ring **only** (never fills) |
| `--ui-success-bg/fg` | `#e7f6ec` / `#0a7d33` | Pale success badge |
| `--ui-warning-bg/fg` | `#fdf1e3` / `#a5620a` | Pale warning badge |
| `--ui-danger-bg/fg` · `--ui-danger` | `#fdecea` / `#c0341d` · `#c0341d` | Pale danger badge · solid danger |
| `--ui-radius-sm/md/lg/pill` | `8px / 12px / 16px / 9999px` | Radii (inputs / cards / containers / pills) |
| `--ui-shadow` · `--ui-shadow-lg` | `none` · `0 8px 30px rgba(0,0,0,.08)` | Elevation is **off** — flatness comes from hairline borders; `-lg` is drawers/modals only |
| `--ui-font` | `"Inter Variable", "Inter", system-ui…` | Type |

**Legacy aliases** (defined so old/ad-hoc sites heal instead of rendering transparent): `--ui-muted`, `--ui-accent`, `--ui-bg-hover/-muted/-elevated`, `--ui-surface-muted`, plus an un-prefixed namespace (`--text-primary`, `--accent`, `--border`, `--bg-card`, …) — all mapped onto the Square palette. Prefer the canonical `--ui-*` names above in new code.

**Utility classes:** `.ui-shell-bg` (solid `--ui-bg` background), `.ui-focus-ring` (2px solid `--ui-focus` outline on `:focus-visible`, used across `primitives.jsx`), `.ui-anim-drawer` / `.ui-anim-fade` (drawer slide-in / fade-in). `Input`/`Select` use literal `bg-white` (fine — light-only, no dark inversion to worry about).

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
