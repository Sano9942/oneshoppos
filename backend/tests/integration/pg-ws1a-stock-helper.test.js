/**
 * pg-ws1a-stock-helper.test.js — WS1a shared stock ledger helper
 *
 * Covers services/stock-ledger.js (decrementStock / incrementStock) and the
 * writers retrofitted onto it:
 *
 *   - Concurrency: two simultaneous decrements of the LAST unit → exactly one
 *     succeeds, the other gets insufficient_stock; outlet_stock never goes
 *     negative. (Requires two real pool clients — the scoped test `db` holds a
 *     single dedicated client so it can't model true row-lock contention.)
 *   - decrementStock writes ALL THREE tables for a variant line and keeps the
 *     batch invariant (Σ active batch remaining = outlet_stock) for tracked SKUs.
 *   - incrementStock is the mirror image.
 *   - M3 transfer route: variant stock moves between outlets; the cross-outlet
 *     product_variants.stock rollup nets to zero.
 *   - M6 supplier-return route: a variant line now decrements all three tables
 *     (the old bug touched only product_variants.stock).
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const pool = require("../../db-pg");
const stockLedger = require("../../services/stock-ledger");
const batchStock = require("../../services/batch-stock");

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

describe("WS1a — shared stock ledger helper", () => {
  let db;
  let cleanup;
  let schemaName;

  beforeAll(async () => {
    const ctx = await createTestApp();
    db = ctx.db;
    cleanup = ctx.cleanup;
    schemaName = ctx.schemaName;
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  // ───────────────────────────────────────────────────────────────
  // Concurrency — the headline guarantee
  // ───────────────────────────────────────────────────────────────
  describe("concurrent decrement of the last unit", () => {
    it("exactly one succeeds, the other gets insufficient_stock, stock never negative", async () => {
      // Product 4 (untracked "Snack D"), outlet 1. Force exactly 1 on hand.
      await db.query(
        "UPDATE outlet_stock SET quantity = 1 WHERE product_id = 4 AND outlet_id = 1"
      );

      // Two independent pool clients pinned to the test schema so their
      // FOR UPDATE locks actually contend (the scoped `db` proxy shares one
      // client and would just interleave BEGIN/COMMIT on a single connection).
      const clientA = await pool.getClient();
      const clientB = await pool.getClient();
      try {
        await clientA.query(`SET search_path = '${schemaName}'`);
        await clientB.query(`SET search_path = '${schemaName}'`);

        await clientA.query("BEGIN");
        await clientB.query("BEGIN");

        // A takes the row lock and decrements 1 → 0 (not yet committed).
        const resA = await stockLedger.decrementStock(clientA, {
          productId: 4, outletId: 1, qty: 1, manageBatch: false,
        });
        expect(resA.qty).toBe(1);

        // B races: its SELECT ... FOR UPDATE must block on A's lock. Launch
        // without awaiting, give it time to reach the blocked read.
        let bError = null;
        const bPromise = stockLedger
          .decrementStock(clientB, { productId: 4, outletId: 1, qty: 1, manageBatch: false })
          .catch((e) => { bError = e; });
        await new Promise((r) => setTimeout(r, 250));

        // Commit A — releases the lock; B now sees quantity = 0 and its gate fires.
        await clientA.query("COMMIT");
        await bPromise;
        await clientB.query("ROLLBACK");

        expect(bError).toBeTruthy();
        expect(bError.code).toBe("insufficient_stock");
        expect(bError.statusCode).toBe(400);
      } finally {
        clientA.release();
        clientB.release();
      }

      // Authoritative on-hand is exactly 0 — never negative.
      const { rows: [os] } = await db.query(
        "SELECT quantity FROM outlet_stock WHERE product_id = 4 AND outlet_id = 1"
      );
      expect(Number(os.quantity)).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Variant: all three tables move together
  // ───────────────────────────────────────────────────────────────
  describe("decrementStock / incrementStock variant paths", () => {
    let variantId;

    beforeAll(async () => {
      const { rows: [v] } = await db.query(
        `INSERT INTO product_variants (product_id, sku, price, stock)
         VALUES (1, 'WS1A-VAR-1', 100, 10) RETURNING id`
      );
      variantId = v.id;
      // Per-outlet variant row + product-level outlet_stock at outlet 1.
      await db.query(
        `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity) VALUES ($1, 1, 10)`,
        [variantId]
      );
      await db.query(
        `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (1, 1, 10)
         ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 10`
      );
    });

    it("decrement writes variant_outlet_stock + product_variants.stock + outlet_stock", async () => {
      await db.transaction(async (client) => {
        await stockLedger.decrementStock(client, {
          productId: 1, variantId, outletId: 1, qty: 3, manageBatch: false,
        });
      });

      const { rows: [vos] } = await db.query(
        "SELECT quantity FROM variant_outlet_stock WHERE variant_id = $1 AND outlet_id = 1",
        [variantId]
      );
      const { rows: [pv] } = await db.query(
        "SELECT stock FROM product_variants WHERE id = $1", [variantId]
      );
      const { rows: [os] } = await db.query(
        "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1"
      );
      expect(Number(vos.quantity)).toBe(7);
      expect(Number(pv.stock)).toBe(7);
      expect(Number(os.quantity)).toBe(7);
    });

    it("increment mirrors the decrement across all three tables", async () => {
      await db.transaction(async (client) => {
        await stockLedger.incrementStock(client, {
          productId: 1, variantId, outletId: 1, qty: 3, manageBatch: false,
        });
      });

      const { rows: [vos] } = await db.query(
        "SELECT quantity FROM variant_outlet_stock WHERE variant_id = $1 AND outlet_id = 1",
        [variantId]
      );
      const { rows: [pv] } = await db.query(
        "SELECT stock FROM product_variants WHERE id = $1", [variantId]
      );
      const { rows: [os] } = await db.query(
        "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1"
      );
      expect(Number(vos.quantity)).toBe(10);
      expect(Number(pv.stock)).toBe(10);
      expect(Number(os.quantity)).toBe(10);
    });

    it("gate:false lets an authoritative correction drive stock down without throwing", async () => {
      // Even asking for more than on hand must not throw when gate is off
      // (stock-count corrections rely on this).
      await db.query(
        `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (5, 1, 2)
         ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 2`
      );
      await expect(
        db.transaction(async (client) =>
          stockLedger.decrementStock(client, {
            productId: 5, outletId: 1, qty: 5, gate: false, manageBatch: false,
          })
        )
      ).resolves.toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Batch invariant: Σ active batch remaining = outlet_stock
  // ───────────────────────────────────────────────────────────────
  describe("batch ledger stays consistent for tracked SKUs", () => {
    it("decrement consumes batches so Σ remaining = outlet_stock", async () => {
      // Make product 2 batch-tracked with two lots totalling 12 at outlet 1.
      await db.query("UPDATE products SET track_batches = true WHERE id = 2");
      await db.query(
        `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (2, 1, 12)
         ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 12`
      );
      await db.query(
        `INSERT INTO stock_batches (product_id, outlet_id, batch_number, received_qty, remaining_qty, status)
         VALUES (2, 1, 'WS1A-B1', 5, 5, 'active'), (2, 1, 'WS1A-B2', 7, 7, 'active')`
      );

      await db.transaction(async (client) => {
        await stockLedger.decrementStock(client, {
          productId: 2, outletId: 1, qty: 8, refType: "test", refId: 1,
        });
      });

      const { rows: [os] } = await db.query(
        "SELECT quantity FROM outlet_stock WHERE product_id = 2 AND outlet_id = 1"
      );
      const drift = await batchStock.getDrift(db, { outletId: 1 });
      const p2Drift = drift.find((d) => d.product_id === 2);
      expect(Number(os.quantity)).toBe(4);
      expect(p2Drift).toBeUndefined(); // no drift → invariant holds
    });
  });

  // ───────────────────────────────────────────────────────────────
  // M3 transfer route — variant stock moves, rollup nets to zero
  // ───────────────────────────────────────────────────────────────
  describe("M3 inventory transfer (route) via helper", () => {
    it("moves variant stock between outlets and leaves the rollup unchanged", async () => {
      // Drive the helper the way the transfer route does — decrement source,
      // increment dest, both manageBatch:false (transferBatches owns identity).
      const { rows: [v] } = await db.query(
        `INSERT INTO product_variants (product_id, sku, price, stock)
         VALUES (1, 'WS1A-XFER', 100, 6) RETURNING id`
      );
      const vid = v.id;
      await db.query(
        `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity) VALUES ($1, 1, 6)`,
        [vid]
      );
      await db.query(
        `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (1, 1, 6)
         ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 6`
      );

      await db.transaction(async (client) => {
        await stockLedger.decrementStock(client, {
          productId: 1, variantId: vid, outletId: 1, qty: 4, manageBatch: false,
        });
        await stockLedger.incrementStock(client, {
          productId: 1, variantId: vid, outletId: 2, qty: 4, manageBatch: false,
        });
      });

      const { rows: [src] } = await db.query(
        "SELECT quantity FROM variant_outlet_stock WHERE variant_id = $1 AND outlet_id = 1", [vid]
      );
      const { rows: [dst] } = await db.query(
        "SELECT quantity FROM variant_outlet_stock WHERE variant_id = $1 AND outlet_id = 2", [vid]
      );
      const { rows: [pv] } = await db.query(
        "SELECT stock FROM product_variants WHERE id = $1", [vid]
      );
      expect(Number(src.quantity)).toBe(2);
      expect(Number(dst.quantity)).toBe(4);
      // Cross-outlet rollup: -4 at source then +4 at dest = net zero.
      expect(Number(pv.stock)).toBe(6);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // M6 supplier-return route — variant line hits all three tables
  // ───────────────────────────────────────────────────────────────
  describe("M6 supplier-return (route) variant path", () => {
    it("decrements variant_outlet_stock + rollup + outlet_stock, not just the rollup", async () => {
      const supplierReturns = require("../../routes/supplier-returns");
      const { makeRequest, ADMIN_ID } = require("../helpers/request");
      const { createTestApp: makeApp } = require("../helpers/createTestApp-pg");

      // Build a dedicated app so route wiring is real. Uses its own schema.
      const ctx2 = await makeApp();
      try {
        supplierReturns(ctx2.app, ctx2.deps);

        const { rows: [v] } = await ctx2.db.query(
          `INSERT INTO product_variants (product_id, sku, price, stock)
           VALUES (1, 'WS1A-SR', 100, 9) RETURNING id`
        );
        const vid = v.id;
        await ctx2.db.query(
          `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity) VALUES ($1, 1, 9)`,
          [vid]
        );
        await ctx2.db.query(
          `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (1, 1, 9)
           ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 9`
        );

        const res = await makeRequest(ctx2.app, ADMIN_ID)
          .post("/api/supplier-returns")
          .send({
            supplier_id: 1, outlet_id: 1,
            items: [{ product_id: 1, variant_id: vid, quantity: 2, unit_price: 50 }],
          });
        expect(res.status).toBe(200);

        const { rows: [vos] } = await ctx2.db.query(
          "SELECT quantity FROM variant_outlet_stock WHERE variant_id = $1 AND outlet_id = 1", [vid]
        );
        const { rows: [pv] } = await ctx2.db.query(
          "SELECT stock FROM product_variants WHERE id = $1", [vid]
        );
        const { rows: [os] } = await ctx2.db.query(
          "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1"
        );
        expect(Number(vos.quantity)).toBe(7);
        expect(Number(pv.stock)).toBe(7);
        expect(Number(os.quantity)).toBe(7);
      } finally {
        if (ctx2.cleanup) await ctx2.cleanup();
      }
    });
  });
});
