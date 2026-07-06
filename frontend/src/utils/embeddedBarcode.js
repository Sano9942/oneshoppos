/**
 * utils/embeddedBarcode.js
 *
 * Frontend mirror of backend/services/embedded-barcode.js — the SAME pure
 * price/weight-embedded EAN-13 decode algorithm, kept in sync so the POS can
 * give the cashier instant on-screen feedback the moment a scale label is
 * scanned, while the backend scan endpoint remains the authoritative decoder
 * (V01 plan P0). No React, no side effects — trivially unit-testable.
 *
 * Scheme shape (from company_profile.barcode_scheme, delivered via
 * useAuth().company): see the backend module's header for the full contract.
 */

export const DEFAULT_EMBEDDED_SCHEME = Object.freeze({
  enabled: false,
  prefixes: [20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
  embed: "price",
  item_code_length: 5,
  value_length: 5,
  value_decimals: 2,
  item_code_field: "sku",
  verify_check_digit: true,
});

/** Standard EAN-13 mod-10 check digit for the first 12 digits. */
export function ean13CheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = first12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function normalizeScheme(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const prefixes =
    Array.isArray(s.prefixes) && s.prefixes.length
      ? s.prefixes.map((p) => String(p))
      : DEFAULT_EMBEDDED_SCHEME.prefixes.map((p) => String(p));
  return {
    enabled: s.enabled === true,
    prefixes,
    embed: s.embed === "weight" ? "weight" : "price",
    item_code_length: Number.isInteger(s.item_code_length)
      ? s.item_code_length
      : DEFAULT_EMBEDDED_SCHEME.item_code_length,
    value_length: Number.isInteger(s.value_length)
      ? s.value_length
      : DEFAULT_EMBEDDED_SCHEME.value_length,
    value_decimals: Number.isInteger(s.value_decimals)
      ? s.value_decimals
      : s.embed === "weight"
        ? 3
        : 2,
    item_code_field: ["sku", "plu", "barcode"].includes(s.item_code_field)
      ? s.item_code_field
      : DEFAULT_EMBEDDED_SCHEME.item_code_field,
    verify_check_digit: s.verify_check_digit !== false,
  };
}

/**
 * Decode a scanned code against the tenant scheme.
 * Returns { ok:true, embed, itemCode, itemCodeField, price? , weight? } or
 * { ok:false, reason:'disabled'|'not_embedded'|'malformed'|'bad_check_digit' }.
 */
export function decodeEmbeddedBarcode(rawCode, rawScheme) {
  const scheme = normalizeScheme(rawScheme);
  if (!scheme.enabled) return { ok: false, reason: "disabled" };

  const code = String(rawCode == null ? "" : rawCode).trim();
  if (!/^\d+$/.test(code)) return { ok: false, reason: "not_embedded" };
  if (code.length !== 13) return { ok: false, reason: "not_embedded" };

  const prefix = [...scheme.prefixes]
    .sort((a, b) => b.length - a.length)
    .find((p) => code.startsWith(p));
  if (!prefix) return { ok: false, reason: "not_embedded" };

  const prefixLen = prefix.length;
  const { item_code_length: itemLen, value_length: valLen } = scheme;
  if (prefixLen + itemLen + valLen + 1 !== code.length) {
    return { ok: false, reason: "malformed" };
  }

  if (scheme.verify_check_digit) {
    const expected = ean13CheckDigit(code.slice(0, 12));
    const actual = code.charCodeAt(12) - 48;
    if (expected !== actual) return { ok: false, reason: "bad_check_digit" };
  }

  const itemCode = code.slice(prefixLen, prefixLen + itemLen);
  const rawValue = code.slice(prefixLen + itemLen, prefixLen + itemLen + valLen);
  const scaled = Number(rawValue) / Math.pow(10, scheme.value_decimals);

  if (scheme.embed === "weight") {
    return {
      ok: true,
      embed: "weight",
      itemCode,
      itemCodeField: scheme.item_code_field,
      weight: Number(scaled.toFixed(4)),
    };
  }
  return {
    ok: true,
    embed: "price",
    itemCode,
    itemCodeField: scheme.item_code_field,
    price: Number(scaled.toFixed(2)),
  };
}
