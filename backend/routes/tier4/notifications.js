const express = require("express");

module.exports = function createNotificationsRouter({ db, requireFeature }) {
  const router = express.Router();

  router.get(
    "/api/notifications",
    requireFeature("notifications"),
    (req, res) => {
      const unreadOnly = Number(req.query.unread_only || 0) === 1;
      const where = unreadOnly ? "WHERE is_read = 0" : "";
      db.all(
        `SELECT * FROM notifications ${where} ORDER BY datetime(created_at) DESC LIMIT 50`,
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ notifications: rows || [] });
        },
      );
    },
  );

  router.get(
    "/api/notifications/count",
    requireFeature("notifications"),
    (req, res) => {
      db.get(
        "SELECT COUNT(*) AS unread FROM notifications WHERE is_read = 0",
        [],
        (err, row) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ unread: Number(row?.unread || 0) });
        },
      );
    },
  );

  router.put(
    "/api/notifications/:id/read",
    requireFeature("notifications"),
    (req, res) => {
      const { id } = req.params;
      db.run(
        "UPDATE notifications SET is_read = 1 WHERE id = ?",
        [id],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            message: "Notification marked as read",
            changed: this.changes || 0,
          });
        },
      );
    },
  );

  router.put(
    "/api/notifications/read-all",
    requireFeature("notifications"),
    (req, res) => {
      db.run(
        "UPDATE notifications SET is_read = 1 WHERE is_read = 0",
        [],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            message: "All notifications marked as read",
            changed: this.changes || 0,
          });
        },
      );
    },
  );

  return router;
};
