# Photography / Creative Studio

**Presets:** `photography_studio`  **Modes/flags:** modes `service_projects` + `appointments` → `phase4_service_projects`, `phase4_service_contracts`, `phase4_appointments` (`mode-registry.js:34,22`)
**Surfaces:** POS · public booking · portal (invoices/orders/appointments) · admin
**Owned wiring plan:** [completion 09-service-projects.md](../../completion/plans/09-service-projects.md) (quote→project→contract→invoice) + [03-appointments-commissions.md](../../completion/plans/03-appointments-commissions.md) (booking surface)

## What's built today (from code)

- Quotations with accept/approve → **convert to project** — `routes/tier4/crm.js` (quotations), `routes/projects.js:59-68` (`/api/quotations/:id/approve`, `/convert-to-project`) — works
- Projects: lifecycle, milestones, activity log, files — `routes/projects.js`, `services/projects.js` (`service_projects`, `project_milestones`, `project_activities`, `project_files` — `schema-pg.sql:3762-3852`) — works
- Milestone/deposit billing: attach invoices to projects, billing summary — `routes/projects.js:76-83`, `services/project-billing.js` — works
- Contracts with **e-signature**, multi-signer, templates, send/sign events — `routes/contracts.js` (`/send`, `/sign`, `/api/contract-templates`), `services/contracts.js:signContract`, `contract_signers`/`contract_events` (`schema-pg.sql:3829-3842`) — works
- Session booking: calendar, availability, public "Book a session" page with Photographer labels + deposit intent — `routes/bookings.js`, `routes/public-bookings.js`, `industry-config.js:269` — works
- Lead pipeline: CRM leads + activities — `routes/tier4/crm.js` — works (generic CRM, not a public inquiry form)
- Invoicing with deposits, reminders, subscriptions (retainers) — `routes/customer-invoices.js`, `services/customer-invoicing.js`, `services/subscriptions.js` — works
- Portal: client sees invoices/orders/"Photo Shoots" — `industry-config.js:762,791` — works

## What this industry needs (domain + research)

Benchmarks: Studio Ninja, HoneyBook (business ops), Pixieset/ShootProof (delivery).

- Lead → quote → contract → invoice → project pipeline with automation — Studio Ninja's end-to-end loop: "customizable quotes to online contracts and secure payments"; HoneyBook pipelines — source: [Studio Ninja](https://www.studioninja.co/), [HoneyBook vs Studio Ninja](https://www.honeybook.com/blog/honeybook-vs-studio-ninja) — **largely met**
- **Public inquiry/contact form feeding the lead pipeline** — Studio Ninja's integrated contact-form builder is how leads enter; photographers live on inquiries — source: [Studio Ninja review](https://www.joshuaharrison.photography/studio-ninja-review/)
- **Client questionnaires** (wedding day timeline, shot lists) — portal-standard in Studio Ninja — source: same review (portal shows "questionnaire, contract, invoices and galleries")
- **Gallery delivery/proofing** — clients receive/select photos via Pixieset/ShootProof; Studio Ninja integrates rather than builds — source: [Flothemes studio software roundup](https://flothemes.com/best-studio-management-software-for-photographers/)
- Workflow automation (email sequences per project stage) — HoneyBook/Studio Ninja standard — source: [Studio Ninja](https://www.studioninja.co/)

## Gap analysis (ranked)

| Requirement | Built? | Evidence (code) | Impact tier | Note |
|---|---|---|---|---|
| Public inquiry form → lead | no | `routes/tier4/crm.js` leads are staff-entered; no public lead-capture endpoint (public routes are bookings/storefront/reservations only — `routes/CLAUDE.md` mount list) | P1 | the top of the funnel; public-bookings page is an adjacent pattern to clone |
| Client questionnaires | no | no form/questionnaire entity in schema; portal tabs are fixed set (`industry-config.js:729`) | P1 | shared shape with clinical intake forms and gym waivers — one form-builder serves all |
| Gallery delivery / proofing | no | grep `gallery\|proofing` `*.{js,jsx}` → only storefront product-image false-positives; `project_files` (`schema-pg.sql:3852`) is internal storage, not client-facing selection | P1 | category leaders integrate (Pixieset) rather than build; a portal "files" tab sharing `project_files` is the 20% version |
| Stage-based workflow automation (emails per milestone) | no | milestones exist; no trigger/sequence engine (marketing automations gap — owned by completion plan 11) | P2 | ride on plan 11's automation engine when it lands |
| Quote→project→contract→e-sign→milestone invoicing | yes | files above | — | the business spine matches Studio Ninja feature-for-feature |
| Session scheduling + public booking + deposits | yes | files above | — | |

## Readiness verdict

**Competitive (business ops), with a soft client-facing edge.** The quote→project→contract→invoice spine already matches Studio Ninja; no P0s — a studio can genuinely run on it today. The biggest gap to category-leading is the client-facing trio (inquiry form, questionnaires, gallery delivery), all P1 and all buildable on existing portal machinery.
