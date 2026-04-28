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
});
