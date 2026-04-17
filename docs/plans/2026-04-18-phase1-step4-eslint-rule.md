# Phase 1.2 Step 4 — ESLint Enforcement Rule Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a custom ESLint rule that flags raw `<button>` and `<input>` elements in `src/pages/redesign/` as hard errors, preventing regression after the Step 2+3 primitive migration.

**Architecture:** A local ESLint plugin (3 files in `frontend/eslint-rules/`) registered as an inline plugin in `eslint.config.js`. Scoped to `src/pages/redesign/**` only. Rule uses JSX AST visitors to detect raw elements with smart exceptions for patterns that genuinely can't use primitives.

**Tech Stack:** ESLint 9 flat config, ESLint `RuleTester` for unit tests, Vitest to run the tests (existing test runner).

---

## Context

- Design doc: `docs/plans/phase1-foundation-polish/06-step4-eslint-design.md`
- ESLint config: `frontend/eslint.config.js` (flat config, ESM, `"type": "module"`)
- Existing rules: only `no-unused-vars` — no custom rules yet
- `frontend/eslint-rules/` does not exist yet — create it
- After adding the rule, `npm run lint` **will report errors** on the ~277 raw `<button>` and ~183 raw `<input>` elements still in redesign pages — that is expected and correct. Step 4 adds the gate; a follow-up cleanup PR fixes the violations.
- Branch to use: `phase1-step4-eslint-rule` (create off `main`)

---

## Task 1: Create branch and plugin scaffold

**Files:**
- Create: `frontend/eslint-rules/index.js`
- Create: `frontend/eslint-rules/no-raw-interactive.js`

**Step 1: Create the branch**

```bash
cd d:/newprojects/oneshoppos
git checkout -b phase1-step4-eslint-rule
```

Expected: `Switched to a new branch 'phase1-step4-eslint-rule'`

**Step 2: Create the plugin index (wrapper)**

Create `frontend/eslint-rules/index.js`:

```js
import noRawInteractive from "./no-raw-interactive.js";

export default {
  rules: {
    "no-raw-interactive": noRawInteractive,
  },
};
```

**Step 3: Create the rule skeleton (failing stub)**

Create `frontend/eslint-rules/no-raw-interactive.js`:

```js
export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow raw <button> and <input> elements in redesign pages — use primitives instead.",
    },
    messages: {
      rawButton:
        "Raw <button> found. Use <Button> from ui/primitives.jsx instead. " +
        "(Exception: single-icon button with aria-label is allowed.)",
      rawInput:
        "Raw <input type=\"{{type}}\"> found. Use <Input> from ui/primitives.jsx instead.",
    },
    schema: [],
  },
  create(context) {
    return {};
  },
};
```

**Step 4: Verify the files exist**

```bash
ls frontend/eslint-rules/
```

Expected: `index.js  no-raw-interactive.js`

---

## Task 2: Write failing tests for the rule

**Files:**
- Create: `frontend/eslint-rules/no-raw-interactive.test.js`

**Step 1: Create the test file**

Create `frontend/eslint-rules/no-raw-interactive.test.js`:

```js
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import rule from "./no-raw-interactive.js";

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    parserOptions: {
      ecmaVersion: "latest",
      ecmaFeatures: { jsx: true },
      sourceType: "module",
    },
  },
});

describe("no-raw-interactive", () => {
  it("passes valid cases and fails invalid cases", () => {
    tester.run("no-raw-interactive", rule, {
      valid: [
        // Primitives — never flagged
        { code: `<Button>Save</Button>` },
        { code: `<Input type="text" />` },

        // Excluded input types — genuinely can't use <Input>
        { code: `<input type="file" />` },
        { code: `<input type="checkbox" />` },
        { code: `<input type="radio" />` },
        { code: `<input type="hidden" />` },
        { code: `<input type="range" />` },
        { code: `<input type="color" />` },

        // Icon-only button WITH aria-label — allowed (maps to <Button iconOnly>)
        { code: `<button aria-label="Close"><X /></button>` },
        { code: `<button aria-label="Delete"><Trash2 className="w-4 h-4" /></button>` },
        { code: `<button aria-label="Edit" onClick={fn}><Edit2 size={14} /></button>` },
      ],

      invalid: [
        // Raw buttons with text content
        {
          code: `<button>Save</button>`,
          errors: [{ messageId: "rawButton" }],
        },
        {
          code: `<button onClick={fn}>Cancel</button>`,
          errors: [{ messageId: "rawButton" }],
        },
        {
          code: `<button type="button" className="px-3 py-1">Add</button>`,
          errors: [{ messageId: "rawButton" }],
        },

        // Icon button missing aria-label
        {
          code: `<button><X /></button>`,
          errors: [{ messageId: "rawButton" }],
        },
        {
          code: `<button onClick={fn}><Trash2 size={14} /></button>`,
          errors: [{ messageId: "rawButton" }],
        },

        // Raw inputs that map to <Input>
        {
          code: `<input type="text" />`,
          errors: [{ messageId: "rawInput" }],
        },
        {
          code: `<input type="number" />`,
          errors: [{ messageId: "rawInput" }],
        },
        {
          code: `<input type="email" />`,
          errors: [{ messageId: "rawInput" }],
        },
        {
          code: `<input type="datetime-local" />`,
          errors: [{ messageId: "rawInput" }],
        },
        {
          code: `<input type="password" />`,
          errors: [{ messageId: "rawInput" }],
        },
        // No type = defaults to text
        {
          code: `<input className="border rounded px-2" />`,
          errors: [{ messageId: "rawInput" }],
        },
      ],
    });
  });
});
```

**Step 2: Run the test to confirm it fails (rule stub does nothing yet)**

```bash
cd frontend && npx vitest run eslint-rules/no-raw-interactive.test.js
```

Expected: FAIL — invalid cases are not being caught because `create()` returns `{}`.

---

## Task 3: Implement the rule

**Files:**
- Modify: `frontend/eslint-rules/no-raw-interactive.js`

**Step 1: Replace the stub `create()` with the real implementation**

Replace the entire file content of `frontend/eslint-rules/no-raw-interactive.js`:

```js
// Input types that cannot be represented by <Input> primitive
const EXCLUDED_INPUT_TYPES = new Set([
  "file",
  "checkbox",
  "radio",
  "hidden",
  "range",
  "color",
]);

/**
 * Returns true if a JSX opening element has an aria-label attribute
 */
function hasAriaLabel(openingElement) {
  return openingElement.attributes.some(
    (attr) =>
      attr.type === "JSXAttribute" &&
      attr.name &&
      attr.name.name === "aria-label"
  );
}

/**
 * Returns true if JSX children are all JSX elements (icons) with no text nodes.
 * Allows: <button aria-label="x"><Icon /></button>
 * Disallows: <button>Save</button>, <button><Icon /> Save</button>
 */
function isIconOnly(children) {
  const meaningful = children.filter((c) => {
    if (c.type === "JSXText") {
      return c.value.trim().length > 0;
    }
    return true;
  });
  return (
    meaningful.length > 0 &&
    meaningful.every((c) => c.type === "JSXElement" || c.type === "JSXExpressionContainer")
  );
}

/**
 * Gets the string value of a JSX attribute, or null if dynamic/absent.
 */
function getStringAttr(openingElement, attrName) {
  const attr = openingElement.attributes.find(
    (a) => a.type === "JSXAttribute" && a.name && a.name.name === attrName
  );
  if (!attr || !attr.value) return null;
  if (attr.value.type === "Literal") return attr.value.value;
  return null;
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow raw <button> and <input> elements in redesign pages — use primitives instead.",
    },
    messages: {
      rawButton:
        "Raw <button> found. Use <Button> from ui/primitives.jsx instead. " +
        "(Exception: single-icon button with aria-label is allowed.)",
      rawInput:
        "Raw <input type=\"{{type}}\"> found. Use <Input> from ui/primitives.jsx instead.",
    },
    schema: [],
  },

  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = node.name;
        if (name.type !== "JSXIdentifier") return;

        // --- <button> check ---
        if (name.name === "button") {
          // Find the parent JSXElement to inspect children
          const jsxEl = node.parent;
          const children = jsxEl ? jsxEl.children : [];

          // Allow: icon-only button with aria-label
          if (hasAriaLabel(node) && isIconOnly(children)) return;

          context.report({ node, messageId: "rawButton" });
          return;
        }

        // --- <input> check ---
        if (name.name === "input") {
          const type = getStringAttr(node, "type") || "text";

          if (EXCLUDED_INPUT_TYPES.has(type)) return;

          context.report({
            node,
            messageId: "rawInput",
            data: { type },
          });
        }
      },
    };
  },
};
```

**Step 2: Run the tests — expect all to pass**

```bash
cd frontend && npx vitest run eslint-rules/no-raw-interactive.test.js
```

Expected: all tests PASS.

---

## Task 4: Wire the rule into eslint.config.js

**Files:**
- Modify: `frontend/eslint.config.js`

**Step 1: Add the import and scoped rule block**

Replace the entire content of `frontend/eslint.config.js`:

```js
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import noRawInteractivePlugin from "./eslint-rules/index.js";

export default defineConfig([
  globalIgnores([
    "dist",
    "dist-ssr",
    "coverage",
    "playwright-report*/",
    "test-results/",
  ]),
  {
    files: ["**/*.{js,jsx}"],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: "latest",
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        { varsIgnorePattern: "^[A-Z_]", argsIgnorePattern: "^[A-Z_]" },
      ],
    },
  },
  {
    files: ["src/pages/redesign/**/*.{js,jsx}"],
    plugins: { sano: noRawInteractivePlugin },
    rules: {
      "sano/no-raw-interactive": "error",
    },
  },
]);
```

**Step 2: Run lint on a known-clean file to verify the rule loads without error**

```bash
cd frontend && npx eslint src/ui/primitives.jsx
```

Expected: no errors (primitives.jsx is not in `src/pages/redesign/`).

**Step 3: Run lint on a redesign file to verify the rule fires**

```bash
cd frontend && npx eslint src/pages/redesign/BillingRedesign.jsx 2>&1 | head -20
```

Expected: errors like `Raw <button> found. Use <Button>...` — confirms the rule is active.

**Step 4: Run the full unit test suite to confirm no regressions**

```bash
cd frontend && npx vitest run tests/unit/
```

Expected: all existing unit tests still pass (99 tests).

---

## Task 5: Commit

**Step 1: Stage files**

```bash
cd frontend
git add eslint-rules/index.js eslint-rules/no-raw-interactive.js eslint-rules/no-raw-interactive.test.js eslint.config.js
```

**Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(eslint): add sano/no-raw-interactive rule for redesign pages

Custom ESLint rule scoped to src/pages/redesign/**. Flags raw <button>
and <input> elements as errors. Exceptions:
  - <input type="file|checkbox|radio|hidden|range|color"> — no primitive
  - icon-only <button aria-label="..."> — maps to <Button iconOnly>

Rule will report ~277 button + ~183 input violations on existing code —
expected. A follow-up cleanup PR addresses those. This commit adds the
gate so new violations are blocked from this point forward.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

**Step 3: Push branch**

```bash
git push -u origin phase1-step4-eslint-rule
```

---

## Task 6: Open PR

**Step 1: Create the PR**

```bash
gh pr create \
  --title "feat(eslint): add sano/no-raw-interactive rule for redesign pages" \
  --body "$(cat <<'EOF'
## Summary
- Adds custom ESLint rule `sano/no-raw-interactive` scoped to `src/pages/redesign/**`
- Flags raw `<button>` and `<input>` as hard errors — use `<Button>` / `<Input>` from `ui/primitives.jsx` instead
- Smart exceptions: `file/checkbox/radio/hidden/range/color` inputs + icon-only buttons with `aria-label`
- 16 RuleTester unit tests (8 valid, 8 invalid) all passing

## Known violations
Rule will report ~277 raw `<button>` + ~183 raw `<input>` on existing redesign pages — intentional. These are the cleanup target for the follow-up pass (after Step 5 dark-mode). The gate is now in place.

## Test plan
- [ ] `npx vitest run eslint-rules/no-raw-interactive.test.js` — all 16 cases pass
- [ ] `npx vitest run tests/unit/` — existing 99 unit tests still pass
- [ ] `npx eslint src/ui/primitives.jsx` — no errors (outside scope)
- [ ] `npx eslint src/pages/redesign/BillingRedesign.jsx` — shows violations (rule is live)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Verification Checklist

- [ ] `npx vitest run eslint-rules/no-raw-interactive.test.js` → all pass
- [ ] `npx vitest run tests/unit/` → 99 pass, no regressions
- [ ] `npx eslint src/ui/primitives.jsx` → 0 errors
- [ ] `npx eslint src/pages/redesign/BillingRedesign.jsx` → violations reported (rule live)
- [ ] PR open on GitHub

## What's Next

After this PR merges:
- **Step 5**: Dark mode walkthrough — every redesign page, every modal
- **Cleanup pass**: Fix the ~460 violations the rule now reports (separate PR per domain batch, same pattern as Step 3)
- These can be done in either order; Step 5 is faster and independent
