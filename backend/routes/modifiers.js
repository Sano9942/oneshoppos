/**
 * Modifier group + option CRUD + product linkage + draft-item attach.
 * Phase 2.1 A2 — feature-flagged via phase4_restaurant (uses existing flag,
 * per plan "no new feature flags").
 */
module.exports = function registerModifierRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm, requireAnyPerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const {
    createGroupSchema,
    updateGroupSchema,
    createOptionSchema,
    updateOptionSchema,
    linkGroupSchema,
    attachModifiersSchema,
  } = require("../schemas/modifiers");
  const modifiers = require("../services/modifiers");

  // P2 fix: defense-in-depth — gate on restaurant mode in addition to flag.
  // requireMode falls through with empty modes map (back-compat for pre-M1 tenants).
  // companyLevel: modifier groups are tenant menu catalog config — back-office
  // editing must not depend on standing in an enabled outlet; POS consumption
  // is still outlet-gated via the flags overlay (Step 9 allowlist).
  const readGate = [requireMode("restaurant", { companyLevel: true }), requireFeature("phase4_restaurant", { companyLevel: true }), requireAnyPerm(["manage_restaurant", "manage_inventory"])];
  const writeGate = [requireMode("restaurant", { companyLevel: true }), requireFeature("phase4_restaurant", { companyLevel: true }), requirePerm("manage_restaurant")];

  // ── Groups ──────────────────────────────────────────────────

  app.get("/api/modifiers/groups", ...readGate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id ? Number(req.query.outlet_id) : null;
      const groups = await modifiers.listGroups(deps.db, outletId);
      res.json({ groups });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/modifiers/groups", ...writeGate, validate(createGroupSchema), async (req, res) => {
    try {
      const group = await modifiers.createGroup(deps.db, req.body);
      res.status(201).json(group);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/modifiers/groups/:id", ...writeGate, validate(updateGroupSchema), async (req, res) => {
    try {
      const group = await modifiers.updateGroup(deps.db, Number(req.params.id), req.body);
      if (!group) return res.status(404).json({ error: "Group not found or nothing to update" });
      res.json(group);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.delete("/api/modifiers/groups/:id", ...writeGate, async (req, res) => {
    try {
      const group = await modifiers.deactivateGroup(deps.db, Number(req.params.id));
      if (!group) return res.status(404).json({ error: "Group not found" });
      res.json({ deactivated: group.id });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Options ─────────────────────────────────────────────────

  app.post("/api/modifiers/groups/:id/options", ...writeGate, validate(createOptionSchema), async (req, res) => {
    try {
      const option = await modifiers.addOptionToGroup(deps.db, Number(req.params.id), req.body);
      res.status(201).json(option);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/modifiers/options/:id", ...writeGate, validate(updateOptionSchema), async (req, res) => {
    try {
      const option = await modifiers.updateOption(deps.db, Number(req.params.id), req.body);
      if (!option) return res.status(404).json({ error: "Option not found or nothing to update" });
      res.json(option);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.delete("/api/modifiers/options/:id", ...writeGate, async (req, res) => {
    try {
      const option = await modifiers.deactivateOption(deps.db, Number(req.params.id));
      if (!option) return res.status(404).json({ error: "Option not found" });
      res.json({ deactivated: option.id });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Product linkage ────────────────────────────────────────

  app.post("/api/products/:id/modifier-groups", ...writeGate, validate(linkGroupSchema), async (req, res) => {
    try {
      const link = await modifiers.linkGroupToProduct(
        deps.db,
        Number(req.params.id),
        req.body.group_id,
        req.body.display_order ?? 0
      );
      res.status(201).json(link);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.delete("/api/products/:id/modifier-groups/:groupId", ...writeGate, async (req, res) => {
    try {
      const removed = await modifiers.unlinkGroupFromProduct(
        deps.db,
        Number(req.params.id),
        Number(req.params.groupId)
      );
      if (!removed) return res.status(404).json({ error: "Link not found" });
      res.json({ unlinked: true });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.get("/api/products/:id/modifier-tree", ...readGate, async (req, res) => {
    try {
      const tree = await modifiers.getModifierTreeForProduct(deps.db, Number(req.params.id));
      res.json({ groups: tree });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Attach to draft-order item ─────────────────────────────

  app.post("/api/modifiers/attach", ...writeGate, validate(attachModifiersSchema), async (req, res) => {
    try {
      const result = await modifiers.attachModifiersToDraftItem(
        deps.db,
        req.body.draft_order_item_id,
        req.body.option_ids
      );
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
