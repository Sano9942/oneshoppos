/**
 * backend/routes/messaging.js — Generic messaging inbox (WhatsApp, future SMS).
 *
 * GET    /api/messaging/threads              — List threads with customer info
 * GET    /api/messaging/threads/:id/messages — Messages for a thread
 * POST   /api/messaging/threads/:id/send     — Staff reply
 * PUT    /api/messaging/threads/:id          — Update thread (status, assign)
 */

module.exports = function registerMessagingRoutes(app, deps) {
  const { requireFeature } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const { sendMessageSchema, updateThreadSchema } = require("../schemas/messaging");
  const { addMessage } = require("../services/messaging");

  const gate = [requireFeature("customer_messaging"), requirePerm("manage_orders")];

  // ── List threads ──────────────────────────────────────────────────────

  app.get("/api/messaging/threads", ...gate, async (req, res) => {
    try {
      const { status, channel } = req.query;
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const offset = Number(req.query.offset) || 0;

      const conditions = [];
      const params = [];
      let idx = 1;

      if (status && status !== "all") {
        conditions.push(`mt.status = $${idx}`);
        params.push(status);
        idx++;
      }
      if (channel) {
        conditions.push(`mt.channel = $${idx}`);
        params.push(channel);
        idx++;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const { rows } = await deps.db.query(
        `SELECT mt.*,
           c.name AS customer_name, c.mobile AS customer_mobile, c.email AS customer_email,
           e.name AS assigned_name,
           (SELECT content FROM message_entries me WHERE me.thread_id = mt.id ORDER BY me.created_at DESC LIMIT 1) AS last_message
         FROM message_threads mt
         LEFT JOIN customers c ON c.id = mt.customer_id
         LEFT JOIN employees e ON e.id = mt.assigned_to
         ${where}
         ORDER BY mt.last_message_at DESC NULLS LAST
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      const { rows: [{ cnt }] } = await deps.db.query(
        `SELECT COUNT(*)::int AS cnt FROM message_threads mt ${where}`,
        params
      );

      res.json({ threads: rows, total: cnt });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Thread messages ───────────────────────────────────────────────────

  app.get("/api/messaging/threads/:id/messages", ...gate, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;

      const { rows } = await deps.db.query(
        `SELECT * FROM message_entries WHERE thread_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
        [req.params.id, limit, offset]
      );

      const { rows: [{ cnt }] } = await deps.db.query(
        "SELECT COUNT(*)::int AS cnt FROM message_entries WHERE thread_id = $1",
        [req.params.id]
      );

      res.json({ messages: rows, total: cnt });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Staff reply ───────────────────────────────────────────────────────

  app.post("/api/messaging/threads/:id/send", ...gate, validate(sendMessageSchema), async (req, res) => {
    try {
      const threadId = Number(req.params.id);
      const { content, message_type } = req.body;

      const { rows: [thread] } = await deps.db.query("SELECT * FROM message_threads WHERE id = $1", [threadId]);
      if (!thread) return res.status(404).json({ error: "Thread not found" });

      // Write outbound message entry
      const entry = await addMessage(deps.db, {
        threadId,
        direction: "outbound",
        content,
        messageType: message_type,
        senderType: "staff",
        senderId: req.employee.id,
      });

      // Send via WhatsApp if applicable
      if (thread.channel === "whatsapp") {
        try {
          const WhatsAppClient = require("../services/marketplace/whatsapp-client");
          // Load integration settings for this tenant
          const { rows: [settings] } = await deps.db.query(
            "SELECT config_json FROM integration_settings WHERE provider = 'whatsapp' AND is_active = true LIMIT 1"
          );
          if (settings?.config_json) {
            const config = typeof settings.config_json === "string" ? JSON.parse(settings.config_json) : settings.config_json;
            const client = new WhatsAppClient({ api_key: config.access_token, config_json: config });
            await client.sendTextMessage(thread.channel_identifier, content);
          }
        } catch (waErr) {
          // Log but don't fail — message is recorded locally even if WhatsApp send fails
          const logger = require("../services/logger").child({ component: "messaging" });
          logger.error({ err: waErr, threadId }, "WhatsApp outbound send failed");
        }
      }

      res.json(entry);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Update thread ─────────────────────────────────────────────────────

  app.put("/api/messaging/threads/:id", ...gate, validate(updateThreadSchema), async (req, res) => {
    try {
      const sets = [];
      const params = [];
      let idx = 1;

      if (req.body.status !== undefined) {
        sets.push(`status = $${idx}`);
        params.push(req.body.status);
        idx++;
      }
      if (req.body.assigned_to !== undefined) {
        sets.push(`assigned_to = $${idx}`);
        params.push(req.body.assigned_to);
        idx++;
      }

      if (sets.length === 0) return res.status(400).json({ error: "Nothing to update" });

      sets.push("updated_at = NOW()");
      params.push(req.params.id);

      const { rows: [thread] } = await deps.db.query(
        `UPDATE message_threads SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
        params
      );
      if (!thread) return res.status(404).json({ error: "Thread not found" });
      res.json(thread);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
