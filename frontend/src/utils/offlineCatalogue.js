// The counter's offline copy of the catalogue (One Toy Store pilot, blocker 3a).
//
// The POS finds items through the server (scan, search, variant picker), so with
// the internet down nothing could go into the cart. This keeps every live
// product and variant — names, codes and shelf prices, never cost or stock —
// in IndexedDB, one copy per shop, refreshed from GET /api/products/catalogue
// (?version=, so an unchanged catalogue costs a 304). The POS falls back to it only
// when the server can't be reached; see pages/redesign/pos/offlineLookup.js.
import { openDB } from "idb";
import { api } from "../api";

const DB_NAME = "sanopos_catalogue";
const DB_VERSION = 1;
const STORE = "catalogue";
const SEARCH_LIMIT = 50; // same cap as GET /api/products/search

let _dbPromise = null;
let _index = null;
let _indexShop = null;

function getDb() {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "shop" });
      },
    });
  }
  return _dbPromise;
}

/** Build the lookup structures for a { products, variants } catalogue. */
export function buildIndex({ products = [], variants = [] } = {}) {
  const productsById = new Map();
  const productCodes = new Map();
  const variantBarcodes = new Map();
  const variantSkus = new Map();
  const variantsByProduct = new Map();

  const list = products.map((p) => ({ ...p, stock_unknown: true }));
  for (const p of list) {
    productsById.set(p.id, p);
    for (const code of [p.barcode, p.sku, p.plu_code]) {
      if (code && !productCodes.has(code)) productCodes.set(code, p);
    }
  }
  // F9: a toy's extra barcodes scan the same toy; after every toy's own codes,
  // as the server does (GET /api/products/scan/:code).
  for (const p of list) {
    for (const code of p.extra_barcodes || []) {
      if (code && !productCodes.has(code)) productCodes.set(code, p);
    }
  }
  for (const v of variants) {
    const parent = productsById.get(v.product_id);
    if (!parent) continue;
    const variant = { ...v, price: v.price ?? parent.price, stock_unknown: true };
    if (!variantsByProduct.has(v.product_id)) variantsByProduct.set(v.product_id, []);
    variantsByProduct.get(v.product_id).push(variant);
    if (v.barcode && !variantBarcodes.has(v.barcode)) variantBarcodes.set(v.barcode, variant);
    if (v.sku && !variantSkus.has(v.sku)) variantSkus.set(v.sku, variant);
  }
  const byName = [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { products: byName, productsById, productCodes, variantBarcodes, variantSkus, variantsByProduct };
}

/**
 * The offline scan, matching GET /api/products/scan/:code: a product's barcode,
 * SKU or PLU first; otherwise a variant's own barcode, then its SKU.
 * Returns { product, variant? } or null.
 */
export function lookupCode(index, code) {
  if (!index || !code) return null;
  const product = index.productCodes.get(code);
  if (product) return { product };
  const variant = index.variantBarcodes.get(code) || index.variantSkus.get(code);
  if (!variant) return null;
  return { product: index.productsById.get(variant.product_id), variant };
}

/**
 * The offline search box, matching GET /api/products/search: case-insensitive
 * part match on name, barcode, SKU, PLU or price (or the one field asked for),
 * at most 50. D60 order: exact code, code starting with the text, name
 * containing it, then the rest; by name inside each group.
 */
export function searchIndex(index, query, field = "all") {
  const q = String(query || "").trim().toLowerCase();
  if (!index || !q) return [];
  const low = (v) => (v == null ? "" : String(v).toLowerCase());
  const has = (v) => v != null && low(v).includes(q);
  const groups = [[], [], [], []];
  for (const p of index.products) {
    const extra = p.extra_barcodes || [];
    const hasBarcode = has(p.barcode) || extra.some(has);
    const hit =
      field === "barcode" ? hasBarcode
        : field === "sku" ? has(p.sku)
          : field === "price" ? has(p.price)
            : has(p.name) || hasBarcode || has(p.sku) || has(p.plu_code) || has(p.price);
    if (!hit) continue;
    const codes = [p.sku, p.barcode, p.plu_code, ...extra].map(low);
    const rank = codes.includes(q) ? 0
      : codes.some((c) => c && c.startsWith(q)) ? 1
        : has(p.name) ? 2
          : 3;
    groups[rank].push(p);
  }
  return groups.flat().slice(0, SEARCH_LIMIT);
}

export function variantsFor(index, productId) {
  if (!index) return [];
  return index.variantsByProduct.get(Number(productId)) || [];
}

export function productFor(index, productId) {
  if (!index) return null;
  return index.productsById.get(Number(productId)) || null;
}

/** The copy currently in memory (null until loaded or downloaded). */
export function getCatalogueIndex() {
  return _index;
}

function adoptRecord(record) {
  _index = { ...buildIndex(record), fetchedAt: record.fetched_at };
  _indexShop = record.shop;
  return _index;
}

/** Load this shop's saved copy into memory. Returns a summary, or null if none. */
export async function loadCatalogue(shop) {
  const db = await getDb();
  const record = await db.get(STORE, shop || "default");
  if (!record) {
    if (_indexShop !== (shop || "default")) { _index = null; _indexShop = null; }
    return null;
  }
  adoptRecord(record);
  return { productCount: record.products.length, fetchedAt: record.fetched_at };
}

/**
 * Download the catalogue if it changed and keep it. Never throws:
 *   { status: "updated" | "current" | "offline" | "error", productCount? }
 * A failed download keeps the copy already held.
 */
export async function refreshCatalogue(shop) {
  const key = shop || "default";
  const db = await getDb();
  const saved = await db.get(STORE, key);
  if (saved && _indexShop !== key) adoptRecord(saved);

  let res;
  try {
    // The version goes in the query, not If-None-Match: the page can't read
    // the ETag cross-origin, and a custom header would add a preflight.
    const qs = saved?.version ? `?version=${encodeURIComponent(saved.version)}` : "";
    res = await api.raw(`/api/products/catalogue${qs}`);
  } catch {
    return { status: "offline", productCount: saved?.products.length ?? 0 };
  }
  if (res.status === 304 && saved) {
    const touched = { ...saved, fetched_at: new Date().toISOString() };
    await db.put(STORE, touched);
    adoptRecord(touched);
    return { status: "current", productCount: saved.products.length };
  }
  if (!res.ok) return { status: "error", httpStatus: res.status, productCount: saved?.products.length ?? 0 };

  const body = await res.json();
  const record = {
    shop: key,
    version: body.version || null,
    fetched_at: new Date().toISOString(),
    products: Array.isArray(body.products) ? body.products : [],
    variants: Array.isArray(body.variants) ? body.variants : [],
  };
  await db.put(STORE, record);
  adoptRecord(record);
  return { status: "updated", productCount: record.products.length };
}

/** Test helper: forget the in-memory copy (and, unless kept, the saved ones). */
export async function resetCatalogueForTests({ keepStorage = false } = {}) {
  _index = null;
  _indexShop = null;
  if (!keepStorage) {
    const db = await getDb();
    await db.clear(STORE);
  }
}
