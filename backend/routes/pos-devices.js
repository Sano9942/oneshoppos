// 2-G.13 POS device registry — browser UUID ↔ surrogate integer id, used as
// scope_id for pos_layouts scope_type='device'. Gated by the same feature
// flag as the layouts themselves so per-device is opt-in with the rest of
// the Quick Grid feature.
const { validate } = require("../middleware/validate");
const { RegisterDeviceSchema, UpdateDeviceSchema } = require("../schemas/pos-devices");

module.exports = function registerPosDeviceRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;
  const feat = requireFeature("phase2_pos_layouts");

  // POST /api/pos-devices/register — idempotent on device_uuid.
  // Creates (or updates) the registry row and stamps last_seen. Returns the
  // surrogate integer id which the browser persists alongside the UUID and
  // uses as scope_id when fetching its device-scoped pos_layouts.
  app.post("/api/pos-devices/register", feat, validate(RegisterDeviceSchema), async (req, res) => {
    const { device_uuid, outlet_id, label } = req.body;
    try {
      const { rows } = await db.query(
        `INSERT INTO pos_device_registry (device_uuid, outlet_id, label, last_seen)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (device_uuid) DO UPDATE SET
           outlet_id = COALESCE(EXCLUDED.outlet_id, pos_device_registry.outlet_id),
           label = COALESCE(EXCLUDED.label, pos_device_registry.label),
           last_seen = NOW()
         RETURNING *`,
        [device_uuid, outlet_id || null, label || null],
      );
      res.json({ device: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/pos-devices — list devices for admin tab. Optional outlet filter.
  app.get("/api/pos-devices", feat, requirePerm("all_access"), async (req, res) => {
    const { outlet_id } = req.query;
    try {
      let sql = `SELECT d.*, o.name AS outlet_name FROM pos_device_registry d
                 LEFT JOIN outlets o ON o.id = d.outlet_id`;
      const params = [];
      if (outlet_id) {
        sql += ` WHERE d.outlet_id = $1`;
        params.push(Number(outlet_id));
      }
      sql += ` ORDER BY d.last_seen DESC`;
      const { rows } = await db.query(sql, params);
      res.json({ devices: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/pos-devices/:id — admin rename / reassign outlet.
  app.put("/api/pos-devices/:id", feat, requirePerm("all_access"), validate(UpdateDeviceSchema), async (req, res) => {
    const { label, outlet_id } = req.body;
    try {
      const sets = [];
      const vals = [];
      let idx = 1;
      if (label !== undefined) { sets.push(`label = $${idx++}`); vals.push(label); }
      if (outlet_id !== undefined) { sets.push(`outlet_id = $${idx++}`); vals.push(outlet_id); }
      if (!sets.length) return res.status(400).json({ error: "no fields to update" });
      vals.push(req.params.id);
      const { rows } = await db.query(
        `UPDATE pos_device_registry SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
        vals,
      );
      if (!rows.length) return res.status(404).json({ error: "Device not found" });
      res.json({ device: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/pos-devices/:id — admin unregister. CASCADE is intentionally
  // NOT set on pos_layouts.scope_id — orphan device layouts are harmless and
  // a future admin cleanup handles them explicitly.
  app.delete("/api/pos-devices/:id", feat, requirePerm("all_access"), async (req, res) => {
    try {
      const { rowCount } = await db.query(
        "DELETE FROM pos_device_registry WHERE id = $1",
        [req.params.id],
      );
      if (!rowCount) return res.status(404).json({ error: "Device not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
