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
  loadActiveOutlets,
  resolveOutletStates,
  setOutletModuleState,
} = require("../services/business-modules");
const { validate } = require("../middleware/validate");
const { ToggleModuleSchema, OutletToggleSchema } = require("../schemas/business-modules");

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
  const { db, requirePerm, requireAnyPerm } = deps;

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
        // Non-van outlets drive both the recommended chips and the v2 per-outlet
        // augmentation. Same non-van definition v1 used for outlet_count, so the
        // top-level outlet_count stays byte-compatible.
        const activeOutlets = await loadActiveOutlets(db);
        const outletCount = activeOutlets.length || 1;

        const recommended = new Set(
          presetRecommendedModules(industry, { outletCount })
        );

        // Per-outlet augmentation (v2, D1b) — ONLY when the tenant actually has
        // more than one active outlet. Single-outlet tenants keep the byte-
        // identical v1 payload (no outlets[]/enabled_outlet_count/outlet_count/
        // default_outlet_enabled fields on any card). Two bulk queries total,
        // independent of card/outlet count.
        const outletStates =
          activeOutlets.length > 1
            ? await resolveOutletStates(db, { outlets: activeOutlets, flags, modes })
            : null;

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
              description: s.description || null,
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
            // v2: per-outlet breakdown for scope:'outlet' cards on multi-outlet
            // tenants only (outletStates is null otherwise → v1 payload).
            ...(outletStates && outletStates[key] ? outletStates[key] : {}),
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
        // ?outlet_id= scopes disable-direction counts to one outlet (ignored for
        // enable direction and non-outlet-scoped cards). Ignore a non-numeric.
        const rawOutlet = req.query.outlet_id;
        const parsed =
          rawOutlet !== undefined && rawOutlet !== "" ? Number(rawOutlet) : undefined;
        const outletId = Number.isFinite(parsed) ? parsed : undefined;
        const { status, body } = await computeImpact(db, {
          key: req.params.key,
          direction,
          tenantId: req.tenantId,
          outletId,
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

  // Per-outlet activation write path (v2, D1b). Two body shapes — a single
  // outlet override {outlet_id, enabled:true|false|null} or the card default
  // {default_outlet_enabled}. Delegable to manage_outlet_modules as well as
  // manage_business_modules; all the inherit/lock/audit rules live in the
  // service.
  app.post(
    "/api/business-modules/:key/outlet-toggle",
    requireAnyPerm(["manage_business_modules", "manage_outlet_modules"]),
    validate(OutletToggleSchema),
    async (req, res) => {
      try {
        const actor =
          req.employee?.name ||
          (req.headers["x-employee-id"]
            ? `employee:${req.headers["x-employee-id"]}`
            : "unknown");
        const { status, body } = await setOutletModuleState(db, {
          key: req.params.key,
          outletId: req.body.outlet_id,
          enabled: req.body.enabled,
          defaultOutletEnabled: req.body.default_outlet_enabled,
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
