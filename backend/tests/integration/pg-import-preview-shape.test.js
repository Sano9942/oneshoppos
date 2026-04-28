/**
 * pg-import-preview-shape — Phase 3.12 fix F7.
 *
 * Frontend ImportRedesign.jsx reads `preview.rows[].with._errors`, but the
 * backend was returning `{ preview, valid (count), errors[], sample[] }` —
 * shape mismatch silently rendered "0 valid rows" on every tab in production.
 *
 * Asserts the new unified shape across all 5 import endpoints:
 *   {
 *     rows: [ { _row: <line>, _errors: [...], ...rowFields } ],
 *     valid: <count of rows where _errors.length === 0>,
 *   }
 *
 * Rows preserve original input order. Valid rows have `_errors: []`.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const XLSX = require("xlsx");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req;

function csvBuffer(headers, rows) {
  const lines = [headers.join(","), ...rows.map((r) => r.map((v) => (v == null ? "" : String(v))).join(","))];
  return Buffer.from(lines.join("\n"), "utf8");
}

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  require("../../routes/import")(app, deps);
  req = makeRequest(app, ADMIN_ID);

  // Seed an expense category so the expenses test can validate FK lookup
  await db.query(
    "INSERT INTO expense_categories (name) VALUES ('Office Supplies') ON CONFLICT (name) DO NOTHING",
  );

  // Seed a supplier + supplier_invoice for the payments test
  await db.query("INSERT INTO suppliers (id, name) VALUES (999, 'Test Supplier') ON CONFLICT DO NOTHING");
  await db.query(
    "INSERT INTO supplier_invoices (id, supplier_id, invoice_number, amount, status) VALUES (999, 999, 'INV-PAY-001', 1000, 'unpaid') ON CONFLICT DO NOTHING",
  );
}, 60000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

describe("Import preview shape (F7) — unified rows[] response", () => {
  describe("POST /api/import/products?preview=1", () => {
    it("returns rows[] with _row + _errors per input row, valid count, and preserves order", async () => {
      const buf = csvBuffer(
        ["name", "sku", "selling_price"],
        [
          ["Widget A", "WDG-A", 10],   // row 2 — valid
          ["", "WDG-B", 20],           // row 3 — missing name
          ["Widget C", "WDG-C", ""],   // row 4 — missing price
        ],
      );

      const res = await req
        .post("/api/import/products?preview=1")
        .attach("file", buf, "products.csv");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("rows");
      expect(Array.isArray(res.body.rows)).toBe(true);
      expect(res.body.rows).toHaveLength(3);

      // Order preserved
      expect(res.body.rows[0]._row).toBe(2);
      expect(res.body.rows[1]._row).toBe(3);
      expect(res.body.rows[2]._row).toBe(4);

      // Each row has _errors as an array
      expect(res.body.rows[0]._errors).toEqual([]);
      expect(res.body.rows[1]._errors).toEqual(expect.arrayContaining([expect.stringMatching(/name/i)]));
      expect(res.body.rows[2]._errors).toEqual(expect.arrayContaining([expect.stringMatching(/selling_price|price/i)]));

      // Original fields preserved on each row (frontend renders them as columns)
      expect(res.body.rows[0].name).toBe("Widget A");
      expect(res.body.rows[0].sku).toBe("WDG-A");
      expect(res.body.rows[1].sku).toBe("WDG-B");

      // valid is the count of rows with empty _errors
      expect(res.body.valid).toBe(1);
    });

    it("does not commit any rows when preview=1", async () => {
      const before = await db.query("SELECT COUNT(*)::int AS n FROM products");
      const buf = csvBuffer(
        ["name", "selling_price"],
        [["Preview Only Product", 99]],
      );
      await req.post("/api/import/products?preview=1").attach("file", buf, "products.csv");
      const after = await db.query("SELECT COUNT(*)::int AS n FROM products");
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });
  });

  describe("POST /api/import/products?preview=1 — F8/F9 duplicate SKU detection", () => {
    it("flags in-file duplicate SKUs on later rows (F8)", async () => {
      const buf = csvBuffer(
        ["name", "sku", "selling_price"],
        [
          ["Coffee Beans", "DUP-SKU-001", 850],   // row 2 — first occurrence, valid
          ["Drip Filter",  "DUP-SKU-001", 250],   // row 3 — dup of row 2's sku
          ["Espresso Cup", "DUP-SKU-001", 100],   // row 4 — dup again
          ["Tea Bag",      "UNIQUE-001",  50],    // row 5 — valid
        ],
      );

      const res = await req
        .post("/api/import/products?preview=1")
        .attach("file", buf, "products.csv");

      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(4);

      // Row 2 stays valid (first occurrence wins)
      expect(res.body.rows[0]._errors).toEqual([]);
      // Rows 3 + 4 flagged as in-file duplicates referencing row 2
      expect(res.body.rows[1]._errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/duplicate sku.*DUP-SKU-001.*row 2/i)]),
      );
      expect(res.body.rows[2]._errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/duplicate sku.*DUP-SKU-001.*row 2/i)]),
      );
      // Row 5 unique
      expect(res.body.rows[3]._errors).toEqual([]);

      expect(res.body.valid).toBe(2);
    });

    it("does not flag rows where sku is empty/null (NULL SKUs are allowed to repeat)", async () => {
      const buf = csvBuffer(
        ["name", "sku", "selling_price"],
        [
          ["Item One",   "", 10],   // row 2 — null sku
          ["Item Two",   "", 20],   // row 3 — null sku again, allowed
          ["Item Three", "", 30],   // row 4 — null sku again, allowed
        ],
      );

      const res = await req
        .post("/api/import/products?preview=1")
        .attach("file", buf, "products.csv");

      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(3);
      expect(res.body.rows[0]._errors).toEqual([]);
      expect(res.body.rows[1]._errors).toEqual([]);
      expect(res.body.rows[2]._errors).toEqual([]);
      expect(res.body.valid).toBe(3);
    });

    it("flags rows whose sku already exists in the DB (F9)", async () => {
      // Seed a product with a known non-NULL sku
      await db.query(
        "INSERT INTO products (name, sku, price) VALUES ('Existing Product', 'DB-COLLISION-001', 999) ON CONFLICT DO NOTHING",
      );

      const buf = csvBuffer(
        ["name", "sku", "selling_price"],
        [
          ["New Coffee",     "DB-COLLISION-001", 850],   // row 2 — collides with seeded
          ["Brand New Item", "BRAND-NEW-SKU",    100],   // row 3 — fresh sku
        ],
      );

      const res = await req
        .post("/api/import/products?preview=1")
        .attach("file", buf, "products.csv");

      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.rows[0]._errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/sku.*DB-COLLISION-001.*already exists/i)]),
      );
      expect(res.body.rows[1]._errors).toEqual([]);
      expect(res.body.valid).toBe(1);
    });

    it("blocks the actual import (no preview) from inserting duplicate SKUs", async () => {
      // Seed a product to collide with
      await db.query(
        "INSERT INTO products (name, sku, price) VALUES ('Existing Block Test', 'BLOCK-SKU-001', 500) ON CONFLICT DO NOTHING",
      );

      const buf = csvBuffer(
        ["name", "sku", "selling_price"],
        [
          ["New Valid Item",  "FRESH-SKU-AAA", 100],  // row 2 — fresh, should insert
          ["Tries to Dupe",   "BLOCK-SKU-001", 150],  // row 3 — DB collision, should NOT insert
          ["Tries to Dupe 2", "FRESH-SKU-AAA", 200],  // row 4 — in-file dup of row 2, should NOT insert
        ],
      );

      const before = await db.query(
        "SELECT COUNT(*)::int AS n FROM products WHERE sku IN ('FRESH-SKU-AAA', 'BLOCK-SKU-001')",
      );

      const res = await req
        .post("/api/import/products")
        .attach("file", buf, "products.csv");

      expect(res.status).toBe(200);
      // Only row 2 should have inserted
      expect(res.body.imported).toBe(1);
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(res.body.errors.length).toBeGreaterThanOrEqual(2); // rows 3 + 4 errored

      const after = await db.query(
        "SELECT COUNT(*)::int AS n FROM products WHERE sku IN ('FRESH-SKU-AAA', 'BLOCK-SKU-001')",
      );
      // Was 1 (the seeded BLOCK-SKU-001), now 2 (added FRESH-SKU-AAA once)
      expect(after.rows[0].n - before.rows[0].n).toBe(1);
    });
  });

  describe("POST /api/import/customers?preview=1", () => {
    it("returns rows[] with _row + _errors and valid count", async () => {
      const buf = csvBuffer(
        ["name", "mobile"],
        [
          ["Ali Khan", "0300-1234567"],
          ["", "0300-7654321"],
        ],
      );

      const res = await req
        .post("/api/import/customers?preview=1")
        .attach("file", buf, "customers.csv");

      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.rows[0]._errors).toEqual([]);
      expect(res.body.rows[1]._errors).toEqual(expect.arrayContaining([expect.stringMatching(/name/i)]));
      expect(res.body.valid).toBe(1);
      expect(res.body.rows[0].name).toBe("Ali Khan");
    });
  });

  describe("POST /api/import/suppliers?preview=1", () => {
    it("returns rows[] with _row + _errors and valid count", async () => {
      const buf = csvBuffer(
        ["name", "phone"],
        [
          ["ACME Distribution", "021-1111111"],
          ["", "021-2222222"],
        ],
      );

      const res = await req
        .post("/api/import/suppliers?preview=1")
        .attach("file", buf, "suppliers.csv");

      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.rows[0]._errors).toEqual([]);
      expect(res.body.rows[1]._errors).toEqual(expect.arrayContaining([expect.stringMatching(/name/i)]));
      expect(res.body.valid).toBe(1);
    });
  });

  describe("POST /api/import/expenses?preview=1", () => {
    it("returns rows[] with _row + _errors and valid count", async () => {
      const buf = csvBuffer(
        ["date", "category", "amount"],
        [
          ["2026-04-29", "Office Supplies", 100],   // valid
          ["", "Office Supplies", 50],              // row 3 — missing date
          ["2026-04-29", "DoesNotExist", 75],       // row 4 — unknown category
          ["not-a-date", "Office Supplies", 200],   // row 5 — invalid date
        ],
      );

      const res = await req
        .post("/api/import/expenses?preview=1")
        .attach("file", buf, "expenses.csv");

      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(4);
      expect(res.body.rows[0]._errors).toEqual([]);
      expect(res.body.rows[1]._errors.length).toBeGreaterThan(0);
      expect(res.body.rows[2]._errors).toEqual(expect.arrayContaining([expect.stringMatching(/category/i)]));
      expect(res.body.rows[3]._errors.length).toBeGreaterThan(0);
      expect(res.body.valid).toBe(1);
    });
  });

  describe("POST /api/import/payments?preview=1", () => {
    it("returns rows[] with _row + _errors and valid count", async () => {
      const buf = csvBuffer(
        ["supplier", "invoice_number", "amount", "date", "payment_method"],
        [
          ["Test Supplier", "INV-PAY-001", 500, "2026-04-29", "Cash"],   // valid
          ["", "INV-PAY-001", 100, "2026-04-29", "Cash"],                // row 3 — missing supplier
          ["Test Supplier", "INV-DOES-NOT-EXIST", 100, "2026-04-29", "Cash"], // row 4 — unknown invoice
          ["Test Supplier", "INV-PAY-001", -50, "2026-04-29", "Cash"],   // row 5 — negative amount
        ],
      );

      const res = await req
        .post("/api/import/payments?preview=1")
        .attach("file", buf, "payments.csv");

      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(4);
      expect(res.body.rows[0]._errors).toEqual([]);
      expect(res.body.rows[1]._errors).toEqual(expect.arrayContaining([expect.stringMatching(/supplier/i)]));
      expect(res.body.rows[2]._errors).toEqual(expect.arrayContaining([expect.stringMatching(/invoice/i)]));
      expect(res.body.rows[3]._errors).toEqual(expect.arrayContaining([expect.stringMatching(/amount/i)]));
      expect(res.body.valid).toBe(1);
    });
  });

  // ─── F11: error wording — non-numeric price should say "is not a number"
  //       instead of "is required and must be a number"
  describe("POST /api/import/products — F11 error wording", () => {
    it("uses precise wording when selling_price is provided but non-numeric", async () => {
      const buf = csvBuffer(
        ["name", "selling_price"],
        [["Espresso Maker", "Rs 850"]],
      );
      const res = await req
        .post("/api/import/products?preview=1")
        .attach("file", buf, "products.csv");
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0]._errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/selling_price.*Rs 850.*not a number/i)]),
      );
      // Should NOT use the misleading "required" wording when the field has content
      expect(res.body.rows[0]._errors.some((e) => /required/i.test(e))).toBe(false);
    });

    it("still uses 'is required' wording when selling_price is empty", async () => {
      const buf = csvBuffer(
        ["name", "selling_price"],
        [["No Price Item", ""]],
      );
      const res = await req
        .post("/api/import/products?preview=1")
        .attach("file", buf, "products.csv");
      expect(res.body.rows[0]._errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/selling_price.*required/i)]),
      );
    });
  });

  // ─── F12: suppliers in-file dup name detection
  describe("POST /api/import/suppliers — F12 in-file duplicate name", () => {
    it("flags second+ rows that repeat an earlier supplier name in the same file", async () => {
      const buf = csvBuffer(
        ["name", "phone"],
        [
          ["ACME Distribution", "021-1111111"],
          ["acme distribution", "021-2222222"],   // case-insensitive dup
          ["BetaCo",            "021-3333333"],
        ],
      );
      const res = await req
        .post("/api/import/suppliers?preview=1")
        .attach("file", buf, "suppliers.csv");
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(3);
      expect(res.body.rows[0]._errors).toEqual([]);
      expect(res.body.rows[1]._errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/duplicate.*name.*ACME Distribution|acme distribution/i)]),
      );
      expect(res.body.rows[2]._errors).toEqual([]);
      expect(res.body.valid).toBe(2);
    });
  });

  // ─── F13: payments in-file dup-payment detection
  //       (same supplier_id + invoice_number + amount + date == suspected double-pay)
  describe("POST /api/import/payments — F13 in-file duplicate payment", () => {
    it("flags second+ rows that repeat an earlier (invoice, amount, date) tuple", async () => {
      const buf = csvBuffer(
        ["supplier", "invoice_number", "amount", "date", "payment_method"],
        [
          ["Test Supplier", "INV-PAY-001", 500, "2026-04-29", "Cash"],   // first
          ["Test Supplier", "INV-PAY-001", 500, "2026-04-29", "Cash"],   // exact dup → flag
          ["Test Supplier", "INV-PAY-001", 250, "2026-04-29", "Cash"],   // diff amount → ok
        ],
      );
      const res = await req
        .post("/api/import/payments?preview=1")
        .attach("file", buf, "payments.csv");
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(3);
      expect(res.body.rows[0]._errors).toEqual([]);
      expect(res.body.rows[1]._errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/duplicate payment.*row 2/i)]),
      );
      expect(res.body.rows[2]._errors).toEqual([]);
      expect(res.body.valid).toBe(2);
    });
  });

  // ─── F14: customer email format validation when present
  describe("POST /api/import/customers — F14 email format", () => {
    it("flags rows where email is provided but malformed", async () => {
      const buf = csvBuffer(
        ["name", "email"],
        [
          ["Ali",   "ali@example.com"],
          ["Sara",  "not-an-email"],
          ["Bilal", ""],   // empty is fine — email is optional
          ["Hira",  "missing-at-sign.com"],
        ],
      );
      const res = await req
        .post("/api/import/customers?preview=1")
        .attach("file", buf, "customers.csv");
      expect(res.status).toBe(200);
      expect(res.body.rows[0]._errors).toEqual([]);
      expect(res.body.rows[1]._errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/email.*not-an-email.*invalid|email.*format/i)]),
      );
      expect(res.body.rows[2]._errors).toEqual([]);
      expect(res.body.rows[3]._errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/email.*missing-at-sign.com.*invalid|email.*format/i)]),
      );
      expect(res.body.valid).toBe(2);
    });
  });

  // ─── F15: customers in-file dup mobile warning
  describe("POST /api/import/customers — F15 duplicate mobile in same file", () => {
    it("flags second+ rows that repeat an earlier mobile number", async () => {
      const buf = csvBuffer(
        ["name", "mobile"],
        [
          ["Ali",   "0300-1112222"],
          ["Bilal", "0300-1112222"],   // dup mobile
          ["Sara",  "0300-3334444"],
        ],
      );
      const res = await req
        .post("/api/import/customers?preview=1")
        .attach("file", buf, "customers.csv");
      expect(res.status).toBe(200);
      expect(res.body.rows[0]._errors).toEqual([]);
      expect(res.body.rows[1]._errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/duplicate.*mobile.*0300-1112222.*row 2/i)]),
      );
      expect(res.body.rows[2]._errors).toEqual([]);
      expect(res.body.valid).toBe(2);
    });
  });
});
