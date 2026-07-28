import { RuleTester } from "eslint";
import rule from "./no-raw-palette-color.js";

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

tester.run("no-raw-palette-color", rule, {
  valid: [
    // Token-driven chrome — the whole point.
    { code: `<div className="bg-(--ui-muted-surface) text-(--ui-text)" />` },
    { code: `<div className={\`p-2 \${on ? "bg-(--ui-primary)" : "bg-(--ui-surface)"}\`} />` },

    // Non-colour utilities that merely contain digits or palette-ish words.
    { code: `<div className="mt-4 gap-2 rounded-full z-200 grid-cols-3" />` },
    { code: `<div className="border-2 opacity-50 max-w-md" />` },

    // DATA ENCODING indirected through a lookup map — never seen by this rule.
    // This is exactly what must keep working (Recharts, EMPLOYEE_COLORS, the
    // 23 SetupWizard industry tiles, dental-chart condition codes...).
    {
      code: `const STATUS = { active: "bg-emerald-100 text-emerald-700" };
             const El = () => <span className={STATUS[s]} />;`,
    },
    {
      code: `const TILES = [{ iconBg: "bg-blue-100", iconColor: "text-blue-600" }];
             const El = () => <div className={TILES[0].iconBg} />;`,
    },

    // Colour outside a className is not this rule's business (e.g. Recharts fill prop).
    { code: `<Cell fill="#8884d8" />` },
    { code: `<Bar stroke="rgb(16,16,16)" />` },

    // Explicitly allowed class names (star gold has no token equivalent).
    {
      code: `<Star className="h-4 w-4 fill-yellow-400" />`,
      options: [{ allow: ["fill-yellow-400"] }],
    },
    // allow matches the bare form even when the usage is variant-prefixed.
    {
      code: `<div className="hover:fill-yellow-400" />`,
      options: [{ allow: ["fill-yellow-400"] }],
    },
  ],

  invalid: [
    // The plain case.
    {
      code: `<div className="bg-slate-800" />`,
      errors: [{ messageId: "rawPalette", data: { cls: "bg-slate-800" } }],
    },
    // Both branches of a ternary inside a template literal.
    {
      code: `<div className={\`p-2 \${on ? "bg-emerald-500" : "bg-slate-100"}\`} />`,
      errors: [{ messageId: "rawPalette" }, { messageId: "rawPalette" }],
    },
    // Variant-prefixed, and the opacity-modifier form.
    {
      code: `<div className="hover:bg-indigo-50" />`,
      errors: [{ messageId: "rawPalette" }],
    },
    {
      code: `<div className="dark:bg-amber-500/10" />`,
      errors: [{ messageId: "rawPalette" }],
    },
    // clsx-style helper arguments.
    {
      code: `<div className={clsx("flex", cond && "text-red-600")} />`,
      errors: [{ messageId: "rawPalette" }],
    },
    // An allow entry for one class must not excuse a different one.
    {
      code: `<div className="fill-yellow-400 bg-slate-800" />`,
      options: [{ allow: ["fill-yellow-400"] }],
      errors: [{ messageId: "rawPalette", data: { cls: "bg-slate-800" } }],
    },
  ],
});
