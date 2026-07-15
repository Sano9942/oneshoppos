// Pure helpers for the per-outlet role override editor (PLAN-V2 Step 14 / D2b).
//
// Contract gotcha (Step 13): PUT /api/employees/:id/outlets is bulk-replace —
// OMITTING outlet_roles clears every override. The editor must therefore
// always round-trip the full map: explicit role_id for overridden outlets,
// null for inherit.

// Build the outlet_roles payload for the PUT from the assigned outlet ids and
// the editor's override state ({ [outlet_id]: role_id } — explicit overrides
// only). Every assigned outlet gets a key; "" / undefined / null → null.
export function buildOutletRolesMap(assignedOutletIds, overrides) {
  const map = {};
  for (const outletId of assignedOutletIds || []) {
    const v = overrides?.[outletId];
    map[outletId] = v == null || v === "" ? null : Number(v);
  }
  return map;
}

// Extract the editor's override state from GET /api/employees/:id/outlets
// rows (role_id per row is the override; null = inherit).
export function overridesFromAssignments(rows) {
  const map = {};
  for (const row of rows || []) {
    if (row.role_id != null) map[row.outlet_id] = Number(row.role_id);
  }
  return map;
}
