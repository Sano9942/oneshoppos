// How the POS finds products (One Toy Store pilot, blocker 3a): ask the server
// first — it has live stock, kits and scale-label decoding — and fall back to
// the counter's catalogue copy (utils/offlineCatalogue.js) only when the server
// can't be reached: the browser says offline, the request fails, the server is
// down (5xx) or doesn't answer in OFFLINE_TIMEOUT_MS. A real answer from the
// server (404, 403, …) is never second-guessed by the copy.
import { api } from "../../../api";
import {
  getCatalogueIndex,
  lookupCode,
  searchIndex,
  variantsFor,
  productFor,
} from "../../../utils/offlineCatalogue";

export const OFFLINE_TIMEOUT_MS = 4000;

class Unreachable extends Error {}

function browserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// Run a request; turn "can't reach the server" into Unreachable.
async function reach(run) {
  if (browserOffline()) throw new Unreachable("offline");
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Unreachable("timeout")), OFFLINE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([run(), timeout]);
  } catch (err) {
    if (err instanceof Unreachable || err instanceof TypeError) throw new Unreachable(err.message);
    if (err?.status >= 500) throw new Unreachable(`HTTP ${err.status}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const NO_COPY = "Offline, and there is no offline copy of the catalogue on this counter yet";

/**
 * Scan / PLU lookup. Resolves to
 *   { found: true, product, variant?, offline }  or
 *   { found: false, status, error, offline }
 */
export async function scanProduct(code) {
  try {
    const res = await reach(async () => {
      const r = await api.raw(`/api/products/scan/${encodeURIComponent(code)}`);
      if (r.status >= 500) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      return r;
    });
    let body = {};
    try { body = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok || !body?.product) {
      return { found: false, offline: false, status: res.status, error: body?.error || `No product for ${code}` };
    }
    return { found: true, offline: false, product: body.product, variant: body.variant || null };
  } catch (err) {
    if (!(err instanceof Unreachable)) throw err;
  }
  const index = getCatalogueIndex();
  if (!index) return { found: false, offline: true, status: 0, error: NO_COPY };
  const hit = lookupCode(index, code);
  if (!hit) return { found: false, offline: true, status: 404, error: `Offline: no product for ${code} in the offline copy` };
  return { found: true, offline: true, product: hit.product, variant: hit.variant || null };
}

/** Search box. Resolves to { products, offline }. */
export async function searchProducts(query, { field = "all", outletId = null } = {}) {
  const params = { query };
  if (outletId) params.outlet_id = outletId;
  if (field !== "all") params.field = field;
  try {
    const data = await reach(() => api.get("/api/products/search", params));
    return { products: data?.products || [], offline: false };
  } catch (err) {
    if (!(err instanceof Unreachable)) throw err;
  }
  return { products: searchIndex(getCatalogueIndex(), query, field), offline: true };
}

/** Variant picker. Resolves to { product, variants, offline }. */
export async function loadVariants(productId, { outletId = null } = {}) {
  const qs = outletId ? `?outlet_id=${outletId}` : "";
  try {
    const [prodRes, varRes] = await reach(() => Promise.all([
      api.get(`/api/products/${productId}`),
      api.get(`/api/products/${productId}/variants${qs}`),
    ]));
    return {
      product: prodRes?.product || prodRes || null,
      variants: Array.isArray(varRes?.variants) ? varRes.variants : [],
      offline: false,
    };
  } catch (err) {
    if (!(err instanceof Unreachable)) throw err;
  }
  const index = getCatalogueIndex();
  if (!index) throw new Error(NO_COPY);
  return { product: productFor(index, productId), variants: variantsFor(index, productId), offline: true };
}

/** Variants of a product, for the scan paths' "has variants?" check. */
export async function listVariants(productId) {
  try {
    const v = await reach(() => api.get(`/api/products/${productId}/variants`));
    return Array.isArray(v?.variants) ? v.variants : [];
  } catch (err) {
    if (!(err instanceof Unreachable)) return [];
  }
  return variantsFor(getCatalogueIndex(), productId);
}

/** True when the server answers now (Lock uses it: unlocking needs the server). */
export async function serverReachable() {
  try {
    await reach(async () => {
      const r = await api.raw("/api/health");
      if (r.status >= 500) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      return r;
    });
    return true;
  } catch {
    return false;
  }
}

/** True for an error meaning "couldn't reach the server", not a real refusal. */
export function isUnreachableError(err) {
  return err instanceof TypeError || err instanceof Unreachable || err?.status >= 502;
}
