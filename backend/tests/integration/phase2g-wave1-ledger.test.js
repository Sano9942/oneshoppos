const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Phase 2-G Wave 1 — ledger + flag seeds (v62)", () => {
  let db, cleanup;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestApp());
  }, 180000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  }, 60000);

  it("gift_card_transactions table exists with correct columns", async () => {
    const { rows } = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'gift_card_transactions'
      ORDER BY ordinal_position
    `);
    expect(rows.map((r) => r.column_name)).toEqual([
      "id",
      "gift_card_id",
      "type",
      "amount",
      "reference_type",
      "reference_id",
      "note",
      "created_at",
    ]);
  });

  it("gift_card_transactions enforces type check (credit/debit)", async () => {
    const { rows: gc } = await db.query(
      `INSERT INTO gift_cards (code, initial_value, remaining_value)
       VALUES ('TEST_LEDGER_001', 1000, 1000) RETURNING id`
    );
    await expect(
      db.query(
        `INSERT INTO gift_card_transactions (gift_card_id, type, amount)
         VALUES ($1, 'invalid_type', 100)`,
        [gc[0].id]
      )
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("loyalty_transactions table exists with correct columns", async () => {
    const { rows } = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'loyalty_transactions'
      ORDER BY ordinal_position
    `);
    expect(rows.map((r) => r.column_name)).toEqual([
      "id",
      "customer_id",
      "type",
      "points",
      "reference_type",
      "reference_id",
      "note",
      "created_at",
    ]);
  });

  it("loyalty_transactions type enum includes earn/redeem/adjust/expire", async () => {
    const { rows: cust } = await db.query(
      `INSERT INTO customers (name) VALUES ('Ledger Test Cust') RETURNING id`
    );
    for (const t of ["earn", "redeem", "adjust", "expire"]) {
      await db.query(
        `INSERT INTO loyalty_transactions (customer_id, type, points) VALUES ($1, $2, 10)`,
        [cust[0].id, t]
      );
    }
    await expect(
      db.query(
        `INSERT INTO loyalty_transactions (customer_id, type, points) VALUES ($1, 'bogus', 10)`,
        [cust[0].id]
      )
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("seeds all 11 phase2g_* feature flags with enabled=false", async () => {
    const expectedKeys = [
      "phase2g_gift_cards",
      "phase2g_loyalty",
      "phase2g_price_books",
      "phase2g_price_override",
      "phase2g_variant_picker",
      "phase2g_serialized_inventory",
      "phase2g_per_line_restock",
      "phase2g_inventory_intelligence",
      "phase2g_receipt_barcode_lookup",
      "phase2g_omni_input",
      "phase2g_label_designer",
    ];
    const { rows } = await db.query(
      `SELECT key, enabled FROM feature_flags WHERE key = ANY($1::text[])`,
      [expectedKeys]
    );
    expect(rows).toHaveLength(11);
    for (const row of rows) {
      expect(row.enabled).toBe(false);
    }
  });

  it("indexes exist on the two new ledgers", async () => {
    const { rows } = await db.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename IN ('gift_card_transactions', 'loyalty_transactions')
    `);
    const names = rows.map((r) => r.indexname);
    expect(names).toContain("idx_gift_card_transactions_gift_card");
    expect(names).toContain("idx_loyalty_transactions_customer");
  });
});
