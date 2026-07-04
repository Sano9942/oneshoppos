# V08 — Photography Depth (Inquiry Form · Questionnaires · Gallery v1)

**Covers:** findings [09-photography](../findings/09-photography.md) — no P0s (the quote→project→contract→invoice spine matches Studio Ninja); this closes the client-facing P1 trio.
**Presets/modes:** `photography_studio` — modes `service_projects`+`appointments`.
**Surfaces:** public (inquiry form) · portal (questionnaires, gallery) · admin (CRM leads, projects)
**Closes findings rows:** [09] "Public inquiry form → lead" (P1) · "Client questionnaires" (P1 — F03) · "Gallery delivery / proofing" (P1, the 20% version findings suggest) · "Stage-based workflow automation" (P2 — NOT built here; rides completion plan 11's automation engine, per findings note).
**Depends on:** F03 (questionnaires), completion plan 09 executed.
**Branch:** portal/public UI rides `redesign/square`; backend off `main`.
**Model:** **Sonnet, effort medium** (Opus if run alongside others). Smallest plan in the program — three pattern-copies onto existing machinery.

---

## Tasks

### P1 (no P0s in this vertical)
1. **Public inquiry form → lead** — `POST /api/public/inquiries` (mounted pre-tenant like `public-bookings.js`, `resolvePublicTenantDb`, own rate limit): name/phone/email/event-date/type/message → creates a CRM lead (`routes/tier4/crm.js` lead tables — staff-entered today, findings evidence) + notifies staff (`createNotification` + email). Embeddable page (`/inquire?tenant=slug`) linked from the public booking page + storefront; anti-spam: Turnstile (config.js already carries `TURNSTILE_SITE_KEY` — reuse the signup guard).
2. **Client questionnaires** — F03 consumed: photography templates seeded (wedding timeline, shot list); `auto_attach` on project creation; responses on the project page; client fills via portal or public link. Config + seeds only.
3. **Gallery delivery v1** — the findings-scoped 20% version: extend `project_files` (schema:3852, internal-only today) with `client_visible BOOLEAN DEFAULT FALSE` + `client_selected BOOLEAN` (pause-list, two columns); portal project tab gains a "Gallery" section: grid of client-visible images (R2-served), client toggles selections ("pick your 20"), staff sees selections on the project. Watermarking/downloads/sales-per-print explicitly OUT (category leaders integrate Pixieset; we ship proofing-lite).
4. **Selection → milestone hook** — client completing selection logs a project activity + notifies staff (existing `project_activities`).

### P2
5. Inquiry-to-booking conversion button on the lead (prefills the booking modal).
6. Gallery share link for non-portal clients (tokenized public view, F03's token pattern).

## Reuse map (grep-confirmed)
| Need | Reuse | Evidence |
|---|---|---|
| Public tenant routing + limiter | `public-bookings.js` mount + `publicBookingLimiter` | backend/CLAUDE.md |
| Lead pipeline | `routes/tier4/crm.js` leads + activities | findings [09] built rows |
| Turnstile anti-bot | signup flow guard (`TURNSTILE_SITE_KEY` in config.js) | frontend CLAUDE.md config |
| Forms | F03 | plans/F03 |
| Files + activities | `project_files`, `project_activities` (`services/projects.js`) | services/CLAUDE.md |
| Image upload validation | `rasterImageFileFilter` | backend/CLAUDE.md |

## Harden what's built
- **P1 — portal file scoping.** `project_files` becomes client-readable: the portal endpoint must filter `client_visible=true` AND project→customer ownership. Failure: client A opens client B's wedding gallery by iterating project ids — the classic portal IDOR. Copy the ownership-scope pattern from `customer-portal/treatments.js` (findings [06] portal row) and test cross-customer access explicitly.
- **P1 — image payloads.** Galleries are hundreds of multi-MB originals; portal grid must serve R2 URLs directly (R2_PUBLIC_URL path) with lazy loading, never proxy through the 10MB-JSON Express path. Failure: 300-photo gallery through the `/r2/` streaming proxy saturates the single Node instance (backend/CLAUDE.md: single-threaded). Upload path for bulk originals: reuse existing product-media multi-upload; if it proves single-file-only at execution, note and batch client-side.
- **P2 — inquiry spam residue**: even with Turnstile, junk leads accumulate — lead status `spam` + bulk-dismiss on the CRM list (one status value).

## Cross-surface lens
- **Auth:** three new public/portal read-write paths — each scope-checked (tenant param layer + ownership layer, trap-4 discipline).
- **Notifications:** inquiry received (staff), selection completed (staff), questionnaire request (client) — via F05 rules where wired, `createNotification` for staff-side.
- **Visibility:** gallery images are per-project client-visible flags — nothing leaks via storefront product-image endpoints (different tables; assert anyway).

## Verification bar
- Test tenant: fresh `photography_studio`.
- Walkthrough (the Studio Ninja loop, now closed at both ends): public inquiry → lead appears + staff notified → convert: quote → accept → project → contract e-signed → questionnaire auto-attached, client fills on portal → shoot booked via public page with deposit → staff uploads 30 photos, marks client-visible → client selects 20 on portal → staff notified, selections listed → milestone invoiced.
- IDOR test: second customer's portal session cannot read the first's gallery/questionnaire (404).
- Empty states: gallery before upload; inquiry list empty; questionnaire pending vs submitted badges.
