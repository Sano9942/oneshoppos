/**
 * D8 "copy settings from" — the ONE place that knows what a brand-new outlet
 * inherits from an existing one (PLAN-V2 Step 12; owner ruling 2026-07-14).
 *
 * Everything here runs inside the caller's outlet-creation transaction
 * (routes/outlets.js), so a failure in any table rolls back the outlet itself —
 * a half-copied location must never exist.
 *
 * WHAT IS NOT HERE IS THE POINT. The ruling's durable rule: a table whose
 * existence is justified by per-outlet DIVERGENCE, or which represents
 * PHYSICAL/PERSONAL reality, is never copyable — and a copy must never silently
 * satisfy a REQUIRED setup-checklist item (D6/Step 11). So, deliberately absent:
 *   outlet_tax_profiles(+lines) — the table exists BECAUSE outlets differ on tax;
 *       an absent profile falls back to the normal tenant-wide cascade, whereas a
 *       wrongly-inherited one mis-charges tax silently (FBR exposure).
 *   menu_schedules            — schedules are RESTRICTIONS (no rows = always
 *       available), so copying can silently make items unavailable.
 *   booking_services / booking_resources / room_types / rental_items — these ARE
 *       the required D6 checklist items; copying marks a new outlet "set up".
 *   restaurant_floor_plans    — layout_json describes a different physical room.
 *   booking_availability_rules— references employee_id (staff never copies).
 *   shopify_location_map      — would sync the new outlet to the SOURCE's
 *       physical Shopify location.
 *   restaurant_kiosk_slots    — slot_token is a live capability token.
 *   pos_device_registry       — device_uuid is physical hardware.
 *   modifier_groups           — de-facto tenant-global (PLAN-V3 Step 6, owner
 *       ruled NEVER 2026-07-23). Its outlet_id column is vestigial: the POS
 *       per-product path (services/modifiers.js:getModifierTreeForProduct) and
 *       the back-office list both IGNORE outlet_id, and the create form never
 *       sets it — so a new outlet already sees every product's full modifier
 *       tree with zero copy. A per-outlet copy would either double-display a
 *       modifier at EVERY outlet (copying the product links, since the tree
 *       query is outlet-blind) or leave dead unreferenced rows (not copying
 *       them); there is nothing it can correctly add. No UNIQUE key on the
 *       table means a copy would also silently double groups on re-run.
 *
 * approval_policies WAS parked here "until after D2"; D2 landed (v137) and the
 * owner ruled COPY (PLAN-V3 Step 5, 2026-07-23) — it is now in COPY_SPECS below.
 * Its role_id is a tenant-global roles(id) ref (per-outlet roles live in
 * employee_outlets, not here), so a copied policy resolves cleanly at the new
 * outlet; only outlet-specific rows copy (outlet_id = source), and global
 * (outlet_id IS NULL) rows already cover the new outlet so they are left alone.
 *
 * COPY_SPECS is also a CONTRACT: every column of every listed table must appear
 * in exactly one of scope/copy/stamp/skip. tests/unit/outlet-copy-drift.test.js
 * (backed by an integration column check) fails when a migration adds a column
 * nobody classified — the alternative is an explicit column list silently
 * dropping it. That already almost happened: kds_stations carries four columns
 * its CREATE TABLE doesn't show.
 */

// Column-name/table-name interpolation below is safe: every identifier comes
// from this static map, never from a request. Values are always parameterised.
const COPY_SPECS = [
  {
    table: "outlet_business_modules",
    scope: "outlet_id",
    copy: ["module_key", "enabled"],
    stamp: { updated_by: "actor", updated_at: "now" },
    skip: {},
  },
  {
    table: "pos_layouts",
    // Outlet-scoped via a polymorphic scope_type/scope_id pair, NOT an
    // outlet_id column — invisible to an outlet_id grep. Same for
    // price_list_assignments below.
    scope: "scope_pair",
    copy: ["name", "layout_json", "is_active"],
    stamp: { created_by: "employee", created_at: "now", updated_at: "now" },
    skip: { id: "serial" },
  },
  {
    table: "outlet_product_visibility",
    scope: "outlet_id",
    copy: ["product_id", "is_visible"],
    stamp: { created_at: "now", updated_at: "now" },
    skip: { id: "serial" },
  },
  {
    table: "price_list_assignments",
    scope: "scope_pair",
    copy: ["price_list_id", "priority", "is_active", "starts_at", "ends_at"],
    stamp: { created_at: "now" },
    skip: { id: "serial" },
  },
  {
    table: "tip_pool_distribution_rules",
    // Partial unique index allows one default per outlet; the source can hold at
    // most one, and the target starts empty, so the copy lands cleanly.
    scope: "outlet_id",
    copy: ["name", "strategy", "config_jsonb", "is_default", "is_active"],
    stamp: { created_at: "now", updated_at: "now" },
    skip: { id: "serial" },
  },
  {
    table: "kds_stations",
    scope: "outlet_id",
    copy: ["name", "station_role", "is_active", "balance_strategy", "target_prep_seconds"],
    stamp: { created_at: "now", updated_at: "now" },
    skip: {
      id: "serial",
      // printer_config is TENANT-WIDE and holds a host/port for one physical
      // printer. Carrying printer_id would point the new outlet's station at
      // hardware standing in the source outlet. FK is ON DELETE SET NULL, so
      // NULL is an expected state — the merchant picks the printer on site.
      printer_id: "binds to a physical printer at the source outlet",
      last_assigned_at: "runtime load-balancing state, not configuration",
    },
  },
  {
    // PLAN-V3 Step 5 (owner ruling COPY, 2026-07-23). Approval thresholds are
    // per-outlet loss-prevention CONFIG a new location wants a sane default of —
    // like outlet_business_modules. role_id → roles(id) is TENANT-GLOBAL (per-
    // outlet roles live in employee_outlets, never here), so a copied policy
    // resolves at the new outlet unchanged. Only outlet-specific rows copy
    // (WHERE outlet_id = source); global (outlet_id IS NULL) policies already
    // apply everywhere and are deliberately not duplicated.
    table: "approval_policies",
    scope: "outlet_id",
    copy: ["action_type", "role_id", "policy", "threshold_value", "threshold_type", "is_active"],
    stamp: { created_at: "now", updated_at: "now" },
    skip: { id: "serial" },
  },
];

/** Build one set-based INSERT … SELECT for a spec. */
function buildCopySql(spec, { sourceOutletId, targetOutletId, actor, employeeId }) {
  const values = [];
  const P = (v) => {
    values.push(v);
    return `$${values.length}`;
  };

  const insertCols = [];
  const selectExprs = [];

  if (spec.scope === "outlet_id") {
    insertCols.push("outlet_id");
    selectExprs.push(P(targetOutletId));
  } else {
    insertCols.push("scope_type", "scope_id");
    selectExprs.push("'outlet'", P(targetOutletId));
  }

  for (const col of spec.copy) {
    insertCols.push(col);
    selectExprs.push(col);
  }

  for (const [col, kind] of Object.entries(spec.stamp || {})) {
    insertCols.push(col);
    if (kind === "now") selectExprs.push("NOW()");
    else if (kind === "actor") selectExprs.push(P(actor));
    else selectExprs.push(P(employeeId ?? null));
  }

  const where =
    spec.scope === "outlet_id"
      ? `outlet_id = ${P(sourceOutletId)}`
      : `scope_type = 'outlet' AND scope_id = ${P(sourceOutletId)}`;

  return {
    text:
      `INSERT INTO ${spec.table} (${insertCols.join(", ")}) ` +
      `SELECT ${selectExprs.join(", ")} FROM ${spec.table} WHERE ${where}`,
    values,
  };
}

/**
 * Clone the copyable settings of `sourceOutletId` onto `targetOutletId`.
 * MUST be called inside the caller's transaction, with `client` from it.
 * Returns { total, perTable } — perTable only lists tables that copied ≥1 row,
 * so the audit line stays readable.
 */
async function copyOutletSettings(client, { sourceOutletId, targetOutletId, actor, employeeId }) {
  const perTable = {};
  let total = 0;

  for (const spec of COPY_SPECS) {
    const { text, values } = buildCopySql(spec, {
      sourceOutletId,
      targetOutletId,
      actor,
      employeeId,
    });
    const { rowCount } = await client.query(text, values);
    if (rowCount > 0) {
      perTable[spec.table] = rowCount;
      total += rowCount;
    }
  }

  return { total, perTable };
}

/** Human-readable audit fragment: "3 (outlet_business_modules 2, kds_stations 1)". */
function describeCopy({ total, perTable }) {
  const parts = Object.entries(perTable).map(([t, n]) => `${t} ${n}`);
  return parts.length ? `${total} (${parts.join(", ")})` : "0";
}

module.exports = { copyOutletSettings, describeCopy, buildCopySql, COPY_SPECS };
