/**
 * pg-batch-phase4-storefront-tax.test.js — Phase 4 P13 regression
 *
 * Walkthrough of the live storefront on 2026-04-29 (livetest1, schema_version=83,
 * tax_mode='inclusive') showed the quote service returning taxRate=0 / taxAmount=0
 * for products with gst=5 set, and ignoring tax_mode entirely. POS sales were
 * fixed in the P8 bundle (sales.js lines 988-1118 do the full cascade) but
 * storefront/services/quote.js was never updated.
 *
 * These tests pin down the expected behaviour:
 *
 *   1. tax_mode='exclusive' + product.gst=17 → tax added on top of unit price
 *   2. tax_mode='inclusive' + product.gst=17 → unit price already includes tax
 *      (price stays 100, tax extracted to ~14.53, grandTotal == subtotal).
 *   3. tax_mode='none' overrides everything to 0 even if product has gst.
 *
 * Test exercises calculateQuote() directly — no HTTP layer needed.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { calculateQuote } = require("../../services/quote");

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

describe("Phase 4 P13 — storefront quote honours tenant tax_mode + gst column", () => {
  let db;
  let cleanup;
  let storefrontChannelId;

  beforeAll(async () => {
    const ctx = await createTestApp();
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Add P8 column. v83 adds it but our seed factory may run an older schema cut;
    // CREATE OR ALTER idempotently to be safe.
    await db.query(
      `ALTER TABLE company_profile
         ADD COLUMN IF NOT EXISTS tax_mode TEXT NOT NULL DEFAULT 'none'
         CHECK (tax_mode IN ('none', 'inclusive', 'exclusive'))`
    );

    // Look up the storefront channel id (seeded by schema-pg.sql).
    const { rows } = await db.query(
      "SELECT id FROM sales_channels WHERE code = 'storefront'"
    );
    storefrontChannelId = rows[0].id;

    // Publish product 1 (gst=17, tax_id=1, price=100) to storefront so quote returns it.
    await db.query(
      `INSERT INTO channel_publications (channel_id, product_id, is_published, published_at)
       VALUES ($1, 1, true, NOW())
       ON CONFLICT (channel_id, product_id, COALESCE(variant_id, 0))
       DO UPDATE SET is_published = true`,
      [storefrontChannelId]
    );

    // Inject a product with gst column ONLY (no tax_id, no category tax) — mirrors
    // livetest1 'Snack Bar' (id=11, gst=5, tax_id=null, category_id=null).
    // This is the variant the live walk caught on 2026-04-29: storefront quote
    // returned taxRate=0 because quote.js JOIN ignores p.gst entirely.
    await db.query(
      `INSERT INTO products (id, barcode, name, price, stock, cost_price, gst, category_id, tax_id, brand_id, supplier_id)
       VALUES (101, 'PHASE4-GST-ONLY', 'Gst-Only Product', 50, 100, 30, 5, NULL, NULL, NULL, NULL)`
    );
    await db.query(
      `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (101, 1, 100)`
    );
    await db.query(
      `INSERT INTO channel_publications (channel_id, product_id, is_published, published_at)
       VALUES ($1, 101, true, NOW())
       ON CONFLICT (channel_id, product_id, COALESCE(variant_id, 0))
       DO UPDATE SET is_published = true`,
      [storefrontChannelId]
    );
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  // ──────────────────────────────────────────────────────────────────
  // Case 1 — exclusive: tax added on top of price
  // ──────────────────────────────────────────────────────────────────
  it("tax_mode='exclusive' + gst=17 → taxAmount 17, grandTotal 117", async () => {
    await db.query("UPDATE company_profile SET tax_mode = 'exclusive' WHERE id = 1");

    const quote = await calculateQuote(
      db,
      [{ productId: 1, variantId: null, qty: 1 }],
      "pickup",
      1,
      storefrontChannelId,
      null,
      { taxMode: "exclusive" }
    );

    expect(quote.availabilityErrors).toEqual([]);
    expect(quote.items).toHaveLength(1);
    expect(Number(quote.items[0].unitPrice)).toBe(100);
    // 17% on 100 → 17
    expect(Number(quote.items[0].taxAmount)).toBeCloseTo(17, 2);
    expect(Number(quote.subtotal)).toBe(100);
    expect(Number(quote.taxTotal)).toBeCloseTo(17, 2);
    expect(Number(quote.grandTotal)).toBeCloseTo(117, 2);
  });

  // ──────────────────────────────────────────────────────────────────
  // Case 2 — inclusive: unit price already includes tax
  // ──────────────────────────────────────────────────────────────────
  it("tax_mode='inclusive' + gst=17 → grandTotal stays 100, tax extracted", async () => {
    await db.query("UPDATE company_profile SET tax_mode = 'inclusive' WHERE id = 1");

    const quote = await calculateQuote(
      db,
      [{ productId: 1, variantId: null, qty: 1 }],
      "pickup",
      1,
      storefrontChannelId,
      null,
      { taxMode: "inclusive" }
    );

    expect(quote.availabilityErrors).toEqual([]);
    // 100 / 1.17 ≈ 85.47, tax ≈ 14.53
    expect(Number(quote.items[0].unitPrice)).toBe(100);
    expect(Number(quote.items[0].taxAmount)).toBeCloseTo(14.53, 1);
    // In inclusive mode, grandTotal must equal what the customer sees on the
    // storefront — i.e. the displayed price, not (price + tax).
    expect(Number(quote.grandTotal)).toBeCloseTo(100, 2);
  });

  // ──────────────────────────────────────────────────────────────────
  // Case 2b — exclusive + product.gst-only (no tax_id) → uses gst column
  //   This is the livetest1 Snack Bar case (gst=5, tax_id=null).
  //   Pre-fix the storefront quote ignored p.gst and returned taxAmount=0.
  // ──────────────────────────────────────────────────────────────────
  it("tax_mode='exclusive' + product.gst=5 only (tax_id=null) → taxAmount uses gst", async () => {
    await db.query("UPDATE company_profile SET tax_mode = 'exclusive' WHERE id = 1");

    const quote = await calculateQuote(
      db,
      [{ productId: 101, variantId: null, qty: 1 }],
      "pickup",
      1,
      storefrontChannelId,
      null,
      { taxMode: "exclusive" }
    );

    expect(quote.availabilityErrors).toEqual([]);
    expect(quote.items).toHaveLength(1);
    expect(Number(quote.items[0].unitPrice)).toBe(50);
    // 5% on 50 → 2.50
    expect(Number(quote.items[0].taxAmount)).toBeCloseTo(2.5, 2);
    expect(Number(quote.taxTotal)).toBeCloseTo(2.5, 2);
    expect(Number(quote.grandTotal)).toBeCloseTo(52.5, 2);
  });

  // ──────────────────────────────────────────────────────────────────
  // Case 3 — none: tax forced to 0 regardless of gst
  // ──────────────────────────────────────────────────────────────────
  it("tax_mode='none' + gst=17 → taxAmount 0", async () => {
    await db.query("UPDATE company_profile SET tax_mode = 'none' WHERE id = 1");

    const quote = await calculateQuote(
      db,
      [{ productId: 1, variantId: null, qty: 1 }],
      "pickup",
      1,
      storefrontChannelId,
      null,
      { taxMode: "none" }
    );

    expect(quote.availabilityErrors).toEqual([]);
    expect(Number(quote.items[0].taxAmount)).toBe(0);
    expect(Number(quote.taxTotal)).toBe(0);
    expect(Number(quote.grandTotal)).toBe(100);
  });
});
