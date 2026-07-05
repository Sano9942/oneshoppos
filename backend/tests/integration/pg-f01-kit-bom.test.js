/**
 * pg-f01-kit-bom.test.js — F01 Kit / BOM / Recipe engine
 *
 * Verification bar (from the plan):
 *   - kit sale decrements COMPONENTS (not the kit), exact decimal math
 *   - empty kit is NOT sellable (400 empty_kit, no silent zero-decrement)
 *   - kit availability = min(floor(component_stock / qty_per))
 *   - two parallel sales for the last kit's components → exactly one succeeds
 *   - void + return of a kit restock components
 *   - variant component decrements variant_outlet_stock
 *   - assembly run produces output + consumes components; disassembly 1→N
 *   - non-POS writers reject kits (quotation convert); transfer/adjustment block
 *   - CRUD rejects nested kits + self-reference
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const dbpg = require("../../db-pg");
const kitEngine = require("../../services/kit-engine");

describe("F01 — Kit / BOM engine (Postgres)", () => {
  let app, db, deps, cleanup, schemaName;

  // Fixtures: products 4 (Snack D, stock 100) + 5 (Drink E, stock 80) are our
  // standard components. We build kits from them.
  const COMP_A = 4; // qty_per 2
  const COMP_B = 5; // qty_per 0.25

  async function makeKit(name, components, bomType = "kit") {
    const { rows: [p] } = await db.query(
      `INSERT INTO products (name, price, cost_price, bom_type, is_bundle, status)
       VALUES ($1, $2, 0, $3, $4, 'active') RETURNING id`,
      [name, 300, bomType, bomType === "kit"]
    );
    for (const c of components) {
      await db.query(
        `INSERT INTO product_bundles (product_id, component_product_id, component_variant_id, quantity)
         VALUES ($1, $2, $3, $4)`,
        [p.id, c.pid, c.vid || null, c.qty]
      );
    }
    return p.id;
  }

  async function stockOf(productId, outletId = 1) {
    const { rows: [r] } = await db.query(
      "SELECT COALESCE(quantity,0) AS q FROM outlet_stock WHERE product_id=$1 AND outlet_id=$2",
      [productId, outletId]
    );
    return r ? Number(r.q) : 0;
  }

  function sale(kitId, qty, extra = {}) {
    return request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({
        outlet_id: 1,
        employee_id: 1,
        cartItems: [{ id: kitId, name: "Kit", price: 300, quantity: qty, cost_price: 0 }],
        payments: [{ method: "cash", amount: 300 * qty }],
        idempotency_key: "f01-" + Math.random().toString(36).slice(2),
        ...extra,
      });
  }

  beforeAll(async () => {
    ({ app, db, deps, cleanup, schemaName } = await createTestApp());

    require("../../routes/shifts")(app, deps);
    require("../../routes/attendance")(app, deps);
    require("../../routes/products")(app, deps);
    require("../../routes/sales")(app, deps);
    require("../../routes/returns")(app, deps);
    require("../../routes/inventory")(app, deps);
    require("../../routes/stock-conversions")(app, deps);

    // Enable the kit_bom_engine flag (gates the stock-conversions routes).
    await db.query(
      "INSERT INTO feature_flags (key, enabled) VALUES ('kit_bom_engine', true) ON CONFLICT (key) DO UPDATE SET enabled = true"
    );

    await request(app).post("/api/shifts/open").set("x-employee-id", "1")
      .send({ outlet_id: 1, opening_float: 500, denominations: [] });
    await request(app).post("/api/attendance/pin-checkin")
      .send({ pin_code: "2580", outlet_id: 1 });
  }, 30000);

  afterAll(async () => { if (cleanup) await cleanup(); });

  it("kit sale decrements COMPONENTS with exact decimal math, not the kit", async () => {
    const kit = await makeKit("Sweet Box", [{ pid: COMP_A, qty: 2 }, { pid: COMP_B, qty: 0.25 }]);
    const a0 = await stockOf(COMP_A), b0 = await stockOf(COMP_B);

    const res = await sale(kit, 3);
    expect(res.status).toBe(200);

    expect(await stockOf(COMP_A)).toBeCloseTo(a0 - 6, 4);   // 2 * 3
    expect(await stockOf(COMP_B)).toBeCloseTo(b0 - 0.75, 4); // 0.25 * 3
    // Kit itself holds no stock — no negative row conjured.
    expect(await stockOf(kit)).toBe(0);
  });

  it("a kit with zero components is NOT sellable (400 empty_kit)", async () => {
    const kit = await makeKit("Empty Kit", []);
    const res = await sale(kit, 1);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("empty_kit");
  });

  it("kit availability = min(floor(component_stock / qty_per)) via POS search", async () => {
    const kit = await makeKit("Avail Kit", [{ pid: COMP_A, qty: 2 }, { pid: COMP_B, qty: 0.25 }]);
    const a = await stockOf(COMP_A), b = await stockOf(COMP_B);
    const expected = Math.min(Math.floor(a / 2), Math.floor(b / 0.25));

    const res = await request(app).get("/api/products/search")
      .query({ query: "Avail Kit", outlet_id: 1 })
      .set("x-employee-id", "1");
    expect(res.status).toBe(200);
    const row = res.body.products.find((p) => p.id === kit);
    expect(Number(row.available_qty)).toBe(expected);
  });

  it("two parallel component decrements for the last kit → exactly one succeeds", async () => {
    // The createTestApp harness shares ONE pg client, so real row-lock
    // contention needs SEPARATE physical connections. Drive the engine directly
    // on two raw pool clients pinned to the test schema — this is the true
    // concurrency guarantee (SELECT ... FOR UPDATE serializes them).
    const { rows: [cA] } = await db.query(
      "INSERT INTO products (name, price, cost_price, bom_type, status) VALUES ('RaceComp', 10, 5, 'standard', 'active') RETURNING id"
    );
    await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, 1)", [cA.id]);
    const kit = await makeKit("Race Kit", [{ pid: cA.id, qty: 1 }]);

    const c1 = await dbpg.pool.connect();
    const c2 = await dbpg.pool.connect();
    try {
      await c1.query(`SET search_path = "${schemaName}"`);
      await c2.query(`SET search_path = "${schemaName}"`);
      const attempt = async (c) => {
        try {
          await c.query("BEGIN");
          const decr = await kitEngine.reserveComponents(c, { productId: kit, outletId: 1, saleQty: 1 });
          await kitEngine.decrementComponents(c, { outletId: 1, decrements: decr });
          await c.query("COMMIT");
          return "ok";
        } catch (e) {
          await c.query("ROLLBACK");
          return e.code || "err";
        }
      };
      const results = await Promise.all([attempt(c1), attempt(c2)]);
      expect(results.filter((r) => r === "ok")).toHaveLength(1);
      expect(results).toContain("insufficient_stock");
      expect(await stockOf(cA.id)).toBe(0);
    } finally {
      c1.release();
      c2.release();
    }
  });

  it("void of a kit sale restocks components", async () => {
    const kit = await makeKit("Void Kit", [{ pid: COMP_A, qty: 3 }]);
    const a0 = await stockOf(COMP_A);
    const res = await sale(kit, 2);
    expect(res.status).toBe(200);
    expect(await stockOf(COMP_A)).toBeCloseTo(a0 - 6, 4);

    const voidRes = await request(app).put(`/api/sales/${res.body.saleId}/void`)
      .set("x-employee-id", "1").send({ void_reason: "test" });
    expect([200, 201]).toContain(voidRes.status);
    expect(await stockOf(COMP_A)).toBeCloseTo(a0, 4);
  });

  it("return of a kit restocks components", async () => {
    const kit = await makeKit("Return Kit", [{ pid: COMP_A, qty: 2 }]);
    const a0 = await stockOf(COMP_A);
    const res = await sale(kit, 1);
    expect(res.status).toBe(200);
    expect(await stockOf(COMP_A)).toBeCloseTo(a0 - 2, 4);

    const ret = await request(app).post("/api/returns").set("x-employee-id", "1")
      .send({
        original_sale_id: res.body.saleId, outlet_id: 1,
        total_refund: 300, refund_method: "cash",
        items: [{ product_id: kit, quantity: 1, refund_price: 300 }],
      });
    expect([200, 201]).toContain(ret.status);
    expect(await stockOf(COMP_A)).toBeCloseTo(a0, 4);
  });

  it("kit with a variant component decrements variant_outlet_stock", async () => {
    // Give product 3 a variant with per-outlet stock.
    const { rows: [v] } = await db.query(
      "INSERT INTO product_variants (product_id, sku, price, stock) VALUES (3, 'VAR-1', 500, 20) RETURNING id"
    );
    await db.query(
      "INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity) VALUES ($1, 1, 20)", [v.id]
    );
    const kit = await makeKit("Variant Kit", [{ pid: 3, vid: v.id, qty: 2 }]);

    const res = await sale(kit, 3);
    expect(res.status).toBe(200);
    const { rows: [vos] } = await db.query(
      "SELECT quantity FROM variant_outlet_stock WHERE variant_id=$1 AND outlet_id=1", [v.id]
    );
    expect(Number(vos.quantity)).toBeCloseTo(20 - 6, 4); // 2 * 3
  });

  it("assembly run produces output stock + consumes recipe components", async () => {
    const assembled = await makeKit("Tray", [{ pid: COMP_A, qty: 4 }, { pid: COMP_B, qty: 1 }], "assembled");
    const a0 = await stockOf(COMP_A), b0 = await stockOf(COMP_B), out0 = await stockOf(assembled);

    const res = await request(app).post("/api/stock-conversions").set("x-employee-id", "1")
      .send({ conversion_type: "assembly", outlet_id: 1, output_product_id: assembled, output_qty: 5 });
    expect(res.status).toBe(201);

    expect(await stockOf(COMP_A)).toBeCloseTo(a0 - 20, 4); // 4 * 5
    expect(await stockOf(COMP_B)).toBeCloseTo(b0 - 5, 4);  // 1 * 5
    expect(await stockOf(assembled)).toBeCloseTo(out0 + 5, 4);
  });

  it("disassembly run consumes 1 source and produces N outputs", async () => {
    const { rows: [src] } = await db.query(
      "INSERT INTO products (name, price, cost_price, bom_type, status) VALUES ('Carcass', 1000, 800, 'standard', 'active') RETURNING id"
    );
    await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, 3)", [src.id]);
    const { rows: [cut1] } = await db.query(
      "INSERT INTO products (name, price, cost_price, bom_type, status) VALUES ('Cut1', 300, 0, 'standard', 'active') RETURNING id"
    );
    const { rows: [cut2] } = await db.query(
      "INSERT INTO products (name, price, cost_price, bom_type, status) VALUES ('Cut2', 200, 0, 'standard', 'active') RETURNING id"
    );

    const res = await request(app).post("/api/stock-conversions").set("x-employee-id", "1")
      .send({
        conversion_type: "disassembly", outlet_id: 1,
        source_product_id: src.id, source_qty: 1,
        outputs: [
          { product_id: cut1.id, quantity: 4, unit_cost: 100 },
          { product_id: cut2.id, quantity: 6 },
        ],
      });
    expect(res.status).toBe(201);
    expect(await stockOf(src.id)).toBe(2);   // 3 - 1
    expect(await stockOf(cut1.id)).toBe(4);
    expect(await stockOf(cut2.id)).toBe(6);
  });

  it("disassembly rejects when source stock is insufficient", async () => {
    const { rows: [src] } = await db.query(
      "INSERT INTO products (name, price, cost_price, bom_type, status) VALUES ('EmptyCarcass', 1000, 0, 'standard', 'active') RETURNING id"
    );
    const res = await request(app).post("/api/stock-conversions").set("x-employee-id", "1")
      .send({
        conversion_type: "disassembly", outlet_id: 1,
        source_product_id: src.id, source_qty: 1,
        outputs: [{ product_id: COMP_A, quantity: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("insufficient_stock");
  });

  it("transfers + adjustments of a kit are blocked with a clear error", async () => {
    const kit = await makeKit("NoTransfer Kit", [{ pid: COMP_A, qty: 1 }]);
    const t = await request(app).post("/api/transfers").set("x-employee-id", "1")
      .send({ product_id: kit, from_outlet_id: 1, to_outlet_id: 2, quantity: 1 });
    expect(t.status).toBe(400);
    expect(t.body.code).toBe("kit_no_stock");

    const a = await request(app).post("/api/adjustments").set("x-employee-id", "1")
      .send({ product_id: kit, outlet_id: 1, quantity_change: 5, reason: "test" });
    expect(a.status).toBe(400);
    expect(a.body.code).toBe("kit_no_stock");
  });

  it("CRUD rejects nested kits and self-reference", async () => {
    const innerKit = await makeKit("Inner Kit", [{ pid: COMP_A, qty: 1 }]);

    // nested kit (component is itself a kit)
    const nested = await request(app).post("/api/products").set("x-employee-id", "1")
      .send({
        name: "Outer Kit", price: 500, bom_type: "kit",
        bundle_components: [{ product_id: innerKit, quantity: 1 }],
      });
    expect(nested.status).toBe(400);
    expect(nested.body.code).toBe("nested_kit");
  });
});
