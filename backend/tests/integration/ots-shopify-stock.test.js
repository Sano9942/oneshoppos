/**
 * ots-shopify-stock.test.js — One Toy Store pilot blocker 2: keeping Shopify's
 * stock counts equal to SanoPOS's (docs/onetoystore-pilot/PROGRESS.md, 2a–2g).
 *
 * The real Shopify client code runs (shopify/client.js); only the network is
 * replaced by an in-memory fake Shopify that behaves like the Admin API for the
 * calls we make: read "available" per item and location, set it with a
 * compare-and-set, and apply +/- changes. Nothing here talks to a real store.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");
const shopifyClient = require("../../shopify/client");
const stockCheck = require("../../shopify/stock-check");

let app, db, cleanup;
const ADMIN_PIN = "2580";
const LOC = "gid://shopify/Location/9001";
const item = (n) => `gid://shopify/InventoryItem/${n}`;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const admin = () => makeRequest(app, ADMIN_ID);

// ─── Fake Shopify ──────────────────────────────────────────────────────────
const shop = {
  known: new Set(), // inventory item gids Shopify knows
  levels: new Map(), // `${item}|${location}` -> available (absent = not stocked there)
  calls: [],
  beforeNextSet: null, // simulate an online order landing between our read and our set
  reset() {
    this.known.clear();
    this.levels.clear();
    this.calls = [];
    this.beforeNextSet = null;
  },
  stock(itemGid, qty, loc = LOC) {
    this.known.add(itemGid);
    this.levels.set(`${itemGid}|${loc}`, qty);
  },
  qty(itemGid, loc = LOC) {
    return this.levels.get(`${itemGid}|${loc}`);
  },
  sets() {
    return this.calls.filter((c) => c.query.includes("inventorySetQuantities"));
  },
};

function fakeShopifyFetch(url, init) {
  const { query, variables } = JSON.parse(init.body);
  shop.calls.push({ query, variables });
  let data;
  let errors;
  if (query.includes("InventoryLevels")) {
    data = {
      nodes: variables.ids.map((id) => {
        if (!shop.known.has(id)) return null;
        const k = `${id}|${variables.locationId}`;
        return {
          id,
          inventoryLevel: shop.levels.has(k)
            ? { id: `lvl-${k}`, quantities: [{ name: "available", quantity: shop.levels.get(k) }] }
            : null,
        };
      }),
    };
  } else if (query.includes("inventorySetQuantities")) {
    if (shop.beforeNextSet) {
      const f = shop.beforeNextSet;
      shop.beforeNextSet = null;
      f();
    }
    const qs = variables.input.quantities;
    // Shopify applies a set all-or-nothing: one stale compare blocks the batch.
    const stale = qs.filter((q) => {
      const expected = q.compareQuantity ?? q.changeFromQuantity;
      return shop.levels.get(`${q.inventoryItemId}|${q.locationId}`) !== expected;
    });
    if (stale.length) {
      data = {
        inventorySetQuantities: {
          userErrors: stale.map((q) => ({
            code: "COMPARE_QUANTITY_STALE",
            field: ["input", "quantities"],
            message: `The compareQuantity argument no longer matches the persisted quantity for ${q.inventoryItemId}.`,
          })),
        },
      };
    } else {
      for (const q of qs) shop.levels.set(`${q.inventoryItemId}|${q.locationId}`, q.quantity);
      data = { inventorySetQuantities: { userErrors: [] } };
    }
  } else if (query.includes("inventoryAdjustQuantities")) {
    for (const c of variables.input.changes) {
      const k = `${c.inventoryItemId}|${c.locationId}`;
      shop.levels.set(k, (shop.levels.get(k) || 0) + c.delta);
    }
    data = { inventoryAdjustQuantities: { userErrors: [], inventoryAdjustmentGroup: null } };
  } else {
    errors = [{ message: `fake Shopify: unexpected query ${query.slice(0, 60)}` }];
  }
  return Promise.resolve(
    new Response(JSON.stringify(errors ? { errors } : { data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

let realFetch;
beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) =>
    String(url).includes(".myshopify.com/admin/api/")
      ? fakeShopifyFetch(url, init)
      : realFetch(url, init);

  ({ app, db, cleanup } = await createTestApp({
    registerAll: true,
    deps: {
      // Real client code; the fake above stands in for the network.
      adjustShopifyInventory: shopifyClient.adjustShopifyInventory,
      fetchInventoryLevelsBatch: shopifyClient.fetchInventoryLevelsBatch,
      setShopifyInventory: shopifyClient.setShopifyInventory,
    },
  }));

  await db.query(
    `INSERT INTO shopify_connections (shop_domain, access_token, api_version, is_active, webhook_secret)
     VALUES ('ots-test.myshopify.com', 'shpat_fake', '2025-10', true, 'whsec')`,
  );
  await db.query(
    `INSERT INTO shopify_location_map (outlet_id, shopify_location_id, shopify_location_name) VALUES (1, $1, 'Shop')`,
    [LOC],
  );
  // A variant of product 3 ("Hot Wheels"-style): its own shop stock is 2,
  // while the product total at the shop is 20.
  const { rows: [v] } = await db.query(
    `INSERT INTO product_variants (product_id, sku, barcode, price, cost_price, stock)
     VALUES (3, 'HW-RED', 'HW-RED-BC', 500, 300, 2) RETURNING id`,
  );
  await db.query("INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity) VALUES ($1, 1, 2)", [v.id]);
  global.__otsVariantId = v.id;

  // Mappings. Product 1 is stored the way the Shopify import stores it (a full
  // gid); product 2 as a bare number. Both must be read correctly (2g).
  await db.query(
    `INSERT INTO shopify_product_map (product_id, variant_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, is_active)
     VALUES (1, NULL, 'p1', 'v1', $1, true),
            (2, NULL, 'p2', 'v2', '102', true),
            (3, $2, 'p3', 'v3', $3, true),
            (4, NULL, 'p4', 'v4', $4, true),
            (5, NULL, 'p5', 'v5', $5, true)`,
    [item(101), v.id, item(103), item(104), item(105)],
  );
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  delete global.__otsVariantId;
  if (cleanup) await cleanup();
});

async function setLocal(productId, qty, outletId = 1) {
  await db.query("UPDATE outlet_stock SET quantity = $1 WHERE product_id = $2 AND outlet_id = $3", [qty, productId, outletId]);
}

async function resetShop() {
  shop.reset();
  await db.query("DELETE FROM external_sync_events");
  await db.query("DELETE FROM inventory_reconciliation");
}

async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function openTill(outletId = 1) {
  const open = await one("SELECT id FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' LIMIT 1", [outletId]);
  if (!open) {
    const res = await admin().post("/api/shifts/open").send({ outlet_id: outletId, employee_id: ADMIN_ID, opening_float: 500 });
    expect(res.status).toBe(200);
  }
  const att = await makeRequest(app).post("/api/attendance/pin-checkin").send({ pin_code: ADMIN_PIN, outlet_id: outletId });
  if (![200, 400].includes(att.status)) throw new Error(`clock-in ${att.status}`);
}

const outboundEvents = async () =>
  (await all("SELECT id, status, idempotency_key, payload FROM external_sync_events WHERE direction = 'outbound' ORDER BY id"))
    .map((e) => ({ ...e, p: JSON.parse(e.payload || "{}") }));

// ─── 2a / 2d / 2g ──────────────────────────────────────────────────────────
describe("Blocker 2 — Set Shopify to SanoPOS counts", () => {
  beforeEach(resetShop);

  it("sets Shopify to SanoPOS's exact counts (2a), whatever form the Shopify id was saved in (2g)", async () => {
    await setLocal(1, 7);
    await setLocal(2, 30);
    shop.stock(item(101), 3); // stored as a full gid
    shop.stock(item(102), 12); // stored as a bare number
    shop.stock(item(103), 2);
    shop.stock(item(104), 100);
    shop.stock(item(105), 80);

    const res = await admin().post("/api/integrations/shopify/stock/set-to-pos").send({});
    expect(res.status).toBe(200);
    expect(shop.qty(item(101))).toBe(7);
    expect(shop.qty(item(102))).toBe(30);
    expect(res.body.set).toBe(2);
    expect(res.body.mismatch).toBe(0);
    // It sends a count, not a +/- change.
    expect(shop.calls.some((c) => c.query.includes("inventoryAdjustQuantities"))).toBe(false);
    const sent = shop.sets().flatMap((c) => c.variables.input.quantities);
    expect(sent.find((q) => q.inventoryItemId === item(101))).toMatchObject({ quantity: 7, compareQuantity: 3 });
  });

  it("a variant is compared and set with its own shop stock, not the product total (2d)", async () => {
    shop.stock(item(101), 50);
    shop.stock(item(102), 30);
    shop.stock(item(103), 9); // variant: SanoPOS has 2 (product total is 20)
    shop.stock(item(104), 100);
    shop.stock(item(105), 80);
    await setLocal(1, 50);
    await setLocal(2, 30);

    const check = await admin().post("/api/integrations/shopify/reconciliation").send({});
    expect(check.status).toBe(200);
    const row = await one("SELECT local_qty, external_qty, status FROM inventory_reconciliation WHERE variant_id = $1 AND outlet_id = 1", [global.__otsVariantId]);
    expect(Number(row.local_qty)).toBe(2);
    expect(Number(row.external_qty)).toBe(9);
    expect(row.status).toBe("mismatch");

    await admin().post("/api/integrations/shopify/stock/set-to-pos").send({});
    expect(shop.qty(item(103))).toBe(2);
  });

  it("an item Shopify can't read is reported, never counted as 0 and never set (2d)", async () => {
    // item 102 unknown to Shopify; item 104 known but not stocked at the shop.
    shop.stock(item(101), 50);
    shop.known.add(item(104));
    shop.stock(item(103), 2);
    shop.stock(item(105), 80);
    await setLocal(1, 50);

    const res = await admin().post("/api/integrations/shopify/stock/set-to-pos").send({});
    expect(res.status).toBe(200);
    expect(res.body.not_found).toBe(1);
    expect(res.body.not_at_location).toBe(1);
    expect(shop.sets()).toHaveLength(0);
    const unknown = await one("SELECT external_qty, status FROM inventory_reconciliation WHERE product_id = 2 AND outlet_id = 1");
    expect(unknown.status).toBe("not_found");
    expect(unknown.external_qty).toBeNull();
    expect((await one("SELECT status FROM inventory_reconciliation WHERE product_id = 4 AND outlet_id = 1")).status).toBe("not_at_location");
  });

  it("negative SanoPOS stock is sent as 0", async () => {
    await setLocal(5, -3);
    shop.stock(item(105), 4);
    const res = await admin().post("/api/integrations/shopify/stock/set-to-pos").send({});
    expect(res.status).toBe(200);
    expect(shop.qty(item(105))).toBe(0);
    await setLocal(5, 80);
  });

  it("if an online order changes Shopify's count while fixing, that item is left alone and reported", async () => {
    await setLocal(1, 7);
    shop.stock(item(101), 3);
    shop.stock(item(102), 12);
    await setLocal(2, 30);
    // An online order for item 101 lands after our read, before our set.
    shop.beforeNextSet = () => shop.levels.set(`${item(101)}|${LOC}`, 2);

    const res = await admin().post("/api/integrations/shopify/stock/set-to-pos").send({});
    expect(res.status).toBe(200);
    expect(shop.qty(item(101))).toBe(2); // not overwritten with a stale 7
    expect(shop.qty(item(102))).toBe(30); // the rest of the batch still went through
    expect(res.body.changed_meanwhile).toBe(1);
    expect(res.body.set).toBe(1);
    const row = await one("SELECT status, resolution_status, resolution_note FROM inventory_reconciliation WHERE product_id = 1 AND outlet_id = 1");
    expect(row.status).toBe("mismatch");
    expect(row.resolution_note).toMatch(/changed while fixing/);

    // Running again fixes it.
    const again = await admin().post("/api/integrations/shopify/stock/set-to-pos").send({});
    expect(again.body.set).toBe(1);
    expect(shop.qty(item(101))).toBe(7);
  });

  it("sends waiting +/- changes first, and skips an item whose change is still on its way", async () => {
    await setLocal(1, 7);
    await setLocal(2, 30);
    shop.stock(item(101), 3);
    shop.stock(item(102), 12);
    const payload = (productId, inv, delta) => JSON.stringify({
      product_id: productId, variant_id: null, outlet_id: 1, delta, reason: "sale",
      shopify_inventory_item_id: inv, shopify_location_id: LOC,
    });
    // Product 1: a change that is due now → sent first, then the count is set.
    await db.query(
      `INSERT INTO external_sync_events (direction, entity_type, idempotency_key, status, payload, next_retry_at)
       VALUES ('outbound', 'inventory', 'k-due', 'pending', $1, NOW())`,
      [payload(1, item(101), -1)],
    );
    // Product 2: a change waiting to retry later → item skipped, not overwritten.
    await db.query(
      `INSERT INTO external_sync_events (direction, entity_type, idempotency_key, status, payload, next_retry_at, attempt_count)
       VALUES ('outbound', 'inventory', 'k-later', 'retry', $1, NOW() + interval '1 hour', 1)`,
      [payload(2, "102", -1)],
    );

    const res = await admin().post("/api/integrations/shopify/stock/set-to-pos").send({});
    expect(res.status).toBe(200);
    expect((await one("SELECT status FROM external_sync_events WHERE idempotency_key = 'k-due'")).status).toBe("processed");
    expect(shop.qty(item(101))).toBe(7);
    expect(shop.qty(item(102))).toBe(12);
    expect(res.body.waiting).toBe(1);
    expect((await one("SELECT status FROM inventory_reconciliation WHERE product_id = 2 AND outlet_id = 1")).status).toBe("waiting");
  });

  it("old failed changes for a fixed item are retired, so 'retry failed' can't replay them", async () => {
    await setLocal(1, 7);
    shop.stock(item(101), 3);
    await db.query(
      `INSERT INTO external_sync_events (direction, entity_type, idempotency_key, status, payload, attempt_count)
       VALUES ('outbound', 'inventory', 'k-dead', 'dead_letter', $1, 3)`,
      [JSON.stringify({ product_id: 1, variant_id: null, outlet_id: 1, delta: -4, reason: "sale", shopify_inventory_item_id: item(101), shopify_location_id: LOC })],
    );
    await admin().post("/api/integrations/shopify/stock/set-to-pos").send({});
    expect(shop.qty(item(101))).toBe(7);
    expect((await one("SELECT status FROM external_sync_events WHERE idempotency_key = 'k-dead'")).status).toBe("superseded");

    const retry = await admin().post("/api/integrations/shopify/sync/retry-failed").send({});
    expect(retry.status).toBe(200);
    expect(retry.body.queued).toBe(0);
  });
});

// ─── 2c ────────────────────────────────────────────────────────────────────
describe("Blocker 2c — the Reconciliation screen's fixes", () => {
  beforeEach(resetShop);

  it("'POS wins' on selected rows actually sets Shopify (it used to only mark them resolved)", async () => {
    await setLocal(1, 7);
    await setLocal(2, 30);
    shop.stock(item(101), 3);
    shop.stock(item(102), 12);
    await admin().post("/api/integrations/shopify/reconciliation").send({});
    const row = await one("SELECT id FROM inventory_reconciliation WHERE product_id = 1 AND outlet_id = 1");

    const res = await admin().post("/api/integrations/shopify/reconciliation/bulk").send({ ids: [row.id], action: "fix", mode: "pos_wins" });
    expect(res.status).toBe(200);
    expect(shop.qty(item(101))).toBe(7);
    expect(shop.qty(item(102))).toBe(12); // not selected, not touched
    const after = await one("SELECT status, resolution_status FROM inventory_reconciliation WHERE id = $1", [row.id]);
    expect(after).toMatchObject({ status: "matched", resolution_status: "resolved" });
  });

  it("'Check now' changes nothing on either side", async () => {
    await setLocal(1, 7);
    shop.stock(item(101), 3);
    const res = await admin().post("/api/integrations/shopify/reconciliation").send({});
    expect(res.status).toBe(200);
    expect(shop.qty(item(101))).toBe(3);
    expect(Number((await one("SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1")).quantity)).toBe(7);
    expect(shop.sets()).toHaveLength(0);
  });

  it("'Shopify wins' is refused on a variant row (it would overwrite the product total)", async () => {
    shop.stock(item(103), 9);
    await admin().post("/api/integrations/shopify/reconciliation").send({});
    const row = await one("SELECT id FROM inventory_reconciliation WHERE variant_id = $1", [global.__otsVariantId]);
    const before = await one("SELECT quantity FROM outlet_stock WHERE product_id = 3 AND outlet_id = 1");
    const res = await admin().post("/api/integrations/shopify/reconciliation/bulk").send({ ids: [row.id], action: "fix", mode: "shopify_wins" });
    expect(res.status).toBe(400);
    expect((await one("SELECT quantity FROM outlet_stock WHERE product_id = 3 AND outlet_id = 1")).quantity).toBe(before.quantity);
  });
});

// ─── 2b ────────────────────────────────────────────────────────────────────
describe("Blocker 2b — sync requests answer", () => {
  beforeEach(resetShop);

  it("'process pending' answers (it used to hang forever)", async () => {
    const res = await admin().post("/api/integrations/shopify/sync/process-pending").send({ limit: 5 }).timeout(5000);
    expect(res.status).toBe(200);
    expect(res.body.run_id).toBeDefined();
  });

  it("'push inventory' with no rows sets Shopify to SanoPOS counts and answers", async () => {
    await setLocal(1, 7);
    shop.stock(item(101), 3);
    const res = await admin().post("/api/integrations/shopify/sync/push-inventory").send({}).timeout(5000);
    expect(res.status).toBe(200);
    expect(shop.qty(item(101))).toBe(7);
  });

  it("'push inventory' with +/- rows queues and sends them, and answers", async () => {
    shop.stock(item(101), 3);
    const res = await admin().post("/api/integrations/shopify/sync/push-inventory")
      .send({ rows: [{ product_id: 1, outlet_id: 1, delta: 2 }] }).timeout(5000);
    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(1);
    expect(res.body.processed).toBe(1);
    expect(shop.qty(item(101))).toBe(5);
  });
});

// ─── 2e ────────────────────────────────────────────────────────────────────
describe("Blocker 2e — daily check (report only)", () => {
  beforeEach(resetShop);

  it("saves the comparison, tells the owner, and changes nothing", async () => {
    await db.query("DELETE FROM shopify_sync_runs WHERE run_type = 'daily_stock_check'");
    await db.query("DELETE FROM notifications WHERE type = 'shopify_stock_drift'");
    await setLocal(1, 7);
    shop.stock(item(101), 3);
    const conn = await one("SELECT * FROM shopify_connections WHERE is_active = true ORDER BY id DESC LIMIT 1");

    expect(await stockCheck.dailyCheckDue(db)).toBe(true);
    const result = await stockCheck.runDailyCheck(db, conn, shopifyClient);
    expect(result.mismatch).toBeGreaterThanOrEqual(1);
    expect(shop.sets()).toHaveLength(0);
    expect(shop.qty(item(101))).toBe(3);
    expect((await one("SELECT status FROM inventory_reconciliation WHERE product_id = 1 AND outlet_id = 1")).status).toBe("mismatch");
    const note = await one("SELECT title, message, link FROM notifications WHERE type = 'shopify_stock_drift'");
    expect(note.message).toMatch(/different count on Shopify/);
    expect(await stockCheck.dailyCheckDue(db)).toBe(false);
  });

  it("an item the owner ignored stays ignored on the next day's check if nothing changed", async () => {
    await setLocal(1, 7);
    shop.stock(item(101), 3);
    const conn = await one("SELECT * FROM shopify_connections WHERE is_active = true ORDER BY id DESC LIMIT 1");
    await stockCheck.runDailyCheck(db, conn, shopifyClient);
    const row = await one("SELECT id FROM inventory_reconciliation WHERE product_id = 1 AND outlet_id = 1");
    await admin().put(`/api/integrations/shopify/reconciliation/${row.id}`).send({ resolution_status: "ignored" });
    await stockCheck.runDailyCheck(db, conn, shopifyClient);
    expect((await one("SELECT resolution_status FROM inventory_reconciliation WHERE product_id = 1 AND outlet_id = 1")).resolution_status).toBe("ignored");
  });
});

// ─── 2f ────────────────────────────────────────────────────────────────────
describe("Blocker 2f — no stock change is dropped as a 'duplicate'", () => {
  beforeEach(resetShop);

  it("every transfer of the same item reaches Shopify, not just the first", async () => {
    await setLocal(1, 50);
    for (let i = 0; i < 2; i++) {
      const res = await admin().post("/api/transfers").send({
        product_id: 1, from_outlet_id: 1, to_outlet_id: 2, quantity: 1, employee_id: ADMIN_ID,
      });
      expect(res.status).toBe(200);
    }
    const events = await waitFor(async () => {
      const ev = (await outboundEvents()).filter((e) => e.p.reason === "transfer_out");
      return ev.length >= 2 ? ev : null;
    });
    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.idempotency_key)).size).toBe(2);
  });

  it("the same item on two lines of one bill sends the whole quantity", async () => {
    await openTill();
    await setLocal(2, 30);
    const res = await admin().post("/api/sales").send({
      outlet_id: 1, employee_id: ADMIN_ID,
      cartItems: [{ id: 2, quantity: 1, price: 200 }, { id: 2, quantity: 2, price: 200 }],
      payments: [{ method: "Card", amount: 600 }],
    });
    expect(res.status).toBe(200);
    const events = await waitFor(async () => {
      const ev = (await outboundEvents()).filter((e) => e.p.reason === "sale" && e.p.product_id === 2);
      return ev.length ? ev : null;
    });
    expect(events).toHaveLength(1);
    expect(events[0].p.delta).toBe(-3);
  });

  it("a returned variant updates the variant on Shopify, not the plain product", async () => {
    await openTill();
    const vid = global.__otsVariantId;
    await db.query("UPDATE variant_outlet_stock SET quantity = 5 WHERE variant_id = $1 AND outlet_id = 1", [vid]);
    const sale = await admin().post("/api/sales").send({
      outlet_id: 1, employee_id: ADMIN_ID,
      cartItems: [{ id: 3, variant_id: vid, quantity: 1, price: 500 }],
      payments: [{ method: "Card", amount: 500 }],
    });
    expect(sale.status).toBe(200);
    const ret = await admin().post("/api/returns").send({
      original_sale_id: sale.body.saleId, outlet_id: 1, employee_id: ADMIN_ID, total_refund: 500, refund_method: "Card",
      items: [{ product_id: 3, variant_id: vid, quantity: 1, refund_price: 500 }],
    });
    expect(ret.status).toBe(200);
    const ev = await waitFor(async () => (await outboundEvents()).find((e) => e.p.reason === "return"));
    expect(ev.p.variant_id).toBe(vid);
    expect(ev.p.shopify_inventory_item_id).toBe(item(103));
  });
});
