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
const { MODE_REGISTRY } = require("../config/mode-registry");

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
  for (const [mode, cfg] of Object.entries(MODE_REGISTRY)) {
    if (mode === excludeMode) continue;
    if (cfg.feature_flags_to_enable.some((f) => liveFlags[f] === true)) {
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
async function computeImpact(db, { key, direction = "disable", tenantId }) {
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

  const counts = [];
  if (target.type === "card") {
    for (const [qKey, q] of Object.entries(target.card.impact_queries)) {
      let count = null;
      try {
        const { rows } = await db.query(q.sql);
        count = rows[0]?.count ?? 0;
      } catch {
        // Missing table on an older tenant schema — report unknown, not 500.
      }
      counts.push({ key: qKey, label: q.label, count });
    }
  }
  const dependents =
    target.type === "card" ? collectEnabledDependents(key, flags, modes) : [];
  return {
    status: 200,
    body: { key, direction: "disable", counts, dependents },
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
  resolveToggleTarget,
  isCardEnabled,
  collectPrerequisites,
  collectEnabledDependents,
  computeImpact,
  toggleModule,
  rejectCatalogManagedFlagWrites,
};
