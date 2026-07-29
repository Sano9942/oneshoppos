/**
 * master-db-pg.transaction() — P0-2.
 *
 * The module shipped with `query()` and no `transaction()`, so every
 * multi-statement master write was a run of independent autocommits. The
 * billing webhook was the expensive case: mark the payment intent completed,
 * activate the tenant, record the payment — three separate commits. A failure
 * after the first left a merchant who had paid and could not use the product,
 * and the handler's own idempotency guard ("intent already completed → Already
 * processed") meant every gateway retry short-circuited before reaching the
 * activation it still needed.
 *
 * These tests use a fake pool so they assert the transaction *contract* — that
 * a mid-callback failure rolls back and the client is always released — rather
 * than needing a live Postgres. The contract is what the webhook depends on.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const masterDb = require("../../master-db-pg");

/** Records every statement issued, and can be told to blow up on one of them. */
function fakePool() {
  const statements = [];
  let released = 0;
  let failOn = null;
  const client = {
    query: async (sql) => {
      const text = typeof sql === "string" ? sql : sql.text;
      statements.push(text);
      if (failOn && text.includes(failOn)) throw new Error(`boom: ${failOn}`);
      return { rows: [] };
    },
    release: () => { released += 1; },
  };
  return {
    pool: { connect: async () => client },
    statements,
    get released() { return released; },
    // init() opens its own BEGIN/SET/DDL/COMMIT and releases the client, so the
    // recorder has to be zeroed afterwards or every assertion below is counting
    // schema bootstrap alongside the transaction under test.
    reset() { statements.length = 0; released = 0; },
    // Armed only AFTER init, because MASTER_SCHEMA's DDL mentions `tenants` and
    // `payment_records` — arming beforehand blows up the bootstrap instead of
    // the statement under test, and the failure looks identical.
    arm(sub) { failOn = sub; },
  };
}

/** Point masterDb at a fresh recorder, zeroed past init and optionally armed. */
async function attach({ failOn = null } = {}) {
  const p = fakePool();
  await masterDb.init({ pool: p.pool });
  p.reset();
  p.arm(failOn);
  return p;
}

let pool;
beforeEach(async () => {
  pool = await attach();
});

describe("masterDb.transaction", () => {
  it("is exported — the billing webhook cannot be atomic without it", () => {
    expect(typeof masterDb.transaction).toBe("function");
  });

  it("wraps the callback in BEGIN/COMMIT and pins search_path to public once", async () => {
    await masterDb.transaction(async (client) => {
      await client.query("UPDATE tenants SET payment_status = 'active'");
      await client.query("INSERT INTO payment_records DEFAULT VALUES");
      await client.query("UPDATE payment_intents SET status = 'completed'");
    });

    expect(pool.statements[0]).toBe("BEGIN");
    expect(pool.statements[1]).toContain("SET LOCAL search_path TO public");
    expect(pool.statements[pool.statements.length - 1]).toBe("COMMIT");
    // One BEGIN for the batch, not one per statement — that difference is the
    // whole point, and it is also what guarantees every statement lands on the
    // same backend under Supavisor transaction-mode pooling.
    expect(pool.statements.filter((s) => s === "BEGIN")).toHaveLength(1);
    expect(pool.statements.filter((s) => s.includes("SET LOCAL search_path"))).toHaveLength(1);
  });

  it("returns the callback's value", async () => {
    const out = await masterDb.transaction(async () => ({ activated: 7 }));
    expect(out).toEqual({ activated: 7 });
  });

  it("ROLLBACKs and rethrows when a statement fails mid-batch", async () => {
    pool = await attach({ failOn: "payment_records" });

    await expect(
      masterDb.transaction(async (client) => {
        await client.query("UPDATE tenants SET payment_status = 'active'");
        await client.query("INSERT INTO payment_records DEFAULT VALUES");
        await client.query("UPDATE payment_intents SET status = 'completed'");
      })
    ).rejects.toThrow(/boom/);

    expect(pool.statements).toContain("ROLLBACK");
    expect(pool.statements).not.toContain("COMMIT");
    // The statement after the failure never ran, so the intent is NOT marked
    // completed — which is what keeps the gateway's retry able to do the work.
    expect(pool.statements.some((s) => s.includes("payment_intents"))).toBe(false);
  });

  it("releases the client on both paths", async () => {
    await masterDb.transaction(async () => {});
    expect(pool.released).toBe(1);

    pool = await attach({ failOn: "tenants" });
    await expect(
      masterDb.transaction(async (client) => { await client.query("UPDATE tenants SET x = 1"); })
    ).rejects.toThrow();
    expect(pool.released).toBe(1);
  });
});

describe("billing webhook ordering", () => {
  it("activates the tenant before marking the intent completed", () => {
    // Ordering is defence in depth: if only a prefix of the block ever lands —
    // someone unwraps the transaction, or a statement is inserted between them
    // — the merchant should end up with access and a re-runnable intent, never
    // an intent marked done and a tenant still locked out. Asserted against the
    // source because the failure it guards cannot be reproduced once the
    // transaction is correct.
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "routes", "webhooks.js"), "utf8");

    const activate = src.indexOf("payment_status = 'active'");
    const complete = src.indexOf("UPDATE payment_intents SET status = 'completed'");
    expect(activate).toBeGreaterThan(-1);
    expect(complete).toBeGreaterThan(-1);
    expect(activate, "tenant activation must precede marking the intent completed").toBeLessThan(complete);

    // And all three must be inside masterDb.transaction, not autocommits.
    const txAt = src.indexOf("masterDb.transaction");
    expect(txAt).toBeGreaterThan(-1);
    expect(txAt).toBeLessThan(activate);
  });
});
