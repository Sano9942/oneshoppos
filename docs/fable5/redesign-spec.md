# SanoPOS → Square-Style Redesign Spec

> **Authoritative target + build plan for the full-app UI redesign.** A fresh Fable 5 session should read this top-to-bottom, then execute §5 in order. Source analysis: [../research/square-design-reference/README.md](../research/square-design-reference/README.md). Operating rules: [playbook.md](playbook.md).
>
> **This is a frontend reskin + layout change, not a feature change.** Every existing behavior, route, and API call must keep working. Do not touch backend, schema, business logic, auth, tax, or POS offline/receipt logic.

---

## 1. Locked decisions (do not re-litigate)

| Decision | Value |
|---|---|
| **Fidelity** | Faithful to Square — near-monochrome black/white/gray, pill buttons, flat hairline cards, no shadows, generous spacing. SanoPOS's green brand accent is **retired** for the redesign. |
| **Scope** | Entire app, all surfaces, phased: back-office dashboard → POS → admin panel → public/portals. |
| **Font** | **Inter** (self-hosted, variable). Replaces the current default sans. Do NOT use Square's proprietary "Square Sans" or any Square logo/brand asset. |
| **Dark mode** | **Dropped.** Light-only, like Square. Cleanly remove the dark-theme toggle and all `[data-theme="dark"]` token branches — don't leave half-wired dark code. |
| **Version model** | New branch `redesign/square`; `main` stays frozen (production keeps serving the current design). Review via Vercel branch preview. |
| **Backend** | **Untouched.** No route, service, schema, migration, or API-contract changes. Presentation layer only. |

---

## 2. Target design tokens (rewrite `frontend/src/ui/tokens.css`)

Light-only. Values derived from the live Square DOM (see source analysis §1).

```
/* Text */
--ui-text:          #101010;   /* near-black, not pure #000 */
--ui-text-muted:    #6b7280;   /* secondary text */

/* Surfaces */
--ui-bg:            #ffffff;    /* main content canvas */
--ui-surface:       #ffffff;   /* cards */
--ui-sidebar:       #fafafa;   /* sidebar bg — subtly separates nav from content */
--ui-muted-surface: #f5f5f5;   /* hover / disabled / secondary-button bg */

/* Borders */
--ui-border:        #f0f0f0;   /* near-invisible hairline — THE key flat-card cue */
--ui-border-strong: #e3e3e3;   /* input borders, dividers that need to read */

/* Primary action = BLACK (faithful to Square; no green) */
--ui-primary:        #101010;
--ui-primary-strong: #000000;  /* hover */
--ui-on-primary:     #ffffff;

/* Accent — reserved for text links + focus ring ONLY, never fills */
--ui-link:  #006aff;           /* Square-like blue */
--ui-focus: #006aff;

/* Status (pale-bg badge style, keep restrained) */
--ui-success-bg: #e7f6ec;  --ui-success-fg: #0a7d33;
--ui-warning-bg: #fdf1e3;  --ui-warning-fg: #a5620a;
--ui-danger-bg:  #fdecea;  --ui-danger-fg:  #c0341d;
--ui-danger:     #c0341d;

/* Radii */
--ui-radius-sm:   8px;    /* inputs, small controls */
--ui-radius-md:   12px;   /* cards */
--ui-radius-lg:   16px;   /* large containers */
--ui-radius-pill: 9999px; /* buttons, chips, filter pills */

/* Elevation — Square uses NONE. Keep shadows off. */
--ui-shadow:    none;
--ui-shadow-lg: 0 8px 30px rgba(0,0,0,0.08); /* ONLY for slide-over drawers/modals */

/* Type */
--ui-font: "Inter", system-ui, -apple-system, sans-serif;
```

**Typography scale:** body 14px/400; muted labels 13px; H1 24–25px/700; section headings 16–18px/700; button text 14px/600. Inter carries the "display" feel at 700 weight — no separate display font needed.

---

## 3. Component targets (rewrite `frontend/src/ui/primitives.jsx`)

Keep the **same export names and prop APIs** wherever they exist (pages depend on them) — change only the rendered styling. Add new primitives where noted.

- **Button** — pill (`--ui-radius-pill`), height 40px (`sm` ~32px), weight 600. `primary` = black bg / white text; `default`/secondary = `--ui-muted-surface` bg / black text, no border; `danger` = `--ui-danger`; `link` = `--ui-link`, underline on hover, no padding. No green anywhere.
- **SectionCard** — `--ui-surface` bg, `0.8px solid --ui-border`, `--ui-radius-md`, padding 24–32px, **no shadow**.
- **Input / Select** — white bg, `1px solid --ui-border-strong`, `--ui-radius-sm`, focus ring `--ui-focus`.
- **Badge** — pale-bg + colored-fg + small leading icon, per status tokens above.
- **Modal** — centered; white card, `--ui-radius-lg`, `--ui-shadow-lg`, scrim `rgba(0,0,0,0.45)`. Keep existing focus-trap/escape behavior.
- **Drawer (NEW)** — right-anchored, full-height slide-over with scrim; header row (X left, optional `...` + primary pill right), scrollable body. This is Square's account-menu / notifications / record-detail pattern. Build once, reuse.
- **Toast** — bottom, near-black bg, white text, colored status icon, underlined text action + X. (Update `ToastContext` presentation only, not its API.)
- **Tooltip** — black pill, white text.
- **Toggle (NEW or restyle)** — gray track, black knob; no colored "on" track.
- **EmptyState** — support 3 tiers via a `variant` prop: `minimal` (icon + heading + line + 1 pill), `standard` (adds secondary pill + "Learn more" bordered row), `hero` (full-bleed dark section, big headline, white pill, 3-icon caption row) for flagship pages.
- **TableToolbar / filter pills** — search input + clearable filter pills (active/non-default filter shows an inline `✕` to clear) + primary create pill on the right.

---

## 4. Layout targets

- **Sidebar** (`AppLayoutRedesign` + `frontend/src/ui/nav-config.js`) — 280px, `--ui-sidebar` bg. Convert the flat grouped list into a **single-open inline accordion**: clicking a top-level group expands its children in place (push-down, not flyout); nest 2–3 levels where the current nav has sub-areas. Active leaf = light-gray rounded-rect highlight. Top: account/business switcher as a bordered pill, then a full-width search. Bottom (fixed): notifications + help icon row, then a full-width **black primary CTA** (SanoPOS's equivalent of "Take payment" — likely "New sale"/open POS).
- **Page shell** (`PageShell`) — white canvas, H1 at 24–25px/700, generous top spacing, optional subtitle in `--ui-text-muted`, `right` slot for a primary pill.
- **Record detail** — prefer the new **Drawer** (master-detail: keep the list visible, slide detail in from the right) over full-page navigation for quick-view/edit, matching Square's customer-directory pattern.

---

## 5. Build plan (execute in order)

### Phase 0 — Safety net
1. Commit current uncommitted work on `main` with a clear message (checkpoint).
2. Tag it: `git tag v-pre-square-redesign`.
3. Create and switch to `redesign/square`. **All redesign work happens here.**
4. Push the `redesign/square` branch so Vercel builds a preview. **Never push or merge to `main`; no PR.**

### Phase 1 — Foundation + one reference page  ← **HARD STOP FOR APPROVAL**
1. Self-host Inter; wire it as `--ui-font`.
2. Rewrite `tokens.css` (§2) — light-only, remove all dark branches.
3. Remove dark-mode plumbing: the profile-dropdown toggle and `utils/theme.js` dark paths (keep `initTheme` as a no-op or delete its callers cleanly).
4. Rewrite `primitives.jsx` (§3) incl. the new **Drawer** and **Toggle**.
5. Rewrite the sidebar to the accordion layout (§4).
6. Redesign **one reference page end-to-end: the dashboard Home** (`pages/redesign/` dashboard) — real Square-style cards, spacing, empty states.
7. Push, get the Vercel preview URL, run a Playwright smoke pass, then **STOP and report with the preview link.** Do not proceed to Phase 2 until the human approves the look.

### Phase 2 — Roll out across the back-office dashboard
Every `*Redesign.jsx` page and report/dashboard module. Most compose the primitives, so the token/primitive rewrite propagates automatically — focus on page-specific layout, tables (apply the new toolbar + drawer patterns), forms, and empty states. Verify per cluster with a fresh-context verifier subagent + Playwright walkthrough.

### Phase 3 — POS (effort: xhigh)
The cashier screen and its ~60 files use **hardcoded colors** and are **offline-critical**. Replace visuals only: swap hardcoded colors for the new tokens, apply pill/flat styling, keep it fast and touch-friendly. **Do not alter** the offline queue, checkout/`api.raw` status handling, keyboard shortcuts, or receipt logic. Verify offline flow still works.

### Phase 4 — Admin panel (`pages/admin/`, `/admin`)
Apply the design system. Uses `adminFetch`, separate auth — presentation only.

### Phase 5 — Public + portals
Landing, login/signup, reset, public receipt, customer portal, manufacturer portal, storefront. These have their own layouts/auth — reskin to match; don't merge their auth into the tenant scope.

Each phase ends by appending any non-obvious lesson to the memory system (one file per lesson + MEMORY.md pointer).

---

## 6. Guardrails (do-not-touch)

- **Backend is off-limits:** no changes to `backend/` routes, services, `schema-pg.sql`, migrations, or API contracts. If a page looks wrong because of data shape, fix the *presentation*, not the API.
- **Preserve all behavior and routes.** No renamed/removed routes, no broken deep links, no changed data-fetching logic — only how it's rendered.
- **POS:** offline-first behavior, checkout status handling, keyboard shortcuts, and receipt rendering must be byte-for-byte behavior-identical. Visual changes only.
- **Auth/tax/money math:** never touched by this work.
- **Don't hand-edit `CLAUDE.md` files** — they're regenerated by `/audit-docs`.
- **Don't copy Square's font or brand assets.** Inter + original SanoPOS wordmark only.
- **Git:** commit + push only the `redesign/square` branch. Never touch `main`, never open a PR, never write to the production DB.

---

## 7. Autonomy & verification

- **Autonomy:** proceed through reversible frontend steps without pausing. Stop only at: the **Phase 1 approval gate**, any action that would affect `main`, or a genuine block needing human input. Don't end a turn on an "I'll do X next" promise — do it.
- **Verify against the running app, not docs:** fresh-context verifier subagent + Playwright walkthrough per phase; trust order = live behavior > code > tests > CLAUDE.md.
- **Effort:** `high` default; `xhigh` for the Phase 1 token/primitive foundation and all of Phase 3 (POS).
