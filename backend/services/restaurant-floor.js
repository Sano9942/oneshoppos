/**
 * Restaurant floor plan and table session service.
 */

async function getFloorPlans(db, outletId) {
  const { rows } = await db.query(
    `SELECT fp.*,
       (SELECT COUNT(*)::int FROM restaurant_tables rt WHERE rt.floor_plan_id = fp.id AND rt.is_active = true) AS table_count
     FROM restaurant_floor_plans fp
     WHERE fp.outlet_id = $1
     ORDER BY fp.name`,
    [outletId]
  );
  return rows;
}

async function getFloorPlanWithTables(db, planId) {
  const { rows: [plan] } = await db.query(
    "SELECT * FROM restaurant_floor_plans WHERE id = $1",
    [planId]
  );
  if (!plan) return null;

  const { rows: sections } = await db.query(
    "SELECT * FROM restaurant_floor_sections WHERE floor_plan_id = $1 ORDER BY sort_order",
    [planId]
  );

  const { rows: tables } = await db.query(
    `SELECT rt.*,
       ts.id AS session_id, ts.status AS session_status, ts.guest_count, ts.server_id,
       ts.seated_at, e.name AS server_name
     FROM restaurant_tables rt
     LEFT JOIN restaurant_table_sessions ts ON ts.table_id = rt.id AND ts.status != 'closed'
     LEFT JOIN employees e ON e.id = ts.server_id
     WHERE rt.floor_plan_id = $1
     ORDER BY rt.label`,
    [planId]
  );

  return { ...plan, sections, tables };
}

async function createFloorPlan(db, data) {
  const { rows: [plan] } = await db.query(
    `INSERT INTO restaurant_floor_plans (outlet_id, name, layout_json)
     VALUES ($1, $2, $3) RETURNING *`,
    [data.outlet_id, data.name, JSON.stringify(data.layout_json || {})]
  );
  return plan;
}

async function updateFloorPlan(db, id, data) {
  const sets = [];
  const params = [];
  let idx = 0;

  if (data.name !== undefined) { idx++; sets.push(`name = $${idx}`); params.push(data.name); }
  if (data.is_active !== undefined) { idx++; sets.push(`is_active = $${idx}`); params.push(data.is_active); }
  if (data.layout_json !== undefined) { idx++; sets.push(`layout_json = $${idx}`); params.push(JSON.stringify(data.layout_json)); }

  if (!sets.length) return null;
  idx++; params.push(id);
  sets.push("updated_at = NOW()");

  const { rows: [plan] } = await db.query(
    `UPDATE restaurant_floor_plans SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return plan;
}

async function openTableSession(db, data) {
  // Check no active session on table
  const { rows: existing } = await db.query(
    "SELECT id FROM restaurant_table_sessions WHERE table_id = $1 AND status != 'closed'",
    [data.table_id]
  );
  if (existing.length) throw Object.assign(new Error("Table already has an active session"), { statusCode: 409 });

  // Get table's outlet
  const { rows: [table] } = await db.query(
    "SELECT rt.*, fp.outlet_id FROM restaurant_tables rt JOIN restaurant_floor_plans fp ON fp.id = rt.floor_plan_id WHERE rt.id = $1",
    [data.table_id]
  );
  if (!table) throw Object.assign(new Error("Table not found"), { statusCode: 404 });

  const { rows: [session] } = await db.query(
    `INSERT INTO restaurant_table_sessions (table_id, outlet_id, server_id, guest_count)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.table_id, table.outlet_id, data.server_id || null, data.guest_count || 1]
  );
  return session;
}

async function updateTableSession(db, id, data) {
  const sets = [];
  const params = [];
  let idx = 0;

  if (data.status !== undefined) {
    idx++; sets.push(`status = $${idx}`); params.push(data.status);
    if (data.status === "closed") sets.push("closed_at = NOW()");
  }
  if (data.server_id !== undefined) { idx++; sets.push(`server_id = $${idx}`); params.push(data.server_id); }
  if (data.guest_count !== undefined) { idx++; sets.push(`guest_count = $${idx}`); params.push(data.guest_count); }
  if (data.table_id !== undefined) {
    const { rows: [destTable] } = await db.query(
      "SELECT rt.*, fp.outlet_id FROM restaurant_tables rt JOIN restaurant_floor_plans fp ON fp.id = rt.floor_plan_id WHERE rt.id = $1",
      [data.table_id]
    );
    if (!destTable) throw Object.assign(new Error("Destination table not found"), { statusCode: 404 });
    idx++; sets.push(`table_id = $${idx}`); params.push(data.table_id);
    idx++; sets.push(`outlet_id = $${idx}`); params.push(destTable.outlet_id);
  }

  if (!sets.length) return null;
  idx++; params.push(id);
  sets.push("updated_at = NOW()");

  const { rows: [session] } = await db.query(
    `UPDATE restaurant_table_sessions SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return session;
}

module.exports = {
  getFloorPlans, getFloorPlanWithTables,
  createFloorPlan, updateFloorPlan,
  openTableSession, updateTableSession,
};
