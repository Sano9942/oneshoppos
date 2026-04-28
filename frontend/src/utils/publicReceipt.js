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

/**
 * Build the pre-filled message body for a wa.me share link.
 *
 * Used by both POS post-checkout share and Sales History share. Picks a
 * brand identifier (outlet name, falling back to receipt-template header_text,
 * finally "SanoPOS") so the message preamble reads naturally — NOT the
 * receipt-greeting line which is often "Thank you for shopping!" (that's a
 * print-format greeting, not a brand).
 *
 * @param {object} args
 * @param {string} args.invoiceNumber
 * @param {string} args.totalLabel - pre-formatted currency string (e.g. "Rs 100.00")
 * @param {string} [args.outletName] - preferred brand identifier
 * @param {string} [args.fallbackName] - secondary brand identifier (e.g. template.header_text)
 * @returns {string} a multi-line message body, NOT URL-encoded
 */
export function buildReceiptShareMessage({ invoiceNumber, totalLabel, outletName, fallbackName }) {
  const brand = outletName || fallbackName || "SanoPOS";
  return [
    `Receipt from ${brand}`,
    `Invoice: ${invoiceNumber}`,
    `Total: ${totalLabel}`,
    `View: ${buildPublicReceiptUrl(invoiceNumber)}`,
  ].join("\n");
}

/**
 * Build a `wa.me/?text=...` URL ready to feed into `window.open`.
 *
 * @param {object} args - same as buildReceiptShareMessage
 * @returns {string} a wa.me URL
 */
export function buildWhatsAppShareUrl(args) {
  const text = buildReceiptShareMessage(args);
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
