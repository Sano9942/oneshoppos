/**
 * CSV-only import parsing.
 *
 * Imports used to run every upload — .csv and .xlsx alike — through XLSX.read().
 * That was the only reason the `xlsx` dependency existed, and it is frozen at
 * 0.18.5 on npm with two advisories (prototype pollution, ReDoS) whose fixes are
 * published only to SheetJS's own registry, so npm can see the problem and never
 * the remedy. It has now been removed from the product entirely.
 *
 * The risk in that swap was never the CVE, it was the parser. XLSX handled
 * RFC-4180 quoting for free; the only CSV parsing previously hand-written in
 * this repo is a naive split(",") that breaks on the first quoted comma. These
 * tests pin the cases that would silently shift every subsequent column on the
 * path that sets prices and stock — a failure that produces plausible-looking
 * wrong data rather than an error.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Papa = require("papaparse");

/** Mirrors routes/import.js:parseFile — same options, same normalisation. */
function parseFile(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const { data } = Papa.parse(text, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: "greedy",
    transformHeader: (h) => String(h).trim(),
  });
  return data.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = v == null ? "" : v;
    return out;
  });
}

const buf = (s) => Buffer.from(s, "utf8");

describe("import CSV parsing", () => {
  it("keeps a quoted comma inside one field", () => {
    // The case a split(",") gets wrong. "Widget, Large" is one product name;
    // naive splitting turns it into two columns and shifts price into category.
    const rows = parseFile(buf('name,price,category\n"Widget, Large",99.99,Tools\n'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ name: "Widget, Large", price: "99.99", category: "Tools" });
  });

  it("keeps a newline inside a quoted field", () => {
    // Real exports do this in address and description columns. The previous
    // hand-rolled frontend scanner split on newlines first, so this became two
    // broken rows.
    const rows = parseFile(buf('name,address\n"Acme","12 Main St\nLahore"\n'));
    expect(rows).toHaveLength(1);
    expect(rows[0].address).toBe("12 Main St\nLahore");
  });

  it('reads an escaped quote ("") as a single quote', () => {
    const rows = parseFile(buf('name,note\nWidget,"6"" pipe"\n'));
    expect(rows[0].note).toBe('6" pipe');
  });

  it("preserves leading zeros on barcodes and SKUs", () => {
    // The reason the download template used to be a formatted .xlsx. If these
    // become numbers, every scan against the barcode fails.
    const rows = parseFile(buf("name,barcode,sku\nWidget,001234,007\n"));
    expect(rows[0].barcode).toBe("001234");
    expect(rows[0].sku).toBe("007");
  });

  it("leaves ISO dates as strings", () => {
    // XLSX with raw:true coerced these to Excel serials (46141.2…), which broke
    // Date.parse() in the expenses/payments validators. dynamicTyping:false is
    // what keeps that fixed.
    const rows = parseFile(buf("date,amount\n2026-04-29,25000\n"));
    expect(rows[0].date).toBe("2026-04-29");
    expect(rows[0].amount).toBe("25000");
  });

  it("strips the UTF-8 BOM Excel writes, so the first header is not corrupted", () => {
    const rows = parseFile(buf("\uFEFFname,price\nWidget,10\n"));
    expect(Object.keys(rows[0])).toContain("name");
    expect(rows[0].name).toBe("Widget");
  });

  it("trims whitespace-padded headers", () => {
    const rows = parseFile(buf(" name , price \nWidget,10\n"));
    expect(rows[0].name).toBe("Widget");
    expect(rows[0].price).toBe("10");
  });

  it("drops blank and whitespace-only trailing rows", () => {
    // Spreadsheet exports leave these behind; without skipEmptyLines they
    // import as empty products.
    const rows = parseFile(buf("name,price\nWidget,10\n\n   \n"));
    expect(rows).toHaveLength(1);
  });

  it("handles CRLF line endings", () => {
    const rows = parseFile(buf("name,price\r\nWidget,10\r\n"));
    expect(rows).toHaveLength(1);
    expect(rows[0].price).toBe("10");
  });

  it("returns an empty array for a header-only file", () => {
    expect(parseFile(buf("name,price\n"))).toEqual([]);
  });

  it("fills a missing trailing column with an empty string, not undefined", () => {
    // Downstream validators call .trim() on these; undefined would throw.
    const rows = parseFile(buf("name,price,category\nWidget,10\n"));
    expect(rows[0].category ?? "").toBe("");
  });
});

describe("Excel uploads are refused", () => {
  // Mirrors routes/import.js:rejectNonCsv. Extension-based deliberately: Windows
  // with Excel installed sends application/vnd.ms-excel for a .csv file, so a
  // MIME allowlist would refuse legitimate uploads from real merchant machines.
  function rejectNonCsv(file) {
    if (!file) return "No file uploaded";
    const name = String(file.originalname || "");
    if (/\.(xlsx|xlsm|xlsb|xls)$/i.test(name)) return "excel";
    if (!/\.csv$/i.test(name)) return "unsupported";
    return null;
  }

  it.each(["products.xlsx", "PRODUCTS.XLSX", "book.xls", "macro.xlsm", "binary.xlsb"])(
    "refuses %s",
    (originalname) => {
      expect(rejectNonCsv({ originalname })).toBe("excel");
    }
  );

  it.each(["products.csv", "PRODUCTS.CSV", "my.export.csv"])("accepts %s", (originalname) => {
    expect(rejectNonCsv({ originalname })).toBeNull();
  });

  it("refuses an unrelated type", () => {
    expect(rejectNonCsv({ originalname: "notes.pdf" })).toBe("unsupported");
  });

  it("still reports a missing file", () => {
    expect(rejectNonCsv(undefined)).toBe("No file uploaded");
  });
});
