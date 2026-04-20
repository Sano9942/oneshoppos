import { describe, it, expect } from "vitest";

// Inline copy of the parser from CustomerGroupPriceBookRedesign.jsx — the
// function is local to the component so we keep a mirror here to freeze
// behavior (if the component file copy ever drifts, add a shared util).
function parsePriceBookCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { items: [], skipped: 0 };

  const firstCells = lines[0].split(",").map((c) => c.trim().toLowerCase());
  const hasHeader =
    firstCells.includes("product_id") ||
    firstCells.includes("price") ||
    firstCells[0] === "id";
  const rows = hasHeader ? lines.slice(1) : lines;

  const items = [];
  let skipped = 0;
  for (const row of rows) {
    const cells = row.split(",").map((c) => c.trim());
    if (cells.length < 2) {
      skipped += 1;
      continue;
    }
    let productId, variantId, price;
    if (cells.length === 2) {
      productId = Number(cells[0]);
      price = Number(cells[1]);
    } else {
      productId = Number(cells[0]);
      variantId = cells[1] === "" ? null : Number(cells[1]);
      price = Number(cells[2]);
    }
    if (!Number.isFinite(productId) || !Number.isFinite(price) || price < 0) {
      skipped += 1;
      continue;
    }
    items.push({
      product_id: productId,
      variant_id: variantId ?? null,
      price,
      min_qty: 1,
    });
  }
  return { items, skipped };
}

describe("parsePriceBookCsv", () => {
  it("returns empty for empty / whitespace text", () => {
    expect(parsePriceBookCsv("")).toEqual({ items: [], skipped: 0 });
    expect(parsePriceBookCsv("\n\n  \n")).toEqual({ items: [], skipped: 0 });
  });

  it("parses 2-column rows (product_id, price)", () => {
    const out = parsePriceBookCsv("1,100\n2,200");
    expect(out.items).toEqual([
      { product_id: 1, variant_id: null, price: 100, min_qty: 1 },
      { product_id: 2, variant_id: null, price: 200, min_qty: 1 },
    ]);
    expect(out.skipped).toBe(0);
  });

  it("parses 3-column rows with variant_id", () => {
    const out = parsePriceBookCsv("1,42,99\n2,,50");
    expect(out.items).toEqual([
      { product_id: 1, variant_id: 42, price: 99, min_qty: 1 },
      { product_id: 2, variant_id: null, price: 50, min_qty: 1 },
    ]);
  });

  it("skips the header row when present (product_id keyword)", () => {
    const out = parsePriceBookCsv("product_id,price\n1,80\n2,180");
    expect(out.items).toHaveLength(2);
    expect(out.items[0].product_id).toBe(1);
  });

  it("skips the header row when present (id/price keyword)", () => {
    const out = parsePriceBookCsv("id,variant_id,price\n5,,200");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].product_id).toBe(5);
  });

  it("skips malformed rows and counts them", () => {
    const out = parsePriceBookCsv("1,100\nwhatever\n3,abc\n4,-5\n5,50");
    // rows: "1,100" ok, "whatever" too few cells, "3,abc" price NaN,
    // "4,-5" price < 0, "5,50" ok
    expect(out.items).toHaveLength(2);
    expect(out.skipped).toBe(3);
  });

  it("handles windows line endings", () => {
    const out = parsePriceBookCsv("1,100\r\n2,200\r\n");
    expect(out.items).toHaveLength(2);
  });

  it("empty variant_id cell produces null", () => {
    const out = parsePriceBookCsv("7,,35");
    expect(out.items[0].variant_id).toBe(null);
  });
});
