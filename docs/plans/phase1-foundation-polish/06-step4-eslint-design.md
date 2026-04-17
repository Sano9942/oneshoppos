# Phase 1.2 Step 4 — ESLint Enforcement Rule Design

> **Date:** 2026-04-18
> **Status:** Approved by user
> **Parent:** [HANDOFF.md](HANDOFF.md) → Step 4

## Goal

Prevent raw `<button>` and `<input>` elements from being reintroduced in `src/pages/redesign/` after the Step 2+3 modal/primitive migration. Hard error in CI, zero false positives.

## Approach

Option C: custom ESLint rule with element-level exceptions for patterns that genuinely can't map to primitives. No disable-comment flood.

## Files to Create

```
frontend/
  eslint-rules/
    no-raw-interactive.js     ← AST visitor rule
    index.js                  ← plugin export wrapper
    no-raw-interactive.test.js ← RuleTester unit tests
  eslint.config.js            ← add scoped block (additive only)
```

## Rule Logic

### `<button>` — flagged UNLESS:
- Single child that is a JSX element (icon component) with no text nodes AND has an `aria-label` prop
  - Rationale: icon-only close/action buttons (`<button aria-label="Close"><X /></button>`) are the `<Button iconOnly>` equivalent; both patterns are acceptable

### `<input>` — flagged UNLESS `type` is one of:
| Excluded type | Why |
|--------------|-----|
| `file` | No primitive equivalent; native file picker required |
| `checkbox` | No primitive equivalent; used for multi-select rows, consent toggles |
| `radio` | No primitive equivalent |
| `hidden` | Form utility, no visual equivalent |
| `range` | No primitive equivalent |
| `color` | No primitive equivalent |

All other types (`text`, `number`, `email`, `password`, `search`, `tel`, `url`, `date`, `time`, `datetime-local`, and no-type) map directly to `<Input>` and are **flagged**.

### Error messages
```
Raw <button> found in redesign page. Use <Button> from ui/primitives.jsx instead.
  (exception: single-icon button with aria-label is allowed)

Raw <input type="text"> found in redesign page. Use <Input> from ui/primitives.jsx instead.
```

## ESLint Config Integration

New block added to `frontend/eslint.config.js` after existing rules — additive, no changes to existing block:

```js
import noRawInteractivePlugin from "./eslint-rules/index.js";

{
  files: ["src/pages/redesign/**/*.{js,jsx}"],
  plugins: { "sano": noRawInteractivePlugin },
  rules: { "sano/no-raw-interactive": "error" }
}
```

Scope: `src/pages/redesign/**` only. `admin/`, `portal/`, `storefront/`, `pos/` subdirs intentionally excluded.

## Rule Unit Tests (RuleTester)

### Valid (must not error)
- `<Button>Save</Button>` — primitive, not flagged
- `<Input type="text" />` — primitive, not flagged
- `<input type="file" />` — excluded type
- `<input type="checkbox" />` — excluded type
- `<input type="radio" />` — excluded type
- `<input type="hidden" />` — excluded type
- `<button aria-label="Close"><X /></button>` — icon-only with aria-label
- `<button aria-label="Delete"><Trash2 className="w-4 h-4" /></button>` — icon-only with aria-label

### Invalid (must error)
- `<button>Save</button>` — raw text button
- `<button onClick={fn}>Cancel</button>` — raw text button
- `<button><X /></button>` — icon button missing aria-label
- `<input type="text" />` — maps to `<Input>`
- `<input type="number" />` — maps to `<Input>`
- `<input type="email" />` — maps to `<Input>`
- `<input type="datetime-local" />` — maps to `<Input>`
- `<input />` — no type defaults to text, maps to `<Input>`

## Verification

```bash
cd frontend
npx eslint src/pages/redesign/BillingRedesign.jsx   # should show errors on remaining raw elements
npx eslint src/pages/redesign/POSRedesign.jsx        # POS is outside redesign/ root — should be clean
npm run lint                                          # full run
npx vitest run eslint-rules/                         # rule unit tests pass
```

## Known Remaining Raw Elements (from Step 3 grep)

After Step 2+3, `src/pages/redesign/` still has ~277 raw `<button>` and ~183 raw `<input>` elements. These are the target of a follow-up cleanup pass (not part of this step — Step 4 just adds the gate). The rule will fire on all non-exempted ones immediately after being added. That's expected — Step 4 adds the rule, a future cleanup pass addresses the violations.

**This means `npm run lint` will have errors after Step 4 until those are fixed.** The plan is:
1. Step 4: add the rule (this step)
2. Step 5 (dark mode) can proceed in parallel since it doesn't touch lint
3. A dedicated cleanup PR fixes the remaining violations before Phase 1.2 is declared done

## Commit Strategy

Single commit on a new branch `phase1-step4-eslint-rule`:
- `frontend/eslint-rules/` (3 new files)
- `frontend/eslint.config.js` (additive change)
- Commit message includes: rule logic summary, exemption list, known violation count
