// Pattern-based classifier for the POS omni-input.
// Pure module — zero React, zero side effects — so it's cheap to unit-test
// and can be reused outside the component (e.g. barcode scanner buffer).

const BARCODE_LENGTHS = {
  8: "EAN-8",
  12: "UPC-A",
  13: "EAN-13",
  14: "GTIN-14",
};

export function classifyOmniInput(raw) {
  const input = (raw ?? "").trim();
  if (!input) return { kind: "noop" };

  if (input.startsWith("#")) {
    const rest = input.slice(1).trim();
    if (!rest) return { kind: "noop" };
    return { kind: "customer", value: rest };
  }

  if (/^\d+$/.test(input)) {
    const format = BARCODE_LENGTHS[input.length];
    if (format) return { kind: "barcode", format, value: input };
    if (input.length === 4 || input.length === 5) {
      return { kind: "plu", value: input };
    }
    // Digits outside standard ranges fall through to text search.
  }

  if (input.length < 2) return { kind: "noop" };
  return { kind: "text", value: input };
}
