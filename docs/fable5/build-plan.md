# Fable 5 Build Plan — Harden Verticals + Build Whitespace Verticals

> Two workstreams, structured to exploit Fable 5's strengths (long-horizon autonomy, parallel subagents, first-shot correctness) in **mixed autonomy**. Read [playbook.md](playbook.md) first for the operating rules.
>
> Grounding: the preset engine is `backend/config/industry-config.js` (23 presets) + `backend/config/mode-registry.js` (10 modes). Adding a **preset on an existing mode** is mostly config; adding a **new mode** is real feature work.

---

## Workstream A — Harden existing verticals

**Goal:** take the code-complete-but-less-battle-tested verticals to launch quality. Targets: **rentals** (car/equipment/furniture/party), **room_management** (hotel/guesthouse/hostel), **gym**, **photography_studio**, and the weight-based trio (**butcher/sweet_shop/textile**).

**Per-vertical loop** (one vertical = one Fable 5 task, run largely autonomous, pause only for fixes that touch schema/multi-tenant):

1. **Spin a test tenant** with that `industry_type` (your onboarding/signup flow; mirror the existing `onboard-*` Playwright specs). Save creds as a test-tenant memory.
2. **Walk the `onboarding_steps`** for that preset end-to-end, then exercise every flow the vertical's mode unlocks (e.g. rentals: check-out → return → late fee; rooms: booking → folio → check-in/out; gym: membership → recurring billing → class booking).
3. **Verify against code + live**, not docs: does each screen's API call succeed, does the mode's feature flags resolve, do labels/vocab render correctly? Use a fresh-context verifier subagent running the Playwright walkthrough.
4. **Log findings** as a diagnosis (what broke, what's rough), most-severe first. Don't auto-fix — report and pause for go-ahead on anything schema/auth-touching.
5. **Fix + re-verify**, then write lessons to memory.

**Parallelize:** the diagnosis passes for independent verticals have no shared state — run several as parallel subagents, each producing a findings report, then triage across them. Fixes go sequentially (shared schema).

**Autonomy:** diagnosis + walkthrough + test-writing = autonomous. Fixes that touch `schema-pg.sql`, migrations, tenant routing, or tax = pause for review.

**Known trap to check first** (from memory): non-restaurant `schema-pg.sql` drift — `treatment_plan_templates`, `outlets` geofence, `leave_requests` partial-day, `company_profile` columns may exist via migration but not in the base schema file. Verify schema parity per vertical before trusting a clean walkthrough.

---

## Workstream B — Build new whitespace verticals

**Goal:** add industry presets for market gaps. Most are **label skins on an existing mode** = low effort, high catalog coverage.

**Mode-reuse map** (proposed — confirm the fit per vertical before building):

| New vertical | Reuses mode | Net-new work? |
|---|---|---|
| Pharmacy | core (+ maybe batch/expiry) | 🟡 batch/lot + expiry tracking may need a new capability |
| Bakery | core / weight-based | 🟢 config skin |
| Bar / Brewery | `restaurant` | 🟢 config skin (bar service already in restaurant mode) |
| Laundry / Dry-cleaning | `workflow_tickets` | 🟢 config skin |
| Florist | core (+ maybe made-to-order) | 🟢 config skin |
| Bookstore | core | 🟢 config skin |
| Auto workshop | `workflow_tickets` | 🟢 config skin (repair_shop cousin) |
| Events / Catering | `service_projects` + `appointments` | 🟢 config skin |
| Tuition / Education | `subscriptions` + `appointments` | 🟢 config skin |
| Spa (dedicated) | `appointments` (+ `room_management` for rooms) | 🟢 config skin |

**Recipe for a config-skin vertical** (autonomous-friendly, mostly one file):

1. Add a preset to `INDUSTRY_PRESETS` in `industry-config.js`: `industry_type`, `business_model`, `display_name`, `modes: [...]`, `labels`, `dashboard_widgets`, `onboarding_steps`, `pos_layout_mode`, `pos_search_config`, and (if it has appointments) `public_booking_labels`.
2. Add its entry to `PORTAL_ENABLED_TABS_BY_PRESET` (+ `PORTAL_LABEL_OVERRIDES` if labels differ).
3. Confirm mode flags auto-enable via `getFeatureFlagsForModes` (no manual flag list needed — the preset re-seed handles it).
4. Add/extend the frontend preset mirror (`PresetContext.jsx`) if it carries new label keys or unit vocab.
5. **Test tenant walkthrough** + verifier subagent, same as Workstream A.
6. Unit test in the `industry-config`/`mode-registry` test style already in `backend/tests/unit/`.

**Recipe for a vertical needing a NEW capability** (e.g. pharmacy batch/expiry): this is a **new mode**, not a skin — pause after step 1's analysis and get a go-ahead. New mode = registry entry + new flags + routes/services + schema. Treat it like a mode-sized feature, not a preset.

**Autonomy:** config-skin verticals = autonomous end-to-end (they're low-risk, config-only), report the diff + walkthrough result. New-capability verticals = plan first, pause for approval before building.

---

## Sequencing recommendation

1. Start with **Workstream A** on the two highest-value un-hardened verticals (likely **rooms** and **rentals** — most complex, most exposed). One at a time, mixed autonomy.
2. In parallel, batch the **config-skin whitespace verticals** (Workstream B) — they're cheap and expand your addressable market fast.
3. Defer new-capability verticals (pharmacy batch/expiry) until a real customer signal, per your "don't build ahead of demand" pattern.

Each run ends by appending lessons to the memory system so the next run starts smarter.
