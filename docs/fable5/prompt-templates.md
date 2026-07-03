# Fable 5 Prompt Templates — SanoPOS

> Copy-paste, fill the `[brackets]`, run on `claude-fable-5`. Each template already bakes in the Fable-5 behaviors (act don't deliberate, scope discipline, verify-against-code, progress-grounding, mixed autonomy, outcome-first summary). Pair with [playbook.md](playbook.md).
>
> Rule of thumb: give the **why**, the **scope fence**, and the **verification bar** — then get out of the way.

---

## 1. Harden a vertical

```
Effort: high.

Why: [vertical] is code-complete but not launch-validated. I want it at the quality of retail/restaurant before I sell it.

Task: Harden the [vertical] preset (industry_type "[type]", mode "[mode]").
- Spin a test tenant with this industry_type. Walk its onboarding_steps, then exercise every flow the mode unlocks.
- Verify against actual code + the live walkthrough, not CLAUDE.md. Use a fresh-context verifier subagent to run the Playwright walkthrough and report what actually failed.
- Produce a findings report, most-severe first, each finding pointing to a tool result.

Scope: diagnosis only this turn — do not fix yet. Don't refactor anything outside the finding.
Autonomy: run the diagnosis autonomously; end the turn with the report and wait before fixing.
Report: lead with the verdict (launch-ready? what's the worst issue?), then the ranked findings.
```

---

## 2. Build a new whitespace vertical (config skin)

```
Effort: medium.

Why: expanding the industry catalog. [vertical] is a label skin on the existing "[mode]" mode — no new capability needed.

Task: Add a "[vertical]" preset.
- Add it to INDUSTRY_PRESETS in backend/config/industry-config.js (labels, business_model, modes, dashboard_widgets, onboarding_steps, pos_layout_mode, pos_search_config, public_booking_labels if it books).
- Add PORTAL_ENABLED_TABS_BY_PRESET (+ label overrides). Mirror new label keys in frontend PresetContext.jsx.
- Add a unit test in the existing industry-config test style.
- Spin a test tenant with the new industry_type and walk it via a verifier subagent.

Scope: config only. If you discover it needs a capability no existing mode provides, STOP and tell me — that's a new mode, not a skin, and I'll decide separately.
Autonomy: run end-to-end; report the diff + walkthrough result.
Report: outcome first (does a fresh tenant on this preset work?), then the diff summary.
```

---

## 3. Close a Square-parity gap feature

```
Effort: high (xhigh if it touches schema/multi-tenant/tax).

Why: from docs/research/sanopos-vs-square-comparison.md, we lack [feature]. I want parity with Square's [feature].

Task: Implement [feature]. Reuse existing infrastructure — [e.g. "generalize the existing invoice payment-link flow" / "extend marketing.js campaigns"] rather than building parallel machinery. Grep for what already exists first.

Scope: build only [feature]. No adjacent cleanup, no speculative options. Audit every call path that touches [shared concern] so POS/storefront/field-rep/portal all stay consistent.
Autonomy: plan first and show me the approach if it touches schema, auth, or tax; otherwise implement + test, then report. Don't commit or push.
Verify: fresh-context verifier subagent confirms it works against a test tenant before you claim done.
Report: outcome first, then what changed and what I should test manually.
```

---

## 4. Bug hunt / systematic debug

```
Effort: high.

Why: [symptom] on [where]. [Known-good vs broken context.]

Task: Find the root cause before proposing any fix. Reproduce it (test tenant or failing test), trace the actual call path, and confirm the mechanism with a tool result — don't pattern-match to a plausible cause.

Scope: diagnosis first. When touching a shared concern (tax/stock/auth/pricing/visibility), check every other route/service that touches it — the recurring failure here is one path fixed, another still broken.
Autonomy: diagnose autonomously; end with the root cause + proposed fix and wait. Don't apply it yet.
Report: outcome first (root cause in one sentence), then the evidence chain, then the proposed fix.
```

---

## 5. Code review before merge

```
Effort: high.

Task: Review the current branch diff for correctness bugs and multi-tenant/tax/auth regressions. This is a multi-tenant POS — pay special attention to: tenant isolation, POS-vs-storefront-vs-field-rep consistency, schema/migration safety, and money math.

Scope: review only — report findings, don't fix unless I say so. Rank by severity; skip nits.
Verify: for each finding, give the concrete failure scenario (inputs → wrong output), not a vague concern.
Report: findings most-severe first; if nothing real survives scrutiny, say so plainly.
```

---

## Reusable snippets

**Long autonomous run add-on:**
```
Proceed through reversible steps without pausing. Only stop for: schema/migration changes, auth/tax/security, commits/PRs, or prod-DB writes — or if genuinely blocked on input only I can give. Don't end a turn on an "I'll do X next" promise; do it. You have ample context — don't suggest a new session.
```

**Parallelize independent work:**
```
These [N] items share no state. Dispatch them to parallel subagents, keep working while they run, and triage the reports together. Fixes that touch shared schema go sequentially.
```

**Memory close-out:**
```
Before finishing, append any non-obvious lesson (correction, confirmed approach, gotcha) to the memory system per the existing one-file-per-lesson convention, and add the MEMORY.md pointer. Don't record what the repo already documents.
```
