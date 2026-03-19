module.exports = function mountCourierRoutes(app, deps) {
  const db = deps.db;
  const { requirePerm } = deps;

  // GET /api/couriers — list couriers
  app.get("/api/couriers", async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT id, name, adapter_key, tracking_url_template, enabled, api_base_url FROM courier_integrations ORDER BY name"
      );
      res.json({ couriers: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/couriers/:id — admin configures courier (enable/disable, API key)
  app.put("/api/couriers/:id", requirePerm("all_access"), async (req, res) => {
    try {
      const { id } = req.params;
      const { enabled, api_key, api_secret, api_base_url } = req.body || {};
      await db.query(
        `UPDATE courier_integrations SET
          enabled = COALESCE($1, enabled),
          api_key = COALESCE($2, api_key),
          api_secret = COALESCE($3, api_secret),
          api_base_url = COALESCE($4, api_base_url)
         WHERE id = $5`,
        [enabled, api_key, api_secret, api_base_url, id]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/couriers — admin adds custom courier
  app.post("/api/couriers", requirePerm("all_access"), async (req, res) => {
    try {
      const { name, tracking_url_template } = req.body || {};
      if (!name) return res.status(400).json({ error: "Name required" });
      const { rows: [courier] } = await db.query(
        `INSERT INTO courier_integrations (name, adapter_key, tracking_url_template, enabled)
         VALUES ($1, 'generic', $2, true) RETURNING *`,
        [name, tracking_url_template || ""]
      );
      res.json({ courier });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/orders/:id/ship — ship an order with a courier
  app.post("/api/orders/:id/ship", requirePerm("manage_orders"), async (req, res) => {
    try {
      const { id } = req.params;
      const { courier_id, tracking_number } = req.body || {};
      if (!courier_id || !tracking_number) {
        return res.status(400).json({ error: "courier_id and tracking_number required" });
      }

      const { rows: [order] } = await db.query(
        "SELECT id, order_status FROM web_orders WHERE id = $1", [id]
      );
      if (!order) return res.status(404).json({ error: "Order not found" });

      await db.query(
        `UPDATE web_orders SET courier_id = $1, tracking_number = $2, shipped_at = NOW(),
           fulfillment_status = 'shipped'
         WHERE id = $3`,
        [courier_id, tracking_number, id]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/orders/:id/tracking — get tracking info
  app.get("/api/orders/:id/tracking", async (req, res) => {
    try {
      const { rows: [order] } = await db.query(
        `SELECT wo.tracking_number, wo.shipped_at, wo.delivered_at, wo.fulfillment_status,
                ci.name as courier_name, ci.tracking_url_template
         FROM web_orders wo
         LEFT JOIN courier_integrations ci ON wo.courier_id = ci.id
         WHERE wo.id = $1`,
        [req.params.id]
      );
      if (!order) return res.status(404).json({ error: "Order not found" });

      let tracking_url = null;
      if (order.tracking_number && order.tracking_url_template) {
        tracking_url = order.tracking_url_template.replace("{tracking}", order.tracking_number);
      }

      res.json({ ...order, tracking_url });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
