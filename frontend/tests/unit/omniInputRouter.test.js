import { describe, it, expect } from "vitest";
import { classifyOmniInput } from "../../src/pages/redesign/pos/omniInputRouter.js";

describe("classifyOmniInput", () => {
  describe("barcode detection", () => {
    it("detects EAN-13 (13 digits, valid checksum)", () => {
      expect(classifyOmniInput("5901234123457")).toEqual({
        kind: "barcode",
        format: "EAN-13",
        value: "5901234123457",
      });
    });

    it("detects UPC-A (12 digits)", () => {
      expect(classifyOmniInput("036000291452")).toMatchObject({
        kind: "barcode",
        format: "UPC-A",
      });
    });

    it("detects EAN-8 (8 digits)", () => {
      expect(classifyOmniInput("73513537")).toMatchObject({
        kind: "barcode",
        format: "EAN-8",
      });
    });

    it("detects GTIN-14 (14 digits)", () => {
      expect(classifyOmniInput("12345678901231")).toMatchObject({
        kind: "barcode",
        format: "GTIN-14",
      });
    });
  });

  describe("PLU detection", () => {
    it("detects 4-digit PLU (produce code)", () => {
      expect(classifyOmniInput("4011")).toEqual({
        kind: "plu",
        value: "4011",
      });
    });

    it("detects 5-digit PLU", () => {
      expect(classifyOmniInput("94011")).toEqual({
        kind: "plu",
        value: "94011",
      });
    });
  });

  describe("customer prefix", () => {
    it("detects # prefix with phone-like suffix", () => {
      expect(classifyOmniInput("#03001234567")).toEqual({
        kind: "customer",
        value: "03001234567",
      });
    });

    it("detects # prefix with name-like suffix", () => {
      expect(classifyOmniInput("#ahmed")).toEqual({
        kind: "customer",
        value: "ahmed",
      });
    });

    it("treats bare # as empty (no dispatch)", () => {
      expect(classifyOmniInput("#")).toEqual({ kind: "noop" });
    });
  });

  describe("text search", () => {
    it("routes alphanumeric strings ≥ 2 chars to text search", () => {
      expect(classifyOmniInput("coke")).toEqual({
        kind: "text",
        value: "coke",
      });
    });

    it("treats short text (< 2 chars) as noop", () => {
      expect(classifyOmniInput("a")).toEqual({ kind: "noop" });
    });

    it("treats empty/whitespace as noop", () => {
      expect(classifyOmniInput("")).toEqual({ kind: "noop" });
      expect(classifyOmniInput("   ")).toEqual({ kind: "noop" });
    });

    it("trims whitespace before routing", () => {
      expect(classifyOmniInput("  coke  ")).toMatchObject({
        kind: "text",
        value: "coke",
      });
    });
  });

  describe("ambiguity resolution", () => {
    it("digits-only 4-5 chars → PLU (not text)", () => {
      expect(classifyOmniInput("4011").kind).toBe("plu");
    });

    it("digits-only 6-7 chars → text search (ambiguous, fall back to text)", () => {
      expect(classifyOmniInput("123456").kind).toBe("text");
    });

    it("digits with leading zeros still treated as barcode if 8/12/13/14 length", () => {
      expect(classifyOmniInput("00012345678905").kind).toBe("barcode");
    });
  });
});
