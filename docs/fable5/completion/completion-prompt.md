# Fable 5 Kickoff — Completion (Make It All Connect)

> Two paste-in blocks for a **fresh Fable 5 session** (model `claude-fable-5`). **Prompt A** generates the divided plans (plan mode) and stops for your approval. **Prompt B** executes one approved plan. Both are self-contained — they point Fable at the spec, so no prior chat context is needed. Operating rules live in [../playbook.md](../playbook.md).

---

## Prompt A — Generate the completion plans (run first)

```
Effort: high (xhigh when mapping anything that touches tax, auth, or multi-tenant routing).

The software feels complete but isn't — the goal is to make every surface actually connect end-to-end (no broken buttons, dead routes, unresolved flags, or contract mismatches), close the real Square feature gaps, and polish the rough edges. You'll do this mode by mode, one plan at a time. Right now you're building the PLANS, not executing them.

FIRST, read these in full before writing anything:
- docs/fable5/completion/completion-spec.md   (authoritative: scope, division, two-phase workflow, guardrails)
- docs/fable5/completion/plan-template.md      (the exact shape every plan file must follow)
- docs/research/sanopos-vs-square-comparison.md (code-verified feature gaps — source for the P1 axis)
- backend/config/industry-config.js + backend/config/mode-registry.js (the core→modes→presets structure to cut along)
- the feedback_* memory files (esp. feedback_parallel_paths — the recurring cross-surface bug)

THEN do Phase A from completion-spec.md §4:
- Audit FROM CODE. Build each plan as a call-path map + verification checklist (flow → screen → API → route → service → schema, with "wired correctly = X" per item), plus any defects that fall out cheaply while mapping. Do NOT try to walk every flow live now — that's execution.
- Cut the plans per §3: 00-core-spine first, 01-cross-surface (the seams) second, then one plan per mode with a preset-skin checklist, then growth-surface plan(s). You may merge/split/reorder — justify the final cut in the README register.
- EVIDENCE RULE: every item in a plan's Defects (P0) section cites a concrete tool result from this run. Suspicions with no evidence go in "Confirm during execution", never in Defects. No "a POS should have…" filler.
- Rank within each plan: P0 broken wiring → P1 parity gap (cite the comparison doc's 🟡/❌) → P2 polish.
- Each plan states its own branch strategy (backend off main; frontend notes the redesign/square collision per spec §6) and carries the mandatory cross-surface lens.
- Write the plan files into docs/fable5/completion/plans/ and fill the register table in docs/fable5/completion/README.md.

HARD STOP after the plans + register are written. Report for my approval BEFORE executing anything. Do not start fixing.

Autonomy: run the code-mapping and plan-writing autonomously through reversible steps. Stop only at this approval gate, before anything on the spec §5 pause-list, or if genuinely blocked on input only I can give. Don't end a turn on an "I'll do X next" promise — do it. You have ample context; don't suggest a new session.

Report: lead with the outcome — how you cut the plans and why, the register, and the 3–5 worst confirmed wiring defects you already found — then the details.
```

---

## Prompt B — Execute one approved plan (run per plan, after approval)

```
Effort: high (xhigh if the plan touches schema, multi-tenant, auth, or tax).

Execute completion plan docs/fable5/completion/plans/[NN-name].md. The plans were already generated and approved — read that file plus docs/fable5/completion/completion-spec.md for the rules.

Do Phase B:
- Spin or reuse a test tenant for the plan's industry_type. Walk its verification checklist live.
- Fix in priority order: P0 broken wiring first, then P1 gaps (reuse existing infra — grep before building parallel machinery), then P2 polish. Confirm each "Confirm during execution" suspicion live before treating it as real.
- Apply the mandatory cross-surface lens: for every shared concern (tax/stock/pricing/visibility/auth/receipts), fix EVERY surface that touches it, not just the one screen — the recurring failure here is POS-fixed-storefront-still-broken.
- A fresh-context verifier subagent runs the Playwright walkthrough and confirms each checklist row actually passes before you claim done.

Scope: this plan only. No adjacent refactors. If a fix needs a schema change, new migration, or a brand-new mode/capability, STOP and tell me — that's on the pause list.
Autonomy: proceed through reversible fixes + tests without pausing; stop for spec §5 pause-list items or a genuine block. Don't commit or push. Don't write to production.
Close-out: update the register status for this plan and append any non-obvious lesson to memory (one file + MEMORY.md pointer).
Report: outcome first — what's now wired that wasn't, what's left, what I should test manually — then the diff summary.
```

---

## If you want me (this session) to pre-run Phase 0 setup

The folder and register scaffold already exist. Say the word if you also want me to cut a working branch or pre-spin a test tenant before your Fable session starts — otherwise Prompt A can begin as-is.
