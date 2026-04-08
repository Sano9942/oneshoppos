# Landing Page Design — SanoPOS

**Date:** 2026-03-15
**Goal:** Replace the bare login page with a full one-pager that sells the product, helps new tenants get started, and provides a user guide — all without slowing down existing users.

---

## Routing Change

- **Current:** `HomeRedirect` (`/`) redirects unauthenticated users to `/login` which renders `Login.jsx`.
- **New:** `HomeRedirect` renders a new `LandingPage` component inline for unauthenticated users. The `/login` route stays as a fallback but also renders `LandingPage`. Authenticated users still redirect to `/context-select`.

## Page Structure

### File: `frontend/src/pages/LandingPage.jsx`

Single new file. Replaces `Login.jsx` as the unauthenticated entry point. `Login.jsx` is NOT deleted — `LandingPage` imports and reuses the login form logic.

### Sections (top to bottom)

#### 1. Sticky Navbar
- Logo/brand name "SanoPOS" on the left
- Anchor links: Features, Setup Guide, User Guide
- "Login" button that scrolls to the hero login card (or focuses the store code field)
- Transparent bg, becomes white with shadow on scroll

#### 2. Hero (visible on load — no scrolling needed)
- **Left side (desktop):** Headline, subtext, 2-3 bullet points
  - Headline: "The Complete POS System for Modern Retail"
  - Subtext: "Manage sales, inventory, staff, and reports — all in one place."
  - Bullets: Multi-store ready, Offline capable, Shopify sync
- **Right side (desktop):** The login card (store code + username + PIN form)
  - Reuses existing login form logic from `Login.jsx`
  - Extracts form into a `LoginForm` component (or just inlines it)
- **Mobile:** Stacks vertically — headline first, then login card

#### 3. Features Grid
- 8 feature cards in a 4x2 grid (desktop), 2x4 (tablet), 1x8 (mobile)
- Each card: Lucide icon + title + one-line description
- Features:
  1. Point of Sale — Fast checkout with barcode scanning
  2. Inventory — Stock levels, transfers, adjustments across outlets
  3. Staff Management — Employees, attendance, kiosk PIN clock-in
  4. Reports — 67+ report tabs covering sales, stock, and financials
  5. Cash Shifts — Denomination-based open/close with variance tracking
  6. Multi-Store — Manage multiple outlets from one dashboard
  7. Customer Loyalty — Wallet balance, points earn/redeem
  8. Shopify Sync — Import products, sync inventory, webhooks

#### 4. How It Works
- 3-step horizontal flow (vertical on mobile)
  1. **Get provisioned** — Admin creates your store account
  2. **Setup Wizard** — Configure store name, currency, timezone, first outlet
  3. **Start Selling** — Add products, open a shift, make your first sale
- Simple numbered circles connected by a line/arrow

#### 5. Setup Guide (accordion)
- Expandable sections:
  - "What happens after your store is provisioned?"
  - "Completing the Setup Wizard"
  - "Adding your first products"
  - "Inviting employees and setting permissions"
  - "Opening your first cash shift"
- Content: 3-5 sentences per section, plain language

#### 6. User Guide (accordion)
- Expandable sections:
  - "Making a sale (POS screen)"
  - "Processing returns and exchanges"
  - "Managing inventory and stock transfers"
  - "Running reports"
  - "Cash shifts and end-of-day closing"
  - "Using the kiosk for attendance"
- Content: Step-by-step instructions, 4-8 bullet points per section

#### 7. Footer
- "SanoPOS" brand + copyright 2026
- Links: scroll-to-top, Features, Setup Guide, User Guide

## Design Tokens

- **Primary color:** `#7B61FF` (existing brand purple from login button)
- **Background:** White sections alternating with `slate-50` for contrast
- **Typography:** System font stack (already used), heading sizes via Tailwind
- **Icons:** Lucide React (already a dependency)
- **No images/illustrations** — icons + text only, keeps bundle small

## Technical Details

- **No new dependencies** — Tailwind + Lucide + React, all already installed
- **No backend changes** — purely frontend
- **Scroll behavior:** `scroll-behavior: smooth` on html, anchor IDs on sections
- **Login form:** Extract form JSX from `Login.jsx` into the hero section of `LandingPage.jsx`. Keep the same auth logic (`useAuth`, `useCurrency`, `IS_MULTI_TENANT`).
- **Mobile responsive:** Tailwind breakpoints (`md:` for tablet, `lg:` for desktop)
- **Accessibility:** Accordion uses `<details>`/`<summary>` (native HTML, no JS needed for expand/collapse)

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `frontend/src/pages/LandingPage.jsx` | **Create** | New landing page component |
| `frontend/src/pages/Login.jsx` | **Keep** | Stays as-is for direct `/login` URL, but `HomeRedirect` no longer redirects here |
| `frontend/src/App.jsx` | **Modify** | `HomeRedirect` renders `LandingPage` for unauth users; add `/login` fallback to also render `LandingPage` |

## What This Does NOT Include

- No pricing page (no billing layer yet)
- No signup form (tenants are provisioned by super-admin)
- No blog or changelog
- No animations or heavy JS (keep it fast)
