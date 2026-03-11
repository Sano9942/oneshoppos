const express = require("express");

module.exports = function createNotificationsRouter({ db, requireFeature }) {
  const router = express.Router();

  router.get(
    "/api/notifications",
    requireFeature("notifications"),
    async (req, res) => {
      try {
        const unreadOnly = Number(req.query.unread_only || 0) === 1;
        const where = unreadOnly ? "WHERE is_read = false" : "";
        const { rows } = await db.query(
          `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT 50`
        );
        res.json({ notifications: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.get(
    "/api/notifications/count",
    requireFeature("notifications"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          "SELECT COUNT(*) AS unread FROM notifications WHERE is_read = false"
        );
        res.json({ unread: Number(rows[0]?.unread || 0) });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.put(
    "/api/notifications/:id/read",
    requireFeature("notifications"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { rowCount } = await db.query(
          "UPDATE notifications SET is_read = true WHERE id = $1",
          [id]
        );
        res.json({
          message: "Notification marked as read",
          changed: rowCount || 0,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.put(
    "/api/notifications/read-all",
    requireFeature("notifications"),
    async (req, res) => {
      try {
        const { rowCount } = await db.query(
          "UPDATE notifications SET is_read = true WHERE is_read = false"
        );
        res.json({
          message: "All notifications marked as read",
          changed: rowCount || 0,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  return router;
};
