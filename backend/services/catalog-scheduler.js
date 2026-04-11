const { PRODUCT_FIELDS, VARIANT_FIELDS } = require("../schemas/scheduled-changes");

function resolveTable(entityType) {
  if (entityType === "product") return { table: "products", allowed: PRODUCT_FIELDS };
  if (entityType === "variant") return { table: "product_variants", allowed: VARIANT_FIELDS };
  return null;
}

/**
 * Apply a single row from `scheduled_catalog_changes`. Caller is expected to
 * pass a db with `.query()` and `.transaction()` (a tenant-scoped pool, not
 * a transaction client — this function opens its own transaction internally
 * so target UPDATE and status='applied' land atomically).
 *
 * On success: target row updated, change row marked 'applied'.
 * On validation failure (bad entity_type / field_name not in allowlist):
 * change row marked 'failed' via a fresh query. No throw.
 * On UPDATE error (e.g. target row missing, constraint violation):
 * transaction rolls back, change row marked 'failed' via a fresh query.
 * No throw — caller loops over many rows and one bad row shouldn't stop the rest.
 */
async function applyScheduledChange(db, change) {
  const resolved = resolveTable(change.entity_type);
  if (!resolved) {
    await db.query(
      "UPDATE scheduled_catalog_changes SET status = 'failed', applied_at = NOW() WHERE id = $1",
      [change.id]
    );
    return { status: "failed", reason: "unknown entity_type" };
  }

  if (!resolved.allowed.includes(change.field_name)) {
    await db.query(
      "UPDATE scheduled_catalog_changes SET status = 'failed', applied_at = NOW() WHERE id = $1",
      [change.id]
    );
    return { status: "failed", reason: "field_name not in allowlist" };
  }

  const updateSql = `UPDATE ${resolved.table} SET ${change.field_name} = $1 WHERE id = $2`;

  try {
    await db.transaction(async (client) => {
      await client.query(updateSql, [change.new_value, change.entity_id]);
      await client.query(
        "UPDATE scheduled_catalog_changes SET status = 'applied', applied_at = NOW() WHERE id = $1",
        [change.id]
      );
    });
    return { status: "applied" };
  } catch (err) {
    await db.query(
      "UPDATE scheduled_catalog_changes SET status = 'failed', applied_at = NOW() WHERE id = $1",
      [change.id]
    );
    return { status: "failed", reason: err.message };
  }
}

module.exports = { applyScheduledChange };
