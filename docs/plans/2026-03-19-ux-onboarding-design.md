# UX & Onboarding Improvements — Design

**Date:** 2026-03-19
**Status:** Approved

---

## Overview

Seven UX improvements to polish the SanoPOS experience: employee self-service profile, profile dropdown menu, global toast notifications, POS keyboard shortcuts with help overlay, dark mode, and breadcrumb navigation.

## Decisions

1. **Onboarding checklist already exists** — `DashboardOnboarding.jsx` with 5 steps. No changes needed.
2. **Dark mode: manual toggle only** — no system preference detection. Toggle in profile dropdown.
3. **Toast: custom, no external library** — matches existing patterns, keeps bundle small.
4. **POS shortcuts: F-key based** — 10 shortcuts, standard POS convention.
5. **Breadcrumbs: route-based auto-generation** — config mapping, skipped on dashboard/POS.

---

## 1. Employee Profile Page + Dropdown

### Profile Dropdown (AppLayoutRedesign.jsx header)

Replaces the bare "Logout" button with a dropdown showing:
- Employee name + role badge (always visible)
- "My Profile" → navigates to `/profile`
- Dark mode toggle (sun/moon icon + "Dark Mode" label)
- "Logout" (existing logic)

### Profile Page (`/profile`)

New route, accessible to all authenticated employees.

**Read-only info section:**
- Name, role, email, assigned outlets

**Self-service forms:**
- "Change PIN" — current PIN → new PIN → confirm new PIN
- "Change Password" — current password (or PIN if no password yet) → new password → confirm

**Backend endpoints used:**
- `GET /api/auth/me` (existing) — load employee info
- `PUT /api/employees/:id/change-password` (existing) — change password
- `PUT /api/employees/:id/change-pin` (new) — change PIN

### New Endpoint: `PUT /api/employees/:id/change-pin`

- Self-only: `x-employee-id` must match `:id`
- Accepts `{ current_pin, new_pin }`
- Verifies current PIN via `pin_hash` or `pin_code`
- Hashes new PIN, updates both `pin_code` and `pin_hash`
- Returns success message

---

## 2. Global Toast System

### `frontend/src/contexts/ToastContext.jsx`

New context provider wrapping the app.

**API:**
```js
const { toast, success, error, warning } = useToast();
toast("Message", "info");   // type: success | error | warning | info
success("Saved!");           // shorthand
error("Failed to save");     // shorthand
```

**Behavior:**
- Auto-dismiss after 4 seconds
- Stack up to 3 toasts (oldest dismissed first)
- Position: bottom-right corner (avoids POS area conflicts)
- Types: success (green), error (red), warning (amber), info (slate)
- Animated: slide-in from right, fade-out on dismiss
- Close button (X) for manual dismiss

**Integration:**
- Wrap in `App.jsx` alongside `CurrencyProvider` and `AuthProvider`
- Pages can adopt gradually — no need to replace all inline errors at once

---

## 3. POS Keyboard Shortcuts

### Shortcut Map (registered in POSContext.jsx)

| Key | Action | Guard |
|-----|--------|-------|
| `F1` | Toggle help overlay | Always |
| `F2` | Open discount modal | Cart not empty |
| `F3` | Park sale | Cart not empty |
| `F4` | Focus customer search | Always |
| `F5` | Open parked sales | Always |
| `F8` | Remove last item | Cart not empty |
| `F9` | Open checkout/payment | Cart not empty |
| `F10` | Clear cart (with confirm) | Cart not empty |
| `Esc` | Close any open modal | Modal open |

**Implementation:**
- Single `keydown` listener in POSContext (extend existing barcode listener)
- `e.preventDefault()` on F-keys to block browser defaults
- Skip when focus is in input/textarea/select (same guard as barcode scanner)
- Each shortcut calls existing POSContext actions (openDiscountModal, parkSale, etc.)

### POS Help Overlay (`POSShortcutsOverlay.jsx`)

- New component mounted in `POSRedesign.jsx`
- Triggered by F1 or `?` button in POS header
- Semi-transparent backdrop with centered card
- Lists all shortcuts in a 2-column grid (Key | Action)
- Dismisses on Esc, F1 again, or click outside

---

## 4. Dark Mode

### CSS Variables (`tokens.css`)

Add `[data-theme="dark"]` selector with dark palette:

```css
[data-theme="dark"] {
  --ui-bg: #0f172a;
  --ui-surface: #1e293b;
  --ui-muted-surface: #334155;
  --ui-border: #475569;
  --ui-text: #f1f5f9;
  --ui-text-muted: #94a3b8;
  --ui-primary: #10b981;
  --ui-primary-strong: #059669;
  --ui-accent: #10b981;
  --ui-danger: #ef4444;
  --ui-warning: #f59e0b;
}
```

### Toggle Logic

- `localStorage` key: `sanopos_theme` (`"light"` or `"dark"`)
- On boot: read from localStorage, default to `"light"`, set `document.documentElement.dataset.theme`
- Toggle in profile dropdown: sun icon (light) / moon icon (dark)
- Small helper: `frontend/src/utils/theme.js` — `getTheme()`, `setTheme(theme)`, `toggleTheme()`

### No Component Changes Needed

All existing components already use `bg-(--ui-surface)`, `text-(--ui-text)`, etc. Swapping the CSS variables via `data-theme` changes the entire app automatically.

**Exception areas to check:**
- Landing page uses some hardcoded Tailwind colors (`bg-slate-50`, `text-slate-900`) — these won't change in dark mode. Landing page stays light (it's a public marketing page).
- Modals with `bg-white` or `bg-black/45` backdrops — may need `bg-(--ui-surface)` swap.
- POS page may have some hardcoded colors.

---

## 5. Breadcrumbs

### `frontend/src/ui/Breadcrumbs.jsx`

- Auto-generates breadcrumb trail from current URL path
- Config mapping of route segments → labels:
  ```js
  { "dashboard": "Dashboard", "employees": "Employees", "purchase-orders": "Purchase Orders", ... }
  ```
- Renders: `Dashboard / Purchase Orders` with links to each level
- Last segment is plain text (current page), others are clickable links

### Placement

- In `AppLayoutRedesign.jsx`, above `<Outlet />`
- Skipped when on: `/dashboard` (root), `/pos` (full-screen), `/kiosk`, `/customer-display`

---

## Files Summary

### New Files
- `frontend/src/contexts/ToastContext.jsx` — global toast provider
- `frontend/src/pages/redesign/ProfileRedesign.jsx` — employee profile page
- `frontend/src/pages/redesign/pos/POSShortcutsOverlay.jsx` — help overlay
- `frontend/src/ui/Breadcrumbs.jsx` — breadcrumb component
- `frontend/src/utils/theme.js` — dark mode helpers

### Modified Files
- `frontend/src/ui/tokens.css` — add dark theme variables
- `frontend/src/App.jsx` — add `/profile` route, wrap ToastProvider, init theme
- `frontend/src/components/AppLayoutRedesign.jsx` — profile dropdown, breadcrumbs, theme toggle
- `frontend/src/pages/redesign/pos/POSContext.jsx` — keyboard shortcuts
- `frontend/src/pages/redesign/pos/POSRedesign.jsx` — mount help overlay, `?` button
- `frontend/src/ui/nav-config.js` — (no change needed, profile is in dropdown not sidebar)
- `backend/routes/employees.js` — add `PUT /api/employees/:id/change-pin`

---

## Out of Scope

- System preference detection for dark mode (manual toggle only)
- Migrating all existing inline errors to toast (gradual adoption)
- Customizable shortcut keys (fixed mapping)
- Onboarding checklist changes (already built)
- Sidebar search functionality (separate feature)
