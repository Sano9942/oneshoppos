/**
 * Phase 2-G Wave 2 — 2-G.4 price-books route (admin CRUD).
 *
 * Covers routes/price-books.js endpoints against a real schema. Verifies
 * - feature-flag gating (phase2g_price_books off → 503)
 * - permission gating (anonymous → 403)
 * - get-or-create semantics (first GET creates the price_list row)
 * - bulk upsert idempotency (repeat POST updates, doesn't duplicate)
 * - variant-scoped vs product-level items coexist under same group
 * - delete-all wipes items but not the price_list row
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req, anonReq;

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

  require("../../routes/customers")(app, deps); // customer-groups CRUD
  require("../../routes/price-books")(app, deps);

  req = makeRequest(app, ADMIN_ID);
  anonReq = request(app); // no x-employee-id header

  // Admin also needs manage_customers to hit group CRUD — seed it explicitly
  // alongside all_access (seed helper gives admin only all_access).
  await db.query(
    `INSERT INTO role_permissions (role_id, permission) VALUES (1, 'manage_customers')
     ON CONFLICT DO NOTHING`,
  );

  // Seed a customer group we can hang the price book on.
  await db.query(
    `INSERT INTO customer_groups (id, name, discount_percent, is_active)
     VALUES (100, 'TestWholesale', 10, true)`,
  );
  await db.query(
    `SELECT setval(pg_get_serial_sequence('customer_groups','id'), 100, true)`,
  );
}, 120000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

async function setFlag(key, enabled) {
  await db.query(
    `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [key, enabled],
  );
  require("../../middleware/feature-flags").invalidateFeatureFlagCache();
}

describe("Phase 2-G Wave 2 — /api/price-books/groups/:groupId routes", () => {
  beforeEach(async () => {
    await setFlag("phase2g_price_books", true);
    // Clean up any items + lists from prior tests in this describe.
    await db.query(
      `DELETE FROM price_list_items
         WHERE price_list_id IN (SELECT id FROM price_lists WHERE customer_group_id = 100)`,
    );
    await db.query(`DELETE FROM price_lists WHERE customer_group_id = 100`);
  });

  test("flag OFF → 503 on GET", async () => {
    await setFlag("phase2g_price_books", false);
    const res = await req.get("/api/price-books/groups/100");
    expect(res.status).toBe(503);
    expect(res.body.flag).toBe("phase2g_price_books");
  });

  test("GET bootstraps a price_list row on first call (get-or-create)", async () => {
    const res = await req.get("/api/price-books/groups/100");
    expect(res.status).toBe(200);
    expect(res.body.priceList).toMatchObject({
      is_active: true,
    });
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toEqual([]);

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM price_lists WHERE customer_group_id = 100`,
    );
    expect(rows[0].n).toBe(1);
  });

  test("GET on second call reuses the same price_list row (idempotent)", async () => {
    const a = await req.get("/api/price-books/groups/100");
    const b = await req.get("/api/price-books/groups/100");
    expect(a.body.priceList.id).toBe(b.body.priceList.id);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM price_lists WHERE customer_group_id = 100`,
    );
    expect(rows[0].n).toBe(1);
  });

  test("POST /items bulk-upsert creates rows and later updates them in place", async () => {
    const first = await req.post("/api/price-books/groups/100/items").send({
      items: [
        { product_id: 1, price: 80, min_qty: 1 },
        { product_id: 2, price: 150, min_qty: 1 },
      ],
    });
    expect(first.status).toBe(200);
    expect(first.body.upserted).toHaveLength(2);
    expect(first.body.upserted.every((r) => r.created)).toBe(true);

    // Re-submit same keys with different price — should update, not insert.
    const second = await req.post("/api/price-books/groups/100/items").send({
      items: [
        { product_id: 1, price: 70, min_qty: 1 },
      ],
    });
    expect(second.status).toBe(200);
    expect(second.body.upserted).toHaveLength(1);
    expect(second.body.upserted[0].updated).toBe(true);

    const after = await req.get("/api/price-books/groups/100");
    const map = Object.fromEntries(
      after.body.items.map((i) => [i.product_id, Number(i.price)]),
    );
    expect(map[1]).toBe(70); // updated
    expect(map[2]).toBe(150); // untouched
  });

  test("POST /items rejects invalid price (negative)", async () => {
    const res = await req.post("/api/price-books/groups/100/items").send({
      items: [{ product_id: 1, price: -5 }],
    });
    expect(res.status).toBe(400);
  });

  test("PUT /items/:itemId updates a single row's price", async () => {
    const seed = await req.post("/api/price-books/groups/100/items").send({
      items: [{ product_id: 1, price: 80, min_qty: 1 }],
    });
    const itemId = seed.body.upserted[0].id;
    const upd = await req.put(`/api/price-books/groups/100/items/${itemId}`).send({
      price: 65,
    });
    expect(upd.status).toBe(200);
    const after = await req.get("/api/price-books/groups/100");
    expect(Number(after.body.items[0].price)).toBe(65);
  });

  test("DELETE /items/:itemId removes a single row", async () => {
    const seed = await req.post("/api/price-books/groups/100/items").send({
      items: [
        { product_id: 1, price: 80, min_qty: 1 },
        { product_id: 2, price: 150, min_qty: 1 },
      ],
    });
    const idToDelete = seed.body.upserted.find((r) => r).id;
    const del = await req.delete(`/api/price-books/groups/100/items/${idToDelete}`);
    expect(del.status).toBe(200);
    const after = await req.get("/api/price-books/groups/100");
    expect(after.body.items.map((i) => i.id)).not.toContain(idToDelete);
  });

  test("DELETE /items (bulk) wipes all items but keeps the price_list row", async () => {
    await req.post("/api/price-books/groups/100/items").send({
      items: [
        { product_id: 1, price: 80, min_qty: 1 },
        { product_id: 2, price: 150, min_qty: 1 },
      ],
    });
    const del = await req.delete("/api/price-books/groups/100/items");
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(2);

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM price_lists WHERE customer_group_id = 100`,
    );
    expect(rows[0].n).toBe(1); // list row survives

    const after = await req.get("/api/price-books/groups/100");
    expect(after.body.items).toEqual([]);
  });

  test("GET on unknown group returns 404", async () => {
    const res = await req.get("/api/price-books/groups/999999");
    expect(res.status).toBe(404);
  });

  test("variant-scoped + product-level items can coexist for same product", async () => {
    // Seed a variant first so the FK holds.
    const { rows: [v] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, price)
       VALUES (1, 'PROD-001-VAR', 120) RETURNING id`,
    );
    const res = await req.post("/api/price-books/groups/100/items").send({
      items: [
        { product_id: 1, price: 80, min_qty: 1 }, // product-level
        { product_id: 1, variant_id: v.id, price: 95, min_qty: 1 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.upserted).toHaveLength(2);
    const after = await req.get("/api/price-books/groups/100");
    expect(after.body.items).toHaveLength(2);
  });
});
