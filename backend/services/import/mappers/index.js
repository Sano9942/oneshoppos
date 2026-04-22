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

module.exports = { getMapper, getTemplate, listSources, REGISTRY };
