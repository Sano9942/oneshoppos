#!/usr/bin/env node
/**
 * One-off maintenance: remove the golv_* vertical-depth test tenants and the
 * leftover schemas of already soft-deleted tenants, to bring the relation and
 * file count inside what a Supabase free-tier instance can actually serve.
 *
 * The target list is an explicit allowlist — never a wildcard, never a LIKE.
 * A schema not named in TARGETS is never touched.
 *
 * Usage:
 *   node scripts/drop-test-tenants.js            # dry run, reports only
 *   node scripts/drop-test-tenants.js --execute  # actually removes
 *
 * Each schema is removed in its own statement rather than one batch: on a
 * throughput-starved disk a single large transaction is far more likely to
 * time out and roll the whole thing back.
 */
require("dotenv").config();
const { Client } = require("pg");

// 23 vertical-depth test tenants, all created 2026-07-06.
const GOLV = [
  "golv_general_retail", "golv_restaurant", "golv_salon", "golv_grocery",
  "golv_cafe", "golv_clinic", "golv_repair_shop", "golv_gym",
  "golv_wholesale", "golv_photography_studio", "golv_butcher",
  "golv_sweet_shop", "golv_textile", "golv_car_rental",
  "golv_equipment_hire", "golv_furniture_rental", "golv_party_supplies",
  "golv_hotel", "golv_guesthouse", "golv_hostel", "golv_dental_clinic",
  "golv_veterinary", "golv_physiotherapy",
];

// Already status='deleted' in the registry, but their schemas may still be on
// disk — migrate-pg.js filters on status='active', so these have been costing
// files while staying invisible to every migration sweep.
const SOFT_DELETED = [
  "packagesmall", "khantoys", "live_test_1", "livetest2",
  "bookfinders", "cafetest1", "d5_modes_proof",
];

// Deliberately preserved. Do not move anything here into TARGETS without an
// explicit decision — livetestauto in particular is the shared E2E tenant.
const KEEP = [
  "livetest1", "livetestauto", "sanoposlivetest1778021564659",
  "cafetestphase8", "grocerywalktest1778451", "wholesalewalktest1778451",
];

const TARGETS = [...GOLV, ...SOFT_DELETED];
const EXECUTE = process.argv.includes("--execute");

// Every public-schema table with a FK to tenants(id). All are ON DELETE NO
// ACTION, so the child rows must go first or the DELETE fails with
// "violates foreign key constraint". Verified against pg_constraint.
const CHILD_TABLES = [
  "email_queue",
  "impersonation_sessions",
  "payment_intents",
  "payment_records",
  "tenant_audit_log",
  "tenant_notes",
  "tenant_refresh_tokens",
  "upgrade_requests",
];

(async () => {
  const overlap = TARGETS.filter((t) => KEEP.includes(t));
  if (overlap.length) throw new Error("target/keep overlap: " + overlap.join(", "));

  // Slugs are interpolated into the batched statements below (parameters are
  // not available in the simple-query protocol these batches require), so
  // assert the allowlist really is the safe shape it looks like.
  const bad = TARGETS.filter((s) => !/^[a-z0-9_]{3,40}$/.test(s));
  if (bad.length) throw new Error("unsafe slug in target list: " + bad.join(", "));

  // Guard: backend/.env points at the LOCAL dev database. This script is only
  // ever meant for the production Supabase instance, reached via
  // `railway run node scripts/drop-test-tenants.js --execute`, which injects
  // the real DATABASE_URL (dotenv does not override an already-set env var).
  const url = process.env.DATABASE_URL || "";
  const host = (() => { try { return new URL(url).hostname; } catch { return "(unparseable)"; } })();
  console.log("target host: " + host + "\n");
  if (EXECUTE && !/supabase\.(co|com)$/.test(host)) {
    throw new Error(
      "refusing to --execute against non-Supabase host '" + host + "'. " +
      "Run via: railway run node scripts/drop-test-tenants.js --execute"
    );
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 120000,
  });
  await client.connect();

  console.log(EXECUTE ? "MODE: EXECUTE\n" : "MODE: DRY RUN (pass --execute to apply)\n");

  const present = (
    await client.query(
      "SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[])",
      [TARGETS.map((s) => "tenant_" + s)]
    )
  ).rows.map((r) => r.nspname);

  console.log(`schemas on disk matching targets: ${present.length} of ${TARGETS.length}\n`);

  let dropped = 0;
  let rowsDeleted = 0;

  for (const slug of TARGETS) {
    const schema = "tenant_" + slug;
    const hasSchema = present.includes(schema);

    if (!EXECUTE) {
      console.log("  would remove " + schema.padEnd(42) + (hasSchema ? "(schema present)" : "(schema absent)"));
      continue;
    }

    const started = Date.now();
    try {
      if (hasSchema) {
        // DATABASE_URL points at the Supabase TRANSACTION pooler (port 6543),
        // which does not keep session state across statements — a standalone
        // `SET statement_timeout = 0` is silently lost before the next query,
        // which is why a large DROP hit the role's default timeout. Sending
        // BEGIN/SET LOCAL/DROP/COMMIT as ONE simple-query batch keeps the whole
        // thing pinned to a single server connection, so SET LOCAL applies.
        // Identifier comes from the hardcoded allowlist above, never from input.
        await client.query(
          `BEGIN; SET LOCAL statement_timeout = 0; DROP SCHEMA "${schema}" CASCADE; COMMIT;`
        );
        dropped++;
      }

      // Children first: all FKs to tenants(id) are ON DELETE NO ACTION.
      const childDeletes = CHILD_TABLES.map(
        (t) => `DELETE FROM "${t}" WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = '${slug}');`
      ).join(" ");
      const res = await client.query(
        `BEGIN; SET LOCAL statement_timeout = 0; ${childDeletes} DELETE FROM tenants WHERE slug = '${slug}'; COMMIT;`
      );
      // Batched simple queries return an array of results, one per statement.
      const last = Array.isArray(res) ? res[res.length - 2] : res;
      rowsDeleted += (last && last.rowCount) || 0;

      console.log("  removed " + schema.padEnd(42) + (Date.now() - started) + "ms");
    } catch (err) {
      console.error("  FAILED  " + schema.padEnd(42) + err.message);
      await client.query("ROLLBACK").catch(() => {});
    }
  }

  if (EXECUTE) {
    console.log(`\nschemas dropped: ${dropped} | registry rows deleted: ${rowsDeleted}`);
    // VACUUM cannot run inside a transaction block, so it cannot borrow the
    // SET LOCAL trick used above and stays exposed to the role's statement
    // timeout on the pooler. Non-fatal: autovacuum reclaims the same space on
    // its own, and the schema drops have already returned the disk.
    console.log("running VACUUM ANALYZE (may time out on the pooler — autovacuum covers it)...");
    try {
      await client.query("VACUUM ANALYZE");
      console.log("vacuum done.");
    } catch (err) {
      console.log("vacuum skipped: " + err.message);
    }
  }

  await client.end();
})().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
