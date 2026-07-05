/**
 * pg-f07-batch.test.js — F07 Batch / expiry / lot engine
 *
 * The invariant under test (tracked products):
 *   Σ stock_batches.remaining_qty (active) = outlet_stock.quantity
 * asserted after EVERY wired stock path.
 *
 * Verification bar (from the plan):
 *   - GRN receive captures a batch (number + expiry) in the same tx as the stock bump
 *   - POS sale consumes FEFO, splitting across the expiry boundary; invariant holds
 *   - POS void returns units to the original batch; invariant holds
 *   - return restocks the right batch; invariant holds
 *   - transfer PRESERVES batch identity (number + expiry + cost) at destination
 *   - adjustment write-off consumes FEFO; invariant holds
 *   - kit of a tracked component consumes the component's batch
 *   - untracked product walkthrough is completely unchanged (regression)
 *   - parallel drain of one batch: no negative remaining_qty, invariant holds
 *   - quotation-convert hard-rejects tracked products (unsafe unlocked decrement)
 *   - drift-check report is clean at the end of the whole walkthrough
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const dbpg = require("../../db-pg");
const batchStock = require("../../services/batch-stock");
const { runExpiryScanForDb } = require("../../workers/expiry-alert-worker-boss");

describe("F07 — Batch / expiry / lot engine (Postgres)", () => {
  let app, db, deps, cleanup, schemaName;

  // ── fixtures / helpers ────────────────────────────────────────────────
  async function makeTrackedProduct(name, { shelfLifeDays = null } = {}) {
    const { rows: [p] } = await db.query(
      `INSERT INTO products (name, price, cost_price, track_batches, shelf_life_days, status)
       VALUES ($1, 100, 40, true, $2, 'active') RETURNING id`,
      [name, shelfLifeDays]
    );
    return p.id;
  }
  async function makeNormalProduct(name) {
    const { rows: [p] } = await db.query(
      `INSERT INTO products (name, price, cost_price, status) VALUES ($1, 100, 40, 'active') RETURNING id`,
      [name]
    );
    return p.id;
  }
  // Seed a batch AND bump outlet_stock by the same qty (keeps the invariant true
  // at setup, exactly like a real GRN receive would).
  async function seedBatch(productId, outletId, { batchNumber, expiry = null, qty, unitCost = 40, lotType = "batch" }) {
    const { rows: [b] } = await db.query(
      `INSERT INTO stock_batches
         (product_id, outlet_id, lot_type, batch_number, expiry_date, received_qty, remaining_qty, unit_cost)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7) RETURNING id`,
      [productId, outletId, lotType, batchNumber, expiry, qty, unitCost]
    );
    await db.query(
      `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1,$2,$3)
       ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $3`,
      [productId, outletId, qty]
    );
    return b.id;
  }
  async function stockOf(productId, outletId) {
    const { rows: [r] } = await db.query(
      "SELECT COALESCE(quantity,0) AS q FROM outlet_stock WHERE product_id=$1 AND outlet_id=$2",
      [productId, outletId]
    );
    return r ? Number(r.q) : 0;
  }
  async function batchSum(productId, outletId) {
    const { rows: [r] } = await db.query(
      "SELECT COALESCE(SUM(remaining_qty),0) AS s FROM stock_batches WHERE product_id=$1 AND outlet_id=$2 AND status='active'",
      [productId, outletId]
    );
    return Number(r.s);
  }
  async function assertInvariant(productId, outletId) {
    const stock = await stockOf(productId, outletId);
    const sum = await batchSum(productId, outletId);
    expect(sum).toBeCloseTo(stock, 4);
  }
  async function batches(productId, outletId) {
    const { rows } = await db.query(
      `SELECT id, batch_number, expiry_date, remaining_qty, status, unit_cost
         FROM stock_batches WHERE product_id=$1 AND outlet_id=$2 ORDER BY id`,
      [productId, outletId]
    );
    return rows;
  }
  function sale(items, extra = {}) {
    const total = items.reduce((s, it) => s + it.price * it.quantity, 0);
    return request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({
        outlet_id: 1,
        employee_id: 1,
        cartItems: items,
        payments: [{ method: "cash", amount: total }],
        idempotency_key: "f07-" + Math.random().toString(36).slice(2),
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
    require("../../routes/purchase-orders")(app, deps);
    require("../../routes/batches")(app, deps);
    app.use(require("../../routes/tier4/crm")(deps));

    await db.query(
      "INSERT INTO feature_flags (key, enabled) VALUES ('batch_expiry_tracking', true) ON CONFLICT (key) DO UPDATE SET enabled = true"
    );
    await db.query(
      "INSERT INTO feature_flags (key, enabled) VALUES ('crm_quotations', true) ON CONFLICT (key) DO UPDATE SET enabled = true"
    );

    await request(app).post("/api/shifts/open").set("x-employee-id", "1")
      .send({ outlet_id: 1, opening_float: 500, denominations: [] });
    await request(app).post("/api/attendance/pin-checkin")
      .send({ pin_code: "2580", outlet_id: 1 });
  }, 30000);

  afterAll(async () => { await cleanup(); });

  // ── GRN capture ───────────────────────────────────────────────────────
  it("GRN (PO receive) captures a batch + expiry in the same tx as the stock bump", async () => {
    const pid = await makeTrackedProduct("GRN Milk", { shelfLifeDays: 7 });
    const { rows: [sup] } = await db.query(
      "INSERT INTO suppliers (name) VALUES ('Dairy Co') RETURNING id"
    );
    const { rows: [po] } = await db.query(
      "INSERT INTO purchase_orders (supplier_id, status, total_cost) VALUES ($1,'Approved',400) RETURNING id",
      [sup.id]
    );
    await db.query(
      "INSERT INTO purchase_order_items (po_id, product_id, quantity, cost_price) VALUES ($1,$2,10,40)",
      [po.id, pid]
    );

    const res = await request(app)
      .post(`/api/purchase-orders/${po.id}/receive`)
      .set("x-employee-id", "1")
      .send({ outlet_id: 1, items: [{ product_id: pid, qty_received: 10, batch_number: "LOT-A", expiry_date: "2026-08-01" }] });
    expect(res.status).toBe(200);

    const bs = await batches(pid, 1);
    expect(bs).toHaveLength(1);
    expect(bs[0].batch_number).toBe("LOT-A");
    expect(Number(bs[0].remaining_qty)).toBe(10);
    await assertInvariant(pid, 1);
    // a receive movement was recorded
    const { rows: mv } = await db.query(
      "SELECT movement_type, quantity FROM batch_movements WHERE batch_id=$1", [bs[0].id]
    );
    expect(mv.some((m) => m.movement_type === "receive" && Number(m.quantity) === 10)).toBe(true);
  });

  it("GRN auto-suggests expiry from shelf_life_days when none supplied", async () => {
    const pid = await makeTrackedProduct("GRN Yogurt", { shelfLifeDays: 5 });
    const { rows: [sup] } = await db.query("INSERT INTO suppliers (name) VALUES ('Dairy Two') RETURNING id");
    const { rows: [po] } = await db.query(
      "INSERT INTO purchase_orders (supplier_id, status, total_cost) VALUES ($1,'Approved',80) RETURNING id", [sup.id]
    );
    await db.query("INSERT INTO purchase_order_items (po_id, product_id, quantity, cost_price) VALUES ($1,$2,2,40)", [po.id, pid]);
    await request(app).post(`/api/purchase-orders/${po.id}/receive`).set("x-employee-id", "1")
      .send({ outlet_id: 1, items: [{ product_id: pid, qty_received: 2 }] });
    const bs = await batches(pid, 1);
    expect(bs).toHaveLength(1);
    expect(bs[0].expiry_date).not.toBeNull(); // auto-suggested
  });

  // ── POS FEFO split ────────────────────────────────────────────────────
  it("POS sale consumes FEFO, splitting across the expiry boundary; invariant holds", async () => {
    const pid = await makeTrackedProduct("Mithai");
    const b1 = await seedBatch(pid, 1, { batchNumber: "B1", expiry: "2026-07-08", qty: 4 });
    const b2 = await seedBatch(pid, 1, { batchNumber: "B2", expiry: "2026-07-12", qty: 6 });
    // stock now 10, batches sum 10
    const res = await sale([{ id: pid, name: "Mithai", price: 100, quantity: 5, cost_price: 40 }]);
    expect(res.status).toBe(200);

    const bs = await batches(pid, 1);
    const b1row = bs.find((b) => b.id === b1);
    const b2row = bs.find((b) => b.id === b2);
    expect(Number(b1row.remaining_qty)).toBe(0);        // sooner-expiry fully consumed first
    expect(b1row.status).toBe("depleted");
    expect(Number(b2row.remaining_qty)).toBe(5);        // remainder from later batch
    await assertInvariant(pid, 1);

    const { rows: mv } = await db.query(
      "SELECT batch_id, quantity FROM batch_movements WHERE movement_type='sale' AND batch_id = ANY($1::int[])",
      [[b1, b2]]
    );
    expect(mv.find((m) => m.batch_id === b1)).toBeTruthy();
    expect(mv.find((m) => m.batch_id === b2)).toBeTruthy();
  });

  it("POS void returns units to the original batch; invariant holds", async () => {
    const pid = await makeTrackedProduct("Void Cake");
    await seedBatch(pid, 1, { batchNumber: "VB1", expiry: "2026-07-20", qty: 5 });
    const res = await sale([{ id: pid, name: "Void Cake", price: 100, quantity: 3, cost_price: 40 }]);
    const saleId = res.body.saleId;
    expect(saleId).toBeTruthy();
    expect(await stockOf(pid, 1)).toBe(2);
    await assertInvariant(pid, 1);

    const vres = await request(app).put(`/api/sales/${saleId}/void`).set("x-employee-id", "1").send({ void_reason: "test" });
    expect(vres.status).toBe(200);
    expect(await stockOf(pid, 1)).toBe(5);
    await assertInvariant(pid, 1);
  });

  it("return restocks into the original batch; invariant holds", async () => {
    const pid = await makeTrackedProduct("Return Bread");
    await seedBatch(pid, 1, { batchNumber: "RB1", expiry: "2026-07-15", qty: 6 });
    const res = await sale([{ id: pid, name: "Return Bread", price: 100, quantity: 4, cost_price: 40 }]);
    const saleId = res.body.saleId;
    expect(await stockOf(pid, 1)).toBe(2);

    const rret = await request(app).post("/api/returns").set("x-employee-id", "1").send({
      original_sale_id: saleId,
      outlet_id: 1,
      total_refund: 200,
      refund_method: "cash",
      items: [{ product_id: pid, quantity: 2, refund_price: 100 }],
    });
    expect(rret.status).toBe(200);
    expect(await stockOf(pid, 1)).toBe(4);
    await assertInvariant(pid, 1);
  });

  // ── transfer preserves identity ───────────────────────────────────────
  it("transfer moves batch IDENTITY (number + expiry + cost) to destination; invariant holds at both outlets", async () => {
    const pid = await makeTrackedProduct("Transfer Mithai");
    await seedBatch(pid, 1, { batchNumber: "TB1", expiry: "2026-07-09", qty: 10, unitCost: 55 });

    const res = await request(app).post("/api/transfers").set("x-employee-id", "1").send({
      product_id: pid, from_outlet_id: 1, to_outlet_id: 2, quantity: 3, employee_id: 1,
    });
    expect(res.status).toBe(200);

    const src = await batches(pid, 1);
    const dst = await batches(pid, 2);
    expect(Number(src[0].remaining_qty)).toBe(7);
    expect(dst).toHaveLength(1);
    expect(dst[0].batch_number).toBe("TB1");          // identity preserved
    expect(Number(dst[0].unit_cost)).toBe(55);        // cost preserved
    expect(dst[0].expiry_date).not.toBeNull();        // expiry preserved (not anonymised)
    expect(Number(dst[0].remaining_qty)).toBe(3);
    await assertInvariant(pid, 1);
    await assertInvariant(pid, 2);
  });

  // ── adjustment write-off ──────────────────────────────────────────────
  it("adjustment write-off FEFO-consumes batches; invariant holds", async () => {
    const pid = await makeTrackedProduct("WriteOff Milk");
    await seedBatch(pid, 1, { batchNumber: "WB1", expiry: "2026-07-06", qty: 8 });

    const res = await request(app).post("/api/adjustments").set("x-employee-id", "1").send({
      product_id: pid, outlet_id: 1, employee_id: 1, quantity_change: -2, reason: "expired stock",
    });
    expect(res.status).toBe(200);
    expect(await stockOf(pid, 1)).toBe(6);
    await assertInvariant(pid, 1);
    const { rows: mv } = await db.query(
      "SELECT movement_type FROM batch_movements bm JOIN stock_batches sb ON sb.id=bm.batch_id WHERE sb.product_id=$1 AND bm.movement_type='write_off'",
      [pid]
    );
    expect(mv.length).toBeGreaterThan(0);
  });

  // ── kit of a tracked component ────────────────────────────────────────
  it("kit sale consumes a tracked component's batch; invariant holds for the component", async () => {
    const comp = await makeTrackedProduct("Tracked Flour");
    await seedBatch(comp, 1, { batchNumber: "KF1", expiry: "2026-07-30", qty: 20 });
    const { rows: [kit] } = await db.query(
      `INSERT INTO products (name, price, cost_price, bom_type, is_bundle, status)
       VALUES ('Cake Kit', 300, 0, 'kit', true, 'active') RETURNING id`
    );
    await db.query(
      "INSERT INTO product_bundles (product_id, component_product_id, quantity) VALUES ($1,$2,2)",
      [kit.id, comp]
    );
    const res = await sale([{ id: kit.id, name: "Cake Kit", price: 300, quantity: 3, cost_price: 0 }]);
    expect(res.status).toBe(200);
    // 3 kits × 2 flour = 6 consumed → 14 left
    expect(await stockOf(comp, 1)).toBe(14);
    await assertInvariant(comp, 1);
  });

  // ── untracked regression ──────────────────────────────────────────────
  it("untracked product walkthrough is completely unchanged (no batch rows, no movements)", async () => {
    const pid = await makeNormalProduct("Plain Bolt");
    await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1,1,10)", [pid]);
    const res = await sale([{ id: pid, name: "Plain Bolt", price: 100, quantity: 3, cost_price: 40 }]);
    expect(res.status).toBe(200);
    expect(await stockOf(pid, 1)).toBe(7);
    const { rows: bs } = await db.query("SELECT id FROM stock_batches WHERE product_id=$1", [pid]);
    expect(bs).toHaveLength(0); // never created a batch
    const drift = await batchStock.getDrift(db, {});
    expect(drift.find((d) => d.product_id === pid)).toBeUndefined(); // untracked excluded
  });

  // ── quotation-convert exclusion ───────────────────────────────────────
  it("quotation-convert hard-rejects a batch-tracked product (unsafe unlocked decrement)", async () => {
    const pid = await makeTrackedProduct("Quote Widget");
    await seedBatch(pid, 1, { batchNumber: "QB1", expiry: "2026-07-25", qty: 5 });
    const { rows: [q] } = await db.query(
      `INSERT INTO quotations (quote_number, outlet_id, status, subtotal, total_amount)
       VALUES ($1, 1, 'accepted', 100, 100) RETURNING id`,
      ["Q-" + Date.now()]
    );
    await db.query(
      "INSERT INTO quotation_items (quotation_id, product_id, quantity, unit_price) VALUES ($1,$2,1,100)",
      [q.id, pid]
    );
    const res = await request(app).post(`/api/quotations/${q.id}/convert`).set("x-employee-id", "1")
      .send({ payment_method: "cash" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("batch_tracked_not_supported");
    // stock + batches untouched (transaction rolled back)
    expect(await stockOf(pid, 1)).toBe(5);
    await assertInvariant(pid, 1);
  });

  // ── concurrency: parallel drain of one batch ──────────────────────────
  it("parallel drain of one batch → no negative remaining_qty, invariant holds", async () => {
    const pid = await makeTrackedProduct("Race Batch");
    await seedBatch(pid, 1, { batchNumber: "RC1", expiry: "2026-07-11", qty: 1 });

    const c1 = await dbpg.pool.connect();
    const c2 = await dbpg.pool.connect();
    try {
      await c1.query(`SET search_path = "${schemaName}"`);
      await c2.query(`SET search_path = "${schemaName}"`);
      // Mirror the sales.js discipline: lock outlet_stock FOR UPDATE, guard on
      // availability, decrement, then consumeBatches — all in one tx.
      const attempt = async (c) => {
        try {
          await c.query("BEGIN");
          const { rows: [s] } = await c.query(
            "SELECT quantity FROM outlet_stock WHERE product_id=$1 AND outlet_id=1 FOR UPDATE", [pid]
          );
          if (!s || Number(s.quantity) < 1) throw Object.assign(new Error("insufficient"), { code: "insufficient_stock" });
          await c.query("UPDATE outlet_stock SET quantity = quantity - 1 WHERE product_id=$1 AND outlet_id=1", [pid]);
          await batchStock.consumeBatches(c, { productId: pid, outletId: 1, qty: 1, refType: "sale", refId: null });
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
    } finally {
      c1.release();
      c2.release();
    }
    expect(await stockOf(pid, 1)).toBe(0);
    expect(await batchSum(pid, 1)).toBe(0);
    // CHECK (remaining_qty >= 0) never violated → no batch went negative
    const { rows } = await db.query("SELECT MIN(remaining_qty) AS m FROM stock_batches WHERE product_id=$1", [pid]);
    expect(Number(rows[0].m)).toBeGreaterThanOrEqual(0);
  });

  // ── batch surfaces: expiring-soon, drill-down, drift, write-off ────────
  it("GET /api/batches/expiring lists batches within the window with days_to_expiry", async () => {
    const pid = await makeTrackedProduct("Expiring Yogurt");
    const soon = new Date(); soon.setDate(soon.getDate() + 3);
    const soonStr = soon.toISOString().slice(0, 10);
    const far = new Date(); far.setDate(far.getDate() + 90);
    await seedBatch(pid, 1, { batchNumber: "EXP-SOON", expiry: soonStr, qty: 4 });
    await seedBatch(pid, 1, { batchNumber: "EXP-FAR", expiry: far.toISOString().slice(0, 10), qty: 4 });

    const res = await request(app).get("/api/batches/expiring?days=7").set("x-employee-id", "1");
    expect(res.status).toBe(200);
    const mine = res.body.batches.filter((b) => b.product_id === pid);
    expect(mine).toHaveLength(1); // only the soon one falls in the 7-day window
    expect(mine[0].batch_number).toBe("EXP-SOON");
    expect(mine[0].days_to_expiry).toBe(3);
  });

  it("GET /api/products/:id/batches drills down to active batches", async () => {
    const pid = await makeTrackedProduct("Drilldown Milk");
    await seedBatch(pid, 1, { batchNumber: "DD1", expiry: "2026-07-30", qty: 5 });
    await seedBatch(pid, 1, { batchNumber: "DD2", expiry: "2026-08-30", qty: 5 });
    const res = await request(app).get(`/api/products/${pid}/batches?outlet_id=1`).set("x-employee-id", "1");
    expect(res.status).toBe(200);
    expect(res.body.batches).toHaveLength(2);
    expect(res.body.batches[0].batch_number).toBe("DD1"); // FEFO order
  });

  it("POST /api/batches/:id/write-off removes the batch's stock; invariant holds", async () => {
    const pid = await makeTrackedProduct("Expired Cheese");
    const bid = await seedBatch(pid, 1, { batchNumber: "OLD1", expiry: "2020-01-01", qty: 6 });
    const res = await request(app).post(`/api/batches/${bid}/write-off`).set("x-employee-id", "1")
      .send({ reason: "expired stock" });
    expect(res.status).toBe(200);
    expect(res.body.written_off).toBe(6);
    expect(await stockOf(pid, 1)).toBe(0);
    await assertInvariant(pid, 1);
    const { rows: [b] } = await db.query("SELECT status FROM stock_batches WHERE id=$1", [bid]);
    expect(b.status).toBe("written_off");
  });

  it("GET /api/batches/drift is clean (invariant enforcer)", async () => {
    const res = await request(app).get("/api/batches/drift").set("x-employee-id", "1");
    expect(res.status).toBe(200);
    expect(res.body.clean).toBe(true);
  });

  it("expiry worker raises a near-expiry notification for expiring batches", async () => {
    const pid = await makeTrackedProduct("Worker Milk");
    const soon = new Date(); soon.setDate(soon.getDate() + 2);
    await seedBatch(pid, 1, { batchNumber: "WK1", expiry: soon.toISOString().slice(0, 10), qty: 3 });
    const before = (await db.query("SELECT COUNT(*) AS c FROM notifications WHERE type='batch_expiring'")).rows[0].c;
    const found = await runExpiryScanForDb({ db, windowDays: 7 });
    expect(found).toBeGreaterThan(0);
    const after = (await db.query("SELECT COUNT(*) AS c FROM notifications WHERE type='batch_expiring'")).rows[0].c;
    expect(Number(after)).toBeGreaterThan(Number(before));
  });

  // ── P1: textile rolls (manual batch pick, decimal length) ──────────────
  it("POS sale of a partial roll decrements the CHOSEN roll (manual batch pick); invariant holds", async () => {
    const pid = await makeTrackedProduct("Lawn Fabric");
    const roll1 = await seedBatch(pid, 1, { batchNumber: "ROLL-1", expiry: null, qty: 25, unitCost: 30, lotType: "roll" });
    const roll2 = await seedBatch(pid, 1, { batchNumber: "ROLL-2", expiry: null, qty: 18, unitCost: 30, lotType: "roll" });
    // Cashier cuts 3.5 m off ROLL-2 specifically (not FEFO — manual pick).
    const res = await sale([{ id: pid, name: "Lawn Fabric", price: 200, quantity: 3.5, cost_price: 30, batch_id: roll2 }]);
    expect(res.status).toBe(200);
    const bs = await batches(pid, 1);
    expect(Number(bs.find((b) => b.id === roll1).remaining_qty)).toBe(25);   // untouched
    expect(Number(bs.find((b) => b.id === roll2).remaining_qty)).toBe(14.5); // 18 - 3.5 (remnant)
    await assertInvariant(pid, 1);
  });

  it("GET /api/batches/cost-flow reports actual batch COGS for tracked products", async () => {
    const pid = await makeTrackedProduct("CostFlow Milk");
    await seedBatch(pid, 1, { batchNumber: "CF1", expiry: "2026-07-28", qty: 10, unitCost: 42 });
    await sale([{ id: pid, name: "CostFlow Milk", price: 100, quantity: 4, cost_price: 40 }]);
    const res = await request(app).get("/api/batches/cost-flow").set("x-employee-id", "1");
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r) => r.product_id === pid);
    expect(row).toBeTruthy();
    expect(row.qty_consumed).toBe(4);
    expect(row.actual_cogs).toBe(168); // 4 × 42 (actual batch cost, not the 40 product cost)
    expect(row.avg_actual_unit_cost).toBe(42);
  });

  // ── products API persists the opt-in (ProductForm wiring) ──────────────
  it("POST/PUT /api/products persists track_batches + shelf_life_days", async () => {
    const created = await request(app).post("/api/products").set("x-employee-id", "1").send({
      name: "API Tracked Milk", price: 120, cost_price: 40,
      track_batches: true, shelf_life_days: 5,
    });
    expect([200, 201]).toContain(created.status);
    const pid = created.body.id;
    let detail = await request(app).get(`/api/products/${pid}`).set("x-employee-id", "1");
    expect(detail.body.product.track_batches).toBe(true);
    expect(Number(detail.body.product.shelf_life_days)).toBe(5);

    const upd = await request(app).put(`/api/products/${pid}`).set("x-employee-id", "1").send({ track_batches: false });
    expect(upd.status).toBe(200);
    detail = await request(app).get(`/api/products/${pid}`).set("x-employee-id", "1");
    expect(detail.body.product.track_batches).toBe(false);
  });

  // ── final drift check ─────────────────────────────────────────────────
  it("drift-check report is clean after the whole walkthrough", async () => {
    const drift = await batchStock.getDrift(db, {});
    expect(drift).toEqual([]);
  });
});
