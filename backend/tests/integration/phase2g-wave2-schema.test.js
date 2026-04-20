const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Phase 2-G Wave 2 — schema additions (v63)", () => {
  let db, cleanup;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestApp());
  }, 180000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  }, 60000);

  it("gift_cards has new card_type / activation_status / issued_* columns", async () => {
    const { rows } = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'gift_cards'
    `);
    const cols = rows.map((r) => r.column_name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "card_type",
        "activation_status",
        "issued_to_customer_id",
        "issued_to_email",
        "issued_from_sale_id",
      ])
    );
  });

  it("gift_cards.card_type enforces digital/physical", async () => {
    await db.query(
      `INSERT INTO gift_cards (code, initial_value, remaining_value, card_type)
       VALUES ('V63_DIGITAL', 500, 500, 'digital')`
    );
    await db.query(
      `INSERT INTO gift_cards (code, initial_value, remaining_value, card_type)
       VALUES ('V63_PHYSICAL', 500, 500, 'physical')`
    );
    await expect(
      db.query(
        `INSERT INTO gift_cards (code, initial_value, remaining_value, card_type)
         VALUES ('V63_BAD', 500, 500, 'virtual')`
      )
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("gift_cards.activation_status enforces pre_printed/issued/active/depleted", async () => {
    for (const s of ["pre_printed", "issued", "active", "depleted"]) {
      await db.query(
        `INSERT INTO gift_cards (code, initial_value, remaining_value, activation_status)
         VALUES ($1, 100, 100, $2)`,
        [`V63_ACT_${s}`, s]
      );
    }
    await expect(
      db.query(
        `INSERT INTO gift_cards (code, initial_value, remaining_value, activation_status)
         VALUES ('V63_ACT_BAD', 100, 100, 'zombie')`
      )
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("gift_card_ranges table exists with correct columns + range check", async () => {
    const { rows } = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'gift_card_ranges'
      ORDER BY ordinal_position
    `);
    expect(rows.map((r) => r.column_name)).toEqual([
      "id",
      "prefix",
      "range_start",
      "range_end",
      "face_value",
      "notes",
      "created_by",
      "created_at",
    ]);

    // range_end >= range_start CHECK
    await expect(
      db.query(
        `INSERT INTO gift_card_ranges (prefix, range_start, range_end, face_value)
         VALUES ('GC', 100, 50, 500)`
      )
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("products.is_gift_card_sku column exists with default false", async () => {
    const { rows } = await db.query(`
      SELECT column_name, column_default, data_type
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'products'
        AND column_name = 'is_gift_card_sku'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe("boolean");
    expect(rows[0].column_default).toMatch(/false/);
  });

  it("price_lists.customer_group_id column + index exist", async () => {
    const { rows: cols } = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'price_lists'
        AND column_name = 'customer_group_id'
    `);
    expect(cols).toHaveLength(1);

    const { rows: idx } = await db.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'price_lists'
    `);
    expect(idx.map((r) => r.indexname)).toContain(
      "idx_price_lists_customer_group"
    );
  });

  it("price_lists.customer_group_id FK points at customer_groups(id)", async () => {
    // Seed a group + try attaching a price list.
    const { rows: g } = await db.query(
      `INSERT INTO customer_groups (name, discount_percent)
       VALUES ('V63 Wholesale', 10) RETURNING id`
    );
    const { rows: pl } = await db.query(
      `INSERT INTO price_lists (name, type, customer_group_id)
       VALUES ('V63 Wholesale List', 'customer_group', $1) RETURNING id, customer_group_id`,
      [g[0].id]
    );
    expect(pl[0].customer_group_id).toBe(g[0].id);

    // FK should reject a non-existent group id.
    await expect(
      db.query(
        `INSERT INTO price_lists (name, type, customer_group_id)
         VALUES ('V63 Bogus', 'customer_group', 9999999)`
      )
    ).rejects.toThrow(/foreign key|violates/i);
  });
});
