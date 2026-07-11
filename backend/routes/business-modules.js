"use strict";

/**
 * Business Modules — read path (PLAN.md Step 4) + toggle write path
 * (PLAN.md Step 6).
 *
 * GET /api/business-modules returns the full self-service modules page
 * payload: every catalog card (config/business-modules.js) with its computed
 * STATE (off/on/setup_required/connected/locked/attention_required — never a
 * bare boolean), scope, live flag/sub_toggle values, depends_on graph,
 * platform-lock state, and "recommended for your industry" chips.
 *
 * GET /api/business-modules/:key/impact — change preview for the confirm
 * dialogs (disable: live counts + enabled dependents; ?direction=enable:
 * prerequisites that would also be enabled + lock state).
 *
 * POST /api/business-modules/:key/toggle {enabled, cascade?} — the write
 * path. All rules live in services/business-modules.js; this file stays thin.
 *
 * Flag/mode reads are deliberately LIVE (direct deps.db queries merged with
 * DEFAULT_FEATURE_FLAGS) rather than via getFeatureFlagsMap/getModesMap:
 * the 60s middleware cache exists for hot-path gating, but a settings page
 * must reflect a toggle immediately — and the direct read also works in the
 * createTestApp harness, which never calls featureFlags.init().
 *
 * Perm (Step 7): requirePerm("manage_business_modules") — granted to NO
 * default role; Administrators pass via the all_access bypass, and module
 * management is delegable by granting the perm to a custom role.
 *
 * GET also returns roles_with_access per card (Step 7): role names whose
 * effective permission set intersects the card's permissions list, plus
 * all_access roles. Toggling a module never writes role_permissions.
 */

const {
  BUSINESS_MODULES,
  MODULE_STATES,
  presetRecommendedModules,
} = require("../config/business-modules");
const {
  loadLiveFlags,
  loadLiveModes,
  getLockedKeys,
  loadRoleAccess,
  rolesWithAccessForCard,
  computeImpact,
  toggleModule,
} = require("../services/business-modules");
const { validate } = require("../middleware/validate");
const { ToggleModuleSchema } = require("../schemas/business-modules");

async function runConnectedCheck(db, check) {
  if (!check) return null;
  if (check.type === "env") return !!process.env[check.env];
  try {
    const { rows } = await db.query(check.sql);
    return rows[0]?.connected === true;
  } catch {
    // Missing table / pre-migration tenant — treat as not connected.
    return false;
  }
}

/**
 * Compute the card state. Rules (documented in config/business-modules.js):
 *  - Bucket A: the tenant_modes row is the truth when it exists; a tenant
 *    with no row for the mode (incl. fully modeless tenants, where
 *    requireMode falls through) derives from the primary flags. Flag-only
 *    verticals (mode: null) always derive from flags.
 *  - Bucket B: on when ANY primary flag is on.
 *  - Bucket C: connected_check fail → setup_required; pass → connected when
 *    the card's flags (if any) are enabled, otherwise off (credentials
 *    stored but the merchant turned the feature off).
 *  - locked: a platform_module_locks row (global or this tenant) blocks
 *    self-enable — an otherwise-off card shows state "locked"; a card that
 *    is already on keeps its state (locks never force-off) but still
 *    carries locked:true.
 */
function computeState(card, flags, modes, connected, isLocked) {
  const anyFlagOn = card.flags.some((f) => flags[f] === true);
  let state;
  if (card.bucket === "C") {
    if (!connected) state = MODULE_STATES.SETUP_REQUIRED;
    else if (card.flags.length > 0 && !anyFlagOn) state = MODULE_STATES.OFF;
    else state = MODULE_STATES.CONNECTED;
  } else if (card.bucket === "A" && card.mode && card.mode in modes) {
    state = modes[card.mode] ? MODULE_STATES.ON : MODULE_STATES.OFF;
  } else {
    state = anyFlagOn ? MODULE_STATES.ON : MODULE_STATES.OFF;
  }
  if (isLocked && (state === MODULE_STATES.OFF || state === MODULE_STATES.SETUP_REQUIRED)) {
    return MODULE_STATES.LOCKED;
  }
  return state;
}

module.exports = function registerBusinessModulesRoutes(app, deps) {
  const { db, requirePerm } = deps;

  app.get(
    "/api/business-modules",
    requirePerm("manage_business_modules"),
    async (req, res) => {
      try {
        const [flags, modes, lockedKeys, roleAccess] = await Promise.all([
          loadLiveFlags(db),
          loadLiveModes(db),
          getLockedKeys(db, req.tenantId),
          loadRoleAccess(db),
        ]);

        // Industry + outlet count drive the "recommended" chips. req.company
        // may be a minimal stub (tests) — fall back to a direct read.
        let industry = req.company?.industry_type;
        if (!industry) {
          try {
            const { rows } = await db.query(
              "SELECT industry_type FROM company_profile WHERE id = 1"
            );
            industry = rows[0]?.industry_type || "general_retail";
          } catch {
            industry = "general_retail";
          }
        }
        let outletCount = 1;
        try {
          const { rows } = await db.query(
            "SELECT COUNT(*)::int AS n FROM outlets WHERE COALESCE(outlet_type, 'store') <> 'van'"
          );
          outletCount = rows[0]?.n || 1;
        } catch { /* default 1 */ }

        const recommended = new Set(
          presetRecommendedModules(industry, { outletCount })
        );

        const modules = [];
        for (const [key, card] of Object.entries(BUSINESS_MODULES)) {
          const connected =
            card.bucket === "C"
              ? await runConnectedCheck(db, card.connected_check)
              : null;

          const isLocked = lockedKeys.has(key);
          modules.push({
            key,
            bucket: card.bucket,
            title: card.title,
            description: card.description,
            scope: card.scope,
            mode: card.mode ?? null,
            state: computeState(card, flags, modes, connected, isLocked),
            locked: isLocked,
            flags: card.flags.map((f) => ({ key: f, enabled: flags[f] === true })),
            sub_toggles: card.sub_toggles.map((s) => ({
              key: s.key,
              title: s.title,
              enabled: flags[s.key] === true,
              depends_on: s.depends_on || [],
              note: s.note || null,
            })),
            depends_on: card.depends_on,
            permissions: card.permissions,
            roles_with_access: rolesWithAccessForCard(card, roleAccess),
            preset_recommended: recommended.has(key),
            ...(card.bucket === "C"
              ? {
                  setup_route: card.setup_route,
                  setup_required_when: card.setup_required_when,
                  connected,
                }
              : {}),
          });
        }

        return res.json({
          industry_type: industry,
          outlet_count: outletCount,
          modules,
        });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  // Change preview for the enable/disable confirm dialogs (PLAN Step 6).
  app.get(
    "/api/business-modules/:key/impact",
    requirePerm("manage_business_modules"),
    async (req, res) => {
      try {
        const direction = req.query.direction === "enable" ? "enable" : "disable";
        const { status, body } = await computeImpact(db, {
          key: req.params.key,
          direction,
          tenantId: req.tenantId,
        });
        return res.status(status).json(body);
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );

  // The toggle write path — all rules enforced in services/business-modules.js.
  app.post(
    "/api/business-modules/:key/toggle",
    requirePerm("manage_business_modules"),
    validate(ToggleModuleSchema),
    async (req, res) => {
      try {
        const actor =
          req.employee?.name ||
          (req.headers["x-employee-id"]
            ? `employee:${req.headers["x-employee-id"]}`
            : "unknown");
        const { status, body } = await toggleModule(db, {
          key: req.params.key,
          enabled: req.body.enabled,
          cascade: req.body.cascade === true,
          actor,
          tenantId: req.tenantId,
        });
        return res.status(status).json(body);
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  );
};
