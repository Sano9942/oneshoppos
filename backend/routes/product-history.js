// Product History tab (One Toy Store pilot, Phase B step 7): stock ledger,
// price & cost history, and sales by bill no for one product. See
// services/product-history.js for how the rows are recorded.
const history = require("../services/product-history");

module.exports = function mountProductHistoryRoutes(app, deps) {
  const { db, requireAnyPerm } = deps;
  const canView = requireAnyPerm(["manage_inventory", "view_inventory_reports"]);

  const intOrNull = (v) => {
    if (v === undefined || v === null || v === "" || v === "all") return null;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : NaN;
  };

  function parse(req, res) {
    const productId = intOrNull(req.params.id);
    const variantId = intOrNull(req.query.variant_id);
    const outletId = intOrNull(req.query.outlet_id);
    const beforeId = intOrNull(req.query.before_id);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    if ([productId, variantId, outletId, beforeId].some(Number.isNaN) || !productId) {
      res.status(400).json({ error: "Invalid id" });
      return null;
    }
    return { productId, variantId, outletId, beforeId, limit, offset };
  }

  app.get("/api/products/:id/history/stock", canView, async (req, res) => {
    const q = parse(req, res);
    if (!q) return;
    try {
      res.json(await history.stockLedger(db, q));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/products/:id/history/prices", canView, async (req, res) => {
    const q = parse(req, res);
    if (!q) return;
    try {
      res.json(await history.priceHistory(db, q));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/products/:id/history/sales", canView, async (req, res) => {
    const q = parse(req, res);
    if (!q) return;
    try {
      res.json(await history.salesHistory(db, q));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
