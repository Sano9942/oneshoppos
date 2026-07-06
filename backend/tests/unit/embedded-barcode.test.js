import { describe, it, expect } from "vitest";
import {
  decodeEmbeddedBarcode,
  ean13CheckDigit,
  normalizeScheme,
  DEFAULT_EMBEDDED_SCHEME,
} from "../../services/embedded-barcode.js";

// V01 grocery lane — price/weight-embedded EAN-13 decode. This is the
// AUTHORITATIVE decoder (scan route uses it); the frontend mirror runs the same
// vectors in frontend/tests/unit/embeddedBarcode.test.js — keep them in sync.

const PRICE_SCHEME = {
  enabled: true,
  prefixes: [20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
  embed: "price",
  item_code_length: 5,
  value_length: 5,
  value_decimals: 2,
  item_code_field: "sku",
  verify_check_digit: true,
};

const WEIGHT_SCHEME = {
  ...PRICE_SCHEME,
  embed: "weight",
  value_decimals: 3,
  item_code_field: "plu",
};

describe("ean13CheckDigit", () => {
  it("computes the standard mod-10 check digit", () => {
    // "211234501299" → check 5  (hand-computed in the plan)
    expect(ean13CheckDigit("211234501299")).toBe(5);
    // "270004201234" → check 1
    expect(ean13CheckDigit("270004201234")).toBe(1);
  });
});

describe("decodeEmbeddedBarcode — price-embedded", () => {
  it("decodes item code + final price from a 21-prefix label", () => {
    const r = decodeEmbeddedBarcode("2112345012995", PRICE_SCHEME);
    expect(r).toEqual({
      ok: true,
      embed: "price",
      itemCode: "12345",
      itemCodeField: "sku",
      price: 12.99,
    });
  });

  it("rejects a corrupted check digit", () => {
    // last digit 5 → 4 breaks the checksum
    const r = decodeEmbeddedBarcode("2112345012994", PRICE_SCHEME);
    expect(r).toEqual({ ok: false, reason: "bad_check_digit" });
  });

  it("skips the checksum when verify_check_digit is false", () => {
    const r = decodeEmbeddedBarcode("2112345012994", {
      ...PRICE_SCHEME,
      verify_check_digit: false,
    });
    expect(r.ok).toBe(true);
    expect(r.price).toBe(12.99);
  });
});

describe("decodeEmbeddedBarcode — weight-embedded", () => {
  it("decodes item code + weight (kg, 3 decimals)", () => {
    const r = decodeEmbeddedBarcode("2700042012341", WEIGHT_SCHEME);
    expect(r).toEqual({
      ok: true,
      embed: "weight",
      itemCode: "00042",
      itemCodeField: "plu",
      weight: 1.234,
    });
  });
});

describe("decodeEmbeddedBarcode — fall-through cases (NOT errors)", () => {
  it("returns disabled when the scheme is off", () => {
    expect(decodeEmbeddedBarcode("2112345012995", { ...PRICE_SCHEME, enabled: false }))
      .toEqual({ ok: false, reason: "disabled" });
    // default scheme is disabled
    expect(decodeEmbeddedBarcode("2112345012995", DEFAULT_EMBEDDED_SCHEME).reason).toBe("disabled");
  });

  it("returns not_embedded for a normal (non 2x prefix) EAN-13", () => {
    // "890..." retail barcode — real product, look it up normally
    const r = decodeEmbeddedBarcode("8901234567894", PRICE_SCHEME);
    expect(r).toEqual({ ok: false, reason: "not_embedded" });
  });

  it("returns not_embedded for a PLU / non-13-length numeric", () => {
    expect(decodeEmbeddedBarcode("4011", PRICE_SCHEME).reason).toBe("not_embedded");
    expect(decodeEmbeddedBarcode("012345678905", PRICE_SCHEME).reason).toBe("not_embedded"); // 12-digit UPC
  });

  it("returns not_embedded for non-numeric input", () => {
    expect(decodeEmbeddedBarcode("HELLO", PRICE_SCHEME).reason).toBe("not_embedded");
    expect(decodeEmbeddedBarcode("", PRICE_SCHEME).reason).toBe("not_embedded");
  });
});

describe("decodeEmbeddedBarcode — malformed scheme geometry", () => {
  it("flags malformed when prefix+item+value+check != 13", () => {
    // value_length 4 makes the layout 2+5+4+1 = 12 ≠ 13
    const bad = { ...PRICE_SCHEME, value_length: 4 };
    const r = decodeEmbeddedBarcode("2112345012995", bad);
    expect(r).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("normalizeScheme", () => {
  it("defaults weight decimals to 3 and price decimals to 2", () => {
    expect(normalizeScheme({ enabled: true, embed: "weight" }).value_decimals).toBe(3);
    expect(normalizeScheme({ enabled: true, embed: "price" }).value_decimals).toBe(2);
  });

  it("coerces prefixes to strings and rejects unknown item_code_field", () => {
    const s = normalizeScheme({ enabled: true, prefixes: [21, 22], item_code_field: "nope" });
    expect(s.prefixes).toEqual(["21", "22"]);
    expect(s.item_code_field).toBe("sku");
  });

  it("supports a single-digit prefix flag (longest-prefix match)", () => {
    // prefix "2", item 6, value 4 → 1+6+4+1 = 12? no — need 13. Use item 6 value 5.
    const scheme = {
      enabled: true,
      prefixes: [2],
      embed: "price",
      item_code_length: 6,
      value_length: 5,
      value_decimals: 2,
      verify_check_digit: false,
    };
    const r = decodeEmbeddedBarcode("2123456099990", scheme);
    expect(r.ok).toBe(true);
    expect(r.itemCode).toBe("123456");
    expect(r.price).toBe(99.99);
  });
});
