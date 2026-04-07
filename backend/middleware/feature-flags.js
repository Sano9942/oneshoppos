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
  ui_redesign_enabled: true,
  ui_redesign_inventory: true,
  ui_redesign_orders: false,
  ui_redesign_pos: false,
  ui_redesign_reports: false,
  ui_redesign_admin: false,
  ui_redesign_customers: false,
  ui_redesign_sales_history: false,
  ui_redesign_cash_management: false,
  ui_redesign_returns: false,
  ui_redesign_categories: false,
  ui_redesign_brands: false,
  ui_redesign_taxes: false,
  ui_redesign_attribute_sets: false,
  ui_redesign_stock_adjustments: false,
  ui_redesign_transfers: false,
  ui_redesign_returned_stock: false,
  ui_redesign_suppliers: false,
  ui_redesign_purchase_orders: false,
  ui_redesign_supplier_payables: false,
  ui_redesign_promotions: false,
  ui_redesign_expenses: false,
  reports_enhanced_filters: false,
  reports_profit_layer: false,
  reports_inventory_health_plus: false,
  reports_exceptions: false,
  reports_scheduled_exports: false,
  context_selection_required: false,
  context_header_enforced: false,
  kiosk_context_locked: false,
  marketplace_integrations: true,
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
        return res.status(503).json({
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
  invalidateFeatureFlagCache,
  requireFeature,
  createNotification,
  notifyLowStockForSale,
};
