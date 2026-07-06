import { describe, it, expect } from "vitest";
import {
  decodeEmbeddedBarcode,
  ean13CheckDigit,
} from "../../src/utils/embeddedBarcode.js";

// Frontend mirror of backend/tests/unit/embedded-barcode.test.js — the POS runs
// this for instant on-screen feedback when a scale label is scanned, while the
// backend scan route remains authoritative. Same vectors → both must agree.

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

describe("embeddedBarcode (frontend mirror)", () => {
  it("computes EAN-13 check digits identically to the backend", () => {
    expect(ean13CheckDigit("211234501299")).toBe(5);
    expect(ean13CheckDigit("270004201234")).toBe(1);
  });

  it("decodes a 21-prefix price label", () => {
    expect(decodeEmbeddedBarcode("2112345012995", PRICE_SCHEME)).toEqual({
      ok: true,
      embed: "price",
      itemCode: "12345",
      itemCodeField: "sku",
      price: 12.99,
    });
  });

  it("decodes a weight label", () => {
    const r = decodeEmbeddedBarcode("2700042012341", {
      ...PRICE_SCHEME,
      embed: "weight",
      value_decimals: 3,
      item_code_field: "plu",
    });
    expect(r).toEqual({
      ok: true,
      embed: "weight",
      itemCode: "00042",
      itemCodeField: "plu",
      weight: 1.234,
    });
  });

  it("falls through on normal barcodes and bad checksums", () => {
    expect(decodeEmbeddedBarcode("8901234567894", PRICE_SCHEME).reason).toBe("not_embedded");
    expect(decodeEmbeddedBarcode("2112345012994", PRICE_SCHEME).reason).toBe("bad_check_digit");
    expect(decodeEmbeddedBarcode("2112345012995", { ...PRICE_SCHEME, enabled: false }).reason).toBe("disabled");
  });
});
