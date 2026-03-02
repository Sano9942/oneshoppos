const { maskSecret: _maskSecret, getActiveShopifyConnection: _getActiveShopifyConnection } = require("../../shopify/utils");

module.exports = function registerShopifyRoutes(app, deps) {
  // Create convenience wrappers that close over injected deps
  function maskSecret(secret) { return _maskSecret(secret, deps.decryptShopifySecret); }
  function getActiveShopifyConnection(cb) { return _getActiveShopifyConnection(deps.db, deps.decryptShopifySecret, cb); }

  function resolveImportCategoryId(productTypeName, cb) {
    const normalized = String(productTypeName || "").trim();
    if (!normalized) return cb(null, null);

    deps.db.all(
      `SELECT c.id, COUNT(ch.id) AS child_count
       FROM categories c
       LEFT JOIN categories ch ON ch.parent_id = c.id
       WHERE lower(c.name) = lower(?)
       GROUP BY c.id`,
      [normalized],
      (err, rows) => {
        if (err) return cb(err);
        const leafMatches = (rows || []).filter(
          (row) => Number(row.child_count || 0) === 0,
        );
        if (leafMatches.length !== 1) {
          return cb(null, null);
        }
        return cb(null, Number(leafMatches[0].id));
      },
    );
  }

  // Augmented deps shared by all sub-modules
  const localDeps = { ...deps, maskSecret, getActiveShopifyConnection, resolveImportCategoryId };

  require("./config")(app, localDeps);
  require("./health")(app, localDeps);
  require("./sync")(app, localDeps);
  require("./orders")(app, localDeps);
  require("./import")(app, localDeps);
  require("./mappings")(app, localDeps);
  require("./webhooks")(app, localDeps);
};
