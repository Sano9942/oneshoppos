"use strict";

/**
 * services/business-modules.js — the Business Modules toggle write path
 * (docs/fable5/business-modules/PLAN.md Step 6). Every owner-agreed safety
 * rule lives here, server-side — the frontend is untrusted:
 *
 *  - Reachability: only catalog card keys (Bucket A/B) and sub_toggle keys
 *    are toggleable. Bucket C cards reject toggling in BOTH directions
 *    (409 REQUIRES_SETUP — their state machine is credential-driven via
 *    setup_route). Unknown keys, bundle-flag keys and UNMANAGED (Bucket D)
 *    keys 404 — unreachable by design.
 *  - Bucket A atomicity: the tenant_modes upsert (never DELETE) and the
 *    card's flag writes happen in ONE deps.db.transaction, mirroring the
 *    super-admin cascade (routes/admin/tenants.js PUT /:id/modes).
 *  - Config preservation: DISABLE snapshots the card's current managed-flag
 *    values (bundle + sub_toggles) into tenant_business_modules.saved_flags
 *    before zeroing them; ENABLE restores that snapshot exactly. Full bundle
 *    defaults apply only on FIRST enable (no row / null snapshot) — and
 *    sub_toggles are never blanket-enabled, they keep their current values.
 *  - Modes-transition trap: writing the tenant's FIRST tenant_modes row stops
 *    requireMode's empty-map fall-through for EVERY mode at once
 *    (middleware/feature-flags.js:313), so before that first row lands we
 *    backfill enabled=true rows for every registry mode that already has any
 *    of its flags enabled — drifted tenants keep their access.
 *  - depends_on: enable auto-enables prerequisite cards (named in the
 *    response; the UI confirms first via GET /:key/impact?direction=enable);
 *    disable with enabled dependents proceeds only with {cascade:true},
 *    snapshotting each dependent too — except Bucket C dependents, which are
 *    left connected and reported (their lifecycle belongs to their setup
 *    flow; cascading them off would be un-undoable from any tenant-facing
 *    endpoint). Enable never silently changes another module without the
 *    response naming it.
 *  - Platform lock: ENABLE is blocked (403 MODULE_LOCKED) by a
 *    public.platform_module_locks row — global (tenant_id NULL) or for this
 *    tenant. DISABLE is always allowed. The lock query is schema-qualified
 *    (public.), so it works through the tenant-scoped db handle in every
 *    environment — PLAN says "via masterDb", but master-db-pg is only
 *    initialised in multi-tenant boot; an explicit public. reference on the
 *    request's own handle is search_path-independent and equivalent.
 *  - Hide-not-delete: no domain table is ever written. The only tables this
 *    service touches are feature_flags, tenant_modes, tenant_business_modules
 *    and action_history (one audit row per toggle).
 */

const {
  BUSINESS_MODULES,
  classifyFlag,
  cardManagedFlags,
} = require("../config/business-modules");
const { DEFAULT_FEATURE_FLAGS } = require("../middleware/feature-flags");
const { MODE_REGISTRY, modeActiveForFlags } = require("../config/mode-registry");

function isMissingTableError(err) {
  return String(err?.message || "").includes("does not exist");
}

// ─────────────────────────────────────────────────────────────────────────────
// Live reads (deliberately uncached — a settings write path must see and
// produce fresh state; the 60s middleware caches are for hot-path gating).
// ─────────────────────────────────────────────────────────────────────────────

async function loadLiveFlags(db) {
  const merged = { ...DEFAULT_FEATURE_FLAGS };
  try {
    const { rows } = await db.query("SELECT key, enabled FROM feature_flags");
    for (const row of rows) merged[row.key] = row.enabled === true;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
  }
  return merged;
}

async function loadLiveModes(db) {
  const map = {};
  try {
    const { rows } = await db.query("SELECT mode, enabled FROM tenant_modes");
    for (const row of rows) map[row.mode] = row.enabled === true;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
  }
  return map;
}

/**
 * Module keys locked for this tenant (global lock rows + rows for this
 * tenant). Missing table (pre-v131 environment) = nothing locked.
 */
async function getLockedKeys(db, tenantId) {
  try {
    const { rows } = await db.query(
      `SELECT module_key FROM public.platform_module_locks
        WHERE tenant_id IS NULL OR tenant_id = $1`,
      [tenantId ?? null]
    );
    return new Set(rows.map((r) => r.module_key));
  } catch (err) {
    if (isMissingTableError(err)) return new Set();
    throw err;
  }
}

/**
 * Effective permission set per role, for the roles_with_access line on each
 * module card (PLAN.md Step 7). DB role_permissions rows are authoritative
 * when a role has ANY rows (that is what requirePerm actually enforces —
 * loadTenantAndPerms reads only the DB); a role with zero rows falls back to
 * DEFAULT_ROLE_PERMISSIONS by name (pre-seed tenants). Merging defaults on
 * top of DB rows would wrongly resurrect permissions an admin removed.
 */
async function loadRoleAccess(db) {
  const { DEFAULT_ROLE_PERMISSIONS } = require("../middleware/permissions");
  const { rows: roles } = await db.query(
    "SELECT id, name FROM roles ORDER BY id ASC"
  );
  const { rows: rps } = await db.query(
    "SELECT role_id, permission FROM role_permissions"
  );
  const byId = new Map(
    roles.map((r) => [r.id, { id: r.id, name: r.name, perms: new Set() }])
  );
  for (const rp of rps) byId.get(rp.role_id)?.perms.add(rp.permission);
  for (const role of byId.values()) {
    if (role.perms.size === 0) {
      for (const p of DEFAULT_ROLE_PERMISSIONS[role.name] || []) {
        role.perms.add(p);
      }
    }
  }
  return [...byId.values()];
}

/**
 * Role names that can use a card's surfaces: all_access roles always
 * (plus the Administrator role by name, defensively), otherwise any role
 * whose effective permission set intersects the card's permissions list.
 * Toggling a module never writes role_permissions — assignments stay
 * dormant while the module is off.
 */
function rolesWithAccessForCard(card, roleAccess) {
  const names = [];
  for (const role of roleAccess) {
    const hasAccess =
      role.name === "Administrator" ||
      role.perms.has("all_access") ||
      (card.permissions || []).some((p) => role.perms.has(p));
    if (hasAccess) names.push(role.name);
  }
  return names;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalog resolution + dependency graph
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a toggle key. Cards and sub_toggles are reachable; everything else
 * (bundle flags, UNMANAGED/Bucket D keys, unknown strings) resolves null.
 */
function resolveToggleTarget(key) {
  const card = BUSINESS_MODULES[key];
  if (card) return { type: "card", key, card };
  for (const [parentKey, parent] of Object.entries(BUSINESS_MODULES)) {
    const sub = parent.sub_toggles.find((s) => s.key === key);
    if (sub) return { type: "sub_toggle", key, sub, parentKey, parent };
  }
  return null;
}

/** Same on/off rule the GET route uses (mode row wins for Bucket A). */
function isCardEnabled(card, flags, modes) {
  const anyFlagOn = card.flags.some((f) => flags[f] === true);
  if (card.bucket === "A" && card.mode && card.mode in modes) {
    return modes[card.mode] === true;
  }
  return anyFlagOn;
}

/** Transitive card prerequisites of a card or sub_toggle target. */
function collectPrerequisites(target) {
  const direct =
    target.type === "card" ? target.card.depends_on : target.sub.depends_on || [];
  const out = [];
  const seen = new Set();
  const stack = [...direct];
  while (stack.length) {
    const k = stack.pop();
    if (seen.has(k)) continue;
    seen.add(k);
    const card = BUSINESS_MODULES[k];
    if (!card) continue; // catalog test guarantees resolution; defensive only
    out.push(k);
    stack.push(...card.depends_on);
  }
  return out;
}

/**
 * Everything currently enabled that depends (transitively) on cardKey:
 * cards ({type:"module"}) and sub_toggles ({type:"sub_toggle"}).
 */
function collectEnabledDependents(cardKey, flags, modes) {
  const dependents = [];
  const seenCards = new Set([cardKey]);
  const frontier = [cardKey];
  while (frontier.length) {
    const current = frontier.pop();
    for (const [k, card] of Object.entries(BUSINESS_MODULES)) {
      if (seenCards.has(k)) continue;
      if (card.depends_on.includes(current) && isCardEnabled(card, flags, modes)) {
        seenCards.add(k);
        dependents.push({ key: k, title: card.title, type: "module", bucket: card.bucket });
        frontier.push(k);
      }
    }
    for (const [pk, parent] of Object.entries(BUSINESS_MODULES)) {
      for (const sub of parent.sub_toggles) {
        if ((sub.depends_on || []).includes(current) && flags[sub.key] === true) {
          if (!dependents.some((d) => d.key === sub.key)) {
            dependents.push({ key: sub.key, title: sub.title, type: "sub_toggle", parent: pk });
          }
        }
      }
    }
  }
  return dependents;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-outlet module activation (Business Modules v2 / D1a, PLAN-V2 Step 8)
//
// Only scope:'outlet' cards participate. tenant/device/hybrid cards are
// tenant-wide in v2 and are rejected from every outlet operation (409
// TENANT_SCOPED). Resolution, frozen at Step 7:
//   effective(outlet) = companyEnabled AND (override ?? default_outlet_enabled ?? TRUE)
// — explicit override row wins; a missing row inherits the card's default; a
// module with no tenant_business_modules row at all inherits TRUE; company-off
// wins everywhere. A company disable NEVER deletes or rewrites override rows
// (they lie dormant, hide-not-delete) — enforced structurally by never writing
// outlet_business_modules from the company-level toggle path.
//
// All reads are bulk: one query for the outlet list, one for every override,
// one for every default — never per-card or per-outlet (query-budget invariant,
// asserted by an integration test).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Active (non-van) outlets — the set the per-outlet UI + resolver operate on.
 * "Active" is the SAME non-van definition GET already uses for outlet_count, so
 * a single-outlet tenant's outlet_count (and whole payload) stays byte-
 * compatible with v1. Missing outlets table ⇒ [].
 */
async function loadActiveOutlets(db) {
  try {
    const { rows } = await db.query(
      "SELECT id, name FROM outlets WHERE COALESCE(outlet_type, 'store') <> 'van' ORDER BY id ASC"
    );
    return rows.map((r) => ({ id: r.id, name: r.name }));
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

/** Every explicit per-outlet override, one bulk query. Map key `${outletId}:${moduleKey}` → bool. */
async function loadOutletOverrides(db) {
  const map = new Map();
  try {
    const { rows } = await db.query(
      "SELECT outlet_id, module_key, enabled FROM outlet_business_modules"
    );
    for (const r of rows) map.set(`${r.outlet_id}:${r.module_key}`, r.enabled === true);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
  }
  return map;
}

/**
 * Per-module default_outlet_enabled, one bulk query. Map moduleKey → bool.
 * A missing row (or a pre-v136 schema with no such column — "does not exist")
 * is absent from the map; callers apply the sparse-row rule (inherit TRUE).
 */
async function loadModuleDefaults(db) {
  const map = new Map();
  try {
    const { rows } = await db.query(
      "SELECT module_key, default_outlet_enabled FROM tenant_business_modules"
    );
    for (const r of rows) map.set(r.module_key, r.default_outlet_enabled === true);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
  }
  return map;
}

/**
 * Per-outlet effective state for every scope:'outlet' card. Two bulk queries
 * (overrides + defaults); `outlets` is passed in so the caller fetches the
 * outlet list exactly once. Returns:
 *   { [cardKey]: { default_outlet_enabled, outlets: [{outlet_id,name,effective,override}],
 *                  outlet_count, enabled_outlet_count } }
 * `override` is the raw explicit value (true/false) or null when no row exists.
 * `enabled_outlet_count` counts outlets where the module is EFFECTIVE (company
 * AND resolved) — a company-off card reads 0 everywhere.
 */
async function resolveOutletStates(db, { outlets, flags, modes }) {
  const [overrides, defaults] = await Promise.all([
    loadOutletOverrides(db),
    loadModuleDefaults(db),
  ]);
  const out = {};
  for (const [key, card] of Object.entries(BUSINESS_MODULES)) {
    if (card.scope !== "outlet") continue;
    const companyEnabled = isCardEnabled(card, flags, modes);
    const defaultEnabled = defaults.has(key) ? defaults.get(key) : true;
    const perOutlet = outlets.map((o) => {
      const ov = overrides.has(`${o.id}:${key}`) ? overrides.get(`${o.id}:${key}`) : null;
      const resolved = ov === null ? defaultEnabled : ov;
      return {
        outlet_id: o.id,
        name: o.name,
        effective: companyEnabled && resolved,
        override: ov,
      };
    });
    out[key] = {
      default_outlet_enabled: defaultEnabled,
      outlets: perOutlet,
      outlet_count: perOutlet.length,
      enabled_outlet_count: perOutlet.filter((p) => p.effective).length,
    };
  }
  return out;
}

/**
 * Step 9 (D1c) worker helper: outlet ids where `cardKey` is OFF per the
 * Step 8 resolution rule (override ?? default ?? TRUE), among active store
 * outlets. Company-level state is deliberately NOT considered — worker
 * callers gate on the feature flag first (the v1 per-tenant gate), and this
 * composes with it as a deny-list: work items at these outlets are skipped,
 * NULL/undimensioned items keep following company state. Returns [] on
 * pre-v136 schemas (missing tables) and whenever nothing is disabled — the
 * common fast path where callers add no SQL filter at all.
 */
async function getDisabledOutletIds(db, cardKey) {
  const card = BUSINESS_MODULES[cardKey];
  if (!card || card.scope !== "outlet") return [];
  const [outlets, overrides, defaults] = await Promise.all([
    loadActiveOutlets(db),
    loadOutletOverrides(db),
    loadModuleDefaults(db),
  ]);
  if (!outlets.length) return [];
  const dflt = defaults.has(cardKey) ? defaults.get(cardKey) : true;
  const disabled = [];
  for (const o of outlets) {
    const k = `${o.id}:${cardKey}`;
    const ov = overrides.has(k) ? overrides.get(k) : null;
    if (!(ov === null ? dflt : ov)) disabled.push(o.id);
  }
  return disabled;
}

/** Parse the single source table out of a fixed-shape impact COUNT query. */
function parseImpactTable(sql) {
  const m = /\bfrom\s+([a-z_][a-z0-9_]*)/i.exec(sql);
  return m ? m[1] : null;
}

/**
 * Add an `outlet_id = $1` predicate to a fixed-shape impact COUNT query. Only
 * the simple `SELECT COUNT(*)... FROM <table> [WHERE ...]` shape is handled;
 * anything with a join/group/subquery returns null so the caller falls back to
 * a tenant-wide count rather than risk a wrong scoped query.
 */
function scopeImpactSql(sql, outletCol = "outlet_id") {
  if (/\b(group\s+by|having|union|join)\b/i.test(sql)) return null;
  if (/\bwhere\b/i.test(sql)) return `${sql} AND ${outletCol} = $1`;
  return `${sql} WHERE ${outletCol} = $1`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup checklists (Business Modules v2 / D6, PLAN-V2 Step 11)
//
// Each covered Bucket A card carries a `setup_checklist` (config/business-
// modules.js). GET computes each item's done state ONLY for ENABLED covered
// cards. Items are `scope:"tenant"` (evaluated tenant-wide) or `scope:"outlet"`
// (evaluated against a resolved outlet, or tenant-wide when outlet-less — the
// settings page is allowlisted outlet-less, so it always passes outletId=null).
// The outlet dimension is built in "from birth" (a floor plan at outlet A never
// completes outlet B's item) and is proven by direct computeChecklists calls in
// the integration suite; the v2 settings-page consumer is tenant-wide.
//
// State rule (amendment g): a card with ANY required item un-done reads
// `attention_required`; optional items never hold the state.
//
// Query budget: ONE batched query (one EXISTS column per item) regardless of
// outlet count — so it never scales the Step 8 per-outlet budget. Zero queries
// when no covered card is enabled (the common retail case). Falls back to
// per-item queries only if the batch fails (a missing table on an old schema),
// so one absent table can't blank the whole checklist.
// ─────────────────────────────────────────────────────────────────────────────

/** Append `<outletCol> = $1` to a bare `SELECT 1 FROM <table> [WHERE ...]` EXISTS body. */
function scopeExistsSql(sql, outletCol) {
  return /\bwhere\b/i.test(sql) ? `${sql} AND ${outletCol} = $1` : `${sql} WHERE ${outletCol} = $1`;
}

/**
 * Build the EXISTS body + params for one checklist item. Outlet-scoped items
 * get the `= $1` predicate only when a concrete outletId is supplied; otherwise
 * (and for tenant-scoped items) they evaluate tenant-wide with no params.
 */
function buildChecklistItemExists(item, outletId) {
  const scoped =
    item.scope === "outlet" &&
    outletId != null &&
    item.done_query.outlet_column;
  const inner = scoped
    ? scopeExistsSql(item.done_query.sql, item.done_query.outlet_column)
    : item.done_query.sql;
  return { exists: `EXISTS(${inner})`, scoped };
}

/** Covered cards (those carrying a setup_checklist) that are currently enabled. */
function enabledCoveredCards(flags, modes) {
  const out = [];
  for (const [key, card] of Object.entries(BUSINESS_MODULES)) {
    if (!Array.isArray(card.setup_checklist) || !card.setup_checklist.length) continue;
    if (!isCardEnabled(card, flags, modes)) continue;
    out.push({ key, card });
  }
  return out;
}

/**
 * Per-card setup checklist state for every ENABLED covered card. Returns
 *   { [cardKey]: { checklist: [{ id, label, required, scope, route, done }],
 *                  required_incomplete } }
 * `outletId` scopes scope:"outlet" items to one outlet; null = tenant-wide.
 */
async function computeChecklists(db, { flags, modes, outletId = null }) {
  const cards = enabledCoveredCards(flags, modes);
  if (!cards.length) return {};

  // Flatten items → one EXISTS column each, in a single batched SELECT.
  const meta = [];
  const cols = [];
  let usesOutlet = false;
  for (const { key, card } of cards) {
    for (const item of card.setup_checklist) {
      const alias = `i${meta.length}`;
      const { exists, scoped } = buildChecklistItemExists(item, outletId);
      if (scoped) usesOutlet = true;
      cols.push(`${exists} AS ${alias}`);
      meta.push({ key, item, alias });
    }
  }

  const doneByAlias = {};
  try {
    const { rows } = await db.query(
      `SELECT ${cols.join(", ")}`,
      usesOutlet ? [outletId] : []
    );
    const row = rows[0] || {};
    for (const { alias } of meta) doneByAlias[alias] = row[alias] === true;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    // A missing table on an older tenant schema — evaluate item-by-item so one
    // absent table can't blank the whole checklist (each failure = not done).
    for (const { item, alias } of meta) {
      const { exists, scoped } = buildChecklistItemExists(item, outletId);
      try {
        const { rows } = await db.query(
          `SELECT ${exists} AS done`,
          scoped ? [outletId] : []
        );
        doneByAlias[alias] = rows[0]?.done === true;
      } catch {
        doneByAlias[alias] = false;
      }
    }
  }

  const out = {};
  for (const { key, item, alias } of meta) {
    if (!out[key]) out[key] = { checklist: [], required_incomplete: false };
    const done = doneByAlias[alias] === true;
    out[key].checklist.push({
      id: item.id,
      label: item.label,
      required: item.required === true,
      scope: item.scope,
      route: item.route,
      done,
    });
    if (item.required === true && !done) out[key].required_incomplete = true;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transaction helpers (all take the transaction client, never db)
// ─────────────────────────────────────────────────────────────────────────────

async function upsertFlagTx(client, key, enabled, actor) {
  await client.query(
    `INSERT INTO feature_flags (key, enabled, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET
       enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [key, enabled, actor]
  );
}

/**
 * The empty→enforcing transition guard. If tenant_modes has ZERO rows, the
 * row we are about to write would flip requireMode from fall-through to
 * enforcing for EVERY mode — so first materialise enabled=true rows for each
 * registry mode whose flags show it is already in use (drifted tenants).
 * Returns the backfilled mode names.
 */
async function backfillModesIfFirstRowTx(client, excludeMode, liveFlags) {
  const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM tenant_modes");
  if (rows[0].n > 0) return [];
  const backfilled = [];
  for (const mode of Object.keys(MODE_REGISTRY)) {
    if (mode === excludeMode) continue;
    if (modeActiveForFlags(mode, liveFlags)) {
      await client.query(
        `INSERT INTO tenant_modes (mode, enabled, enabled_at)
         VALUES ($1, true, NOW()) ON CONFLICT (mode) DO NOTHING`,
        [mode]
      );
      backfilled.push(mode);
    }
  }
  return backfilled;
}

async function upsertModeTx(client, mode, enabled) {
  await client.query(
    `INSERT INTO tenant_modes (mode, enabled, enabled_at) VALUES ($1, $2, NOW())
     ON CONFLICT (mode) DO UPDATE SET enabled = EXCLUDED.enabled, enabled_at = NOW()`,
    [mode, enabled]
  );
}

/**
 * Enable one card inside the transaction. Restores saved_flags when a
 * snapshot exists; applies bundle defaults (card.flags → true, sub_toggles
 * untouched) only on first enable. The snapshot is CLEARED once consumed —
 * it describes the state at the last disable, and leaving it around would
 * let a later redundant enable revert sub_toggle changes the merchant made
 * in the meantime (verifier finding, 2026-07-10).
 *
 * enablingKeys: every card key being enabled in this same toggle (target +
 * prerequisites) — a restored sub_toggle whose depends_on prerequisite is
 * neither enabled nor being enabled is kept OFF instead (the dependency
 * invariant beats exact restore; recorded in result.skipped_restores).
 */
async function enableCardTx(client, key, card, actor, liveFlags, liveModes, enablingKeys, result) {
  let saved = null;
  const { rows: [row] } = await client.query(
    "SELECT saved_flags FROM tenant_business_modules WHERE module_key = $1",
    [key]
  );
  if (row && row.saved_flags && typeof row.saved_flags === "object") {
    saved = row.saved_flags;
  }

  const subDeps = new Map(card.sub_toggles.map((s) => [s.key, s.depends_on || []]));
  const prereqSatisfied = (prereq) =>
    enablingKeys.has(prereq) ||
    (BUSINESS_MODULES[prereq] &&
      isCardEnabled(BUSINESS_MODULES[prereq], liveFlags, liveModes));

  const values = {};
  if (saved) {
    // Exact restore. A bundle flag added to the catalog AFTER the snapshot
    // was taken defaults on; a new sub_toggle stays untouched.
    for (const f of cardManagedFlags(card)) {
      if (f in saved) values[f] = saved[f] === true;
      else if (card.flags.includes(f)) values[f] = true;
    }
    for (const [subKey, deps] of subDeps) {
      if (values[subKey] === true && !deps.every(prereqSatisfied)) {
        values[subKey] = false;
        result.skipped_restores.push(subKey);
      }
    }
  } else {
    for (const f of card.flags) values[f] = true;
  }

  if (card.mode) {
    const backfilled = await backfillModesIfFirstRowTx(client, card.mode, liveFlags);
    if (backfilled.length) result.modes_backfilled.push(...backfilled);
    await upsertModeTx(client, card.mode, true);
  }
  for (const [f, v] of Object.entries(values)) {
    await upsertFlagTx(client, f, v, actor);
    result.flags_changed[f] = v;
  }
  await client.query(
    `INSERT INTO tenant_business_modules (module_key, enabled, saved_flags, updated_by, updated_at)
     VALUES ($1, true, NULL, $2, NOW())
     ON CONFLICT (module_key) DO UPDATE SET
       enabled = true, saved_flags = NULL, updated_by = $2, updated_at = NOW()`,
    [key, actor]
  );
}

/**
 * Disable one card inside the transaction: snapshot current managed-flag
 * values into saved_flags FIRST, then zero every managed flag, then flip the
 * mode row off (never DELETE). Domain tables are never touched.
 *
 * Idempotency guard (verifier finding, 2026-07-10): when the module is
 * ALREADY effectively off, the live flags are the zeroed post-disable state
 * — overwriting saved_flags with them on a repeated disable (double-click,
 * retry) would permanently lose the merchant's real snapshot. In that case
 * the existing snapshot is kept; the flag zeroing itself stays idempotent.
 */
async function disableCardTx(client, key, card, actor, liveFlags, liveModes, result) {
  const managed = cardManagedFlags(card);
  const effectivelyOn = isCardEnabled(card, liveFlags, liveModes);
  const snapshot = {};
  for (const f of managed) snapshot[f] = liveFlags[f] === true;
  await client.query(
    `INSERT INTO tenant_business_modules (module_key, enabled, saved_flags, updated_by, updated_at)
     VALUES ($1, false, $2, $3, NOW())
     ON CONFLICT (module_key) DO UPDATE SET
       enabled = false,
       saved_flags = CASE
         WHEN $4 OR tenant_business_modules.saved_flags IS NULL THEN $2::jsonb
         ELSE tenant_business_modules.saved_flags
       END,
       updated_by = $3, updated_at = NOW()`,
    [key, JSON.stringify(snapshot), actor, effectivelyOn]
  );
  if (card.mode) {
    await backfillModesIfFirstRowTx(client, card.mode, liveFlags);
    await upsertModeTx(client, card.mode, false);
  }
  for (const f of managed) {
    await upsertFlagTx(client, f, false, actor);
    result.flags_changed[f] = false;
  }
}

/** Disable one sub_toggle (cascade path): snapshot its value under its own
 * key (uniform "with their own saved_flags snapshots" semantics), flag off.
 * Same repeated-disable guard as disableCardTx: an already-off sub keeps
 * its existing snapshot. */
async function disableSubToggleTx(client, subKey, actor, liveFlags, result) {
  const wasOn = liveFlags[subKey] === true;
  await client.query(
    `INSERT INTO tenant_business_modules (module_key, enabled, saved_flags, updated_by, updated_at)
     VALUES ($1, false, $2, $3, NOW())
     ON CONFLICT (module_key) DO UPDATE SET
       enabled = false,
       saved_flags = CASE
         WHEN $4 OR tenant_business_modules.saved_flags IS NULL THEN $2::jsonb
         ELSE tenant_business_modules.saved_flags
       END,
       updated_by = $3, updated_at = NOW()`,
    [subKey, JSON.stringify({ [subKey]: wasOn }), actor, wasOn]
  );
  await upsertFlagTx(client, subKey, false, actor);
  result.flags_changed[subKey] = false;
}

async function auditTx(client, actor, key, enabled, result) {
  const parts = [
    `${enabled ? "Enabled" : "Disabled"} business module '${key}'`,
  ];
  if (result.also_enabled.length) parts.push(`also enabled: ${result.also_enabled.join(", ")}`);
  if (result.cascaded.length) parts.push(`cascaded off: ${result.cascaded.map((d) => d.key).join(", ")}`);
  if (result.modes_backfilled.length) parts.push(`modes backfilled: ${result.modes_backfilled.join(", ")}`);
  const touched = Object.entries(result.flags_changed).map(([k, v]) => `${k}=${v}`);
  if (touched.length) parts.push(`flags: ${touched.join(", ")}`);
  await client.query(
    `INSERT INTO action_history (user_name, action_type, description) VALUES ($1, $2, $3)`,
    [actor, "business_module_toggle", parts.join(" — ")]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Change preview for the confirm dialogs (Step 9 consumes this).
 * direction "disable" (default): live impact counts + enabled dependents.
 * direction "enable": prerequisites that would also be enabled + lock state.
 * Returns { status, body }.
 */
async function computeImpact(db, { key, direction = "disable", tenantId, outletId }) {
  const target = resolveToggleTarget(key);
  if (!target) return { status: 404, body: { error: `Unknown module: ${key}` } };

  const [flags, modes] = await Promise.all([loadLiveFlags(db), loadLiveModes(db)]);

  if (direction === "enable") {
    const prereqKeys = collectPrerequisites(target).filter(
      (k) => !isCardEnabled(BUSINESS_MODULES[k], flags, modes)
    );
    const lockCheckKeys = [
      target.type === "card" ? target.key : target.parentKey,
      ...prereqKeys,
    ];
    const locked = await getLockedKeys(db, tenantId);
    const lockedHit = lockCheckKeys.find((k) => locked.has(k)) || null;
    return {
      status: 200,
      body: {
        key,
        direction: "enable",
        prerequisites: prereqKeys.map((k) => ({
          key: k,
          title: BUSINESS_MODULES[k].title,
        })),
        locked: !!lockedHit,
        locked_module: lockedHit,
      },
    };
  }

  // Optional per-outlet scoping (v2): disable-direction counts scoped to one
  // outlet, but only for an outlet-scoped card. For any other card, or when no
  // outlet_id is passed, behaviour is unchanged from v1 (tenant-wide, no flag).
  let outlet = null;
  if (
    outletId !== undefined &&
    outletId !== null &&
    target.type === "card" &&
    target.card.scope === "outlet"
  ) {
    const { rows } = await db.query(
      "SELECT id, name FROM outlets WHERE id = $1 AND COALESCE(outlet_type, 'store') <> 'van'",
      [outletId]
    );
    if (!rows.length) {
      return {
        status: 404,
        body: { code: "OUTLET_NOT_FOUND", error: `Outlet ${outletId} not found or not a valid store outlet.` },
      };
    }
    outlet = rows[0];
  }

  const counts = [];
  if (target.type === "card") {
    const impactQueries = Object.entries(target.card.impact_queries);
    // One query resolves which of the referenced tables carry outlet_id.
    let outletCols = new Set();
    if (outlet && impactQueries.length) {
      const tables = [
        ...new Set(impactQueries.map(([, q]) => parseImpactTable(q.sql)).filter(Boolean)),
      ];
      if (tables.length) {
        try {
          const { rows } = await db.query(
            `SELECT table_name FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND column_name = 'outlet_id' AND table_name = ANY($1)`,
            [tables]
          );
          outletCols = new Set(rows.map((r) => r.table_name));
        } catch {
          // information_schema read failed — treat all as tenant-wide.
        }
      }
    }
    for (const [qKey, q] of impactQueries) {
      let count = null;
      let tenantWide = false;
      try {
        const table = outlet ? parseImpactTable(q.sql) : null;
        const scoped = outlet && table && outletCols.has(table) ? scopeImpactSql(q.sql) : null;
        if (scoped) {
          const { rows } = await db.query(scoped, [outlet.id]);
          count = rows[0]?.count ?? 0;
        } else {
          if (outlet) tenantWide = true; // outlet asked for, but this table isn't per-outlet
          const { rows } = await db.query(q.sql);
          count = rows[0]?.count ?? 0;
        }
      } catch {
        // Missing table on an older tenant schema — report unknown, not 500.
      }
      const entry = { key: qKey, label: q.label, count };
      if (outlet && tenantWide) entry.tenant_wide = true;
      counts.push(entry);
    }
  }
  const dependents =
    target.type === "card" ? collectEnabledDependents(key, flags, modes) : [];
  return {
    status: 200,
    body: {
      key,
      direction: "disable",
      ...(outlet ? { outlet_id: outlet.id } : {}),
      counts,
      dependents,
    },
  };
}

/**
 * The toggle itself. Returns { status, body }; the route stays thin.
 * Never blocks on impact counts — the confirm UX is the frontend's job.
 */
async function toggleModule(db, { key, enabled, cascade = false, actor, tenantId }) {
  const target = resolveToggleTarget(key);
  if (!target) return { status: 404, body: { error: `Unknown module: ${key}` } };

  if (target.type === "card" && target.card.bucket === "C") {
    return {
      status: 409,
      body: {
        code: "REQUIRES_SETUP",
        setup_route: target.card.setup_route,
        error: `'${target.card.title}' is connection-based — use its setup flow, not a toggle.`,
      },
    };
  }

  const [flags, modes] = await Promise.all([loadLiveFlags(db), loadLiveModes(db)]);
  const result = {
    also_enabled: [],
    cascaded: [],
    left_connected: [],
    skipped_restores: [],
    modes_backfilled: [],
    flags_changed: {},
  };

  if (enabled) {
    const prereqKeys = collectPrerequisites(target).filter(
      (k) => !isCardEnabled(BUSINESS_MODULES[k], flags, modes)
    );
    for (const k of prereqKeys) {
      if (BUSINESS_MODULES[k].bucket === "C") {
        // No such edge exists in the catalog today (deliberate — see the
        // cod_reconciliation comment there); defensive fail-closed.
        return {
          status: 409,
          body: {
            code: "PREREQUISITE_REQUIRES_SETUP",
            module_key: k,
            setup_route: BUSINESS_MODULES[k].setup_route,
          },
        };
      }
    }

    // Platform lock — blocks self-ENABLE of the target (a sub_toggle checks
    // its parent card's lock) and of anything we would auto-enable.
    const lockCheckKeys = [
      target.type === "card" ? target.key : target.parentKey,
      ...prereqKeys,
    ];
    const locked = await getLockedKeys(db, tenantId);
    const lockedHit = lockCheckKeys.find((k) => locked.has(k));
    if (lockedHit) {
      return {
        status: 403,
        body: {
          code: "MODULE_LOCKED",
          module_key: lockedHit,
          error: `'${BUSINESS_MODULES[lockedHit].title}' has been locked by the platform — contact support.`,
        },
      };
    }

    const enablingKeys = new Set([
      ...(target.type === "card" ? [target.key] : []),
      ...prereqKeys,
    ]);
    await db.transaction(async (client) => {
      for (const k of prereqKeys) {
        await enableCardTx(client, k, BUSINESS_MODULES[k], actor, flags, modes, enablingKeys, result);
        result.also_enabled.push(k);
      }
      if (target.type === "card") {
        await enableCardTx(client, target.key, target.card, actor, flags, modes, enablingKeys, result);
      } else {
        await upsertFlagTx(client, target.key, true, actor);
        result.flags_changed[target.key] = true;
        await client.query(
          `INSERT INTO tenant_business_modules (module_key, enabled, updated_by, updated_at)
           VALUES ($1, true, $2, NOW())
           ON CONFLICT (module_key) DO UPDATE SET enabled = true, updated_by = $2, updated_at = NOW()`,
          [target.key, actor]
        );
      }
      await auditTx(client, actor, key, true, result);
    });
  } else {
    // DISABLE — always allowed (locks only prevent self-enable).
    const dependents =
      target.type === "card" ? collectEnabledDependents(key, flags, modes) : [];
    if (dependents.length && !cascade) {
      return {
        status: 409,
        body: {
          code: "HAS_ENABLED_DEPENDENTS",
          dependents,
          error: "Other enabled modules depend on this one — retry with cascade:true to disable them too.",
        },
      };
    }
    await db.transaction(async (client) => {
      if (target.type === "card") {
        await disableCardTx(client, target.key, target.card, actor, flags, modes, result);
        for (const d of dependents) {
          if (d.type === "module" && BUSINESS_MODULES[d.key].bucket === "C") {
            // Bucket C dependents (e.g. Delivery Aggregators under
            // Restaurant) are NOT cascaded off: this endpoint can't re-enable
            // a C card (409 REQUIRES_SETUP) and the legacy PUT rejects its
            // primary flag, so zeroing it here would be a re-enable dead-end
            // (verifier finding, 2026-07-10). Their lifecycle stays with
            // their setup flow — reported so the UI can say "still
            // connected: disconnect via its setup page".
            result.left_connected.push(d);
            continue;
          }
          if (d.type === "module") {
            await disableCardTx(client, d.key, BUSINESS_MODULES[d.key], actor, flags, modes, result);
          } else {
            await disableSubToggleTx(client, d.key, actor, flags, result);
          }
          result.cascaded.push(d);
        }
      } else {
        await disableSubToggleTx(client, target.key, actor, flags, result);
      }
      await auditTx(client, actor, key, false, result);
    });
  }

  // Both caches — a toggle must be visible to requireFeature AND requireMode
  // on the next request, not after the 60s TTL.
  const {
    invalidateFeatureFlagCache,
    invalidateModeCache,
  } = require("../middleware/feature-flags");
  invalidateFeatureFlagCache(tenantId);
  invalidateModeCache(tenantId);

  return {
    status: 200,
    body: {
      key,
      enabled,
      also_enabled: result.also_enabled,
      cascaded: result.cascaded,
      left_connected: result.left_connected,
      skipped_restores: result.skipped_restores,
      modes_backfilled: result.modes_backfilled,
      flags_changed: result.flags_changed,
    },
  };
}

/** One audit row per outlet write. scope is `outlet <id>` or `default`. */
async function auditOutletTx(client, actor, key, { scope, direction }) {
  await client.query(
    `INSERT INTO action_history (user_name, action_type, description) VALUES ($1, $2, $3)`,
    [
      actor,
      "business_module_outlet_toggle",
      `${direction} per-outlet activation for business module '${key}' (${scope})`,
    ]
  );
}

/**
 * The per-outlet write path (PLAN-V2 Step 8). Two shapes, one endpoint:
 *   { outletId, enabled: true|false|null } — upsert an override for one outlet;
 *       enabled:null CLEARS the override (row deleted, outlet re-inherits the
 *       card default).
 *   { defaultOutletEnabled } — set the card's default for unlisted/new outlets,
 *       upserting a sparse tenant_business_modules row (column-scoped: only
 *       default_outlet_enabled changes — enabled/saved_flags are preserved).
 *
 * Only scope:'outlet' cards are eligible (409 TENANT_SCOPED otherwise). Platform
 * locks block the ENABLE direction of BOTH shapes (enabled:true and
 * defaultOutletEnabled:true); a clear (enabled:null) is lock-EXEMPT — the
 * default it falls back to already cleared the lock gate when it was set.
 * Company-level state is never touched here. Returns { status, body }.
 */
async function setOutletModuleState(
  db,
  { key, outletId, enabled, defaultOutletEnabled, actor, tenantId }
) {
  const card = BUSINESS_MODULES[key];
  if (!card) return { status: 404, body: { error: `Unknown module: ${key}` } };
  if (card.scope !== "outlet") {
    return {
      status: 409,
      body: {
        code: "TENANT_SCOPED",
        scope: card.scope,
        error: `'${card.title}' is ${card.scope}-scoped — per-outlet activation does not apply.`,
      },
    };
  }

  const isDefaultShape = defaultOutletEnabled !== undefined;
  const [flags, modes] = await Promise.all([loadLiveFlags(db), loadLiveModes(db)]);
  const companyEnabled = isCardEnabled(card, flags, modes);

  // Enable-direction platform-lock gate (both shapes). A clear is exempt.
  const enableDirection = isDefaultShape
    ? defaultOutletEnabled === true
    : enabled === true;
  if (enableDirection) {
    const locked = await getLockedKeys(db, tenantId);
    if (locked.has(key)) {
      return {
        status: 403,
        body: {
          code: "MODULE_LOCKED",
          module_key: key,
          error: `'${card.title}' has been locked by the platform — contact support.`,
        },
      };
    }
  }

  if (isDefaultShape) {
    await db.transaction(async (client) => {
      // Column-scoped upsert: on INSERT the row's `enabled` mirrors the current
      // company state (matching a first-enable row); on CONFLICT only
      // default_outlet_enabled moves — enabled + saved_flags stay put.
      await client.query(
        `INSERT INTO tenant_business_modules (module_key, enabled, default_outlet_enabled, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (module_key) DO UPDATE SET
           default_outlet_enabled = EXCLUDED.default_outlet_enabled,
           updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [key, companyEnabled, defaultOutletEnabled, actor]
      );
      await auditOutletTx(client, actor, key, {
        scope: "default",
        direction: defaultOutletEnabled ? "Enabled" : "Disabled",
      });
    });
  } else {
    // Shape B — the outlet must exist and be a real (non-van) store outlet.
    const { rows: outletRows } = await db.query(
      "SELECT id, name FROM outlets WHERE id = $1 AND COALESCE(outlet_type, 'store') <> 'van'",
      [outletId]
    );
    if (!outletRows.length) {
      return {
        status: 404,
        body: {
          code: "OUTLET_NOT_FOUND",
          error: `Outlet ${outletId} not found or not a valid store outlet.`,
        },
      };
    }
    await db.transaction(async (client) => {
      if (enabled === null) {
        await client.query(
          "DELETE FROM outlet_business_modules WHERE outlet_id = $1 AND module_key = $2",
          [outletId, key]
        );
        await auditOutletTx(client, actor, key, {
          scope: `outlet ${outletId}`,
          direction: "Cleared override on",
        });
      } else {
        await client.query(
          `INSERT INTO outlet_business_modules (outlet_id, module_key, enabled, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (outlet_id, module_key) DO UPDATE SET
             enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [outletId, key, enabled, actor]
        );
        await auditOutletTx(client, actor, key, {
          scope: `outlet ${outletId}`,
          direction: enabled ? "Enabled" : "Disabled",
        });
      }
    });
  }

  // Invalidate both caches for the tenant — outlet writes don't touch company
  // flags/modes today, but Step 9 makes requireFeature outlet-aware off the same
  // resolver, so keep the caches honest now.
  const {
    invalidateFeatureFlagCache,
    invalidateModeCache,
  } = require("../middleware/feature-flags");
  invalidateFeatureFlagCache(tenantId);
  invalidateModeCache(tenantId);

  // Echo the freshly-resolved per-outlet state for this card.
  const outlets = await loadActiveOutlets(db);
  const resolved = await resolveOutletStates(db, { outlets, flags, modes });
  return {
    status: 200,
    body: {
      key,
      scope: "outlet",
      company_enabled: companyEnabled,
      ...(resolved[key] || {
        default_outlet_enabled: true,
        outlets: [],
        outlet_count: outlets.length,
        enabled_outlet_count: 0,
      }),
    },
  };
}

/**
 * Legacy-endpoint lockdown middleware for PUT /api/feature-flags/:key
 * (registerAllRoutes.js — the ONE sanctioned edit to that route). Module
 * primary flags and bundle flags (both role "primary" in classifyFlag) are
 * managed by the Business Modules system and 409 here; sub_toggles,
 * UNMANAGED_FLAGS keys and non-catalog keys keep working.
 *
 * Note on "Bucket D": PLAN Step 6's goal text lists Bucket D flags as
 * rejected, but the ratified Step 2 config merged Bucket D INTO
 * UNMANAGED_FLAGS (config/business-modules.js — "stay writable via the
 * legacy PUT"), and the owner-approved Step 6 design summary says the
 * endpoint "stays usable for sub_toggles and UNMANAGED keys". The config's
 * contract wins: UNMANAGED/Bucket D keys pass through here unchanged.
 */
function rejectCatalogManagedFlagWrites(req, res, next) {
  const cls = classifyFlag(req.params.key);
  if (cls && cls.role === "primary") {
    return res.status(409).json({
      code: "MANAGED_BY_BUSINESS_MODULES",
      module_key: cls.module_key,
      error:
        `'${req.params.key}' is managed by the Business Modules page — ` +
        `toggle the '${BUSINESS_MODULES[cls.module_key].title}' module instead.`,
    });
  }
  return next();
}

module.exports = {
  loadLiveFlags,
  loadLiveModes,
  getLockedKeys,
  loadRoleAccess,
  rolesWithAccessForCard,
  resolveToggleTarget,
  isCardEnabled,
  collectPrerequisites,
  collectEnabledDependents,
  computeImpact,
  toggleModule,
  rejectCatalogManagedFlagWrites,
  // Business Modules v2 — per-outlet activation (Step 8)
  loadActiveOutlets,
  loadOutletOverrides,
  loadModuleDefaults,
  resolveOutletStates,
  setOutletModuleState,
  // Business Modules v2 — per-outlet worker filtering (Step 9)
  getDisabledOutletIds,
  // Business Modules v2 — setup checklists (Step 11, D6)
  computeChecklists,
};
