import { RuleTester } from "eslint";
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
