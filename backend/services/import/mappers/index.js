/**
 * Competitor import mapper registry.
 *
 * Adds a thin translation layer between competitor export formats
 * (Shopify, Square) and the shape that routes/import.js already expects.
 *
 * Supported sources: 'shopify', 'square'
 * Supported entities: 'products', 'customers'
 */

const shopify = require("./shopify");
const square = require("./square");

const REGISTRY = { shopify, square };

function getMapper(source, entity) {
  const src = REGISTRY[String(source || "").toLowerCase()];
  if (!src) return null;
  const mapper = src[entity];
  return typeof mapper === "function" ? mapper : null;
}

function getTemplate(source, entity) {
  const src = REGISTRY[String(source || "").toLowerCase()];
  if (!src || !src.TEMPLATES || !src.TEMPLATES[entity]) return null;
  return {
    headers: src.TEMPLATES[entity],
    examples: (src.EXAMPLES && src.EXAMPLES[entity]) || [],
  };
}

function listSources() {
  return Object.keys(REGISTRY);
}

// ---------------------------------------------------------------------------
// Generic column mapper (WS4 supplier-catalog import).
//
// A supplier price list / catalog arrives with arbitrary column headers
// ("Item Desc", "Rate", "Barcode No"). Rather than force the merchant to
// rename columns to our template, the frontend lets them map each of their
// headers to one of our canonical fields, then sends that map here. This
// module owns both the list of canonical target fields per entity and the
// remap function, so routes/import.js only wires it in.
// ---------------------------------------------------------------------------

// Canonical importable fields per entity — these mirror the plain (non-source)
// template headers in routes/import.js. Keep the two in sync.
const CANONICAL_FIELDS = {
  products: [
    "name", "sku", "barcode", "selling_price", "cost_price",
    "category", "brand", "tax", "unit", "stock_quantity", "status",
  ],
  customers: ["name", "mobile", "email", "address", "cnic", "occupation"],
  suppliers: [
    "name", "contact_person", "phone", "email", "address",
    "payment_terms", "credit_days", "credit_limit",
  ],
};

function getTargetFields(entity) {
  return CANONICAL_FIELDS[entity] || null;
}

// Build a mapper from a { "Their Header": "our_field" } object. Returns null
// when the map is empty/unusable so callers can fall through to the raw rows.
// Unmapped source columns are dropped; only mapped fields survive, which keeps
// normaliseRow() downstream clean.
function buildColumnMapper(columnMap) {
  const entries = Object.entries(columnMap || {}).filter(
    ([their, our]) => their && our,
  );
  if (!entries.length) return null;
  return function mapColumns(rows) {
    return rows.map((r) => {
      const out = {};
      for (const [theirHeader, ourField] of entries) {
        if (Object.prototype.hasOwnProperty.call(r, theirHeader)) {
          out[ourField] = r[theirHeader];
        }
      }
      return out;
    });
  };
}

// Suggest an auto-mapping by loosely matching each source header to a canonical
// field (exact snake_case match, or substring either way). Advisory only — the
// merchant confirms in the UI.
function suggestColumnMap(headers, entity) {
  const targets = getTargetFields(entity) || [];
  const suggested = {};
  const used = new Set();
  for (const h of headers) {
    const norm = String(h).trim().toLowerCase().replace(/\s+/g, "_");
    const guess = targets.find(
      (f) =>
        !used.has(f) &&
        (f === norm || norm.includes(f) || f.includes(norm)),
    );
    if (guess) {
      suggested[h] = guess;
      used.add(guess);
    }
  }
  return suggested;
}

module.exports = {
  getMapper,
  getTemplate,
  listSources,
  REGISTRY,
  CANONICAL_FIELDS,
  getTargetFields,
  buildColumnMapper,
  suggestColumnMap,
};
