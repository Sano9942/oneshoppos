# Next Sessions — Copy-Paste Prompts (Fable 5)

> Written 2026-07-07 after the v122 go-live. Two independent sessions, run in any order.
> Select model `claude-fable-5`. Each prompt is self-contained — paste the whole block.

---

## Prompt A — Super-Admin Refresh

```
Operating rules for this session:
- Verify against code and live state, never docs/memory — they drift. Confirm every claim against actual routes/services/schema and the live DB (Supabase MCP, READ-ONLY).
- Scope discipline: change only what the approved plan requires. Simplest thing that works.
- CRITICAL GIT RULE: `git push origin main` AUTO-DEPLOYS to production (Railway + Vercel). Work on a branch (`feat/admin-refresh`), push the BRANCH only, never main, no PR. I deploy by merging + pushing main myself.
- Local dev/tests use local Postgres (.env / .env.test → sanopos_dev); Supabase is read-only for prod-state facts.
- Lead with the outcome in every report. When you learn something non-obvious, save a memory file per the existing convention.

Context: SanoPOS is a multi-tenant POS (backend/CLAUDE.md, frontend/CLAUDE.md). Production just went live at v122 with the full vertical-depth wave: 10 modes, 23 industry presets (V01–V10: grocery lane, wholesale backorders/van/POD, aggregator injection, salon service-history, clinical recalls/vaccinations, repair estimates, gym member check-in, photography gallery/inquiry, rentals car-legal/inspections, lodging channel-sync/night-audit), 7 foundation engines (F01–F07), ~28 background workers, and a subscription/billing spine. The super-admin panel (frontend/src/pages/admin/, backend/routes/admin/) was Square-reskinned visually (self-contained --ui-* tokens, NO ui/primitives imports — see memory square_redesign_phase4) but functionally predates almost all of this.

Fresh per-industry test tenants exist in BOTH local sanopos_dev and production: slugs `golv_<industry>` (all 23 presets), login "Owner", PIN 1234 — full list in docs/fable5/go-live/TEST-TENANTS.md. Use local ones for verification walkthroughs.

Task: bring the super-admin panel fully up to date with what the platform now is. Two phases with a HARD STOP between them.

PHASE 1 — AUDIT + PLAN (then STOP for my approval):
1. Inventory reality from code: every mode, feature flag (DEFAULT_FEATURE_FLAGS + PRESET_EXTRA_FLAGS + bundle seeders in services/retail-flag-preset.js + industry-config.js), every worker in boot/workers.js, every queue/dead-letter table, the billing/trial lifecycle, and every admin route in backend/routes/admin/*.js + every admin page in frontend/src/pages/admin/.
2. Produce a gap matrix: platform capability → what /admin can see/do about it today → gap severity.
3. Plan these approved scopes (all four):
   a. Vertical-aware tenant management — industry column + filter in tenant list; tenant detail shows which modes/verticals the tenant actually uses with per-mode counts (bookings, contracts, plans, rooms, members, tickets, backorders…).
   b. Flag & mode editor parity — view/toggle EVERY current flag and mode per tenant, grouped sensibly; show drift vs. the tenant's preset-expected set; preset re-apply action.
   c. Ops & worker monitoring — worker-status covers all current workers (recall, channel-sync, night-audit, dunning, deposit-hold-expiry, expiry-alert, booking-reminder…), real queue depths, channel-sync + webhook dead letters, FBR queue health, and a "worker enabled-but-stopped / enabled-in-code-but-no-env-var" alert (see memory feedback_worker_env_var_drift).
   d. Billing & lifecycle tools — bulk trial extend/expire, one-action manage/extend/delete of the golv_* test fleet, plan pricing editor, payment/upgrade views.
4. ALSO propose (as a prioritized suggestion list for me to approve per-item) what a modern SaaS super-admin for this class of software has that we lack — evaluate at least: platform analytics dashboard (signups funnel, activation rate, MRR/ARR, churn), feature-adoption matrix (which tenants use which modes/flags — drives roadmap), tenant health score (activity + error rate + worker failures per tenant), global cross-tenant search, targeted announcements (per industry/plan), admin action-audit completeness (routes/admin has known logAdminAction gaps — see backend/routes/CLAUDE.md), admin 2FA / session hardening, email deliverability stats, rate-limit/abuse dashboard, backup/DR status panel, and impersonation UX improvements. Mark each: build-now / later / skip, with a one-line why.
Deliver the plan as docs/fable5/admin-refresh/PLAN.md, report the summary, and STOP.

PHASE 2 — BUILD (only after I approve, possibly with edits):
- Branch feat/admin-refresh off main. Follow the admin panel's existing conventions: adminFetch() not api.js, self-contained --ui-* token styling (no ui/primitives), routes/admin/* with requireAllowedIp + requireSuperAdmin + logAdminAction on every mutation. New cross-tenant queries must be schema-qualified (admin routes have NO tenant context — see backend/routes/admin/CLAUDE.md).
- Cross-tenant introspection that is expensive goes through public.infra_cache written by a worker, not live per-request fanout.
- Integration tests for new admin endpoints (backend/tests, Vitest, local PG). Verify the UI against the local admin with the golv_* fleet as data.
- Commit in coherent chunks, push the branch, report with proof (test output + screenshots).
```

---

## Prompt B — Marketing Website Rebuild

```
Operating rules for this session:
- Verify against code, never docs/memory. EVERY feature claim on the site must be traceable to a real route/flag/preset in the codebase — no invented capabilities, no "coming soon" unless I approve it explicitly.
- CRITICAL GIT RULE: `git push origin main` AUTO-DEPLOYS to production (Railway + Vercel). Work on a branch (`feat/marketing-site`), push the BRANCH only, never main, no PR.
- Lead with the outcome. Save non-obvious lessons as memory files per the existing convention.

Context: SanoPOS (sanopos.com) is a multi-tenant POS/business-OS. The product just went live at v122 with 10 modes and 23 industry presets (retail, grocery, butcher, sweet shop, textile, wholesale/distribution, restaurant, cafe, salon, clinic, dental, veterinary, physiotherapy, repair shop, gym, photography studio, car rental, equipment hire, furniture rental, party supplies, hotel, guesthouse, hostel) — the authoritative preset/mode/flag source is backend/config/industry-config.js + backend/config/mode-registry.js + the flag seeders in backend/services/retail-flag-preset.js. The current public site is ONE stale landing page: `frontend/src/pages/LandingPagePreview.jsx` served at "/" via HomeRedirect (frontend/src/routes/publicRoutes.jsx); there are also 6 dead design-variant previews at /preview/landing-* and a dead LandingPage.jsx — audit and propose deleting them. Signup is /signup (Turnstile-gated), pricing comes from GET /api/billing/pricing (plan_pricing table). The app UI was fully reskinned to a Square-inspired design system (--ui-* tokens, ui/primitives.jsx) — the marketing site should feel like the same brand.

DECISIONS ALREADY MADE (don't re-litigate):
- Scope: FULL marketing site — home page + one page per industry family (~10: retail & grocery, restaurant & cafe, salon & spa, clinics [medical/dental/vet/physio], gym & fitness, wholesale & distribution, rentals [car/equipment/furniture/events], hotels & lodging, repair shops, photography & creative) + pricing page + a "why SanoPOS / compare" page.
- Positioning: GLOBAL-NEUTRAL. English SaaS positioning that works for any market; Pakistan-specific strengths (FBR digital invoicing, PKR, local couriers, foodpanda/Careem) appear as a dedicated localization/compliance section, not the headline. Currency display should not assume PKR.
- Work style: plan first, STOP for approval, then build.

PHASE 1 — AUDIT + PLAN (then STOP for my approval):
1. Extract the real sellable feature set per industry family from code (presets, modes, flags, portal tabs, POS layouts, vertical engines) — build a feature→proof table you'll reuse for copy.
2. Audit the current landing + the 6 variants: what to keep (visual ideas worth stealing), what to delete.
3. Propose: information architecture (routes/pages), a copy deck per page (headlines, feature blocks, CTAs — written out, not placeholders), the design direction (extend the Square --ui-* system for brand consistency; specify type scale, imagery strategy — product screenshots vs illustration), SEO plan (per-page title/meta/OG, structured data, sitemap; the site is a Vite SPA — state clearly how each page's meta is handled and whether prerendering is needed for SEO, with a recommendation), pricing-page mechanics (live from /api/billing/pricing vs static), and how screenshots will be produced (the golv_* local test tenants — one per industry, login "Owner"/1234, see docs/fable5/go-live/TEST-TENANTS.md — can be seeded with demo data and screenshotted via Playwright).
4. Keep performance in scope: public pages must stay lazy-chunked and must not regress app-bundle size or the login path.
Deliver as docs/fable5/marketing-site/PLAN.md + the copy deck, report the summary, and STOP.

PHASE 2 — BUILD (only after I approve the IA + copy + design direction):
- Branch feat/marketing-site off main. New pages under frontend/src/pages/marketing/ (lazy-loaded public routes), shared marketing layout/nav/footer components, mobile-first responsive, light+dark theme per the token system.
- Wire real CTAs: signup flow, /login, book-a-demo (mailto or form → support ticket route — propose in plan).
- Delete the dead landing variants per the approved plan.
- Verify with the preview tools/Playwright at desktop + mobile widths on every page, check Lighthouse-style basics (meta present, images sized, no console errors), and confirm the signup + login paths still work end-to-end locally.
- Commit in coherent chunks, push the branch, report with screenshots of every page.
```

---

### Notes for both sessions
- Neither session pushes `main`. You review each branch, then merge + push main yourself when ready (that push IS the deploy — runbook: docs/fable5/go-live/DEPLOY-RUNBOOK.md).
- The two branches touch disjoint areas (admin panel vs public marketing pages) and can run in parallel sessions safely.
- Test tenants for both: docs/fable5/go-live/TEST-TENANTS.md (`golv_<industry>` / Owner / 1234, local + prod).
