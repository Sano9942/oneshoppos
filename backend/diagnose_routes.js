const express = require('express');
const multer = require('multer');
const app = express();
const noop = () => {};
const noopMw = (req, res, next) => next && next();
const fakeRouter = express.Router();

try {
  require('./routes/registerAllRoutes')(app, {
    requirePerm: () => noopMw,
    requireAnyPerm: () => noopMw,
    requireFeature: () => noopMw,
    loadEmployeePerms: noopMw,
    ensureDefaultRolePermissions: noop,
    PERMISSION_RULES: [],
    DEFAULT_FEATURE_FLAGS: {},
    runtimeState: { isRestoreInProgress: false },
    authLimiter: noopMw,
    webhookLimiter: noopMw,
    db: new Proxy({}, { get: (t, k) => (typeof k === 'string' ? noop : undefined) }),
    fs: require('fs'),
    path: require('path'),
    multer,
    sqlite3: require('sqlite3'),
    createNotification: noop,
    notifyLowStockForSale: noop,
    createTier4Router: () => fakeRouter,
    verifyConnection: noop,
    fetchShopifyLocations: noop,
    adjustShopifyInventory: noop,
    fetchShopifyVariantCatalog: noop,
    fetchShopifyProductsFull: noop,
    fetchInventoryLevel: noop,
    fetchRecentOrders: noop,
    retryDelayMinutesWithJitter: noop,
    evaluateWebhookTimestampWindow: noop,
    isRetryableInventoryEventStatus: noop,
    canApproveReconciliationRequest: noop,
    buildWebhookIdempotencyKey: noop,
    verifyWebhookSignature: noop,
    encryptShopifySecret: noop,
    decryptShopifySecret: noop,
    logShopifyEvent: noop,
    SHOPIFY_MAX_RETRY_ATTEMPTS: 3,
    PRODUCT_UPLOADS_DIR: __dirname,
    COMPANY_UPLOADS_DIR: __dirname,
    UPLOADS_DIR: __dirname,
    DB_PATH: require('path').join(__dirname, 'oneshop.db'),
  });
  console.log('registerAllRoutes completed OK');
  const routes = (app.router?.stack || [])
    .filter((r) => r.route)
    .map((r) => ({ path: r.route.path, methods: Object.keys(r.route.methods) }));
  console.log('Total routes:', routes.length);
  console.log('DELETE routes:', routes.filter((r) => r.methods.includes('delete')).length);
  const target = routes.find((r) => r.path === '/api/integrations/shopify/import/products');
  console.log('shopify/import/products route:', target ? JSON.stringify(target) : 'NOT FOUND');
} catch (e) {
  const lineMatch = e.stack && e.stack.match(/registerAllRoutes\.js:(\d+)/);
  console.error('THREW at registerAllRoutes.js line:', lineMatch ? lineMatch[1] : 'unknown');
  console.error('Error:', e.message);
  console.error(e.stack.split('\n').slice(0, 8).join('\n'));
}
