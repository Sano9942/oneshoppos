# Plan Template — copy this shape for every file in `plans/`

> Every generated plan file follows this structure exactly. Keep it tight. The point of a plan is to make execution fast and grounded — a call-path map + checklist, not prose. See [completion-spec.md](completion-spec.md) §4 for what a plan is (and isn't).

---

```markdown
# [NN] — [Plan name]  (e.g. "02 — Restaurant mode")

**Covers:** [core spine / cross-surface seams / mode `<name>` + presets X, Y, Z / growth surface]
**Modes/flags in scope:** [`restaurant`, `restaurant_kds`, …]
**Surfaces touched:** [POS · storefront · field-rep · portal · kiosk · admin — list the ones this area actually spans]
**Branch strategy:** [off `main` — backend/wiring only] OR [`redesign/square` collision note per spec §6, with the choice + reason]

---

## Call-path map + verification checklist
> Built from code. For each flow: flow → screen → API call → route → service → schema, and the pass condition. This is what execution walks live.

| Flow | Screen / component | API call | Route → service | "Wired correctly = …" | Status |
|---|---|---|---|---|---|
| [e.g. Open table → add item → send to KDS] | `RestaurantFloorRedesign` | `POST /api/restaurant/checks/:id/items` | `restaurant.js` → `restaurant-kds.js` | item appears on KDS with correct station routing | ☐ |

## Defects (P0) — confirmed broken wiring
> Every line cites a tool result from the planning run. No suspicions here.

- **[defect]** — [what breaks] · evidence: [route/response/flag/tool result] · surfaces affected: [list] · fix sketch: [1 line]

## Feature-parity gaps (P1)
> From the comparison doc. Cite the row.

- **[feature]** — comparison verdict [🟡/❌] · [what Square does vs what we have] · reuse: [existing infra to extend, not rebuild]

## Polish & consistency (P2)
- [edge case / error state / empty state / label-vocab / cross-surface inconsistency]

## Confirm during execution
> Suspected but unverified at plan time — verify live before treating as a defect.

- [suspicion + how to confirm]

## Cross-surface lens (mandatory)
> For every shared concern this plan touches (tax, stock, pricing, visibility, auth, receipts): which OTHER surfaces touch it, and are they consistent? This is where the recurring bug lives.

- [shared concern] → also touched by [surfaces] → [consistent? / needs check]

## Verification bar (execution)
- Test tenant: [industry_type to spin/reuse]
- Walkthrough: [the flows a fresh-context verifier subagent must pass live]
- Done = every checklist row ☑ live + P0s fixed + verifier confirms.

## Preset-skin checklist (mode plans only)
> Per preset sharing this mode: labels, unit vocab, dashboard widgets, onboarding steps, portal tabs render correctly.

- [preset] — [ ] labels [ ] vocab [ ] dashboard [ ] onboarding [ ] portal tabs
```
