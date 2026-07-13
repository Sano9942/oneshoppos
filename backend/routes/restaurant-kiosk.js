/**
 * Manager-facing routes for restaurant order kiosks.
 *
 * Mounted AFTER tenant middleware (managers create/list/revoke tokens while
 * logged in). Public-facing menu + submit endpoints live in
 * routes/public-restaurant.js — those resolve tenant manually via slug.
 *
 * See docs/plans/2026-05-06-order-kiosk-design.md for the counter slot vs
 * table token distinction.
 */

const crypto = require("crypto");

module.exports = function registerRestaurantKioskRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");

  const gate = [
    // companyLevel: config surface (manage_restaurant-gated QR token
    // issuance), not outlet-operational (Step 9 allowlist).
    requireMode("restaurant", { companyLevel: true }),
    requireFeature("phase4_restaurant_qr", { companyLevel: true }),
    requirePerm("manage_restaurant"),
  ];

  // POST /api/restaurant/kiosk-tokens
  // Body: { outlet_id, table_id?, label? }
  //   - table_id null/missing → counter slot
  //   - table_id set          → table-mode draft token
  app.post("/api/restaurant/kiosk-tokens", ...gate, async (req, res) => {
    try {
      const { outlet_id, table_id, label } = req.body || {};
      if (!outlet_id) return res.status(400).json({ error: "outlet_id is required" });

      // Validate outlet belongs to tenant.
      const { rows: [outlet] } = await deps.db.query(
        "SELECT id FROM outlets WHERE id = $1",
        [outlet_id]
      );
      if (!outlet) return res.status(404).json({ error: "Outlet not found" });

      if (table_id) {
        // Table mode — validate the table, then mint a draft with a stable
        // source_token_id. One open draft per table is the existing
        // restaurant pattern (UNIQUE on source_token_id WHERE NOT NULL).
        // restaurant_tables doesn't carry outlet_id directly; it lives on
        // the parent floor plan.
        const { rows: [table] } = await deps.db.query(
          `SELECT rt.id, rt.label, fp.outlet_id
             FROM restaurant_tables rt
             JOIN restaurant_floor_plans fp ON fp.id = rt.floor_plan_id
            WHERE rt.id = $1 AND fp.outlet_id = $2`,
          [table_id, outlet_id]
        );
        if (!table) return res.status(404).json({ error: "Table not found for outlet" });

        // If an open draft already exists for this table with a token, return
        // it instead of minting a duplicate — the partial UNIQUE index on
        // source_token_id wouldn't conflict (different tokens), but having
        // multiple open dine_in checks per table confuses the QR menu lookup.
        const { rows: [existing] } = await deps.db.query(
          `SELECT id, source_token_id FROM draft_orders
           WHERE table_id = $1 AND status = 'open'
             AND order_context IN ('dine_in','bar')
             AND source_token_id IS NOT NULL
           ORDER BY created_at DESC LIMIT 1`,
          [table_id]
        );

        let token, draftId;
        if (existing) {
          token = existing.source_token_id;
          draftId = existing.id;
        } else {
          token = crypto.randomUUID();
          // W26 fix path 1: resolve any open table session for this table and
          // link the new draft to it via table_session_id. Without this, a
          // server seating the table via POS while a customer scans the QR
          // creates two parallel checks (one with table_session_id, one without).
          // Linking here means W17's post-sale dirty-flip update fires correctly
          // when the kiosk-minted draft settles.
          const { rows: [openSession] } = await deps.db.query(
            `SELECT id FROM restaurant_table_sessions
              WHERE table_id = $1
                AND status IN ('seated','dirty')
                AND closed_at IS NULL
              ORDER BY id DESC LIMIT 1`,
            [table_id]
          );
          const tableSessionId = openSession?.id || null;
          const { rows: [draft] } = await deps.db.query(
            `INSERT INTO draft_orders
               (outlet_id, created_by, order_context, table_id, table_session_id, source_token_id, source_channel, status)
             VALUES ($1, $2, 'dine_in', $3, $4, $5, 'kiosk', 'open')
             RETURNING id`,
            [outlet_id, req.employee.id, table_id, tableSessionId, token]
          );
          draftId = draft.id;
        }

        return res.status(201).json({
          type: "table",
          id: draftId,
          token,
          path: `/menu/${token}`,
          table_id,
          table_label: table.label,
          outlet_id,
        });
      }

      // Counter slot — one active slot per outlet (revoke first if needed).
      // We don't auto-revoke; the caller decides via DELETE.
      const slotToken = crypto.randomUUID();
      const { rows: [slot] } = await deps.db.query(
        `INSERT INTO restaurant_kiosk_slots (outlet_id, slot_token, label)
         VALUES ($1, $2, $3) RETURNING id, slot_token, label, created_at`,
        [outlet_id, slotToken, label || null]
      );

      return res.status(201).json({
        type: "counter",
        id: slot.id,
        token: slot.slot_token,
        path: `/menu/${slot.slot_token}`,
        label: slot.label,
        outlet_id,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/restaurant/kiosk-tokens?outlet_id=N
  // Returns active counter slots and open table-mode tokens for the outlet.
  app.get("/api/restaurant/kiosk-tokens", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id ? Number(req.query.outlet_id) : null;

      const { rows: counters } = await deps.db.query(
        `SELECT id, slot_token AS token, label, outlet_id, created_at,
                current_draft_order_id
         FROM restaurant_kiosk_slots
         WHERE revoked_at IS NULL ${outletId ? "AND outlet_id = $1" : ""}
         ORDER BY created_at DESC`,
        outletId ? [outletId] : []
      );

      const { rows: tables } = await deps.db.query(
        `SELECT d.id, d.source_token_id AS token, d.outlet_id, d.created_at,
                d.table_id, rt.label AS table_label
         FROM draft_orders d
         LEFT JOIN restaurant_tables rt ON rt.id = d.table_id
         WHERE d.status = 'open'
           AND d.order_context IN ('dine_in','bar')
           AND d.source_token_id IS NOT NULL
           AND d.table_id IS NOT NULL
           ${outletId ? "AND d.outlet_id = $1" : ""}
         ORDER BY d.created_at DESC`,
        outletId ? [outletId] : []
      );

      // Tables available for table-mode minting (excluding ones with an
      // already-open dine_in/bar draft — that draft IS the kiosk token,
      // re-using it would conflict with the unique source_token_id index).
      const { rows: availableTables } = await deps.db.query(
        `SELECT rt.id, rt.label, rt.section_id, rt.floor_plan_id, fp.outlet_id
         FROM restaurant_tables rt
         JOIN restaurant_floor_plans fp ON fp.id = rt.floor_plan_id
         WHERE ${outletId ? "fp.outlet_id = $1 AND" : ""}
               NOT EXISTS (
                 SELECT 1 FROM draft_orders d
                 WHERE d.table_id = rt.id AND d.status = 'open'
                   AND d.order_context IN ('dine_in','bar')
                   AND d.source_token_id IS NOT NULL
               )
         ORDER BY rt.label`,
        outletId ? [outletId] : []
      );

      res.json({
        counters: counters.map((c) => ({
          type: "counter",
          id: c.id,
          token: c.token,
          path: `/menu/${c.token}`,
          label: c.label,
          outlet_id: c.outlet_id,
          created_at: c.created_at,
          has_active_draft: !!c.current_draft_order_id,
        })),
        tables: tables.map((t) => ({
          type: "table",
          id: t.id,
          token: t.token,
          path: `/menu/${t.token}`,
          outlet_id: t.outlet_id,
          table_id: t.table_id,
          table_label: t.table_label,
          created_at: t.created_at,
        })),
        available_tables: availableTables,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/restaurant/kiosk-tokens/counter/:id  → revoke a counter slot
  // DELETE /api/restaurant/kiosk-tokens/table/:id    → cancel a table-mode draft
  // Disjoint paths avoid the slot-id vs draft-id ambiguity flagged in the
  // design doc.
  app.delete("/api/restaurant/kiosk-tokens/counter/:id", ...gate, async (req, res) => {
    try {
      const { rowCount } = await deps.db.query(
        `UPDATE restaurant_kiosk_slots
            SET revoked_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND revoked_at IS NULL`,
        [req.params.id]
      );
      if (!rowCount) return res.status(404).json({ error: "Counter slot not found" });
      res.json({ revoked: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/restaurant/kiosk-tokens/table/:id", ...gate, async (req, res) => {
    try {
      const { rowCount } = await deps.db.query(
        `UPDATE draft_orders
            SET status = 'cancelled', updated_at = NOW()
          WHERE id = $1 AND status = 'open'
            AND order_context IN ('dine_in','bar')`,
        [req.params.id]
      );
      if (!rowCount) return res.status(404).json({ error: "Table token not found or already closed" });
      res.json({ revoked: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
