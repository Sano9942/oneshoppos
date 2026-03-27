/**
 * Cleanup tenants with setup_complete = false after 7 days.
 * Safety: skips tenants that have any sales data.
 * Usage: node backend/jobs/cleanup-dead-tenants.js [--dry-run]
 */
const dbPg = require("../db-pg");
const masterDb = require("../master-db-pg");
const tenantDbManager = require("../tenant-db-manager-pg");

async function cleanupDeadTenants({ dryRun = false } = {}) {
  const { rows: candidates } = await masterDb.query(
    `SELECT id, slug, name, created_at FROM tenants
     WHERE status = 'active'
       AND created_at < NOW() - INTERVAL '7 days'`
  );

  const results = { checked: 0, deleted: 0, skipped: 0, details: [] };

  for (const tenant of candidates) {
    results.checked++;
    try {
      const tenantDb = await tenantDbManager.getDb(tenant.id);

      // Check if setup is incomplete
      const { rows: [profile] } = await tenantDb.query(
        "SELECT setup_complete FROM company_profile WHERE id = 1"
      );
      if (!profile || profile.setup_complete) {
        results.skipped++;
        continue;
      }

      // Safety: skip if any sales exist
      const { rows: [salesCheck] } = await tenantDb.query(
        "SELECT COUNT(*) as count FROM sales LIMIT 1"
      );
      if (Number(salesCheck.count) > 0) {
        results.skipped++;
        results.details.push({ slug: tenant.slug, action: "skipped", reason: "has sales data" });
        continue;
      }

      if (dryRun) {
        results.deleted++;
        results.details.push({ slug: tenant.slug, action: "would_delete", created: tenant.created_at });
        continue;
      }

      // Drop tenant schema
      await dbPg.query(`DROP SCHEMA IF EXISTS tenant_${tenant.slug} CASCADE`);

      // Mark tenant as deleted in master
      await masterDb.query(
        "UPDATE tenants SET status = 'deleted', deleted_at = NOW() WHERE id = $1",
        [tenant.id]
      );

      // Audit log — IMPORTANT: column is `actor`, not `performed_by`
      await masterDb.query(
        `INSERT INTO tenant_audit_log (tenant_id, action, details, actor)
         VALUES ($1, 'auto_cleanup_incomplete_setup', $2, 'system')`,
        [tenant.id, JSON.stringify({ slug: tenant.slug, created_at: tenant.created_at })]
      );

      results.deleted++;
      results.details.push({ slug: tenant.slug, action: "deleted", created: tenant.created_at });
      console.log(`[cleanup] Deleted dead tenant: ${tenant.slug} (created ${tenant.created_at})`);
    } catch (err) {
      results.skipped++;
      results.details.push({ slug: tenant.slug, action: "error", error: err.message });
      console.error(`[cleanup] Error processing ${tenant.slug}:`, err.message);
    }
  }

  return results;
}

// CLI mode
if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`[cleanup] Running ${dryRun ? "DRY RUN" : "LIVE"}...`);
  cleanupDeadTenants({ dryRun })
    .then((r) => {
      console.log(`[cleanup] Done. Checked: ${r.checked}, Deleted: ${r.deleted}, Skipped: ${r.skipped}`);
      if (r.details.length) console.table(r.details);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[cleanup] Fatal:", err);
      process.exit(1);
    });
}

module.exports = { cleanupDeadTenants };
