/**
 * 2-G.14 — Competitor import (Shopify + Square).
 *
 * Covers:
 *  1. POST /api/import/products?source=shopify&preview=1 → preview shape
 *  2. POST /api/import/products?source=shopify → products inserted
 *  3. POST /api/import/customers?source=square → customers inserted
 *  4. GET /api/import/template/products?source=shopify → CSV with Shopify headers
 *  5. Unknown source falls back to native handling
 *  6. Unsupported template source+entity pair returns 400
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const Papa = require("papaparse");

// Fixtures are CSV, not .xlsx. Imports became CSV-only when `xlsx` was removed
// from the product — npm's copy is frozen at 0.18.5 with two advisories whose
// fixes ship only to SheetJS's own registry. Papa.unparse quotes correctly, so
// the Shopify/Square headers containing spaces and the addresses containing
// commas survive the round-trip the same way a real export would.
function aoaToCsvBuffer(aoa) {
  return Buffer.from(Papa.unparse(aoa), "utf8");
}
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req;

function shopifyProductsBuffer(rows) {
  // Omit Vendor/Type/Tax Code so the native handler doesn't try to resolve
  // FK lookups against categories/brands/taxes that aren't seeded in tests.
  const headers = [
    "Handle", "Title", "Variant SKU", "Variant Barcode",
    "Variant Price", "Cost per item", "Variant Inventory Qty", "Status",
  ];
  const aoa = [headers, ...rows];
  return aoaToCsvBuffer(aoa);
}

function squareCustomersBuffer(rows) {
  const headers = [
    "First Name", "Surname", "Email Address", "Phone Number",
    "Postal Address", "Reference ID", "Group Names",
  ];
  const aoa = [headers, ...rows];
  return aoaToCsvBuffer(aoa);
}

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  require("../../routes/import")(app, deps);
  req = makeRequest(app, ADMIN_ID);
}, 60000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

describe("2-G.14 Competitor import — Shopify", () => {
  test("preview returns shape with valid rows + errors", async () => {
    const buf = shopifyProductsBuffer([
      ["widget-a", "Widget A", "WDG-001",
        "1111111111111", 29.99, 15.00, 10, "active"],
      ["widget-b", "", "WDG-002", "", 49.99, 0, 0, "draft"],
    ]);
    const res = await req
      .post("/api/import/products?source=shopify&preview=1")
      .attach("file", buf, "shopify-products.csv");
    expect(res.status).toBe(200);
    expect(res.body.preview).toBe(true);
    // row 1 valid, row 2 errors (name missing — Title empty on Shopify means name-less)
    expect(res.body.valid).toBeGreaterThanOrEqual(1);
    // F7 unified shape: rows[] with _row + _errors per input row
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(res.body.rows.every((r) => Array.isArray(r._errors))).toBe(true);
  });

  test("non-preview inserts products into DB", async () => {
    const buf = shopifyProductsBuffer([
      ["plush-a", "Plush Toy A", "PLUSH-001",
        "2222222222222", 19.99, 8.00, 50, "active"],
    ]);
    const res = await req
      .post("/api/import/products?source=shopify")
      .attach("file", buf, "shopify-products.csv");
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);

    const { rows } = await db.query(
      "SELECT name, sku, barcode, price FROM products WHERE sku = $1",
      ["PLUSH-001"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Plush Toy A");
    expect(rows[0].barcode).toBe("2222222222222");
    expect(Number(rows[0].price)).toBe(19.99);
  });

  test("variant option appends to name", async () => {
    // Build the file with a dynamic header (Option1 Value)
    const headers = ["Title", "Option1 Value", "Variant SKU", "Variant Price"];
    const rows = [["Shirt", "Large", "SH-L", 12.5]];
    const buf = aoaToCsvBuffer([headers, ...rows]);

    const res = await req
      .post("/api/import/products?source=shopify")
      .attach("file", buf, "shopify-variants.csv");
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);

    const { rows: dbRows } = await db.query(
      "SELECT name FROM products WHERE sku = $1", ["SH-L"],
    );
    expect(dbRows[0].name).toBe("Shirt - Large");
  });
});

describe("2-G.14 Competitor import — Square", () => {
  test("imports customers from Square export", async () => {
    const buf = squareCustomersBuffer([
      ["John", "Imported", "john.sq@example.com", "03001234567",
        "123 Main St, Karachi", "SQ-REF-1", "VIP"],
      ["Sara", "Square", "sara.sq@example.com", "03009998888",
        "456 Oak Ave", "", ""],
    ]);
    const res = await req
      .post("/api/import/customers?source=square")
      .attach("file", buf, "square-customers.csv");
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);

    const { rows } = await db.query(
      "SELECT name, email, occupation FROM customers WHERE email IN ($1, $2) ORDER BY email",
      ["john.sq@example.com", "sara.sq@example.com"],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("John Imported");
    expect(rows[0].occupation).toBe("VIP");
    expect(rows[1].name).toBe("Sara Square");
  });
});

describe("2-G.14 Competitor import — template endpoint", () => {
  test("returns Shopify-shaped template CSV", async () => {
    const res = await req
      .get("/api/import/template/products?source=shopify")
      .buffer(true)
      .parse((resp, cb) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    // Parse the CSV and verify Shopify-specific headers
    const data = Papa.parse(res.body.toString("utf8").replace(/^\uFEFF/, ""), {
      header: false, dynamicTyping: false, skipEmptyLines: "greedy",
    }).data;
    expect(data[0]).toContain("Title");
    expect(data[0]).toContain("Variant SKU");
    expect(data[0]).toContain("Variant Price");
  });

  test("returns 400 for unsupported source+entity pair", async () => {
    const res = await req.get("/api/import/template/suppliers?source=shopify");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/shopify|template/i);
  });

  test("returns native template when no source provided", async () => {
    const res = await req
      .get("/api/import/template/products")
      .buffer(true)
      .parse((resp, cb) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const data = Papa.parse(res.body.toString("utf8").replace(/^\uFEFF/, ""), {
      header: false, dynamicTyping: false, skipEmptyLines: "greedy",
    }).data;
    // Native headers are lowercase snake_case
    expect(data[0]).toContain("name");
    expect(data[0]).toContain("selling_price");
  });
});

describe("2-G.14 Competitor import — fallback", () => {
  test("unknown source falls through to native row handling", async () => {
    // Build a native-shaped file; the mapper for source=lightspeed is null, so
    // it should process the raw rows normally.
    const headers = ["name", "sku", "selling_price", "stock_quantity"];
    const buf = aoaToCsvBuffer([headers, ["Fallback Product", "FB-1", 5, 3]]);

    const res = await req
      .post("/api/import/products?source=lightspeed")
      .attach("file", buf, "native.csv");
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
  });
});
