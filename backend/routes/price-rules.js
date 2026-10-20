/**
 * One Toy Store F10: Settings → Price rules (docs/onetoystore-pilot/PHASE-F-PLAN.md F10).
 *
 *   GET  /api/price-rules                      the rules the bill screen uses (bill receivers)
 *   PUT  /api/price-rules                      save a new version (Administrators only)
 *   GET  /api/price-rules/history              every save, who and when (Administrators only)
 *   POST /api/price-rules/history/:id/restore  "Go back to this version" (Administrators only)
 */
const logger = require("../services/logger");
const { actorOf } = require("../services/product-history");
const { currentRules, checkRules, saveVersion, history, restoreVersion } = require("../services/price-rules");

module.exports = function registerPriceRuleRoutes(app, deps) {
  const { db, requirePerm } = deps;

  app.get("/api/price-rules", requirePerm("receive_supplier_bills"), async (req, res) => {
    try {
      res.json(await currentRules(db));
    } catch (err) {
      logger.error({ err }, "price rules: read failed");
      res.status(500).json({ error: "Couldn't load the price rules." });
    }
  });

  app.put("/api/price-rules", requirePerm("all_access"), async (req, res) => {
    try {
      const { rules, errors } = await checkRules(db, req.body?.rules);
      if (errors.length) return res.status(400).json({ error: errors[0], errors });
      const version = await saveVersion(db, rules, actorOf(req));
      res.status(201).json({ version });
    } catch (err) {
      logger.error({ err }, "price rules: save failed");
      res.status(500).json({ error: "Couldn't save the price rules." });
    }
  });

  app.get("/api/price-rules/history", requirePerm("all_access"), async (req, res) => {
    try {
      res.json({ versions: await history(db) });
    } catch (err) {
      logger.error({ err }, "price rules: history failed");
      res.status(500).json({ error: "Couldn't load the history." });
    }
  });

  app.post("/api/price-rules/history/:id/restore", requirePerm("all_access"), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: "That version doesn't exist." });
    try {
      const version = await restoreVersion(db, id, actorOf(req));
      if (!version) return res.status(404).json({ error: "That version doesn't exist." });
      res.status(201).json({ version });
    } catch (err) {
      logger.error({ err }, "price rules: restore failed");
      res.status(500).json({ error: "Couldn't go back to that version." });
    }
  });
};
