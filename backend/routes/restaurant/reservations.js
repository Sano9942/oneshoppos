// Phase 2-R.4 — Reservations CRUD + SMS.
//
// Admin-side CRUD for bookings, plus a best-effort SMS helper that the
// reminder worker also uses. Gated: restaurant mode + phase4_restaurant_reservations.

const crypto = require("crypto");

module.exports = function registerReservationsRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../../middleware/feature-flags");
  const { requirePerm } = require("../../middleware/permissions");
  const { validate } = require("../../middleware/validate");
  const {
    reservationCreateSchema,
    reservationUpdateSchema,
    reservationSmsSchema,
    reservationSeatSchema,
  } = require("../../schemas/reservations");
  const smsService = require("../../services/sms");
  const floor = require("../../services/restaurant-floor");
  const logger = require("../../services/logger").child({ component: "reservations" });

  const gate = [
    requireMode("restaurant"),
    requireFeature("phase4_restaurant_reservations"),
    requirePerm("manage_restaurant"),
  ];

  // List with optional filters.
  app.get("/api/restaurant/reservations", ...gate, async (req, res) => {
    try {
      const { from, to, status, outlet_id } = req.query;
      const params = [];
      const where = ["1=1"];
      if (from) { params.push(from); where.push(`reservation_start >= $${params.length}`); }
      if (to) { params.push(to); where.push(`reservation_start <= $${params.length}`); }
      if (status) { params.push(status); where.push(`status = $${params.length}`); }
      if (outlet_id) { params.push(Number(outlet_id)); where.push(`outlet_id = $${params.length}`); }
      const { rows } = await deps.db.query(
        `SELECT r.*,
                rt.label AS table_label
         FROM reservations r
         LEFT JOIN restaurant_tables rt ON rt.id = r.table_id
         WHERE ${where.join(" AND ")}
         ORDER BY reservation_start ASC`,
        params
      );
      res.json({ reservations: rows });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.get("/api/restaurant/reservations/:id", ...gate, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
      const { rows: [row] } = await deps.db.query(
        `SELECT r.*, rt.label AS table_label
         FROM reservations r
         LEFT JOIN restaurant_tables rt ON rt.id = r.table_id
         WHERE r.id = $1`,
        [id]
      );
      if (!row) return res.status(404).json({ error: "Reservation not found" });
      res.json(row);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post(
    "/api/restaurant/reservations",
    ...gate,
    validate(reservationCreateSchema),
    async (req, res) => {
      try {
        const body = req.body;
        const { rows: [row] } = await deps.db.query(
          `INSERT INTO reservations
            (customer_name, phone, email, party_size, reservation_start,
             reservation_end, outlet_id, table_id, status, notes, source,
             token, created_by_employee_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11, $12)
           RETURNING *`,
          [
            body.customer_name,
            body.phone || null,
            body.email || null,
            body.party_size,
            body.reservation_start,
            body.reservation_end || null,
            body.outlet_id || null,
            body.table_id || null,
            body.notes || null,
            body.source || "staff",
            crypto.randomUUID(),
            req.employee?.id || null,
          ]
        );
        res.status(201).json(row);
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

  app.put(
    "/api/restaurant/reservations/:id",
    ...gate,
    validate(reservationUpdateSchema),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
        const fields = [];
        const params = [];
        for (const [k, v] of Object.entries(req.body)) {
          if (v === undefined) continue;
          params.push(v);
          fields.push(`${k} = $${params.length}`);
        }
        if (!fields.length) return res.status(400).json({ error: "No fields to update" });
        params.push(id);
        const { rows: [row] } = await deps.db.query(
          `UPDATE reservations SET ${fields.join(", ")}, updated_at = NOW()
           WHERE id = $${params.length} RETURNING *`,
          params
        );
        if (!row) return res.status(404).json({ error: "Reservation not found" });
        res.json(row);
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

  // W25 — seat a reservation: pick a table, open a table_session, stamp
  // reservations.table_id + status='seated'. Until this route shipped, the
  // Seat button on /restaurant/reservations only flipped status — leaving
  // table_id null and no floor-side session to order/fire/settle against.
  app.post(
    "/api/restaurant/reservations/:id/seat",
    ...gate,
    validate(reservationSeatSchema),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
        const { table_id, server_id, guest_count } = req.body;

        const result = await deps.db.transaction(async (client) => {
          const { rows: [reservation] } = await client.query(
            "SELECT * FROM reservations WHERE id = $1",
            [id]
          );
          if (!reservation) {
            const err = new Error("Reservation not found");
            err.statusCode = 404;
            throw err;
          }
          if (!["pending", "confirmed", "waitlisted"].includes(reservation.status)) {
            const err = new Error(
              `Reservation is ${reservation.status} — only pending/confirmed/waitlisted reservations can be seated`
            );
            err.statusCode = 409;
            throw err;
          }

          // Re-uses the same service helper that the floor "tap empty table to seat"
          // flow uses. Throws 409 if the table already has an active session, or
          // 404 if the table_id is invalid. outlet_id is derived from the table's
          // floor plan inside openTableSession — reservations.outlet_id may be null.
          const session = await floor.openTableSession(client, {
            table_id,
            server_id: server_id ?? null,
            guest_count: guest_count ?? reservation.party_size ?? 1,
          });

          const { rows: [updatedReservation] } = await client.query(
            `UPDATE reservations
             SET status = 'seated', table_id = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [table_id, id]
          );

          return { session, reservation: updatedReservation };
        });

        try {
          await deps.db.query(
            "INSERT INTO action_history (employee_id, action_type, description) VALUES ($1, $2, $3)",
            [
              req.employee.id,
              "reservation_seated",
              JSON.stringify({
                reservation_id: id,
                table_id,
                session_id: result.session.id,
              }),
            ]
          );
        } catch {}

        res.json(result);
      } catch (err) {
        logger.error({ err, reservation_id: req.params.id }, "reservation seat failed");
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

  app.delete("/api/restaurant/reservations/:id", ...gate, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
      // Hard-delete only terminal rows; force soft-cancel via PUT otherwise.
      const { rows: [row] } = await deps.db.query(
        `DELETE FROM reservations
         WHERE id = $1 AND status IN ('cancelled','no_show')
         RETURNING id`,
        [id]
      );
      if (!row) {
        return res
          .status(409)
          .json({ error: "Only cancelled or no-show reservations can be deleted — use PUT to cancel" });
      }
      res.json({ id: row.id, deleted: true });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post(
    "/api/restaurant/reservations/:id/send-sms",
    ...gate,
    validate(reservationSmsSchema),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
        const { rows: [row] } = await deps.db.query(
          `SELECT r.*, cp.company_name
           FROM reservations r, company_profile cp
           WHERE r.id = $1
           LIMIT 1`,
          [id]
        );
        if (!row) return res.status(404).json({ error: "Reservation not found" });
        if (!row.phone) return res.status(400).json({ error: "Reservation has no phone number" });

        const body = buildSmsBody(req.body.template, row);
        const result = await smsService.sendSms(deps.db, {
          to: row.phone,
          body,
          type: "transactional",
        });

        // Stamp confirmation/reminder flags for auditability.
        if (result.sent) {
          if (req.body.template === "confirmation") {
            await deps.db.query(
              `UPDATE reservations SET sms_confirmed_at = NOW() WHERE id = $1 AND sms_confirmed_at IS NULL`,
              [id]
            );
          }
        }
        res.json({ ok: true, sent: result.sent, error: result.error });
      } catch (err) {
        logger.error({ err }, "reservation send-sms failed");
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );
};

function buildSmsBody(template, r) {
  const when = new Date(r.reservation_start).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const name = r.customer_name || "there";
  const party = r.party_size || 1;
  const store = r.company_name || "our restaurant";
  switch (template) {
    case "confirmation":
      return `Hi ${name}, your reservation for ${party} at ${store} on ${when} is confirmed. Reply CANCEL if you can't make it.`;
    case "reminder":
      return `Reminder: your reservation for ${party} at ${store} is at ${when}. Reply CANCEL if you can't make it.`;
    case "cancellation":
      return `Your reservation at ${store} on ${when} has been cancelled. Thank you.`;
    default:
      return `Your reservation at ${store} on ${when}.`;
  }
}

module.exports.buildSmsBody = buildSmsBody;
