/**
 * ai.js — Anthropic-backed generation helpers (Phase 2 fast-entry / catalog AI).
 *
 * Two capabilities, both reusing the single ANTHROPIC_API_KEY:
 *   1. generateProductContent() — Haiku text: product description + tags from a
 *      name (+ optional category/brand). No customer data, no money-critical
 *      fields — safe, cheap, the "Shopify Magic" clone.
 *   2. extractInvoiceLineItems() — Sonnet vision: read a supplier invoice/challan
 *      image and return line items shaped to the import pipeline's canonical
 *      product fields, so they can flow straight into the existing import
 *      preview/confirm flow (which applies margin, auto-SKU, tax).
 *
 * Both functions accept an injected `client` (for unit testing without network)
 * and fall back to a real Anthropic client built from ANTHROPIC_API_KEY. Neither
 * function reaches the network in tests when a fake client is supplied.
 */

const MODELS = {
  // Cheap, fast — fine for short text generation.
  text: "claude-haiku-4-5-20251001",
  // Stronger reasoning + vision — worth it for messy/handwritten challans.
  // Low volume (per-invoice), so the higher per-token cost is acceptable.
  vision: "claude-sonnet-5",
};

function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function getClient() {
  const Anthropic = require("@anthropic-ai/sdk");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/**
 * Pull the first JSON value out of a model response. Claude sometimes wraps
 * JSON in ```json fences or adds a sentence of prose — this tolerates both by
 * slicing from the first bracket to its matching last bracket of the same kind.
 * Returns the parsed value, or throws if nothing parseable is found.
 */
function parseJsonFromText(text) {
  if (!text || typeof text !== "string") throw new Error("empty AI response");
  let s = text.trim();
  // Strip a leading/trailing code fence if present.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Find the outermost JSON container.
  const firstObj = s.indexOf("{");
  const firstArr = s.indexOf("[");
  let start = -1;
  let open = "{";
  let close = "}";
  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
    start = firstArr;
    open = "[";
    close = "]";
  } else if (firstObj !== -1) {
    start = firstObj;
  }
  if (start === -1) throw new Error("no JSON found in AI response");
  const end = s.lastIndexOf(close);
  if (end <= start) throw new Error("malformed JSON in AI response");
  return JSON.parse(s.slice(start, end + 1));
}

function textFromResponse(resp) {
  return resp?.content?.find?.((b) => b.type === "text")?.text || resp?.content?.[0]?.text || "";
}

/**
 * Generate a product description + tags. Returns { description, tags[] }.
 * @param {{name:string, category?:string, brand?:string, unit?:string}} product
 * @param {{client?:object}} [deps]
 */
async function generateProductContent(product, deps = {}) {
  const { name, category, brand, unit } = product || {};
  if (!name || !String(name).trim()) throw new Error("product name is required");
  const client = deps.client || getClient();

  const facts = [
    `Name: ${name}`,
    category ? `Category: ${category}` : null,
    brand ? `Brand: ${brand}` : null,
    unit ? `Sold by: ${unit}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await client.messages.create({
    model: MODELS.text,
    max_tokens: 400,
    system:
      "You write concise product catalog copy for a Pakistani retail/wholesale " +
      "shop's point-of-sale system. Given a product, return STRICT JSON with " +
      'exactly two keys: "description" (1-2 plain sentences, no marketing fluff, ' +
      'factual, English) and "tags" (array of 3-8 short lowercase keyword strings ' +
      "useful for search/filtering — material, type, use, size if implied). " +
      "Return ONLY the JSON object, no prose, no code fence.",
    messages: [{ role: "user", content: facts }],
  });

  const parsed = parseJsonFromText(textFromResponse(resp));
  const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 8)
    : [];
  return { description, tags };
}

/**
 * Extract product line items from a supplier invoice / challan image.
 * Returns rows shaped to the import pipeline's canonical fields so they can be
 * fed straight into the import preview: { name, cost_price, stock_quantity,
 * unit, barcode }. selling_price is intentionally omitted — the import flow
 * derives it from the category margin, and the shopkeeper confirms.
 *
 * @param {{imageBase64:string, mediaType?:string}} image
 * @param {{client?:object}} [deps]
 */
async function extractInvoiceLineItems(image, deps = {}) {
  const { imageBase64, mediaType } = image || {};
  if (!imageBase64) throw new Error("imageBase64 is required");
  const client = deps.client || getClient();

  const resp = await client.messages.create({
    model: MODELS.vision,
    max_tokens: 2000,
    system:
      "You read a photographed or scanned supplier invoice / delivery challan " +
      "and extract its product line items. Return STRICT JSON: an array of " +
      "objects, each with keys: name (string), quantity (number), unit_cost " +
      "(number, the per-unit purchase/cost price), unit (string like pcs/kg/box " +
      "or empty), barcode (string or empty). Extract ONLY real product lines — " +
      "skip totals, taxes, headers, and shipping. If a value is unreadable, use " +
      "0 for numbers and \"\" for strings. Return ONLY the JSON array.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType || "image/jpeg",
              data: imageBase64,
            },
          },
          { type: "text", text: "Extract the product line items as JSON." },
        ],
      },
    ],
  });

  const parsed = parseJsonFromText(textFromResponse(resp));
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
  return {
    rows: items
      .map((it) => ({
        name: String(it.name || "").trim(),
        cost_price: Number(it.unit_cost) || 0,
        stock_quantity: Number(it.quantity) || 0,
        unit: String(it.unit || "").trim() || "pcs",
        barcode: String(it.barcode || "").trim(),
      }))
      .filter((r) => r.name),
  };
}

module.exports = {
  MODELS,
  isConfigured,
  getClient,
  parseJsonFromText,
  generateProductContent,
  extractInvoiceLineItems,
};
