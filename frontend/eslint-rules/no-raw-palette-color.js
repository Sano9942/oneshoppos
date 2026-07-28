/**
 * Disallow raw Tailwind palette colour classes (bg-slate-800, text-indigo-600,
 * ...) written directly into a className. The app is the Square design system:
 * colour comes from --ui-* tokens in ui/tokens.css, never from the stock
 * palette.
 *
 * Why className-literals only, and not every colour class in the file:
 *
 *   Chrome colour is written inline      -> className="bg-slate-800"
 *   DATA-ENCODING colour is indirected   -> const STATUS = { active: "bg-emerald-100" }
 *                                           className={STATUS[s]}
 *
 * That distinction is the whole point. Recharts series fills, EMPLOYEE_COLORS,
 * STATUS_COLORS, dental-chart condition codes, the POS tile-colour picker and
 * SetupWizard's 23 per-industry tiles all encode a *value*, not chrome — they
 * live in lookup maps and must NOT be swept onto tokens, or they stop carrying
 * meaning. Because they are indirected through a map, this rule never sees them
 * and never fires on them. Inline literals in a className are, empirically,
 * chrome.
 *
 * Genuine exceptions (on-dark accents, star gold) are handled two ways:
 *   - `allow: ["fill-yellow-400"]` rule option for specific class names
 *   - file-level `ignores` in eslint.config.js for whole documented-exception
 *     files (see ui/CLAUDE.md's hardcoded-colour exception list)
 */

const PALETTE = [
  "slate", "gray", "zinc", "neutral", "stone",
  "red", "orange", "amber", "yellow", "lime", "green", "emerald",
  "teal", "cyan", "sky", "blue", "indigo", "violet", "purple",
  "fuchsia", "pink", "rose",
].join("|");

const PREFIX = [
  "bg", "text", "border", "ring", "from", "to", "via", "divide",
  "fill", "stroke", "decoration", "outline", "placeholder", "accent",
  "caret", "shadow",
].join("|");

// e.g. bg-slate-800, hover:text-indigo-600, dark:bg-amber-500/10, -mt is not matched
const COLOR_CLASS = new RegExp(
  `(?:^|\\s)((?:[a-z-]+:)*(?:${PREFIX})-(?:${PALETTE})-\\d{2,3}(?:\\/\\d{1,3})?)(?=\\s|$)`,
  "g"
);

/** Every string literal reachable inside a className expression. */
function collectStrings(node, out = []) {
  if (!node || typeof node !== "object") return out;
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") out.push(node);
      break;
    case "TemplateLiteral":
      node.quasis.forEach((q) => out.push({ ...q, __raw: q.value.cooked ?? "" }));
      node.expressions.forEach((e) => collectStrings(e, out));
      break;
    case "ConditionalExpression":
      collectStrings(node.test, out);
      collectStrings(node.consequent, out);
      collectStrings(node.alternate, out);
      break;
    case "LogicalExpression":
    case "BinaryExpression":
      collectStrings(node.left, out);
      collectStrings(node.right, out);
      break;
    case "ArrayExpression":
      node.elements.forEach((el) => collectStrings(el, out));
      break;
    case "CallExpression":
      // clsx("a", cond && "b") / classNames(...) / cn(...)
      node.arguments.forEach((a) => collectStrings(a, out));
      break;
    default:
      break;
  }
  return out;
}

function textOf(strNode) {
  if (Object.prototype.hasOwnProperty.call(strNode, "__raw")) return strNode.__raw;
  return typeof strNode.value === "string" ? strNode.value : "";
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow raw Tailwind palette colour classes in className — use --ui-* design tokens.",
    },
    messages: {
      rawPalette:
        'Raw palette colour "{{cls}}" in className. Use a --ui-* token instead ' +
        '(e.g. bg-(--ui-muted-surface), text-(--ui-text-muted)) — see ui/tokens.css. ' +
        "If this colour encodes DATA rather than chrome, move it into a lookup map " +
        "(const X_COLORS = {...}) or add it to this rule's `allow` option.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: { type: "array", items: { type: "string" }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const allow = new Set((context.options?.[0]?.allow) || []);

    return {
      JSXAttribute(node) {
        if (!node.name || node.name.name !== "className") return;
        if (!node.value) return;

        const expr =
          node.value.type === "JSXExpressionContainer" ? node.value.expression : node.value;

        for (const strNode of collectStrings(expr)) {
          const text = textOf(strNode);
          if (!text) continue;

          for (const m of text.matchAll(COLOR_CLASS)) {
            const cls = m[1];
            // Allow either the full class ("hover:bg-amber-100") or its
            // unprefixed form ("bg-amber-100" / "fill-yellow-400").
            const bare = cls.replace(/^(?:[a-z-]+:)*/, "");
            if (allow.has(cls) || allow.has(bare)) continue;

            context.report({
              node: strNode.type ? strNode : node,
              messageId: "rawPalette",
              data: { cls },
            });
          }
        }
      },
    };
  },
};
