/**
 * returns.test.js — POST /api/returns, GET /api/returns
 *
 * PORTED FROM SQLITE 2026-08-02 (see security.test.js for the full rationale).
 * Originally targeted B16: no validation that returned items belong to the
 * original sale. Those two guards — wrong product, and quantity exceeding what
 * was sold — are the most valuable assertions in the file and are preserved
 * exactly. A refund for goods that were never bought is money leaving the till
 * against nothing.
 *
 * Port hazards handled (same as sales.test.js):
 *   - NUMERIC columns come back as STRINGS from node-postgres.
 *     outlet_stock.quantity NUMERIC(10,3), returns.total_refund NUMERIC(12,2).
 *     Every numeric read goes through num().
 *   - `?` -> `$1`, dbAll/dbGet/dbRun -> db.query, closeDb -> cleanup().
 *   - The GET tests sent no auth header incidentally; every data-returning GET
 *     requires auth now, so they carry ADMIN_ID.
 *
 * MOUNTED PER-ROUTE, NOT VIA registerAll — and that is deliberate. Under
 * registerAll this file's manager-authored returns 500 with "Cannot read
 * properties of undefined (reading 'query')", because registerAllRoutes wires
 * the real resolveEffectiveRole, which wants a tenant DB this harness has no
 * way to provide. Verified as a harness artifact rather than a product defect
 * by running the identical request through both harnesses:
 *   per-route -> 200, registerAll+ADMIN -> 200, registerAll+MANAGER -> 500.
 * all_access short-circuits the per-outlet role resolution; MANAGER does not.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, MANAGER_ID, CASHIER_ID } = require("../helpers/request");

let app, db, cleanup;
const ADMIN_PIN = "2580";

function num(v) {
  return v === null || v === undefined ? v : Number(v);
}

async function one(sql, params = []) {
  const { rows } = await db.query(sql, params);
  return rows[0];
}

async function all(sql, params = []) {
  const { rows } = await db.query(sql, params);
  return rows;
}

beforeAll(async () => {
  let deps;
  ({ app, db, deps, cleanup } = await createTestApp());
  require("../../routes/shifts")(app, deps);
  require("../../routes/attendance")(app, deps);
  require("../../routes/sales")(app, deps);
  require("../../routes/returns")(app, deps);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function ensureCheckoutContext(outletId = 1) {
  const openShift = await one(
    "SELECT id FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' LIMIT 1",
    [outletId]
  );
  if (!openShift) {
    const openRes = await makeRequest(app, ADMIN_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: outletId, employee_id: ADMIN_ID, opening_float: 500 });
    expect(openRes.status).toBe(200);
  }
  const attendanceRes = await makeRequest(app)
    .post("/api/attendance/pin-checkin")
    .send({ pin_code: ADMIN_PIN, outlet_id: outletId });
  expect([200, 400]).toContain(attendanceRes.status);
}

async function createSaleForReturn() {
  await ensureCheckoutContext(1);
  const res = await makeRequest(app, ADMIN_ID)
    .post("/api/sales")
    .send({
      cartItems: [
        { id: 1, quantity: 3, price: 100, cost_price: 60 },
        { id: 2, quantity: 2, price: 200, cost_price: 120 },
      ],
      paymentMethod: "Cash",
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
  expect(res.status).toBe(200);
  return res.body.saleId;
}

describe("POST /api/returns — Create Return", () => {
  let saleId;

  beforeAll(async () => {
    saleId = await createSaleForReturn();
  });

  it("return restocks outlet_stock for each product", async () => {
    const stockBefore = await one(
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1"
    );

    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 100,
        refund_method: "Cash",
        reason: "Defective item",
        items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();

    const stockAfter = await one(
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1"
    );
    expect(num(stockAfter.quantity)).toBe(num(stockBefore.quantity) + 1);
  });

  it("creates returns + return_items records with correct data", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 200,
        refund_method: "Cash",
        reason: "Wrong item",
        items: [{ product_id: 2, quantity: 1, refund_price: 200 }],
      });

    expect(res.status).toBe(200);

    const returnRow = await one("SELECT * FROM returns WHERE id = $1", [res.body.id]);
    expect(num(returnRow.total_refund)).toBe(200);
    expect(returnRow.refund_method).toBe("Cash");
    expect(num(returnRow.original_sale_id)).toBe(saleId);

    const returnItems = await all("SELECT * FROM return_items WHERE return_id = $1", [
      res.body.id,
    ]);
    expect(returnItems).toHaveLength(1);
    expect(num(returnItems[0].product_id)).toBe(2);
    expect(num(returnItems[0].quantity)).toBe(1);
  });

  it("missing outlet_id returns 400", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        total_refund: 100,
        refund_method: "Cash",
        items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      });

    expect(res.status).toBe(400);
    // Zod validate() may answer before the route's own check — 400 is the
    // contract, the wording depends on which layer rejects first.
    expect(res.body.error).toMatch(/outlet|invalid/i);
  });

  it("empty items array returns 400", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        total_refund: 0,
        refund_method: "Cash",
        items: [],
      });

    expect(res.status).toBe(400);
    // Actual message is "Return must have at least one item" — singular.
    expect(res.body.error).toMatch(/item|invalid/i);
  });

  it("return with product NOT in original sale is rejected — 400 (B16 fixed)", async () => {
    // Product 4 was never in the sale (only products 1 & 2 were).
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 50,
        refund_method: "Cash",
        reason: "Returning product not in sale",
        items: [{ product_id: 4, quantity: 1, refund_price: 50 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not part of the original sale/i);
  });

  it("return qty exceeding sold qty is rejected — 400 (B16 fixed)", async () => {
    // Original sale had qty=3 of product 1; try to return 10.
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 1000,
        refund_method: "Cash",
        reason: "Returning more than sold",
        items: [{ product_id: 1, quantity: 10, refund_price: 100 }],
      });

    expect(res.status).toBe(400);
    /**
     * The guard is now STRONGER than the original test described. It used to
     * compare against the quantity sold; it now compares against the quantity
     * still refundable, netting off returns already made against this sale:
     *
     *   "Cannot refund 10 units of product 1; only 2 remaining
     *    (the rest was already refunded against this sale)"
     *
     * That closes the cumulative case — three separate returns of 1 unit each
     * against a sale of 3 would each pass a naive sold-quantity check while
     * together refunding the whole line twice over. The regex accepts either
     * wording so it asserts the behaviour rather than the sentence.
     */
    expect(res.body.error).toMatch(/exceeds sold quantity|only \d+ remaining/i);
  });

  it("cashier without manage_orders permission is blocked from returns (PERMISSION_RULES: manage_orders)", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        total_refund: 100,
        refund_method: "Cash",
        items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      });

    expect(res.status).toBe(403);
  });
});

describe("GET /api/returns — List & Detail", () => {
  it("GET /api/returns returns list of returns", async () => {
    const res = await makeRequest(app, ADMIN_ID).get("/api/returns");
    expect(res.status).toBe(200);
    expect(res.body.returns).toBeDefined();
    expect(Array.isArray(res.body.returns)).toBe(true);
    expect(res.body.returns.length).toBeGreaterThan(0);
  });

  it("GET /api/returns with date filter excludes out-of-range", async () => {
    const res = await makeRequest(app, ADMIN_ID).get(
      "/api/returns?date_from=2099-01-01&date_to=2099-12-31"
    );
    expect(res.status).toBe(200);
    expect(res.body.returns).toHaveLength(0);
  });

  it("GET /api/returns/:id returns detail with items", async () => {
    const allReturns = await all("SELECT id FROM returns LIMIT 1");
    const returnId = allReturns[0].id;

    const res = await makeRequest(app, ADMIN_ID).get(`/api/returns/${returnId}`);
    expect(res.status).toBe(200);
    expect(res.body.returnData).toBeDefined();
    expect(res.body.items).toBeDefined();
  });
});
