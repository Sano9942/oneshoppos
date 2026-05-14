/**
 * Feature flag system — cached per-tenant flag lookups + notification helpers.
 *
 * Call init(deps) once at boot to inject database handles.
 */

let db, IS_MULTI_TENANT, tenantDbManager, dbProxy;

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
  payment_links: false,
  // Mode-gated (subscriptions mode): flag default flipped false so retail
  // tenants without the subscriptions mode don't see the Subscriptions nav.
  // Tenants on the subscriptions mode get the flag enabled via v44 backfill.
  subscription_billing: false,
  sms_campaigns: false,
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
  phase4_restaurant_seats: false,
  phase4_restaurant_drive_thru: false,
  phase4_restaurant_menu_engineering: false,
  // Mode-gated (appointments mode).
  phase4_appointments: false,
  phase4_appointments_waitlists: false,
  phase4_appointments_classes: false,
  phase4_google_calendar_sync: false,
  // Mode-gated (service_projects mode).
  phase4_service_projects: false,
  phase4_service_contracts: false,
  phase4_contract_ai: false,
  // Mode-gated (workflow_tickets mode).
  phase4_workflow_tickets: false,
  // Mode-gated: flipped ON only by setup/company-profile when a rental preset
  // is selected. Leaving globally ON would show rental nav to retail tenants.
  phase4_rentals: false,
  // Mode-gated (M9): flipped ON only when a hotel/guesthouse/hostel preset
  // is selected. Keeps "Rooms" nav hidden from retail/restaurant tenants.
  phase4_room_management: false,
  // Mode-gated (M10): flipped ON only when a dental_clinic / veterinary /
  // physiotherapy preset is selected. Keeps Clinical nav hidden otherwise.
  phase4_treatment_plans: false,
  // Phase 5 — Pakistan Integration Depth
  phase5_shipping_automation: false,
  phase5_cod_reconciliation: false,
  phase5_payment_gateways: false,
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
  phase2g_receipt_barcode_lookup: false,
  phase2g_label_designer: false,
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
};

// Per-tenant feature flag cache
const _featureFlagCache = new Map();
const FEATURE_FLAG_CACHE_MS = 60_000;

async function getFeatureFlagsMap(tenantId) {
  const cacheKey = tenantId || "_default";
  const cached = _featureFlagCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < FEATURE_FLAG_CACHE_MS) {
    return { ...cached.flags };
  }
  try {
    let flagDb = db;
    if (IS_MULTI_TENANT && tenantId && tenantDbManager) {
      try { flagDb = await tenantDbManager.getDb(tenantId); } catch { /* fall back to db */ }
    }
    const { rows } = await flagDb.query("SELECT key, enabled FROM feature_flags");
    const merged = { ...DEFAULT_FEATURE_FLAGS };
    for (const row of rows || []) {
      merged[row.key] = row.enabled === true;
    }
    _featureFlagCache.set(cacheKey, { flags: merged, timestamp: now });
    return merged;
  } catch (err) {
    if (String(err.message || "").includes("does not exist")) {
      return { ...DEFAULT_FEATURE_FLAGS };
    }
    throw err;
  }
}

function invalidateFeatureFlagCache(tenantId) {
  if (tenantId) {
    _featureFlagCache.delete(tenantId);
  } else {
    _featureFlagCache.clear();
  }
}

function requireFeature(flagKey) {
  return async (req, res, next) => {
    try {
      const flags = await getFeatureFlagsMap(req.tenantId);
      if (!flags[flagKey]) {
        // M29 (Phase 3.14): "feature off" is a permission-style refusal,
        // not a service-availability error. 503 was wrong because it
        // implies "try again later" and triggers Sentry alerts on the
        // POS modifier-tree probe. 403 matches "you cannot use this".
        return res.status(403).json({
          error: `Feature disabled: ${flagKey}`,
          flag: flagKey,
        });
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

function requireMode(modeName) {
  return async (req, res, next) => {
    try {
      const modes = await getModesMap(req.tenantId);
      // If modes map is empty (pre-migration or no modes set), fall through
      // to let feature flags be the sole gate (backward compat)
      if (Object.keys(modes).length === 0) return next();
      if (!modes[modeName]) {
        // M29 (Phase 3.14): align with requireFeature — "mode off" is a
        // permission-style refusal, not a service-availability error.
        return res.status(403).json({
          error: `Mode not enabled: ${modeName}`,
          mode: modeName,
        });
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
  invalidateFeatureFlagCache,
  invalidateModeCache,
  requireFeature,
  requireMode,
  createNotification,
  notifyLowStockForSale,
};
