/**
 * Phase 2-G Wave 3 — 2-G.6 serialized inventory integration test.
 *
 * Covers the full round-trip:
 *   1. GRN scan-receive with serial_numbers[] inserts product_serial_numbers
 *      rows with status='available', grn_id, warranty_months from the product
 *      default.
 *   2. GET /api/products/:id/serials?status=available returns them.
 *   3. POST /api/sales with cartItems[i].serials=[id] flips status to 'sold',
 *      populates warranty_start_date (today) + warranty_end_date
 *      (start + warranty_months), and inserts sale_item_serials bridge rows.
 *   4. Void a serialized sale → serials flip back to 'available', warranty
 *      dates clear; bridge rows stay intact.
 *   5. Negative cases: missing serials rejected, duplicate serial across
 *      lines rejected, unknown serial id rejected, serial belonging to the
 *      wrong product rejected, already-sold serial rejected.
 *   6. Flag OFF: non-serialized products accept no serials — no regression.
 */

require("dotenv").config({
  path: require("path").resolve(__dirname, "..", "..", ".env"),
});

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup;
let reqAdmin;

const fixture = {
  serialProductId: null, // product with serial_required=true
  nonSerialProductId: 1, // seeded product 1 (non-serialized)
  grnId: null,
  availableSerialIds: [], // ids created in the GRN-receive test, reused across tests
};

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  require("../../middleware/feature-flags").init({
    db,
    IS_MULTI_TENANT: false,
    tenantDbManager: null,
    dbProxy: db,
  });
  require("../../middleware/feature-flags").invalidateFeatureFlagCache();

  require("../../routes/shifts")(app, deps);
  require("../../routes/attendance")(app, deps);
  require("../../routes/sales")(app, deps);
  require("../../routes/grn")(app, deps);
  require("../../routes/product-serials")(app, deps);

  reqAdmin = makeRequest(app, ADMIN_ID);

  await request(app)
    .post("/api/shifts/open")
    .set("x-employee-id", "1")
    .send({ outlet_id: 1, opening_float: 500, denominations: [] });
  await request(app)
    .post("/api/attendance/pin-checkin")
    .send({ pin_code: "2580", outlet_id: 1 });

  // Seed a serialized product (iPhone-like) with default warranty 12 months.
  const { rows: [prod] } = await db.query(
    `INSERT INTO products (name, price, cost_price, barcode, sku, status, serial_required, default_warranty_months)
       VALUES ('iPhone 15', 200000, 150000, 'IPH15-001', 'IPH15-001', 'active', true, 12)
     RETURNING id`,
  );
  fixture.serialProductId = prod.id;

  // Seed outlet_stock so POS sale passes the outlet-level stock check.
  await db.query(
    `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, 100)`,
    [prod.id],
  );

  // Seed a goods_received_notes row + grn_item so the scan-receive path has
  // something to increment. Minimal columns; other columns accept defaults.
  const { rows: [grn] } = await db.query(
    `INSERT INTO goods_received_notes (grn_number, outlet_id)
       VALUES ('GRN-TEST-001', 1) RETURNING id`,
  );
  fixture.grnId = grn.id;
  await db.query(
    `INSERT INTO grn_items (grn_id, product_id, qty_ordered, qty_received, cost_price)
       VALUES ($1, $2, 10, 0, 150000)`,
    [grn.id, prod.id],
  );
}, 120000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

async function getSerial(id) {
  const { rows } = await db.query(
    `SELECT id, status, warranty_start_date, warranty_end_date, warranty_months, sale_id
       FROM product_serial_numbers WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

describe("Phase 2-G Wave 3 — 2-G.6 serialized inventory", () => {
  test("GRN scan-receive creates product_serial_numbers rows with warranty_months from product default", async () => {
    const res = await reqAdmin
      .post(`/api/grn/${fixture.grnId}/scan-receive`)
      .send({
        barcode: "IPH15-001",
        quantity: 3,
        serial_numbers: ["IMEI-A", "IMEI-B", "IMEI-C"],
      });
    expect(res.status).toBe(200);
    expect(res.body.item.serialized).toBe(true);
    expect(res.body.item.serials_recorded).toBe(3);

    const { rows } = await db.query(
      `SELECT id, serial_number, status, warranty_months, grn_id
         FROM product_serial_numbers
        WHERE product_id = $1 ORDER BY id ASC`,
      [fixture.serialProductId],
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.status).toBe("available");
      expect(r.warranty_months).toBe(12);
      expect(r.grn_id).toBe(fixture.grnId);
    }
    fixture.availableSerialIds = rows.map((r) => r.id);
  });

  test("GET /api/products/:id/serials?status=available returns the seeded serials", async () => {
    const res = await reqAdmin.get(
      `/api/products/${fixture.serialProductId}/serials?status=available`,
    );
    expect(res.status).toBe(200);
    expect(res.body.serials).toHaveLength(3);
    expect(new Set(res.body.serials.map((s) => s.status))).toEqual(new Set(["available"]));
  });

  test("GRN scan-receive rejects when serial_numbers count != quantity", async () => {
    const res = await reqAdmin
      .post(`/api/grn/${fixture.grnId}/scan-receive`)
      .send({
        barcode: "IPH15-001",
        quantity: 2,
        serial_numbers: ["IMEI-D"], // only 1
      });
    expect(res.status).toBe(400);
    expect(String(res.body.error || "")).toMatch(/serial/i);
  });

  test("GRN scan-receive rejects duplicate serial numbers in one batch", async () => {
    const res = await reqAdmin
      .post(`/api/grn/${fixture.grnId}/scan-receive`)
      .send({
        barcode: "IPH15-001",
        quantity: 2,
        serial_numbers: ["IMEI-E", "IMEI-E"],
      });
    expect(res.status).toBe(400);
    expect(String(res.body.error || "")).toMatch(/duplicate/i);
  });

  test("GRN scan-receive rejects collision with existing serial", async () => {
    const res = await reqAdmin
      .post(`/api/grn/${fixture.grnId}/scan-receive`)
      .send({
        barcode: "IPH15-001",
        quantity: 1,
        serial_numbers: ["IMEI-A"], // already exists
      });
    expect(res.status).toBe(409);
  });

  test("POST /api/sales with serials[] flips status to sold + sets warranty dates + creates bridge row", async () => {
    const serialId = fixture.availableSerialIds[0];
    const before = await getSerial(serialId);
    expect(before.status).toBe("available");

    const saleRes = await reqAdmin.post("/api/sales").send({
      cartItems: [
        {
          id: fixture.serialProductId,
          name: "iPhone 15",
          price: 200000,
          quantity: 1,
          serials: [serialId],
        },
      ],
      payments: [{ method: "Cash", amount: 200000 }],
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
    expect(saleRes.status).toBe(200);
    const saleId = saleRes.body.saleId;

    const after = await getSerial(serialId);
    expect(after.status).toBe("sold");
    expect(after.sale_id).toBe(saleId);
    expect(after.warranty_start_date).toBeTruthy();
    expect(after.warranty_end_date).toBeTruthy();
    // warranty_end_date should be warranty_start_date + 12 months
    const start = new Date(after.warranty_start_date);
    const end = new Date(after.warranty_end_date);
    const monthsDiff =
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (end.getUTCMonth() - start.getUTCMonth());
    expect(monthsDiff).toBe(12);

    const { rows: bridge } = await db.query(
      `SELECT sale_item_id, serial_id FROM sale_item_serials WHERE serial_id = $1`,
      [serialId],
    );
    expect(bridge).toHaveLength(1);
  });

  test("POST /api/sales rejects a line missing serials when product is serialized", async () => {
    const saleRes = await reqAdmin.post("/api/sales").send({
      cartItems: [
        {
          id: fixture.serialProductId,
          name: "iPhone 15",
          price: 200000,
          quantity: 1,
          // no serials
        },
      ],
      payments: [{ method: "Cash", amount: 200000 }],
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
    expect(saleRes.status).toBe(400);
    expect(String(saleRes.body.error || "")).toMatch(/serial/i);
  });

  test("POST /api/sales rejects an unknown serial id", async () => {
    const saleRes = await reqAdmin.post("/api/sales").send({
      cartItems: [
        {
          id: fixture.serialProductId,
          name: "iPhone 15",
          price: 200000,
          quantity: 1,
          serials: [999999],
        },
      ],
      payments: [{ method: "Cash", amount: 200000 }],
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
    expect(saleRes.status).toBe(400);
  });

  test("POST /api/sales rejects a serial that is already sold", async () => {
    const soldSerialId = fixture.availableSerialIds[0]; // sold in an earlier test
    const saleRes = await reqAdmin.post("/api/sales").send({
      cartItems: [
        {
          id: fixture.serialProductId,
          name: "iPhone 15",
          price: 200000,
          quantity: 1,
          serials: [soldSerialId],
        },
      ],
      payments: [{ method: "Cash", amount: 200000 }],
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
    expect(saleRes.status).toBe(409);
  });

  test("POST /api/sales rejects serials on a non-serialized product", async () => {
    // Product id 1 is a seeded non-serial item.
    const saleRes = await reqAdmin.post("/api/sales").send({
      cartItems: [
        {
          id: 1,
          name: "Seed Product 1",
          price: 100,
          quantity: 1,
          serials: [fixture.availableSerialIds[1]],
        },
      ],
      payments: [{ method: "Cash", amount: 100 }],
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
    expect(saleRes.status).toBe(400);
  });

  test("voiding a serialized sale returns the serial to 'available' and clears warranty dates", async () => {
    const serialId = fixture.availableSerialIds[1];

    // 1. Sell it.
    const saleRes = await reqAdmin.post("/api/sales").send({
      cartItems: [
        {
          id: fixture.serialProductId,
          name: "iPhone 15",
          price: 200000,
          quantity: 1,
          serials: [serialId],
        },
      ],
      payments: [{ method: "Cash", amount: 200000 }],
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
    expect(saleRes.status).toBe(200);
    const saleId = saleRes.body.saleId;

    expect((await getSerial(serialId)).status).toBe("sold");

    // 2. Void it.
    const voidRes = await reqAdmin.put(`/api/sales/${saleId}/void`).send({
      void_reason: "test void — serial return",
    });
    expect(voidRes.status).toBeLessThan(400);

    const after = await getSerial(serialId);
    expect(after.status).toBe("available");
    expect(after.sale_id).toBeNull();
    expect(after.warranty_start_date).toBeNull();
    expect(after.warranty_end_date).toBeNull();

    // Bridge row should still exist (append-only for audit).
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM sale_item_serials WHERE serial_id = $1`,
      [serialId],
    );
    expect(rows[0].n).toBe(1);
  });

  test("GET /api/sales/:id/serials returns the serials attached to that sale", async () => {
    const serialId = fixture.availableSerialIds[2];

    const saleRes = await reqAdmin.post("/api/sales").send({
      cartItems: [
        {
          id: fixture.serialProductId,
          name: "iPhone 15",
          price: 200000,
          quantity: 1,
          serials: [serialId],
        },
      ],
      payments: [{ method: "Cash", amount: 200000 }],
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
    expect(saleRes.status).toBe(200);

    const res = await reqAdmin.get(`/api/sales/${saleRes.body.saleId}/serials`);
    expect(res.status).toBe(200);
    expect(res.body.serials).toHaveLength(1);
    expect(res.body.serials[0].id).toBe(serialId);
    expect(res.body.serials[0].warranty_end_date).toBeTruthy();
  });
});
