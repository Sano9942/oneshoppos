// backend/tenant-provisioner-pg.js
// Provisions a new tenant: creates schema, runs DDL, seeds data, registers in public.tenants.
// No filesystem operations — everything lives in Postgres schemas.
//
// CLI usage:
//   node backend/tenant-provisioner-pg.js --slug aces-hardware --name "Aces Hardware" --pin 1234

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { MIGRATIONS } = require("./migrate-pg");

const SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "schema-pg.sql"), "utf8"
);
const BCRYPT_ROUNDS = 10;

const ALL_PERMISSIONS = [
  "all_access",
  "manage_customers",
  "manage_employees",
  "manage_inventory",
  "manage_orders",
  "pos_discount",
  "pos_park",
  "pos_void",
  "view_reports",
  "void_sales",
];

/**
 * Provisions a new tenant schema with seed data and registers in public.tenants.
 *
 * @param {object} db - The db-pg pool wrapper
 * @param {object} opts
 * @param {string} opts.slug - Tenant slug (3-40 chars, lowercase+numbers+underscores, no hyphens)
 * @param {string} opts.name - Store display name
 * @param {string} opts.ownerEmail - Owner email
 * @param {string} opts.timezone - IANA timezone (default "UTC")
 * @param {string} opts.pin - Admin PIN (4-8 digits)
 * @returns {Promise<{tenantId: number, employeeId: number, outletId: number}>}
 */
async function provision(db, { slug, name, ownerEmail, timezone, pin }) {
  validateSlug(slug);
  if (!name) throw new Error("name is required");
  if (!pin || !/^\d{4,8}$/.test(pin)) throw new Error("pin must be 4-8 digits");

  // Defense-in-depth: convert any hyphens to underscores for Postgres schema name safety
  const safeSlug = slug.replace(/-/g, "_");
  const schemaName = `tenant_${safeSlug}`;
  const crypto = require("crypto");
  const setupToken = crypto.randomBytes(32).toString("hex");
  const pinHash = await bcrypt.hash(String(pin), BCRYPT_ROUNDS);

  // Step 1 — create schema. Autocommit on purpose: CREATE SCHEMA IF NOT EXISTS
  // is not rolled back cleanly on some PgBouncer configurations, so we do it
  // outside the transaction. The schema becomes an "orphan" only if the
  // subsequent transaction fails AND the explicit DROP SCHEMA cleanup below
  // also fails — at which point `GET /api/admin/orphaned-schemas` picks it up.
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);

  const client = await db.getClient();
  try {
    // --- Tenant schema: DDL + seed (all inside ONE transaction on ONE client) ---
    //
    // Why SET LOCAL instead of session-level SET search_path:
    //   Supabase uses PgBouncer transaction-mode pooling. Session-level SET
    //   persists on the connection and can leak to another caller after
    //   release(). SET LOCAL scopes to the current transaction and reverts
    //   automatically on COMMIT/ROLLBACK — no leakage possible.
    //
    // Why a single BEGIN…COMMIT covering everything:
    //   Previously the 7 seed INSERTs ran autocommit. Any mid-sequence failure
    //   left partial rows in the tenant schema, and retries on the same
    //   connection hit unique-key violations ('roles_name_key', 'taxes_name_key')
    //   or dangling FK errors ('employee_outlets_outlet_id_fkey'). One atomic
    //   unit = either everything seeds or nothing does.
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path = '${schemaName}'`);
    await client.query(SCHEMA_SQL);

    // Mark every existing migration as applied. schema-pg.sql is kept in sync
    // with all migrations, so a freshly-provisioned schema already contains
    // every column/constraint v1..vN would add. Without this seed, the next
    // migrateAllTenants() boot replays v1..vN as no-ops on idempotent guards
    // (slow, brittle), and any non-idempotent migration would fail. Seed once,
    // skip the replay forever.
    if (MIGRATIONS.length > 0) {
      const values = MIGRATIONS.map((_, i) => `($${i + 1})`).join(", ");
      await client.query(
        `INSERT INTO schema_version (version) VALUES ${values} ON CONFLICT DO NOTHING`,
        MIGRATIONS.map((m) => m.version)
      );
    }

    // Outlet
    const outletRes = await client.query(
      "INSERT INTO outlets (name, address) VALUES ($1, '') RETURNING id",
      [name]
    );
    const outletId = outletRes.rows[0].id;

    // Admin role
    const roleRes = await client.query(
      "INSERT INTO roles (name, description) VALUES ('Admin', 'Full access admin role') RETURNING id"
    );
    const roleId = roleRes.rows[0].id;

    // Role permissions
    for (const perm of ALL_PERMISSIONS) {
      await client.query(
        "INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [roleId, perm]
      );
    }

    // Admin employee. Set the legacy `role` text column explicitly to
    // 'Administrator' — the column defaults to 'Cashier' (see schema-pg.sql)
    // and any UI surface that still reads the text column instead of joining
    // through role_id would otherwise show the owner as a cashier.
    const empRes = await client.query(
      "INSERT INTO employees (name, role, pin_hash, role_id) VALUES ('Admin', 'Administrator', $1, $2) RETURNING id",
      [pinHash, roleId]
    );
    const employeeId = empRes.rows[0].id;

    // Employee-outlet link
    await client.query(
      "INSERT INTO employee_outlets (employee_id, outlet_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [employeeId, outletId]
    );

    // Company profile with setup token
    await client.query(
      `INSERT INTO company_profile (id, company_name, timezone, setup_token, setup_token_expires_at, setup_complete)
       VALUES (1, $1, $2, $3, NOW() + INTERVAL '48 hours', false)
       ON CONFLICT (id) DO UPDATE SET setup_token = $3, setup_token_expires_at = NOW() + INTERVAL '48 hours', company_name = $1, timezone = $2`,
      [name, timezone || "UTC", setupToken]
    );

    // Default tax — 0% baseline marked as default. Merchants who need
    // country-specific taxes (GST 17% for PK, etc.) add them via the
    // Taxes settings page or the optional Step 3 wizard field.
    await client.query(
      "INSERT INTO taxes (name, rate, is_default) VALUES ('Default Tax', 0, true)"
    );

    await client.query("COMMIT");

    // --- Public master: tenants + audit (separate transaction, separate schema) ---
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = 'public'");
    const tenantRes = await client.query(
      `INSERT INTO tenants (slug, name, owner_email, timezone)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [slug, name, ownerEmail || "admin@example.com", timezone || "UTC"]
    );
    const tenantId = tenantRes.rows[0].id;

    await client.query(
      `INSERT INTO tenant_audit_log (tenant_id, action, details, actor)
       VALUES ($1, 'created', $2, 'system')`,
      [tenantId, JSON.stringify({ slug, timezone, provisioned_at: new Date().toISOString() })]
    );
    await client.query("COMMIT");

    return { tenantId, employeeId, outletId, setupToken };
  } catch (err) {
    // Roll back whichever transaction is open, then drop the schema to keep
    // the orphan list clean. Both cleanup operations are best-effort —
    // orphaned-schemas admin endpoint is the safety net.
    await client.query("ROLLBACK").catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function validateSlug(slug) {
  if (!slug) throw new Error("slug is required");
  if (!/^[a-z0-9_]{3,40}$/.test(slug)) {
    throw new Error("slug must be 3-40 chars, lowercase letters, numbers, and underscores only (no hyphens)");
  }
}

// --- CLI ---
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  return {
    slug: get("--slug"),
    name: get("--name"),
    timezone: get("--timezone") || "UTC",
    pin: get("--pin"),
    ownerEmail: get("--email") || "admin@example.com",
  };
}

async function main() {
  const args = parseArgs();
  const db = require("./db-pg");
  const masterDb = require("./master-db-pg");

  await masterDb.init(db);

  console.log(`\nProvisioning tenant: ${args.slug}`);
  console.log(`  Name:     ${args.name}`);
  console.log(`  Timezone: ${args.timezone}\n`);

  const result = await provision(db, args);

  console.log("\n\u2705 Tenant provisioned successfully!");
  console.log(`   tenant_id:   ${result.tenantId}`);
  console.log(`   slug:        ${args.slug}`);
  console.log(`   schema:      tenant_${args.slug}`);
  console.log(`   employee_id: ${result.employeeId} (PIN: ${args.pin})`);
  console.log(`   outlet_id:   ${result.outletId}`);

  await db.end();
}

// Run CLI if invoked directly
if (require.main === module) {
  main().catch((err) => {
    console.error("\n\u274C Provisioning failed:", err.message);
    process.exit(1);
  });
}

module.exports = { provision, validateSlug };
