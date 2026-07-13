/**
 * Feature flag system — cached per-tenant flag lookups + notification helpers.
 *
 * Call init(deps) once at boot to inject database handles.
 */

let db, IS_MULTI_TENANT, tenantDbManager, dbProxy;

// ── Per-outlet module gating (Business Modules v2 / D1c, PLAN-V2 Step 9) ──
// Static flag→card and mode→card maps for scope:"outlet" cards only (card
// flags AND sub_toggle keys). config/business-modules.js has no top-level
// requires, so this import is cycle-safe even though services/business-modules
// requires this file back (lazily, inside functions).
const { BUSINESS_MODULES } = require("../config/business-modules");
const OUTLET_FLAG_TO_CARD = new Map();
const OUTLET_MODE_TO_CARD = new Map();
for (const [cardKey, card] of Object.entries(BUSINESS_MODULES)) {
  if (card.scope !== "outlet") continue;
  for (const f of card.flags || []) OUTLET_FLAG_TO_CARD.set(f, cardKey);
  for (const s of card.sub_toggles || []) OUTLET_FLAG_TO_CARD.set(s.key, cardKey);
  if (card.mode) OUTLET_MODE_TO_CARD.set(card.mode, cardKey);
}

const DEFAULT_FEATURE_FLAGS = {
  backup_restore: true,
  e_invoicing_export: true,
  supplier_payables: true,
  approvals: true,
  notifications: true,
  accounting_core: true,
  crm_quotations: true,
  advanced_hr: true,
  multi_company: true,
  reports_enhanced_filters: false,
  reports_profit_layer: false,
  reports_inventory_health_plus: false,
  reports_exceptions: false,
  reports_scheduled_exports: false,
  context_selection_required: false,
  context_header_enforced: false,
  kiosk_context_locked: false,
  marketplace_integrations: true,
  phase2_scheduling: true,
  phase2_outlet_pricing: false,
  phase2_draft_orders: false,
  phase2_pos_approvals: false,
  phase2_returns_policy: true,
  phase2_smart_collections: true,
  phase2_outlet_visibility: false,
  phase2_outlet_tax: true,
  phase2_scheduled_changes: true,
  phase2_commissions: false,
  phase2_report_builder: true,
  phase2_pos_layouts: true,
  phase2_item_suggestions: false,
  marketing_campaigns: true,
  customer_messaging: true,
  customer_invoicing: true,
  // F05 — status-change customer notifications (SMS/email/WhatsApp). Default OFF;
  // consumers (repair tickets, booking reminders) only dispatch when flipped on.
  customer_notifications: false,
  payment_links: false,
  // AI insights chat (routes/insights-ai.js). Default ON for every tenant —
  // seeded as a real feature_flags row by schema-pg.sql (new tenants) and
  // migration v130 (existing tenants), because the route reads the DB row
  // directly rather than this default map. This default keeps the admin flags
  // editor showing it enabled. Still requires ANTHROPIC_API_KEY on the server;
  // admins can toggle it off per tenant.
  ai_insights: true,
  // Mode-gated (subscriptions mode): flag default flipped false so retail
  // tenants without the subscriptions mode don't see the Subscriptions nav.
  // Tenants on the subscriptions mode get the flag enabled via v44 backfill.
  subscription_billing: false,
  subscription_autocharge: false,
  // Phase 4 — New Verticals
  // Mode-gated (restaurant mode): flag default false. Enabled for tenants
  // whose mode row is seeded by setup wizard (restaurant / cafe presets)
  // or by the v44 backfill for existing tenants already using restaurant.
  phase4_restaurant: false,
  phase4_restaurant_qr: false,
  // Mode-gated (restaurant mode).
  phase4_restaurant_kds: false,
  phase4_restaurant_preauth: false,
  // Phase 2-R Wave A-D restaurant maturation flags (mode-gated: restaurant).
  // Default false; enabled via migration v58 backfill for tenants already
  // in restaurant mode, and via MODE_REGISTRY auto-enable for new presets.
  phase4_restaurant_86: false,
  phase4_restaurant_void_comp: false,
  phase4_restaurant_pay_at_table: false,
  phase4_restaurant_reservations: false,
  phase4_restaurant_kds_analytics: false,
  phase4_restaurant_day_parting: false,
  phase4_restaurant_fire_chits: false,
  phase4_restaurant_drive_thru: false,
  phase4_restaurant_menu_engineering: false,
  // V03 — delivery-aggregator order injection (foodpanda / Careem). Default OFF;
  // restaurant + cafe presets seed it ON at wizard completion (RESTAURANT_SEED_FLAGS).
  delivery_aggregators: false,
  // Mode-gated (appointments mode).
  phase4_appointments: false,
  phase4_appointments_waitlists: false,
  phase4_appointments_classes: false,
  phase4_appointments_resources: false,
  // F02 — packages / session passes (default OFF; salon/gym/physio presets flip it).
  packages_passes: false,
  // V07 gym — member check-in kiosk + active-membership validation at the door
  // (default OFF; flipped on by the gym preset via PRESET_EXTRA_FLAGS).
  member_checkin: false,
  // Mode-gated (service_projects mode).
  phase4_service_projects: false,
  phase4_service_contracts: false,
  // Mode-gated (workflow_tickets mode).
  phase4_workflow_tickets: false,
  // Mode-gated: flipped ON only by setup/company-profile when a rental preset
  // is selected. Leaving globally ON would show rental nav to retail tenants.
  phase4_rentals: false,
  // V09 rentals depth. `rental_inspections` is flipped ON for every rental
  // preset (PRESET_EXTRA_FLAGS + v118 backfill); `rental_online_booking` stays
  // OFF everywhere — tenant opt-in (public exposure).
  rental_inspections: false,
  rental_online_booking: false,
  // Mode-gated (M9): flipped ON only when a hotel/guesthouse/hostel preset
  // is selected. Keeps "Rooms" nav hidden from retail/restaurant tenants.
  phase4_room_management: false,
  // V10 lodging depth. `room_channel_sync` + `room_guest_registration` are
  // flipped ON for lodging presets (PRESET_EXTRA_FLAGS + v119 backfill) —
  // inert until a feed is configured / a check-in happens. Public direct
  // booking stays OFF everywhere — tenant opt-in (public exposure), same
  // posture as rental_online_booking.
  room_channel_sync: false,
  room_online_booking: false,
  room_guest_registration: false,
  // Mode-gated (M10): flipped ON only when a dental_clinic / veterinary /
  // physiotherapy preset is selected. Keeps Clinical nav hidden otherwise.
  phase4_treatment_plans: false,
  // V05 clinical depth. `clinical_recalls` is flipped ON for every clinical
  // preset (PRESET_EXTRA_FLAGS + v120 backfill); `vet_vaccinations` is
  // veterinary-only; `clinical_handouts` is physiotherapy-only. All three are
  // individually toggleable per tenant.
  clinical_recalls: false,
  vet_vaccinations: false,
  clinical_handouts: false,
  // F03 form builder — custom intake/waivers/questionnaires. Flipped ON by
  // clinical/gym/photography/repair presets (V05/V06/V07/V08).
  custom_forms: false,
  // Phase 5 — Pakistan Integration Depth
  phase5_shipping_automation: false,
  phase5_cod_reconciliation: false,
  phase5_sms_providers: false,
  // Phase 2-G — General Retail Tier-1 Parity (all default false; each feature
  // is opt-in per tenant via the admin feature-flags UI). DEFAULT entries
  // ensure requireFeature() is deterministic on fresh tenants before the
  // seeded row has propagated through the 60s flag cache.
  phase2g_omni_input: false,
  phase2g_variant_picker: false,
  phase2g_gift_cards: false,
  phase2g_loyalty: false,
  phase2g_price_books: false,
  phase2g_price_override: false,
  phase2g_serialized_inventory: false,
  phase2g_per_line_restock: false,
  phase2g_inventory_intelligence: false,
  phase2g_holds: false,
  phase2g_risk_controls: false,
  retail_weekly_digest: false,
  // Phase 2-G Bucket F polish (migration v76). Receipt designer is ON by
  // default (additive UI with safe defaults — existing tenants see no visible
  // change except QR rendering, which is null-safe when fbr_qr_code is absent).
  // Worker + offline refunds start OFF for gated rollout.
  receipt_designer_v2: true,
  shift_auto_close: false,
  offline_returns: false,
  // Tier 0 wholesale (mode-gated: wholesale). Default false. Enabled when
  // setup wizard runs with industry_type='wholesale' (preset.modes includes
  // 'wholesale' → MODE_REGISTRY auto-enables) or via the v87 backfill for
  // existing wholesale tenants.
  wholesale_credit_controls: false,
  // Tier 1.1 (wholesale field sales): mobile order-booker app — daily route,
  // GPS+selfie check-in with mandatory outcome, owner-side visit report.
  // Default false; opt-in per tenant via admin feature-flags UI.
  wholesale_field_sales: false,
  // Tier 1.3 (wholesale schemes): slab-tier volume discounts + brand-scoped
  // schemes on top of the existing promotions engine. Default false.
  wholesale_schemes: false,
  // Tier 1.4 (wholesale secondary sales): manufacturer-partner portal —
  // distributor invites brand owners (Tapal, Coca-Cola, etc.) to see real-time
  // aggregate onward sales of their brand SKUs. Separate JWT scope. Default false.
  wholesale_secondary_sales: false,
  // V02 (wholesale depth): backorders / partial fulfillment — on shortfall the
  // order-taking surfaces offer "fulfill available + backorder remainder"
  // instead of a hard insufficient_stock 400. Default false; seeded ON for
  // wholesale tenants (v110 backfill + WHOLESALE_SEED_FLAGS).
  wholesale_backorders: false,
  // V02 (wholesale depth): van sales — outlets.outlet_type='van' stock
  // locations, field-PWA sell-from-van, day-end reconciliation. Default false;
  // seeded ON for wholesale tenants (v111 backfill + WHOLESALE_SEED_FLAGS).
  wholesale_van_sales: false,
  // F01 kit/BOM engine. Default false — gates the NEW surfaces (Production
  // screen, recipe costing report, assembled-product type, theoretical-vs-
  // actual usage). The core kit sale decrement stays UNGATED (it already
  // shipped as is_bundle/product_bundles and works on every tenant); seeded
  // ON by presets that consume it (retail/food-service verticals).
  kit_bom_engine: false,
  // F07 batch/expiry/lot engine. Default false — gates the surfaces (GRN batch
  // capture fields, expiring-soon page, batch reports, textile roll picker). The
  // real functional gate for FEFO consumption is per-product products.track_batches,
  // so untracked SKUs are unaffected regardless of this flag. Seeded ON by the
  // retail sub-type presets that consume it (grocery/butcher/sweet_shop/textile).
  batch_expiry_tracking: false,
};

// Per-tenant feature flag cache
const _featureFlagCache = new Map();
const FEATURE_FLAG_CACHE_MS = 60_000;

// Missing-table tolerance for the per-outlet reads: pre-v136 schemas and
// pared-down test schemas simply have no overrides — never an error.
function _isMissingRelation(err) {
  return String(err && err.message || "").includes("does not exist");
}

/**
 * Cache-fill + accessor for the full per-tenant gating bundle:
 *   { flags, outletOverrides: Map("outletId:cardKey" → bool),
 *     moduleDefaults: Map(cardKey → bool), timestamp }
 * The two per-outlet maps are loaded in the SAME 60s cache fill as the flags
 * (2 extra small queries per fill, zero per request). Both Step 8 toggle
 * shapes invalidate this cache via invalidateFeatureFlagCache().
 */
async function _getBundle(tenantId) {
  const cacheKey = tenantId || "_default";
  const cached = _featureFlagCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < FEATURE_FLAG_CACHE_MS) {
    return cached;
  }
  let flagDb = db;
  if (IS_MULTI_TENANT && tenantId && tenantDbManager) {
    try { flagDb = await tenantDbManager.getDb(tenantId); } catch { /* fall back to db */ }
  }
  // init() never called (bare test harness) — same defensive posture as
  // getModesMap: defaults only, uncached, never a throw.
  if (!flagDb) {
    return {
      flags: { ...DEFAULT_FEATURE_FLAGS },
      outletOverrides: new Map(),
      moduleDefaults: new Map(),
      timestamp: now,
    };
  }

  let merged;
  try {
    const { rows } = await flagDb.query("SELECT key, enabled FROM feature_flags");
    merged = { ...DEFAULT_FEATURE_FLAGS };
    for (const row of rows || []) {
      merged[row.key] = row.enabled === true;
    }
  } catch (err) {
    if (_isMissingRelation(err)) {
      // Uncached deliberately (matches pre-Step-9 behavior for absent tables).
      return {
        flags: { ...DEFAULT_FEATURE_FLAGS },
        outletOverrides: new Map(),
        moduleDefaults: new Map(),
        timestamp: now,
      };
    }
    throw err;
  }

  const outletOverrides = new Map();
  try {
    const { rows } = await flagDb.query(
      "SELECT outlet_id, module_key, enabled FROM outlet_business_modules"
    );
    for (const r of rows || []) {
      outletOverrides.set(`${r.outlet_id}:${r.module_key}`, r.enabled === true);
    }
  } catch (err) {
    if (!_isMissingRelation(err)) throw err;
  }

  const moduleDefaults = new Map();
  try {
    const { rows } = await flagDb.query(
      "SELECT module_key, default_outlet_enabled FROM tenant_business_modules"
    );
    for (const r of rows || []) {
      moduleDefaults.set(r.module_key, r.default_outlet_enabled === true);
    }
  } catch (err) {
    if (!_isMissingRelation(err)) throw err;
  }

  const entry = { flags: merged, outletOverrides, moduleDefaults, timestamp: now };
  _featureFlagCache.set(cacheKey, entry);
  return entry;
}

async function getFeatureFlagsMap(tenantId) {
  const entry = await _getBundle(tenantId);
  return { ...entry.flags };
}

/**
 * Step 8 resolution rule for one card at one outlet (company state checked
 * separately by the caller): override ?? default_outlet_enabled ?? TRUE.
 */
function _outletResolved(entry, cardKey, outletId) {
  const k = `${outletId}:${cardKey}`;
  const ov = entry.outletOverrides.has(k) ? entry.outletOverrides.get(k) : null;
  if (ov !== null) return ov;
  return entry.moduleDefaults.has(cardKey) ? entry.moduleDefaults.get(cardKey) : true;
}

/** The outlet-scoped card owning a flag key (or null). Exported for surfaces. */
function outletCardForFlag(flagKey) {
  return OUTLET_FLAG_TO_CARD.get(flagKey) || null;
}

/**
 * Flags map with the per-outlet overlay applied: any flag mapping to an
 * outlet-scoped card that is OFF at `outletId` reads false. Null/absent
 * outletId returns the plain company-level map. Used by GET /api/feature-flags
 * (`effective` field), the context bootstrap, and outlet-bound public surfaces.
 */
async function getEffectiveFlagsMap(tenantId, outletId) {
  const entry = await _getBundle(tenantId);
  const flags = { ...entry.flags };
  if (outletId) {
    for (const [flag, cardKey] of OUTLET_FLAG_TO_CARD) {
      if (flags[flag] === true && !_outletResolved(entry, cardKey, outletId)) {
        flags[flag] = false;
      }
    }
  }
  return flags;
}

/**
 * Pure outlet-level resolution for one card at one outlet (override ??
 * default_outlet_enabled ?? TRUE) — company state deliberately NOT composed.
 * For outlet-bound public surfaces (QR kiosk) that must go dark when the
 * outlet is switched off but whose company-level gating is a separate,
 * pre-existing concern.
 */
async function isModuleOffAtOutlet(tenantId, cardKey, outletId) {
  if (!outletId || !BUSINESS_MODULES[cardKey] || BUSINESS_MODULES[cardKey].scope !== "outlet") {
    return false;
  }
  const entry = await _getBundle(tenantId);
  return !_outletResolved(entry, cardKey, outletId);
}

/**
 * Modes map with the same per-outlet overlay for the outlet-scoped Bucket A
 * modes (restaurant, appointments, rentals, room_management, treatment_plans,
 * workflow_tickets, service_projects).
 */
async function getEffectiveModesMap(tenantId, outletId) {
  const modes = await getModesMap(tenantId);
  if (!outletId) return modes;
  const entry = await _getBundle(tenantId);
  for (const [mode, cardKey] of OUTLET_MODE_TO_CARD) {
    if (modes[mode] === true && !_outletResolved(entry, cardKey, outletId)) {
      modes[mode] = false;
    }
  }
  return modes;
}

function invalidateFeatureFlagCache(tenantId) {
  if (tenantId) {
    _featureFlagCache.delete(tenantId);
  } else {
    _featureFlagCache.clear();
  }
}

/**
 * Per-outlet gate layer (D1c) shared by requireFeature and requireMode.
 * Returns null to pass, or an { status, body } refusal. Rules (owner-ratified
 * at the Step 9 pause):
 *  - req.outletContext undefined ⇒ the shared resolver isn't mounted on this
 *    chain (portal/public routes, standalone test harnesses) ⇒ company-level,
 *    exactly the pre-Step-9 behavior.
 *  - outlet resolved ⇒ evaluate Step 8 effective state for that outlet.
 *  - no outlet resolved ⇒ all_access falls back to company-level (Ruling 1 —
 *    the fail-closed rule targets staff escaping an outlet-level OFF via an
 *    oid:null re-mint; admins can toggle modules anyway); everyone else gets
 *    403 OUTLET_CONTEXT_REQUIRED.
 */
function _outletGate(req, entry, cardKey, refusalBase) {
  const oc = req.outletContext;
  if (oc === undefined) return null;
  if (oc.outletId) {
    if (!_outletResolved(entry, cardKey, oc.outletId)) {
      return {
        status: 403,
        body: { ...refusalBase, outlet_scoped: true, outlet_id: oc.outletId },
      };
    }
    return null;
  }
  const perms = req.employeePerms || [];
  if (perms.includes("all_access")) return null;
  return {
    status: 403,
    body: {
      error: "Outlet context required for this feature",
      code: "OUTLET_CONTEXT_REQUIRED",
      ...(refusalBase.flag ? { flag: refusalBase.flag } : {}),
      ...(refusalBase.mode ? { mode: refusalBase.mode } : {}),
    },
  };
}

/**
 * opts.companyLevel: explicit allowlist marker (Step 9 Ruling 2) — the call
 * site always evaluates company-level state, even when an outlet resolves.
 * Reserved for settings/config surfaces and cross-outlet reports; every use
 * carries a justification comment at the call site.
 */
function requireFeature(flagKey, opts = {}) {
  const outletCard = opts.companyLevel ? null : (OUTLET_FLAG_TO_CARD.get(flagKey) || null);
  return async (req, res, next) => {
    try {
      const entry = await _getBundle(req.tenantId);
      if (!entry.flags[flagKey]) {
        // M29 (Phase 3.14): "feature off" is a permission-style refusal,
        // not a service-availability error. 503 was wrong because it
        // implies "try again later" and triggers Sentry alerts on the
        // POS modifier-tree probe. 403 matches "you cannot use this".
        return res.status(403).json({
          error: `Feature disabled: ${flagKey}`,
          flag: flagKey,
        });
      }
      if (outletCard) {
        const refusal = _outletGate(req, entry, outletCard, {
          error: `Feature disabled: ${flagKey}`,
          flag: flagKey,
        });
        if (refusal) return res.status(refusal.status).json(refusal.body);
      }
      next();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  };
}

// --- Mode cache (same pattern as feature flags) ---
const _modeCache = new Map();
const MODE_CACHE_MS = 60_000;

async function getModesMap(tenantId) {
  const cacheKey = tenantId || "_default";
  const cached = _modeCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.timestamp < MODE_CACHE_MS) {
    return { ...cached.modes };
  }

  let modeDb = db;
  if (IS_MULTI_TENANT && tenantId && tenantDbManager) {
    try { modeDb = await tenantDbManager.getDb(tenantId); } catch { /* fall back */ }
  }
  // If init() was never called (e.g. integration tests that build their own
  // app via createTestApp-pg.js without calling featureFlags.init), modeDb is
  // undefined. Treat this the same as "tenant_modes table absent" so
  // requireMode() falls through to its back-compat empty-map branch instead
  // of 500-ing on .query() of undefined.
  if (!modeDb) return {};

  try {
    const { rows } = await modeDb.query(
      "SELECT mode, enabled FROM tenant_modes"
    );
    const map = {};
    for (const row of rows) map[row.mode] = row.enabled === true;
    _modeCache.set(cacheKey, { modes: map, timestamp: now });
    return map;
  } catch (err) {
    if (String(err.message || "").includes("does not exist")) {
      return {};
    }
    throw err;
  }
}

function invalidateModeCache(tenantId) {
  if (tenantId) _modeCache.delete(tenantId);
  else _modeCache.clear();
}

/**
 * D5 (PLAN-V2 Step 5) empty-map telemetry. After migration v135 + the
 * provisioning seeders, EVERY live tenant has a full tenant_modes row set, so
 * reaching requireMode with an empty map means a failed per-tenant migration
 * or an unseeded provisioning path — surface it loudly. Owner-chosen posture
 * for this release is warn-and-pass (keep falling through so a gap degrades to
 * "flags are the sole gate" instead of a 403 storm); flip to fail-closed next
 * release once prod telemetry reads zero. Skipped under NODE_ENV=test so the
 * integration harness (which never seeds tenant_modes) stays quiet.
 */
function reportEmptyModes(modeName, tenantId) {
  if (process.env.NODE_ENV === "test") return;
  try {
    const Sentry = require("@sentry/node");
    Sentry.captureMessage("requireMode: empty tenant_modes map (D5 warn-and-pass)", {
      level: "warning",
      tags: { mode: modeName, tenantId: tenantId != null ? String(tenantId) : "unknown" },
    });
  } catch { /* Sentry absent/uninitialised — no-op */ }
  try {
    require("../services/logger").warn(
      { mode: modeName, tenantId },
      "requireMode: tenant has an empty tenant_modes map — feature flags are the sole gate. Expected 0 occurrences after migrate v135; investigate this tenant's migration/provisioning."
    );
  } catch { /* logger unavailable — no-op */ }
}

function requireMode(modeName, opts = {}) {
  const outletCard = opts.companyLevel ? null : (OUTLET_MODE_TO_CARD.get(modeName) || null);
  return async (req, res, next) => {
    try {
      const modes = await getModesMap(req.tenantId);
      // Empty map = failed migration or unseeded provisioning path (should be
      // impossible post-v135). Warn-and-pass for one release: fall through so
      // feature flags remain the sole gate rather than 403-storming a tenant.
      // The per-outlet layer below still applies — outlet-level OFF must hold
      // even while the company-level mode gate is in its back-compat posture.
      if (Object.keys(modes).length === 0) {
        reportEmptyModes(modeName, req.tenantId);
      } else if (!modes[modeName]) {
        // M29 (Phase 3.14): align with requireFeature — "mode off" is a
        // permission-style refusal, not a service-availability error.
        return res.status(403).json({
          error: `Mode not enabled: ${modeName}`,
          mode: modeName,
        });
      }
      // Only fetch the gating bundle when the shared resolver actually ran —
      // chains without it (portal/public routes, legacy harnesses) keep the
      // exact pre-Step-9 query profile.
      if (outletCard && req.outletContext !== undefined) {
        const entry = await _getBundle(req.tenantId);
        const refusal = _outletGate(req, entry, outletCard, {
          error: `Mode not enabled: ${modeName}`,
          mode: modeName,
        });
        if (refusal) return res.status(refusal.status).json(refusal.body);
      }
      next();
    } catch (err) {
      if (String(err.message || "").includes("does not exist")) {
        return next();
      }
      return res.status(500).json({ error: err.message });
    }
  };
}

// --- Notification helpers ---

let _notifDb;

function createNotification(type, title, message, link) {
  _notifDb.query(
    "INSERT INTO notifications (type, title, message, link) VALUES ($1, $2, $3, $4)",
    [type, title, message, link || null]
  ).catch(() => {});
}

function notifyLowStockForSale(cartItems, outletId) {
  const productIds = [
    ...new Set(
      (cartItems || [])
        .map((i) => Number(i.original_product_id || i.product_id || i.id))
        .filter(Boolean),
    ),
  ];
  if (!productIds.length || !outletId) return;
  const placeholders = productIds.map((_, i) => "$" + (i + 2)).join(",");
  _notifDb.query(
    `SELECT os.product_id, os.quantity, p.name
     FROM outlet_stock os
     JOIN products p ON p.id = os.product_id
     WHERE os.outlet_id = $1 AND os.product_id IN (${placeholders}) AND COALESCE(os.quantity, 0) <= 10`,
    [outletId, ...productIds]
  ).then(({ rows }) => {
    if (!rows) return;
    rows.forEach((row) => {
      createNotification(
        "low_stock",
        "Low Stock Alert",
        `${row.name} has ${row.quantity} units left`,
        "/inventory",
      );
    });
  }).catch(() => {});
}

function init(deps) {
  db = deps.db;
  IS_MULTI_TENANT = deps.IS_MULTI_TENANT;
  tenantDbManager = deps.tenantDbManager;
  dbProxy = deps.dbProxy;
  _notifDb = IS_MULTI_TENANT ? dbProxy : db;
}

module.exports = {
  init,
  DEFAULT_FEATURE_FLAGS,
  getFeatureFlagsMap,
  getModesMap,
  getEffectiveFlagsMap,
  getEffectiveModesMap,
  isModuleOffAtOutlet,
  outletCardForFlag,
  invalidateFeatureFlagCache,
  invalidateModeCache,
  requireFeature,
  requireMode,
  createNotification,
  notifyLowStockForSale,
};
