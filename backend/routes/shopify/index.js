const {
  maskSecret: _maskSecret,
  getActiveShopifyConnection: _getActiveShopifyConnection,
} = require("../../shopify/utils");

module.exports = function registerShopifyRoutes(app, deps) {
  // Create convenience wrappers that close over injected deps
  function maskSecret(secret) {
    return _maskSecret(secret, deps.decryptShopifySecret);
  }

  // Postgres async version — returns a Promise
  async function getActiveShopifyConnection() {
    return _getActiveShopifyConnection(deps.db, deps.decryptShopifySecret);
  }

  async function resolveImportCategoryId(productTypeName) {
    const normalized = String(productTypeName || "").trim();
    if (!normalized) return null;

    const { rows } = await deps.db.query(
      `SELECT c.id, COUNT(ch.id) AS child_count
       FROM categories c
       LEFT JOIN categories ch ON ch.parent_id = c.id
       WHERE LOWER(c.name) = LOWER($1)
       GROUP BY c.id`,
      [normalized]
    );
    const leafMatches = (rows || []).filter(
      (row) => Number(row.child_count || 0) === 0
    );
    if (leafMatches.length !== 1) return null;
    return Number(leafMatches[0].id);
  }

  // Augmented deps shared by all sub-modules
  const localDeps = {
    ...deps,
    maskSecret,
    getActiveShopifyConnection,
    resolveImportCategoryId,
  };

  require("./config")(app, localDeps);
  require("./health")(app, localDeps);
  require("./sync")(app, localDeps);
  require("./orders")(app, localDeps);
  require("./import")(app, localDeps);
  require("./mappings")(app, localDeps);
  require("./webhooks")(app, localDeps);
  require("./reconciliation")(app, localDeps);
};
