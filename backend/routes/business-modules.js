"use strict";

/**
 * Business Modules — read path (PLAN.md Step 4).
 *
 * GET /api/business-modules returns the full self-service modules page
 * payload: every catalog card (config/business-modules.js) with its computed
 * STATE (off/on/setup_required/connected/locked/attention_required — never a
 * bare boolean), scope, live flag/sub_toggle values, depends_on graph, and
 * "recommended for your industry" chips derived from the tenant's preset.
 *
 * Flag/mode reads are deliberately LIVE (direct deps.db queries merged with
 * DEFAULT_FEATURE_FLAGS) rather than via getFeatureFlagsMap/getModesMap:
 * the 60s middleware cache exists for hot-path gating, but a settings page
 * must reflect a toggle immediately — and the direct read also works in the
 * createTestApp harness, which never calls featureFlags.init().
 *
 * Perm: requirePerm("all_access") for now — Step 7 switches this to the
 * dedicated manage_business_modules permission (Administrators keep passing
 * via the all_access bypass either way).
 */

const {
  BUSINESS_MODULES,
  MODULE_STATES,
  presetRecommendedModules,
} = require("../config/business-modules");
const { DEFAULT_FEATURE_FLAGS } = require("../middleware/feature-flags");

async function loadLiveFlags(db) {
  const merged = { ...DEFAULT_FEATURE_FLAGS };
  try {
    const { rows } = await db.query("SELECT key, enabled FROM feature_flags");
    for (const row of rows) merged[row.key] = row.enabled === true;
  } catch (err) {
    if (!String(err.message || "").includes("does not exist")) throw err;
  }
  return merged;
}

async function loadLiveModes(db) {
  const map = {};
  try {
    const { rows } = await db.query("SELECT mode, enabled FROM tenant_modes");
    for (const row of rows) map[row.mode] = row.enabled === true;
  } catch (err) {
    if (!String(err.message || "").includes("does not exist")) throw err;
  }
  return map;
}

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
 *  - locked comes from platform_module_locks — stubbed false until Step 5/6.
 */
function computeState(card, flags, modes, connected) {
  const anyFlagOn = card.flags.some((f) => flags[f] === true);
  if (card.bucket === "C") {
    if (!connected) return MODULE_STATES.SETUP_REQUIRED;
    if (card.flags.length > 0 && !anyFlagOn) return MODULE_STATES.OFF;
    return MODULE_STATES.CONNECTED;
  }
  if (card.bucket === "A" && card.mode) {
    if (card.mode in modes) {
      return modes[card.mode] ? MODULE_STATES.ON : MODULE_STATES.OFF;
    }
    return anyFlagOn ? MODULE_STATES.ON : MODULE_STATES.OFF;
  }
  return anyFlagOn ? MODULE_STATES.ON : MODULE_STATES.OFF;
}

module.exports = function registerBusinessModulesRoutes(app, deps) {
  const { db, requirePerm } = deps;

  app.get(
    "/api/business-modules",
    // Step 7 switches this to requirePerm("manage_business_modules").
    requirePerm("all_access"),
    async (req, res) => {
      try {
        const [flags, modes] = await Promise.all([
          loadLiveFlags(db),
          loadLiveModes(db),
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

          modules.push({
            key,
            bucket: card.bucket,
            title: card.title,
            description: card.description,
            scope: card.scope,
            mode: card.mode ?? null,
            state: computeState(card, flags, modes, connected),
            // Platform lock lands with the Step 5 table + Step 6 check.
            locked: false,
            flags: card.flags.map((f) => ({ key: f, enabled: flags[f] === true })),
            sub_toggles: card.sub_toggles.map((s) => ({
              key: s.key,
              title: s.title,
              enabled: flags[s.key] === true,
              depends_on: s.depends_on || [],
              note: s.note || null,
            })),
            depends_on: card.depends_on,
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
};
