# Square Dashboard — Design & UX Reference

> **Purpose:** A full-sweep visual/UX audit of the live Square Dashboard (app.squareup.com), captured via browser automation on a real logged-in free account, July 2026. Goal: extract Square's design system (tokens, components, patterns) as a reference for SanoPOS's own design direction. Screenshots were viewed inline during the session but could not be persisted as files (see note at end) — this doc captures everything in writing instead.
>
> **Companion docs in this folder:** `square-software-audit.md` (feature/pricing catalog — different scope, not design), `sanopos-vs-square-comparison.md`.

---

## 1. Design tokens (measured directly from the live DOM via injected JS)

### Typography
```
Body/UI text:  "Square Sans Text VF", "Square Sans Text", "Square Sans Text Fallback", Helvetica, Arial, sans-serif
Headings:      "Square Sans Display VF", "Square Sans Display", "Square Sans Display Fallback", Helvetica, Arial, sans-serif
Body size:     14px / weight 400
H1:            25px / weight 700
```
Square uses a **custom variable font** with a separate display cut for headings — not a generic system font. This is a big, persistent contributor to the "premium/branded" feel that a Tailwind-default sans can't replicate on its own.

### Cards / surfaces
```css
background: #ffffff;
border: 0.8px solid rgb(240, 240, 240);  /* near-invisible hairline */
border-radius: 12px;
padding: 32px;
box-shadow: none;                         /* NO drop shadow anywhere */
```
Separation comes from a hairline border + generous internal padding, never elevation/shadow. This is the single biggest "flat/premium" visual cue across the whole product.

### Buttons
Built on Square's own open-sourced web-component design system ("Market" — custom element `<market-button>`):
```css
background: #101010;    /* near-black, not pure #000 */
color: #ffffff;
border-radius: 20px;    /* = height / 2 → true pill, height 40px */
font-weight: 600;
font-size: 14px;
```
- Primary actions: solid black pill, white text.
- Secondary actions: light-gray pill, black text (no border, no outline style used anywhere observed).
- No color variety for buttons at all — black/white/gray only. Color (blue, green) is reserved for links, status badges, and small accent icons.

### Sidebar
```
width: 280px
background: #FAFAFA     (not pure white — separates nav from white content pane)
active item: light-gray rounded-rect highlight behind the row (not a colored highlight, not a left border accent)
```

### Toast / hover tooltip
- Hover tooltip: small black pill, white text, appears above the trigger icon.
- Toast (bottom-left): near-black background, white text, colored status icon (green check for success), underlined text-link action ("View"), and an "X" dismiss — all in one row.

### Toggle switches
Gray pill track, black circular knob — no color-fill track for "on" state (unlike most products that turn the track green/blue). Consistent with the near-monochrome palette.

### Status badges / pills
- Warning: pale orange background, orange triangle-warning icon, dark text (e.g. "Verification needed").
- Success/status: pale green background, green checkmark icon (e.g. "1/5 Synced").
- "Beta" label: plain gray pill, no icon.

---

## 2. Layout & navigation architecture

### Sidebar nav — inline nested accordion, not flyouts
This is the most important structural pattern observed. Clicking a top-level item (e.g. "Items & services") **expands its children directly beneath it in place**, pushing everything below it down the page — it does NOT open a flyout or navigate away. Only one top-level branch appears to stay open at a time (opening a new one collapses the previous). Nesting goes **3–4 levels deep** in places:

```
Items & services
  └ Items
      ├ Item library
      ├ Channel listings
      ├ Service library
      ├ Image library
      ├ Modifiers
      └ Categories
  └ Subscription plans

Customers
  └ Customer directory
      ├ Directory
      ├ Feedback
      └ Settings

Payments & invoices
  ├ Transactions
  ├ Orders
  │   ├ Overview
  │   ├ All orders
  │   ├ Deliveries
  │   ├ Order partners
  │   └ Fulfilment settings
  ├ Subscriptions
  └ Disputes

Reports
  ├ Sales
  │   ├ Sales summary
  │   ├ Item sales
  │   └ Sales trends
  ├ Accounting
  ├ Payments
  ├ Operations
  ├ Custom
  └ Settings

Staff
  ├ Scheduling
  │   ├ Rota
  │   ├ Availability
  │   └ Time off
  ├ Time tracking
  └ Settings

Settings (global gear icon, bottom of sidebar)
  └ Account & settings
      ├ Personal information
      │   ├ Sign-in & security
      │   └ Preferences
      ├ My business
      ├ Pricing & subscriptions
      ├ Payments
      ├ Notifications
      └ Fulfilment methods
  └ Device management
  └ Restaurant settings
  └ App integrations
  └ Release manager

— divider —
Channels
Square Online
```

Takeaway for SanoPOS: `frontend/src/ui/nav-config.js` currently renders a flat grouped list (Overview/Sell/Customers/Catalog/...). Square's accordion approach scales much better for a nav with 20+ top-level areas and dozens of sub-pages — it keeps the sidebar short by default and only expands what's relevant, and it gives sub-pages a visible "you are here" trail without needing separate breadcrumbs.

### Top bar / account chrome
- **No traditional top bar.** The account switcher ("My Business" — org name + person icon) sits at the very top of the sidebar itself, styled as a bordered pill/box, not a plain text row.
- Below it: a full-width **search bar** (also pill-shaped, magnifying-glass icon, placeholder "Search").
- **Bottom of sidebar** (fixed, always visible regardless of scroll): three icon buttons in a row — Notifications (bell), Setup Guide (clipboard), Help (question mark circle) — followed by a full-width black-outlined **"Take payment"** button as the persistent primary CTA.

### Slide-over panels (not modals) for chrome-level UI
Both the **account menu** (click "My Business") and **Notifications** (bell icon) open as a **full-height panel sliding in from the right**, dimming the rest of the page with a scrim — not a small anchored dropdown. This gives them room for real content (in Notifications' case, a tabbed "Account" / "What's new" segmented control) rather than being cramped.

- Account panel contents: Owner (role label), Account settings, Feature log, Roadmap, Suggest a feature, Cookie preferences, Square Community, Sign out — plus an "Earn rewards" pill button top-right.
- Notifications panel: segmented tabs (Account / What's new), clean empty state ("You're up to date!" with an outlined megaphone icon).

### Setup Guide (clipboard icon)
Opens as a **centered modal** (not a slide-over) — different from the two above, presumably because it's a one-time/occasional flow rather than persistent chrome. Contains a "Setup Guide" heading, overall progress bar + percentage, then icon-badge rows per section ("Account", "Square Point of Sale") each with its own mini black progress pill and "N of M steps completed" text.

### Help icon
Opens Square's **full support center in a new browser tab** (`app.squareup.com/help/...`) rather than any inline UI — out of scope for in-app design patterns, but notable as a UX decision (they don't try to build a mini help widget in-app).

---

## 3. Component patterns (from real pages, not just empty states)

### Data tables (Customer Directory, Item Library)
- Toolbar row: search input, filter pills (e.g. "Category", "All filters" with a funnel icon), and a primary black "Create" pill on the far right.
- Second row (Customers): "Group: All customers" (dropdown-styled label), "+ Create group" pill, "Filters" pill.
- Table header: checkbox column, sortable columns underlined with a caret showing sort direction (e.g. "Name ↑"), and a **"+" button at the far right of the header row** to add/configure columns.
- Rows: thumbnail/avatar placeholder (gray icon square) for image-bearing entities, hover/selected state = light gray row background, right-aligned numeric/price columns, trailing "..." kebab menu per row.
- **Persistent inline "+Quick create" row** directly under the table header on Item Library — lets you add a bare-minimum item (name + price) without opening the full creation modal. Good low-friction pattern for high-volume data entry.
- Dismissible info banners can appear above the toolbar (light gray background, info icon, inline link, X to dismiss) — e.g. "Already have items? Upload an existing item catalogue to get started."

### Master-detail split view (Customer Directory)
Clicking a table row opens a **detail drawer sliding in from the right while the table stays visible** on the left (not a full navigation, not a modal). Drawer contents: entity name as heading, key stat ("Visits: 0"), then labeled rows (Phone, Email) separated by hairline dividers, then expandable sections ("Payment on file", "Notes and files") each with an "Add" text-link action on the right. Top of drawer: X (close), "..." (more actions), and "Edit" pill button.

### Forms (Create Customer modal)
Two-column row layout: **label sits in a subtly gray-shaded left column**, the actual input in a plain white right column, full-width divider between each row. Footer: gray "Cancel" pill (left) + black "Save" pill (right), both bottom-right-ish but Cancel sits to the left of Save with a gap, not far apart.

### Empty states — richness scales with page importance
Three tiers observed:
1. **Minimal** (e.g. Modifiers, Categories): centered icon (line-art or single accent-color glyph) → bold heading → one muted sentence → 1 black pill CTA → optional "LEARN MORE" bordered link row below.
2. **Standard** (e.g. Item Library, empty Customer table): same formula but sometimes two CTAs side by side (one black primary, one gray secondary — e.g. "Create an item" / "Import items").
3. **Rich/full-bleed hero** (e.g. first-visit Customer Directory): a **full-width dark/black hero section** with large bold headline copy, one white pill CTA, and a 3-column row of line-art icons with captions below a divider. Reserved for pages Square wants to sell you on using.

Even the **404 "We couldn't find that page"** view and **first-time feature intro modals** (dark hero background, bullet list of features, black "Continue" pill) follow the exact same visual language — nothing breaks the pattern, which reinforces the "everything feels connected" impression.

### Filter/report toolbars (Transactions, Reports)
Very pill-dense: a horizontal row of individually-styled filter pills, each showing the current value inline (e.g. "All Payment Methods ▾", "Filter by **Timeframe: Reporting day** ✕" — active/non-default filters get a visible X to clear directly on the pill, no need to open the dropdown to reset). Report pages add a colorful two-tone icon badge (black rounded-square with a small yellow/blue accented chart glyph) for their empty state — one of the only places pure color appears outside status badges.

### Settings pages (Sign-in & security)
Bold field label + muted value/description directly beneath it, with the action as an **underlined black text link** on the right of the row (not a button) — "Verify", "Update", "Add". Warning states use a pale-orange badge with icon + text inline next to the label ("⚠ Verification needed"). A thin gray bar spans the very top of the content area on onboarding-relevant settings pages, showing "Next, [step]" plus a mini progress bar and a circular arrow button — nudges you toward the next setup step without blocking the current page.

---

## 4. Gap analysis vs. SanoPOS today

| Aspect | Square | SanoPOS (`frontend/src/ui/tokens.css`, `primitives.jsx`) |
|---|---|---|
| Font | Custom variable font, display/text split | Tailwind default sans, no display cut |
| Card | 12px radius, hairline `#F0F0F0` border, **no shadow**, 32px padding | `--ui-radius-md: 12px` ✓ but `--ui-shadow` applies a real shadow |
| Buttons | Full pill (`radius: 20px` = height/2), black/white only, weight 600 | `rounded-(--ui-radius-sm)` = 8px, Shopify-green primary (`--ui-primary: #008060`), weight 500 |
| Sidebar | 280px, `#FAFAFA` bg, 3–4 level nested inline accordion | Flat grouped list (`nav-config.js`: Overview/Sell/Customers/...), no accordion, no nesting |
| Color use | Near-monochrome; color reserved for status badges/links/rare icon accents | Green accent used broadly for primary actions |
| Empty states | 3-tier system, richness signals page importance | `EmptyState` primitive is a single flat tier (title + body, centered) |
| Slide-over panels | Used for account menu, notifications, and record detail (customer drawer) | Not a pattern currently — SanoPOS uses centered `Modal` for everything |
| Table toolbar | Search + filter pills + inline clearable active-filter chips | `TableToolbar` exists (`primitives.jsx`) but simpler, no clearable filter-pill pattern |

## 5. Recommendations (unchanged from initial pass, still the right priority order)

Don't attempt a full black/white reskin — too much blast radius across ~60+ POS files with intentionally hardcoded colors, plus dark mode. Highest-leverage, lowest-risk moves, roughly in order of ROI:

1. **Drop card shadows, lighten the border** — `--ui-shadow: none`, `--ui-border` → something near `#F0F0F0` in light mode. One token change in `tokens.css`, propagates to every `SectionCard` instantly.
2. **Pill-shape the buttons** — bump `Button`'s radius in `primitives.jsx` to `rounded-full` (or add `--ui-radius-pill`). Cheap, high visual impact, no logic change.
3. **Add a display font** for page titles (`PageShell`'s `<h1>`) — even a free variable font (Inter, Plus Jakarta Sans) gets close to Square's display/text split effect.
4. **Accordion-ize the sidebar** for nav groups with many children (Reports, Catalog, etc.) instead of one long flat list — biggest IA win but the largest change; do this after the above three land and feel right.
5. *(New, from this deeper sweep)* Consider a **slide-over drawer** component for record detail views (customer/product quick-view) as an alternative to always opening a full page or a centered `Modal` — Square's customer-directory master-detail pattern is a strong, low-friction reference if SanoPOS wants a "peek without leaving the list" interaction.

---

## Note on screenshots

This sweep was done via live browser automation with screenshots reviewed inline during the session. The automation's "save to disk" option does not expose a filesystem path this agent can read/write — screenshots could not be copied into this repo as image files. Per user decision, this document captures every visual detail in writing instead. If actual image references are needed later, re-run the walkthrough with manual screenshot saving (right-click → Save Image) at the specific URLs listed in §2.
