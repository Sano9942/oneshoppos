/**
 * Restaurant online ordering inbox routes (Phase 2.1 B2).
 *
 * Unified queue for externally-sourced orders (WhatsApp, Daraz, Shopify,
 * Facebook, QR) that need to be accepted into the restaurant kitchen flow.
 * Gated by phase4_restaurant feature flag + manage_restaurant perm.
 */

module.exports = function registerRestaurantInboxRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const inbox = require("../services/online-inbox");
  const { acceptInboxSchema, rejectInboxSchema } = require("../schemas/restaurant-inbox");

  const gate = [
    requireMode("restaurant"),
    requireFeature("phase4_restaurant"),
    requirePerm("manage_restaurant"),
  ];

  app.get("/api/restaurant/inbox", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id || req.context?.outletId;
      const rows = await inbox.listInbox(
        deps.db,
        outletId ? Number(outletId) : null,
        { status: req.query.status || null, source: req.query.source || null }
      );
      res.json({ orders: rows });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/inbox/:id/accept", ...gate, validate(acceptInboxSchema), async (req, res) => {
    try {
      const result = await inbox.acceptOnlineOrder(
        deps.db,
        Number(req.params.id),
        req.employee.id,
        { order_context: req.body.order_context, outlet_id: req.body.outlet_id }
      );
      try {
        await deps.db.query(
          "INSERT INTO action_history (employee_id, action_type, description) VALUES ($1, $2, $3)",
          [req.employee.id, "online_order_accepted", JSON.stringify({
            web_order_id: Number(req.params.id),
            draft_order_id: result.draftOrderId,
            source: result.webOrder?.source,
          })]
        );
      } catch {}
      res.status(201).json({
        draft_order_id: result.draftOrderId,
        tickets: result.tickets,
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/inbox/:id/reject", ...gate, validate(rejectInboxSchema), async (req, res) => {
    try {
      const result = await inbox.rejectOnlineOrder(
        deps.db,
        Number(req.params.id),
        req.employee.id,
        req.body.reason
      );
      try {
        await deps.db.query(
          "INSERT INTO action_history (employee_id, action_type, description) VALUES ($1, $2, $3)",
          [req.employee.id, "online_order_rejected", JSON.stringify({
            web_order_id: Number(req.params.id),
            reason: req.body.reason,
          })]
        );
      } catch {}
      res.json({ web_order: result.webOrder });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
