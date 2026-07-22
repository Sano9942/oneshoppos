/**
 * D8 copy-spec DRIFT GUARD (PLAN-V2 Step 12, owner ruling 2026-07-14).
 *
 * services/outlet-copy.js COPY_SPECS claims to account for every column of every
 * table it copies. This asserts that against the REAL schema: each column must
 * appear in exactly one of scope / copy / stamp / skip.
 *
 * Why this exists: an explicit column list silently drops columns added later by
 * a migration. That already nearly happened — kds_stations carries printer_id,
 * balance_strategy, target_prep_seconds and last_assigned_at, none of which are
 * in its CREATE TABLE. Without this guard, a future ALTER would quietly stop
 * being copied (or quietly start, if someone used SELECT *), and nobody would
 * notice until a merchant's new outlet was subtly wrong.
 *
 * When this test fails: a migration added a column to a copied table. RULE on it
 * — add it to `copy` (it's per-outlet configuration a new location should
 * inherit) or to `skip` WITH A REASON (it's identity, runtime state, a physical
 * binding, or a secret). Do not "fix" the test by loosening the assertion.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { COPY_SPECS } = require("../../services/outlet-copy");

describe("D8 copy-spec drift guard (Postgres)", () => {
  let db, cleanup, schemaName;

  beforeAll(async () => {
    ({ db, cleanup, schemaName } = await createTestApp());
  }, 60000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("classifies every column of every copied table (no silent drops)", async () => {
    const problems = [];

    for (const spec of COPY_SPECS) {
      const { rows } = await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2`,
        [schemaName, spec.table]
      );
      expect(
        rows.length,
        `${spec.table} not found in the test schema — is COPY_SPECS naming a real table?`
      ).toBeGreaterThan(0);

      const actual = new Set(rows.map((r) => r.column_name));
      const classified = new Set([
        ...(spec.scope === "outlet_id" ? ["outlet_id"] : ["scope_type", "scope_id"]),
        ...spec.copy,
        ...Object.keys(spec.stamp || {}),
        ...Object.keys(spec.skip || {}),
      ]);

      for (const col of actual) {
        if (!classified.has(col)) {
          problems.push(
            `${spec.table}.${col} — NEW COLUMN, unclassified. Add it to copy (per-outlet config a new location should inherit) or skip with a reason (identity / runtime state / physical binding / secret).`
          );
        }
      }
      for (const col of classified) {
        if (!actual.has(col)) {
          problems.push(
            `${spec.table}.${col} — classified in COPY_SPECS but GONE from the schema. Remove it from the spec.`
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it("never copies an identity, secret, physical binding or runtime-state column", async () => {
    // A belt-and-braces read of the ruling: these names must never appear in a
    // `copy` list, whatever a future editor believes.
    const FORBIDDEN = ["id", "printer_id", "device_uuid", "slot_token", "last_assigned_at"];
    const violations = [];
    for (const spec of COPY_SPECS) {
      for (const col of spec.copy) {
        if (FORBIDDEN.includes(col)) violations.push(`${spec.table}.${col}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("only lists tables the owner ruled copyable", async () => {
    // The ruling is the allowlist. Widening it is a decision, not a refactor —
    // this fails if a table is added without the plan being updated first.
    expect(COPY_SPECS.map((s) => s.table).sort()).toEqual([
      "approval_policies",
      "kds_stations",
      "outlet_business_modules",
      "outlet_product_visibility",
      "pos_layouts",
      "price_list_assignments",
      "tip_pool_distribution_rules",
    ]);
  });
});
