/**
 * ots-offline.test.js — One Toy Store pilot, blocker 3 (offline counter).
 * docs/onetoystore-pilot/PROGRESS.md, Blocker 3 (3a, 3c, 3e, 3f).
 *
 *  3a  the counter keeps a copy of the catalogue: GET /api/products/catalogue
 *  3c  a sale replayed twice is booked once
 *  3e  an offline sale replayed past SanoPOS's stock is ACCEPTED (owner, 2026-09-26):
 *      stock goes negative, the sale is marked and the items are reported back.
 *      A live sale keeps the stock check.
 *  3f  an offline sale lands when and where it happened: its own time and the
 *      till session that was open then, even if that till has since closed.
 *
 * An "offline replay" is a POST /api/sales carrying idempotency_key AND
 * offline_sold_at (the moment the cashier rang it up), as the POS queue sends.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const ADMIN_PIN = "2580";
const num = (v) => (v === null || v === undefined ? v : Number(v));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const admin = () => makeRequest(app, ADMIN_ID);
let seq = 0;
const key = () => `ots-offline-${Date.now()}-${++seq}`;

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function closeAnyOpenTill() {
  for (const s of await all("SELECT id FROM cash_shifts WHERE status = 'open'")) {
    await db.query("UPDATE cash_shifts SET status = 'closed', closed_at = NOW() WHERE id = $1", [s.id]);
  }
}

async function openTill(outletId = 1, float = 500) {
  const open = await one("SELECT id FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' LIMIT 1", [outletId]);
  let shiftId = open?.id;
  if (!shiftId) {
    const res = await admin().post("/api/shifts/open").send({ outlet_id: outletId, employee_id: ADMIN_ID, opening_float: float });
    expect(res.status).toBe(200);
    shiftId = res.body.shift_id ?? res.body.id;
  }
  const att = await makeRequest(app).post("/api/attendance/pin-checkin").send({ pin_code: ADMIN_PIN, outlet_id: outletId });
  if (![200, 400].includes(att.status)) throw new Error(`clock-in ${att.status}`);
  return shiftId;
}

async function setStock(productId, qty, outletId = 1) {
  await db.query(
    `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
    [productId, outletId, qty],
  );
}

function replay(body) {
  return admin().post("/api/sales").send({
    outlet_id: 1,
    employee_id: ADMIN_ID,
    idempotency_key: key(),
    offline_sold_at: new Date().toISOString(),
    ...body,
  });
}

// ─── 3a ─────────────────────────────────────────────────────────────────────
describe("3a — the catalogue copy the counter keeps offline", () => {
  let variantId;
  beforeAll(async () => {
    await db.query("UPDATE products SET has_variants = true, sku = 'HW-ASSORT' WHERE id = 3");
    const { rows: [v] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, barcode, price, cost_price, stock)
       VALUES (3, 'HW-CAR-7', '8901234567897', 450, 222, 4) RETURNING id`,
    );
    variantId = v.id;
    const { rows: [set] } = await db.query(`INSERT INTO attribute_sets (name) VALUES ('OTS cars') RETURNING id`);
    const { rows: [attr] } = await db.query(`INSERT INTO attributes (name, attribute_set_id) VALUES ('Model', $1) RETURNING id`, [set.id]);
    const { rows: [opt] } = await db.query(
      `INSERT INTO attribute_options (attribute_id, value) VALUES ($1, 'Twin Mill') RETURNING id`, [attr.id]);
    await db.query(
      `INSERT INTO variant_option_values (variant_id, attribute_id, attribute_option_id) VALUES ($1, $2, $3)`,
      [variantId, attr.id, opt.id]);
    await db.query(
      `INSERT INTO products (name, price, cost_price, barcode, sku, deleted_at) VALUES ('Gone', 10, 5, 'GONE-1', 'GONE', NOW())`);
  });

  it("lists every live product and variant with its codes and price, never cost or stock", async () => {
    const res = await admin().get("/api/products/catalogue");
    expect(res.status).toBe(200);
    const { products, variants } = res.body;

    const widget = products.find((p) => p.id === 1);
    expect(widget).toMatchObject({ name: "Widget A", barcode: "PROD-001" });
    expect(num(widget.price)).toBe(100);
    expect(num(widget.effectiveTaxRate)).toBe(17);
    expect(products.find((p) => p.barcode === "GONE-1")).toBeUndefined();

    const car = variants.find((v) => v.id === variantId);
    expect(car).toMatchObject({ product_id: 3, sku: "HW-CAR-7", barcode: "8901234567897" });
    expect(num(car.price)).toBe(450);
    expect(car.options).toEqual([{ attribute_name: "Model", option_value: "Twin Mill" }]);

    for (const row of [...products, ...variants]) {
      expect(row).not.toHaveProperty("cost_price");
      expect(row).not.toHaveProperty("stock");
      expect(row).not.toHaveProperty("local_stock");
      expect(row).not.toHaveProperty("description_html");
    }
  });

  it("answers 304 when the counter's copy is already current", async () => {
    const first = await admin().get("/api/products/catalogue");
    expect(first.headers.etag).toBeTruthy();
    const again = await admin().get("/api/products/catalogue").set("If-None-Match", first.headers.etag);
    expect(again.status).toBe(304);

    await db.query("UPDATE products SET price = 101 WHERE id = 1");
    const changed = await admin().get("/api/products/catalogue").set("If-None-Match", first.headers.etag);
    expect(changed.status).toBe(200);
    await db.query("UPDATE products SET price = 100 WHERE id = 1");
  });

  it("carries its version in the body, and ?version= answers 304 (a browser can't read the ETag cross-origin)", async () => {
    const first = await admin().get("/api/products/catalogue");
    expect(first.body.version).toMatch(/^[0-9a-f]{40}$/);
    const again = await admin().get(`/api/products/catalogue?version=${first.body.version}`);
    expect(again.status).toBe(304);
    const stale = await admin().get("/api/products/catalogue?version=old");
    expect(stale.status).toBe(200);
    expect(stale.body.version).toBe(first.body.version);
  });
});

// ─── 3e ─────────────────────────────────────────────────────────────────────
describe("3e — an offline sale replayed past SanoPOS's stock is accepted", () => {
  beforeAll(async () => { await closeAnyOpenTill(); await openTill(); });

  it("a live sale over stock is still refused", async () => {
    await setStock(4, 1);
    const res = await admin().post("/api/sales").send({
      outlet_id: 1, employee_id: ADMIN_ID, idempotency_key: key(),
      cartItems: [{ id: 4, quantity: 3, price: 50 }], payments: [{ method: "Cash", amount: 150 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("insufficient_stock");
    expect(num((await one("SELECT quantity FROM outlet_stock WHERE product_id = 4 AND outlet_id = 1")).quantity)).toBe(1);
  });

  it("an offline replay over stock is booked, stock goes negative, and the item is reported", async () => {
    await setStock(4, 1);
    const res = await replay({ cartItems: [{ id: 4, quantity: 3, price: 50 }], payments: [{ method: "Cash", amount: 150 }] });
    expect(res.status).toBe(200);
    expect(res.body.sold_past_stock).toEqual([
      expect.objectContaining({ product_id: 4, variant_id: null, name: "Snack D", available: 1, requested: 3 }),
    ]);
    expect(num((await one("SELECT quantity FROM outlet_stock WHERE product_id = 4 AND outlet_id = 1")).quantity)).toBe(-2);
    const sale = await one("SELECT offline_sold_at, offline_past_stock FROM sales WHERE id = $1", [res.body.saleId]);
    expect(sale.offline_sold_at).not.toBeNull();
    expect(sale.offline_past_stock).toEqual([expect.objectContaining({ product_id: 4, requested: 3 })]);
  });

  it("works for a variant, and for an item with no stock row at this outlet", async () => {
    const { rows: [v] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, barcode, price, cost_price, stock) VALUES (2, 'WB-BLUE', 'WB-BLUE-BC', 200, 120, 0) RETURNING id`);
    await db.query("INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity) VALUES ($1, 1, 0)", [v.id]);
    await db.query("DELETE FROM outlet_stock WHERE product_id = 5 AND outlet_id = 1");

    const res = await replay({
      cartItems: [
        { id: v.id, original_product_id: 2, variant_id: v.id, quantity: 1, price: 200 },
        { id: 5, quantity: 2, price: 75 },
      ],
      payments: [{ method: "Card", amount: 350 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.sold_past_stock.map((r) => [r.product_id, r.variant_id])).toEqual([[2, v.id], [5, null]]);
    expect(num((await one("SELECT quantity FROM variant_outlet_stock WHERE variant_id = $1 AND outlet_id = 1", [v.id])).quantity)).toBe(-1);
    expect(num((await one("SELECT quantity FROM outlet_stock WHERE product_id = 5 AND outlet_id = 1")).quantity)).toBe(-2);
  });

  it("an offline replay within stock carries no past-stock report", async () => {
    await setStock(1, 50);
    const res = await replay({ cartItems: [{ id: 1, quantity: 1, price: 100 }], payments: [{ method: "Card", amount: 100 }] });
    expect(res.status).toBe(200);
    expect(res.body.sold_past_stock).toEqual([]);
    expect((await one("SELECT offline_past_stock FROM sales WHERE id = $1", [res.body.saleId])).offline_past_stock).toBeNull();
  });
});

// ─── 3c ─────────────────────────────────────────────────────────────────────
describe("3c — a queued sale sent twice is booked once", () => {
  beforeAll(async () => { await closeAnyOpenTill(); await openTill(); });

  it("the second copy is acknowledged as a duplicate and stock moves once", async () => {
    await setStock(1, 10);
    const body = {
      outlet_id: 1, employee_id: ADMIN_ID, idempotency_key: key(), offline_sold_at: new Date().toISOString(),
      cartItems: [{ id: 1, quantity: 2, price: 100 }], payments: [{ method: "Card", amount: 200 }],
    };
    const first = await admin().post("/api/sales").send(body);
    const second = await admin().post("/api/sales").send(body);
    expect(first.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.saleId).toBe(first.body.saleId);
    expect(num((await one("SELECT COUNT(*)::int AS n FROM sales WHERE idempotency_key = $1", [body.idempotency_key])).n)).toBe(1);
    expect(num((await one("SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1")).quantity)).toBe(8);
  });
});

// ─── 3f ─────────────────────────────────────────────────────────────────────
describe("3f — an offline sale lands when and where it happened", () => {
  let oldShiftId, newShiftId, soldAt;

  beforeAll(async () => {
    await closeAnyOpenTill();
    await setStock(1, 50);
    // Yesterday's till: opened 09:00, rang a bill offline at 21:50, closed 22:00
    // before the internet came back. Today's till is open when the sale syncs.
    const { rows: [old] } = await db.query(
      `INSERT INTO cash_shifts (outlet_id, employee_id, opening_float, status, opened_at, closed_at)
       VALUES (1, $1, 500, 'closed', NOW() - INTERVAL '1 day' - INTERVAL '13 hours',
               NOW() - INTERVAL '1 day') RETURNING id, opened_at, closed_at`, [ADMIN_ID]);
    oldShiftId = old.id;
    soldAt = new Date(new Date(old.closed_at).getTime() - 10 * 60 * 1000); // 10 min before close
    newShiftId = await openTill();
    expect(newShiftId).not.toBe(oldShiftId);
  });

  it("keeps the time it was rung up and goes into that till, even though it has closed", async () => {
    const res = await replay({
      offline_sold_at: soldAt.toISOString(), shift_id: oldShiftId,
      cartItems: [{ id: 1, quantity: 1, price: 100 }], payments: [{ method: "Cash", amount: 100 }],
    });
    expect(res.status).toBe(200);
    const sale = await one("SELECT shift_id, timestamp FROM sales WHERE id = $1", [res.body.saleId]);
    expect(sale.shift_id).toBe(oldShiftId);
    expect(new Date(sale.timestamp).getTime()).toBe(soldAt.getTime());
    // The sync notice names the till that was already closed.
    expect(res.body.till_closed).toEqual(expect.objectContaining({ shift_id: oldShiftId }));
  });

  it("finds the till by time when the queued sale doesn't name one", async () => {
    const res = await replay({
      offline_sold_at: soldAt.toISOString(),
      cartItems: [{ id: 1, quantity: 1, price: 100 }], payments: [{ method: "Card", amount: 100 }],
    });
    expect(res.status).toBe(200);
    expect((await one("SELECT shift_id FROM sales WHERE id = $1", [res.body.saleId])).shift_id).toBe(oldShiftId);
  });

  it("a stale till id (the sale's time is outside that till) is ignored: the till open at that time is used", async () => {
    // e.g. a counter reloaded offline and remembered last week's till.
    const { rows: [week] } = await db.query(
      `INSERT INTO cash_shifts (outlet_id, employee_id, opening_float, status, opened_at, closed_at)
       VALUES (1, $1, 0, 'closed', NOW() - INTERVAL '8 days', NOW() - INTERVAL '7 days') RETURNING id`, [ADMIN_ID]);
    const res = await replay({
      offline_sold_at: soldAt.toISOString(), shift_id: week.id,
      cartItems: [{ id: 1, quantity: 1, price: 100 }], payments: [{ method: "Card", amount: 100 }],
    });
    expect(res.status).toBe(200);
    const sale = await one("SELECT shift_id, timestamp FROM sales WHERE id = $1", [res.body.saleId]);
    expect(sale.shift_id).toBe(oldShiftId);
    expect(new Date(sale.timestamp).getTime()).toBe(soldAt.getTime());
  });

  it("a sale rung up in the open till lands there with no closed-till notice", async () => {
    const res = await replay({
      shift_id: newShiftId,
      cartItems: [{ id: 1, quantity: 1, price: 100 }], payments: [{ method: "Card", amount: 100 }],
    });
    expect(res.status).toBe(200);
    expect((await one("SELECT shift_id FROM sales WHERE id = $1", [res.body.saleId])).shift_id).toBe(newShiftId);
    expect(res.body.till_closed ?? null).toBeNull();
  });

  it("a counter clock running ahead can't date a sale in the future", async () => {
    const future = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const res = await replay({
      offline_sold_at: future.toISOString(), shift_id: newShiftId,
      cartItems: [{ id: 1, quantity: 1, price: 100 }], payments: [{ method: "Card", amount: 100 }],
    });
    expect(res.status).toBe(200);
    const sale = await one("SELECT timestamp FROM sales WHERE id = $1", [res.body.saleId]);
    expect(new Date(sale.timestamp).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("a replay is booked even if the cashier has clocked out since", async () => {
    await db.query("UPDATE attendance_sessions SET session_end = NOW() WHERE employee_id = $1 AND session_end IS NULL", [ADMIN_ID]);
    const res = await replay({
      shift_id: newShiftId,
      cartItems: [{ id: 1, quantity: 1, price: 100 }], payments: [{ method: "Card", amount: 100 }],
    });
    expect(res.status).toBe(200);
  });
});
