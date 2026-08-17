# SanoPOS Completion Spec — Make It All Connect

> **Authoritative spec for the "finish the software" effort.** A fresh Fable 5 session reads this top-to-bottom, then runs the two-phase workflow in §4. Companion docs: [completion-prompt.md](completion-prompt.md) (paste-in kickoffs) · [plan-template.md](plan-template.md) (the shape every generated plan must follow) · [README.md](README.md) (the plan register). Operating rules: [../playbook.md](../playbook.md).
>
> **The problem this solves:** SanoPOS *feels* complete but isn't. Square's product works because every surface is wired to every other one — the integration between products is the moat, not any single feature. The goal here is to get SanoPOS to that bar: every screen's API call succeeds, every mode's feature flags resolve, every flow works end-to-end across **every surface that touches it** (POS, storefront, field-rep, portal, kiosk, admin), close the real Square feature gaps, and polish the rough edges — mode by mode, one plan at a time.

---

## 1. Scope (locked)

| Decision | Value |
|---|---|
| **Primary axis** | **Wiring & integration correctness.** Make what already exists actually work end-to-end with no errors: every flow → screen → API → route → service → schema, on every surface that touches it. This is the user's core complaint and comes first in every plan. |
| **Secondary axis** | **Square feature-parity gaps.** Close the real gaps from [../research/sanopos-vs-square-comparison.md](../../research/sanopos-vs-square-comparison.md) (the 🟡 Partial and ❌ Missing rows). |
| **Tertiary axis** | **Polish & consistency.** Edge cases, error states, empty states, label/vocab correctness, UX consistency across surfaces. |
| **Division** | **Hybrid — Fable proposes the cut.** Seed structure: core spine first, then a cross-cutting/multi-surface plan, then one plan per mode (with a preset-skin checklist per plan). Final register is Fable's proposal, approved before execution. See §3. |
| **Branch** | **Fable decides per-plan.** Backend/wiring work branches off `main`; frontend-touching work notes the `redesign/square` collision risk (see §6). One line per plan. |
| **Verification trust order** | live behavior (test-tenant walkthrough) > code (routes/services/schema) > tests > CLAUDE.md. Same "verify against code, never docs" bar the repo already enforces. |

Everything else (auth, tax/FBR, multi-tenant routing, migrations, prod DB, commits/PRs) is on the **pause list** — see §5.

---

## 2. Grounding sources (read before generating any plan)

- **The preset engine:** `backend/config/industry-config.js` (23 presets) + `backend/config/mode-registry.js` (10 modes) + `backend/services/retail-flag-preset.js` (flag seeding). This defines the core → modes → presets structure the plans are cut along.
- **The Square target:** [../research/square-software-audit.md](../../research/square-software-audit.md) (full Square catalog) + [../research/sanopos-vs-square-comparison.md](../../research/sanopos-vs-square-comparison.md) (code-verified ✅/🟡/❌ per feature — **this is the source of truth for the feature-gap axis; cite its rows directly**).
- **The accumulated lessons:** the `feedback_*` memory files — especially `feedback_parallel_paths` (POS-fixed-storefront-broken is the recurring bug), `feedback_verify_before_fixing`, `feedback_frontend_claude_stale`, `feedback_audit_ledger_before_building`. Read these before generating plans and append to them after.
- **The redesign context:** [redesign-spec.md](../redesign-spec.md) — the `redesign/square` branch is a mid-flight frontend reskin. Relevant only for the per-plan branch note (§6).

---

## 3. How the plans are cut (proposed seed — Fable finalizes the register)

Cut for **least overlap and correct sequencing**, not for a tidy 1:1 with presets. Proposed order:

1. **`00-core-spine.md`** — the always-on commerce spine every tenant gets: POS/checkout, products & catalog, inventory, customers/CRM, employees/attendance/roles, cash shifts, sales & returns, taxes, promotions, reporting, accounting. Everything else sits on this, so it's audited and hardened first.
2. **`01-cross-surface.md`** — **the seams.** Shared concerns that must stay consistent across POS / storefront / field-rep / portal / kiosk / admin: tax snapshot, stock decrement, pricing/promotions, catalog visibility, auth/permissions, receipts. This is where "connected perfectly" actually lives and where the repo's recurring bug class hides. **Every other plan also carries "check every other surface that touches this" as a mandatory lens** — this plan owns the ones with no natural mode home.
3. **One plan per mode** — `restaurant`, `appointments`, `commissions`, `service_projects`, `subscriptions`, `workflow_tickets`, `rentals`, `room_management`, `treatment_plans`, `wholesale`. Each covers all presets sharing that mode, with a **preset-skin checklist** (labels, vocab, dashboard widgets, onboarding steps, portal tabs) so preset-specific breakage isn't lost.
4. **Growth/consumer surface plan(s)** — the comparison doc's headline gaps cluster here (website builder, marketing automations, review collection, payment links, AI cataloging). Group as Fable sees fit; these are mostly feature-gap (P1), not wiring (P0).

Fable may merge, split, or reorder — but must justify the final cut in the [README.md](README.md) register and keep the core-spine-first, cross-surface-second sequencing.

---

## 4. The two-phase workflow

### Phase A — Generate the plans (plan mode) → **HARD STOP FOR APPROVAL**

Fable audits from **code** and writes one plan file per §3 into `plans/`, then fills the register in [README.md](README.md), then **stops and reports for human approval before any execution.**

**What a plan is (and isn't) at this phase** — this keeps the planning run tractable and grounded:
- A plan **is** a **call-path map + verification checklist** built by reading code: for each flow in that mode/area, trace flow → screen → API call → route → service → schema, and state **"wired correctly = X"** per item (the pass condition to check at execution). Plus any defects that fell out *cheaply* during mapping.
- A plan is **not** the output of exhaustively walking every flow in a test tenant — that's hours per mode and belongs to **execution** (Phase B), not planning. Don't try to find every bug now; build the map that makes finding and fixing them fast.

**Evidence rule (non-negotiable):** every item in a plan's **Defects** section cites a concrete tool result from the planning run (a route whose response shape the frontend doesn't consume, a feature flag that doesn't resolve, a dead button/route, a contract mismatch). Anything you suspect but haven't confirmed goes in a separate **"Confirm during execution"** list — never in Defects. No "a POS should probably have…" filler.

**Prioritize within each plan:** rank every item **P0** (broken flow / wiring defect — fix first) → **P1** (Square parity gap, cite the comparison doc's 🟡/❌ row) → **P2** (polish/consistency). Execution fixes P0 before building P1; a plan may legitimately stop after P0/P1.

Each plan follows [plan-template.md](plan-template.md) exactly.

### Phase B — Execute one plan at a time

One Fable session per plan (or per P-tier within a big plan). For the target plan:
1. Spin/reuse a test tenant for the relevant `industry_type`; walk the checklist live.
2. Fix P0 wiring defects first, then P1 gaps, then P2 polish — auditing every cross-surface path per the mandatory lens.
3. Fresh-context verifier subagent runs the Playwright walkthrough and confirms each checklist item actually passes before "done."
4. Update the register status; append lessons to memory.

Pause for review on anything on the §5 list.

---

## 5. Autonomy & guardrails

**Autonomous** (plan → execute → self-verify, no check-in): code/flow mapping, grep sweeps, reading code, writing/running tests against local PG, drafting a fix + its test and reporting the diff, config-only preset-skin fixes, live walkthroughs against a **test** tenant.

**Pause and get a decision** (end the turn):
- Schema changes / new migrations (`migrate-pg.js`, `schema-pg.sql`).
- Anything touching multi-tenant routing, auth, tax/FBR, or security.
- Adding a **new mode** or a new backend capability (vs. wiring/fixing existing ones) — that's a feature, plan it separately.
- Commits, pushes, PRs.
- Any write to the production DB (Supabase is read-only, for production-state checks only).

**The Phase A approval gate** is itself a hard stop: generate all plans + register, then stop. Do not start executing until the human approves the cut.

Guardrails: local dev/tests use local Postgres (`.env.test`); never run migrations against production; never commit/push/PR unless explicitly told; don't hand-edit `CLAUDE.md` (regenerated by `/audit-docs`).

---

## 6. Per-plan branch note (frontend-collision risk)

Since branch strategy is Fable's call per plan, each plan states one line on it:
- **Backend/wiring-only work** → branch off `main`; no redesign collision.
- **Frontend-touching work** → note the collision: screens built off `main` land in the **old** design and need re-skinning after the Square redesign; screens built on `redesign/square` entangle with the frozen-`main` release strategy. Fable picks and states which, and why.

---

## 7. Close-out (every phase)

Append any non-obvious lesson (a confirmed wiring defect pattern, a cross-surface trap, a gotcha) to the memory system — one file per lesson + the `MEMORY.md` pointer — and update the register status. Don't record what the repo already documents.
