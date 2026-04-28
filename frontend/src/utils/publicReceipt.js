import { IS_MULTI_TENANT } from "../config";
import { readTenantSlug } from "../auth/authStore";

/**
 * Build a public, shareable URL for a receipt.
 *
 * The public-receipt React page lives at /receipt/:invoiceNumber and the
 * backend public API (/api/receipts/:invoiceNumber/public) requires a
 * `?tenant=<slug>` query param when MULTI_TENANT=1 is set on the server
 * (which is the production state). Production is multi-tenant; only local
 * single-tenant dev would skip the query param.
 *
 * Centralising the URL build here means anywhere we surface a "share this
 * receipt" link — the POS post-checkout WhatsApp button, the Sales History
 * detail panel — produces a URL that actually works.
 *
 * @param {string} invoiceNumber - the human-friendly invoice number (e.g. "INV-2026-00001")
 * @returns {string} absolute URL safe to drop in a chat message
 */
export function buildPublicReceiptUrl(invoiceNumber) {
  const base = `${window.location.origin}/receipt/${invoiceNumber}`;
  if (!IS_MULTI_TENANT) return base;
  const slug = readTenantSlug();
  if (!slug) return base;
  return `${base}?tenant=${encodeURIComponent(slug)}`;
}
