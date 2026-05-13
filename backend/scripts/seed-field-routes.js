#!/usr/bin/env node
/**
 * seed-field-routes.js — Tier 1.1 wholesale: one-shot CLI to seed a tenant's
 * field-rep weekly beat plan from a JSON file. The owner-facing UI for this
 * is deferred to 1.1.5 — this script is the temporary admin tool used by
 * support to set up routes during onboarding.
 *
 * Usage:
 *   node backend/scripts/seed-field-routes.js \
 *     --tenant <slug> \
 *     --employee <employee_id> \
 *     --routes <path/to/routes.json>
 *
 * routes.json schema:
 *   {
 *     "0": [12, 17, 23],          // Sunday: visit customer IDs in this order
 *     "1": [34, 41, 52, 88],      // Monday
 *     "2": [...],                 // Tuesday
 *     ...
 *   }
 *
 * Behaviour: For each provided day, deletes existing route rows for
 * (employee_id, day_of_week) and inserts the new list. Days not present in
 * the JSON are left untouched. Idempotent — safe to re-run after edits.
 *
 * Requires DATABASE_URL + MULTI_TENANT=1.
 */
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function parseArgs() {
  const args = { tenant: null, employee: null, routes: null };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--tenant") args.tenant = process.argv[++i];
    else if (a === "--employee") args.employee = process.argv[++i];
    else if (a === "--routes") args.routes = process.argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node backend/scripts/seed-field-routes.js --tenant <slug> --employee <id> --routes <file.json>`);
      process.exit(0);
    }
  }
  if (!args.tenant || !args.employee || !args.routes) {
    console.error("Missing required args. See --help.");
    process.exit(1);
  }
  return args;
}

async function main() {
  const { tenant, employee, routes: routesPath } = parseArgs();
  const employeeId = Number(employee);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    console.error(`Invalid --employee: ${employee}`);
    process.exit(1);
  }

  const routesFile = path.resolve(routesPath);
  if (!fs.existsSync(routesFile)) {
    console.error(`Routes file not found: ${routesFile}`);
    process.exit(1);
  }
  let routesJson;
  try {
    routesJson = JSON.parse(fs.readFileSync(routesFile, "utf-8"));
  } catch (e) {
    console.error(`Could not parse JSON: ${e.message}`);
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });

  try {
    // Resolve tenant schema. Master `tenants` table lives in `public`.
    const client = await pool.connect();
    const { rows: [tenantRow] } = await client.query(
      "SELECT id, slug, status FROM public.tenants WHERE slug = $1",
      [tenant]
    );
    if (!tenantRow) {
      console.error(`Tenant '${tenant}' not found`);
      client.release();
      process.exit(1);
    }
    if (tenantRow.status !== "active") {
      console.error(`Tenant '${tenant}' is not active (status=${tenantRow.status})`);
      client.release();
      process.exit(1);
    }
    const schema = `tenant_${tenantRow.slug}`;
    await client.query(`SET search_path TO "${schema}", public`);

    // Sanity: confirm employee exists and is in this tenant
    const { rows: [emp] } = await client.query(
      `SELECT id, name, employee_type FROM employees WHERE id = $1 AND deleted_at IS NULL`,
      [employeeId]
    );
    if (!emp) {
      console.error(`Employee ${employeeId} not found in tenant ${tenant}`);
      client.release();
      process.exit(1);
    }
    if (emp.employee_type !== "field_rep") {
      console.warn(`[warn] Employee ${employeeId} (${emp.name}) is employee_type='${emp.employee_type}', not 'field_rep'. Continuing anyway.`);
    }

    let totalInserted = 0;
    let daysProcessed = 0;

    for (const dowKey of Object.keys(routesJson)) {
      const dow = Number(dowKey);
      if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
        console.warn(`[skip] Day of week '${dowKey}' is not 0-6`);
        continue;
      }
      const customerIds = routesJson[dowKey];
      if (!Array.isArray(customerIds)) {
        console.warn(`[skip] Day ${dow} value is not an array`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(
          "DELETE FROM field_rep_routes WHERE employee_id = $1 AND day_of_week = $2",
          [employeeId, dow]
        );
        for (let i = 0; i < customerIds.length; i++) {
          const cid = Number(customerIds[i]);
          if (!Number.isInteger(cid)) {
            console.warn(`[skip row] Day ${dow} index ${i} value '${customerIds[i]}' is not a number`);
            continue;
          }
          await client.query(
            `INSERT INTO field_rep_routes (employee_id, day_of_week, customer_id, visit_order)
             VALUES ($1, $2, $3, $4)`,
            [employeeId, dow, cid, i + 1]
          );
          totalInserted++;
        }
        await client.query("COMMIT");
        daysProcessed++;
        console.log(`[day ${dow}] Seeded ${customerIds.length} customer(s)`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`[day ${dow}] Failed: ${err.message}`);
      }
    }

    client.release();
    console.log(`\nDone. ${daysProcessed} day(s) processed, ${totalInserted} route row(s) inserted.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
