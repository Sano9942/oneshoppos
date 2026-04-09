/**
 * Shared polling helper for Phase 4 surfaces (KDS, floor plan, booking calendar).
 * Returns rows changed since a given timestamp for a specified table.
 */

async function getChangesSince(db, table, since, outletId = null) {
  const params = [since];
  let where = "WHERE updated_at > $1";
  if (outletId) {
    params.push(outletId);
    where += ` AND outlet_id = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT * FROM ${table} ${where} ORDER BY updated_at ASC`,
    params
  );
  return rows;
}

module.exports = { getChangesSince };
