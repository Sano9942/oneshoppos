// backend/tenant-provisioner-pg.js
// Provisions a new tenant: creates schema, runs DDL, seeds data, registers in public.tenants.
// No filesystem operations — everything lives in Postgres schemas.
//
// CLI usage:
//   node backend/tenant-provisioner-pg.js --slug aces-hardware --name "Aces Hardware" --pin 1234

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

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
 * @param {string} opts.slug - Tenant slug (3-40 chars, lowercase+numbers+hyphens)
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

  const schemaName = `tenant_${slug}`;

  // Step 1: Create schema
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);

  // Step 2: Run DDL in the new schema
  const client = await db.getClient();
  try {
    await client.query(`SET search_path = '${schemaName}'`);
    await client.query(SCHEMA_SQL);

    // Step 3: Seed data
    const pinHash = await bcrypt.hash(String(pin), BCRYPT_ROUNDS);

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

    // Admin employee
    const empRes = await client.query(
      "INSERT INTO employees (name, pin_code, pin_hash, role_id) VALUES ('Admin', $1, $2, $3) RETURNING id",
      [pin, pinHash, roleId]
    );
    const employeeId = empRes.rows[0].id;

    // Employee-outlet link
    await client.query(
      "INSERT INTO employee_outlets (employee_id, outlet_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [employeeId, outletId]
    );

    // Company profile
    await client.query(
      "INSERT INTO company_profile (id, company_name, timezone) VALUES (1, $1, $2) ON CONFLICT DO NOTHING",
      [name, timezone || "UTC"]
    );

    // Default tax
    await client.query(
      "INSERT INTO taxes (name, rate) VALUES ('Default Tax', 0)"
    );

    // Reset search_path
    await client.query("SET search_path = 'public'");

    // Step 4: Register in public.tenants + audit log (transaction)
    await client.query("BEGIN");
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

    return { tenantId, employeeId, outletId };
  } catch (err) {
    // Attempt to drop the schema on failure
    await client.query("ROLLBACK").catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function validateSlug(slug) {
  if (!slug) throw new Error("slug is required");
  if (!/^[a-z0-9_-]{3,40}$/.test(slug)) {
    throw new Error("slug must be 3-40 chars, lowercase letters, numbers, underscores, and hyphens only");
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
