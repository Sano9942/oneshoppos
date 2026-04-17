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
