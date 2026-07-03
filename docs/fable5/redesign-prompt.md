# Fable 5 Kickoff Prompt — Square-Style Redesign

> Copy the block below into a **fresh Fable 5 session** (model: `claude-fable-5`, effort **high**). It's self-contained — it points Fable 5 at the spec files in this repo, so it doesn't need the research chat's context.

---

```
Effort: high (xhigh for the token/primitive foundation and the POS phase).

You're redesigning the SanoPOS frontend to look and feel like Square's dashboard: a premium, cohesive, near-monochrome black-and-white aesthetic (Inter font, pill buttons, flat hairline cards, no shadows, generous spacing, accordion sidebar, slide-over drawers). Every decision and the concrete target are already written down.

FIRST, read these three files in full before touching anything:
- docs/fable5/redesign-spec.md            (authoritative: target design tokens, components, layout, phased build plan, guardrails)
- docs/research/square-design-reference/README.md   (the Square UX/design analysis it's based on)
- docs/fable5/playbook.md                 (operating rules for this repo)

Then execute the build plan in redesign-spec.md §5, in order.

Non-negotiables (full detail in the spec):
- Frontend/UI ONLY. Do not change backend routes, services, schema, migrations, API contracts, auth, tax, or POS offline/receipt logic. This is a reskin + layout change — preserve every existing behavior, route, and data call. Fix presentation, never the API.
- Light-only. Drop dark mode cleanly. Retire the green brand accent — primary actions are black, per the spec.
- Git: do Phase 0 first — commit current work on main, tag v-pre-square-redesign, then create and switch to branch redesign/square. Work only there. Commit as you go and push the redesign/square branch so Vercel builds a preview. NEVER push or merge to main, and don't open a PR.
- HARD STOP after Phase 1 (design-system foundation + the redesigned dashboard Home reference page). Push it, get the Vercel preview URL, and report for my approval BEFORE rolling the look across the rest of the app. A wrong foundation propagated to 100+ pages is expensive.
- Verify against the running app, not docs: fresh-context verifier subagent + Playwright walkthrough per phase.

Autonomy: proceed through reversible frontend steps without pausing. Stop only at the Phase 1 approval gate, before any action affecting main, or if genuinely blocked on input only I can give. Don't end a turn on an "I'll do X next" promise — do it. You have ample context; don't suggest a new session.

Lead your report with the outcome first: what the new look is, the Vercel preview URL, and exactly what I should eyeball — then the details.
```

---

## If you'd rather I (this session) run Phase 0 for you first

Say the word and I'll commit the current work, create the `v-pre-square-redesign` tag, and cut the `redesign/square` branch now — then your Fable 5 session starts already on the branch and can skip straight to Phase 1.
