// Phase 2-R.4 — Walk-in waitlist.
//
// Server-assigned position. Seating / removing / notifying an entry
// compact-renumbers the remaining active positions so the UI can always
// display "You are #3" faithfully. SMS on notify is best-effort — if the
// tenant has no provider configured, we still transition status.

module.exports = function registerWaitlistRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../../middleware/feature-flags");
  const { requirePerm } = require("../../middleware/permissions");
  const { validate } = require("../../middleware/validate");
  const { waitlistCreateSchema, waitlistSeatSchema } = require("../../schemas/waitlist");
  const smsService = require("../../services/sms");
  const logger = require("../../services/logger").child({ component: "waitlist" });

  const gate = [
    requireMode("restaurant"),
    requireFeature("phase4_restaurant_reservations"),
    requirePerm("manage_restaurant"),
  ];

  app.get("/api/restaurant/waitlist", ...gate, async (req, res) => {
    try {
      const { outlet_id, status } = req.query;
      const params = [];
      const where = ["1=1"];
      if (outlet_id) { params.push(Number(outlet_id)); where.push(`outlet_id = $${params.length}`); }
      if (status) {
        const parts = String(status).split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length) {
          const placeholders = parts.map((_, i) => `$${params.length + i + 1}`);
          params.push(...parts);
          where.push(`status IN (${placeholders.join(",")})`);
        }
      }
      const { rows } = await deps.db.query(
        `SELECT * FROM waitlist_entries
         WHERE ${where.join(" AND ")}
         ORDER BY position ASC NULLS LAST, created_at ASC`,
        params
      );
      res.json({ entries: rows });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post(
    "/api/restaurant/waitlist",
    ...gate,
    validate(waitlistCreateSchema),
    async (req, res) => {
      try {
        const body = req.body;
        const { rows: [maxRow] } = await deps.db.query(
          `SELECT COALESCE(MAX(position), 0) AS max_pos
           FROM waitlist_entries
           WHERE status IN ('waiting','notified')`
        );
        const position = (maxRow?.max_pos || 0) + 1;
        const { rows: [row] } = await deps.db.query(
          `INSERT INTO waitlist_entries
            (customer_name, phone, party_size, outlet_id, quoted_wait_minutes,
             notes, position, status, created_by_employee_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'waiting', $8)
           RETURNING *`,
          [
            body.customer_name,
            body.phone || null,
            body.party_size,
            body.outlet_id || null,
            body.quoted_wait_minutes || null,
            body.notes || null,
            position,
            req.employee?.id || null,
          ]
        );
        res.status(201).json(row);
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

  app.put("/api/restaurant/waitlist/:id/notify", ...gate, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
      const { rows: [row] } = await deps.db.query(
        `UPDATE waitlist_entries
         SET status = 'notified', notified_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'waiting'
         RETURNING *`,
        [id]
      );
      if (!row) return res.status(409).json({ error: "Entry is not in 'waiting' state" });

      if (row.phone) {
        try {
          const { rows: [profile] } = await deps.db.query(
            `SELECT company_name FROM company_profile LIMIT 1`
          );
          const store = profile?.company_name || "our restaurant";
          await smsService.sendSms(deps.db, {
            to: row.phone,
            body: `${row.customer_name}, your table at ${store} is ready! Please come in.`,
            type: "transactional",
          });
        } catch (smsErr) {
          // Keep the status transition — SMS is best-effort.
          logger.warn({ err: smsErr, entryId: id }, "waitlist notify SMS failed");
        }
      }
      res.json(row);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put(
    "/api/restaurant/waitlist/:id/seat",
    ...gate,
    validate(waitlistSeatSchema),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
        const tableId = req.body?.table_id ? Number(req.body.table_id) : null;

        await deps.db.transaction(async (client) => {
          const { rows: [row] } = await client.query(
            `UPDATE waitlist_entries
             SET status = 'seated', seated_at = NOW(), updated_at = NOW()
             WHERE id = $1 AND status IN ('waiting','notified')
             RETURNING *`,
            [id]
          );
          if (!row) {
            const err = new Error("Entry is not in a seatable state");
            err.statusCode = 409;
            throw err;
          }

          if (tableId) {
            // Best-effort create a table session so the floor picks up.
            try {
              await client.query(
                `INSERT INTO restaurant_table_sessions
                  (table_id, outlet_id, guest_count, status)
                 VALUES ($1, $2, $3, 'seated')`,
                [tableId, row.outlet_id, row.party_size]
              );
            } catch { /* floor not provisioned — non-fatal */ }
          }

          await compactPositions(client);
        });

        const { rows: [fresh] } = await deps.db.query(
          `SELECT * FROM waitlist_entries WHERE id = $1`,
          [id]
        );
        res.json(fresh);
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

  app.delete("/api/restaurant/waitlist/:id", ...gate, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
      await deps.db.transaction(async (client) => {
        const { rows: [row] } = await client.query(
          `UPDATE waitlist_entries
           SET status = 'removed', removed_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND status IN ('waiting','notified')
           RETURNING id`,
          [id]
        );
        if (!row) {
          const err = new Error("Entry already removed or seated");
          err.statusCode = 409;
          throw err;
        }
        await compactPositions(client);
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};

async function compactPositions(client) {
  // Re-number the active queue 1..N so the UI never shows gaps.
  const { rows } = await client.query(
    `SELECT id FROM waitlist_entries
     WHERE status IN ('waiting','notified')
     ORDER BY position ASC NULLS LAST, created_at ASC`
  );
  for (let i = 0; i < rows.length; i++) {
    await client.query(
      `UPDATE waitlist_entries SET position = $1 WHERE id = $2`,
      [i + 1, rows[i].id]
    );
  }
}
