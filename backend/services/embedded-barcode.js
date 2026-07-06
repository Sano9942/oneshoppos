'use strict';

/**
 * services/embedded-barcode.js
 *
 * Pure, config-driven decoder for price/weight-embedded EAN-13 barcodes — the
 * labels a deli/butcher/produce scale prints at the counter. A supermarket lane
 * scans these; the item code identifies the product and the embedded field
 * carries the pre-weighed price (or weight) so the cashier never re-enters it.
 *
 * This is the AUTHORITATIVE decoder (V01 plan P0: "backend does the
 * authoritative decode, shared by any client"). The frontend mirror in
 * `frontend/src/utils/embeddedBarcode.js` runs the SAME algorithm for instant
 * on-screen feedback; keep the two in sync. Zero DB, zero side effects — the
 * scan route feeds it the tenant's scheme (from company_profile.barcode_scheme)
 * and the scanned code; everything else is arithmetic.
 *
 * ── Scheme shape (JSONB on company_profile.barcode_scheme) ─────────────────
 *   {
 *     enabled: true,
 *     prefixes: [20,21,22,23,24,25,26,27,28,29],  // GS1 "2x" restricted-range flags
 *     embed: "price" | "weight",     // what the value field carries
 *     item_code_length: 5,           // digits after the prefix that identify the product
 *     value_length: 5,               // digits of the embedded price/weight
 *     value_decimals: 2,             // price → 2 (currency minor units); weight → 3 (grams→kg)
 *     item_code_field: "sku" | "plu" | "barcode",  // how the scan route resolves the product
 *     verify_check_digit: true       // reject on EAN-13 checksum mismatch
 *   }
 *
 * Layout assumed (sums to 13): prefix (2) + item_code (N) + value (M) + check (1).
 * item_code_length + value_length must be 10 for a well-formed EAN-13.
 *
 * The decoder is deliberately tolerant of the prefix length being implied by
 * the shortest prefix string, so schemes can also use a single-digit flag if a
 * tenant's scale hardware does (e.g. prefix "2").
 */

const DEFAULT_EMBEDDED_SCHEME = Object.freeze({
  enabled: false,
  prefixes: [20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
  embed: 'price',
  item_code_length: 5,
  value_length: 5,
  value_decimals: 2,
  item_code_field: 'sku',
  verify_check_digit: true,
});

/** Standard EAN-13 mod-10 check digit for the first 12 digits. */
function ean13CheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = first12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/** Normalize a raw scheme object (from DB/JSONB) into a fully-defaulted scheme. */
function normalizeScheme(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const prefixes = Array.isArray(s.prefixes) && s.prefixes.length
    ? s.prefixes.map((p) => String(p))
    : DEFAULT_EMBEDDED_SCHEME.prefixes.map((p) => String(p));
  return {
    enabled: s.enabled === true,
    prefixes,
    embed: s.embed === 'weight' ? 'weight' : 'price',
    item_code_length: Number.isInteger(s.item_code_length) ? s.item_code_length : DEFAULT_EMBEDDED_SCHEME.item_code_length,
    value_length: Number.isInteger(s.value_length) ? s.value_length : DEFAULT_EMBEDDED_SCHEME.value_length,
    value_decimals: Number.isInteger(s.value_decimals) ? s.value_decimals : (s.embed === 'weight' ? 3 : 2),
    item_code_field: ['sku', 'plu', 'barcode'].includes(s.item_code_field) ? s.item_code_field : DEFAULT_EMBEDDED_SCHEME.item_code_field,
    verify_check_digit: s.verify_check_digit !== false,
  };
}

/**
 * Decode a scanned code against a tenant scheme.
 *
 * @param {string} rawCode  scanned digits
 * @param {object} rawScheme  tenant barcode scheme (from company_profile.barcode_scheme)
 * @returns {object} one of:
 *   { ok:true, embed:'price',  itemCode, itemCodeField, price }        // final line price
 *   { ok:true, embed:'weight', itemCode, itemCodeField, weight }       // decoded weight (kg)
 *   { ok:false, reason:'disabled' | 'not_embedded' | 'malformed' | 'bad_check_digit' }
 *
 * `not_embedded` means "this is a normal barcode — fall through to SKU/barcode
 * lookup", NOT an error. Only `malformed`/`bad_check_digit` are surfaced to the
 * cashier (as an "unmapped/invalid scale item" once product resolution fails).
 */
function decodeEmbeddedBarcode(rawCode, rawScheme) {
  const scheme = normalizeScheme(rawScheme);
  if (!scheme.enabled) return { ok: false, reason: 'disabled' };

  const code = String(rawCode == null ? '' : rawCode).trim();
  if (!/^\d+$/.test(code)) return { ok: false, reason: 'not_embedded' };
  if (code.length !== 13) return { ok: false, reason: 'not_embedded' };

  // Match the longest applicable prefix so a 2-digit "21" wins over a 1-digit "2".
  const prefix = [...scheme.prefixes]
    .sort((a, b) => b.length - a.length)
    .find((p) => code.startsWith(p));
  if (!prefix) return { ok: false, reason: 'not_embedded' };

  const prefixLen = prefix.length;
  const { item_code_length: itemLen, value_length: valLen } = scheme;
  // prefix + item + value + 1 check digit must sum to the code length.
  if (prefixLen + itemLen + valLen + 1 !== code.length) {
    return { ok: false, reason: 'malformed' };
  }

  if (scheme.verify_check_digit) {
    const expected = ean13CheckDigit(code.slice(0, 12));
    const actual = code.charCodeAt(12) - 48;
    if (expected !== actual) return { ok: false, reason: 'bad_check_digit' };
  }

  const itemCode = code.slice(prefixLen, prefixLen + itemLen);
  const rawValue = code.slice(prefixLen + itemLen, prefixLen + itemLen + valLen);
  const scaled = Number(rawValue) / Math.pow(10, scheme.value_decimals);

  if (scheme.embed === 'weight') {
    return {
      ok: true,
      embed: 'weight',
      itemCode,
      itemCodeField: scheme.item_code_field,
      weight: Number(scaled.toFixed(4)),
    };
  }
  return {
    ok: true,
    embed: 'price',
    itemCode,
    itemCodeField: scheme.item_code_field,
    price: Number(scaled.toFixed(2)),
  };
}

module.exports = {
  DEFAULT_EMBEDDED_SCHEME,
  normalizeScheme,
  ean13CheckDigit,
  decodeEmbeddedBarcode,
};
