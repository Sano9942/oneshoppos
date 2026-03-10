const { describe, it, expect, afterAll } = require("vitest");

// This test verifies the pg connection layer works
describe("db-pg connection", () => {
  let db;

  it("connects and runs a simple query", async () => {
    db = require("../../db-pg");
    const result = await db.query("SELECT 1 AS alive");
    expect(result.rows[0].alive).toBe(1);
  });

  it("runs a transaction that commits", async () => {
    const result = await db.transaction(async (client) => {
      await client.query("CREATE TEMP TABLE _test_tx (id SERIAL PRIMARY KEY, val TEXT)");
      await client.query("INSERT INTO _test_tx (val) VALUES ($1)", ["hello"]);
      const { rows } = await client.query("SELECT val FROM _test_tx WHERE id = 1");
      return rows[0];
    });
    expect(result.val).toBe("hello");
  });

  it("rolls back a transaction on error", async () => {
    try {
      await db.transaction(async (client) => {
        await client.query("CREATE TEMP TABLE _test_rb (id SERIAL)");
        throw new Error("deliberate rollback");
      });
    } catch (err) {
      expect(err.message).toBe("deliberate rollback");
    }
    // Table should not exist after rollback
    const result = await db.query(
      "SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = '_test_rb') AS exists"
    );
    expect(result.rows[0].exists).toBe(false);
  });

  afterAll(async () => {
    if (db) await db.end();
  });
});
