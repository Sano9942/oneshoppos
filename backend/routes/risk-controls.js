// 2-G.17 Anti-theft & shrinkage controls.
//
// Entire surface is gated by the phase2g_risk_controls feature flag (defense
// in depth — the three enforcement points in printer.js, returns.js, and
// shifts.js also gate via the same flag so switching off is fully atomic).

const { validate } = require("../middleware/validate");
const {
  UpdateRiskConfigSchema,
  NoSaleEventSchema,
  ReviewAnomalyFlagSchema,
} = require("../schemas/risk-controls");

module.exports = function registerRiskControlsRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;
  const feat = requireFeature("phase2g_risk_controls");

  // Printer service is optional — in tests we don't kick a real drawer. The
  // route still records the no-sale event so the audit log is populated.
  let openDrawer = null;
  try {
    const printerSvc = require("../services/printer")(db);
    openDrawer = printerSvc.openDrawer;
  } catch {
    /* no-op — tests + headless environments skip the drawer kick */
  }

  // ── config (thresholds) ──────────────────────────────────────────────

  app.get("/api/risk/config", feat, requirePerm("all_access"), async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT refund_approval_threshold, variance_approval_threshold, anomaly_z_score_threshold, updated_at FROM risk_controls_config WHERE id = 1",
      );
      if (!rows.length) {
        // Seed-on-read — migration is responsible for the row, but keep the
        // route robust if the tenant's schema is mid-migration.
        await db.query("INSERT INTO risk_controls_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
        return res.json({
          refund_approval_threshold: 5000,
          variance_approval_threshold: 500,
          anomaly_z_score_threshold: 2.0,
          updated_at: null,
        });
      }
      return res.json(rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put(
    "/api/risk/config",
    feat,
    requirePerm("all_access"),
    validate(UpdateRiskConfigSchema),
    async (req, res) => {
      const { refund_approval_threshold, variance_approval_threshold, anomaly_z_score_threshold } = req.body;
      try {
        await db.query(
          `UPDATE risk_controls_config
             SET refund_approval_threshold = COALESCE($1, refund_approval_threshold),
                 variance_approval_threshold = COALESCE($2, variance_approval_threshold),
                 anomaly_z_score_threshold = COALESCE($3, anomaly_z_score_threshold),
                 updated_at = NOW()
           WHERE id = 1`,
          [refund_approval_threshold ?? null, variance_approval_threshold ?? null, anomaly_z_score_threshold ?? null],
        );
        const { rows } = await db.query(
          "SELECT refund_approval_threshold, variance_approval_threshold, anomaly_z_score_threshold, updated_at FROM risk_controls_config WHERE id = 1",
        );
        return res.json(rows[0]);
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // ── no-sale reasons (reference data) ─────────────────────────────────

  app.get("/api/risk/no-sale-reasons", feat, async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT id, code, label, sort_order FROM no_sale_reasons WHERE is_active = true ORDER BY sort_order ASC, label ASC",
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── no-sale event + drawer kick ──────────────────────────────────────

  app.post(
    "/api/risk/no-sale",
    feat,
    requirePerm("pos_park"),
    validate(NoSaleEventSchema),
    async (req, res) => {
      const { reason_code, note, outlet_id } = req.body;
      const employeeId = Number(req.employee?.id || req.headers["x-employee-id"] || 0);
      if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

      try {
        // Validate reason exists + is active.
        const { rows: reasonRows } = await db.query(
          "SELECT code FROM no_sale_reasons WHERE code = $1 AND is_active = true",
          [reason_code],
        );
        if (!reasonRows.length) {
          return res.status(400).json({ error: `Unknown or inactive reason_code "${reason_code}"` });
        }

        // Look up the currently open shift for this employee's outlet (best-effort).
        let shiftId = null;
        if (outlet_id) {
          const { rows: shiftRows } = await db.query(
            "SELECT id FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
            [outlet_id],
          );
          shiftId = shiftRows.length ? shiftRows[0].id : null;
        }

        // Kick the drawer (best-effort — logging happens regardless).
        let drawerResult = { ok: true, skipped: true };
        if (typeof openDrawer === "function") {
          try {
            drawerResult = await openDrawer();
          } catch (e) {
            drawerResult = { ok: false, error: e.message };
          }
        }

        const { rows } = await db.query(
          `INSERT INTO no_sale_events (employee_id, outlet_id, shift_id, reason_code, note)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, employee_id, outlet_id, shift_id, reason_code, note, created_at`,
          [employeeId, outlet_id || null, shiftId, reason_code, note || null],
        );

        return res.json({ event: rows[0], drawer: drawerResult });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // ── no-sale event listing ────────────────────────────────────────────

  app.get("/api/risk/no-sale-events", feat, requirePerm("view_reports"), async (req, res) => {
    try {
      const { employee_id, outlet_id, date_from, date_to, limit = 50, offset = 0 } = req.query;
      const conditions = [];
      const params = [];
      if (employee_id) {
        params.push(Number(employee_id));
        conditions.push(`n.employee_id = $${params.length}`);
      }
      if (outlet_id) {
        params.push(Number(outlet_id));
        conditions.push(`n.outlet_id = $${params.length}`);
      }
      if (date_from) {
        params.push(date_from);
        conditions.push(`n.created_at >= $${params.length}::date`);
      }
      if (date_to) {
        params.push(date_to);
        conditions.push(`n.created_at < ($${params.length}::date + INTERVAL '1 day')`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      params.push(Math.min(Number(limit) || 50, 500));
      params.push(Math.max(Number(offset) || 0, 0));

      const { rows } = await db.query(
        `SELECT n.id, n.employee_id, e.name AS employee_name,
                n.outlet_id, o.name AS outlet_name,
                n.shift_id, n.reason_code, r.label AS reason_label,
                n.note, n.created_at
           FROM no_sale_events n
           LEFT JOIN employees e ON e.id = n.employee_id
           LEFT JOIN outlets o ON o.id = n.outlet_id
           LEFT JOIN no_sale_reasons r ON r.code = n.reason_code
           ${where}
           ORDER BY n.created_at DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return res.json({ events: rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── anomaly flags ────────────────────────────────────────────────────

  app.get("/api/risk/anomaly-flags", feat, requirePerm("view_reports"), async (req, res) => {
    try {
      const { reviewed, limit = 50, offset = 0 } = req.query;
      const conditions = [];
      const params = [];
      if (reviewed === "false" || reviewed === "0") {
        conditions.push("f.reviewed_at IS NULL");
      } else if (reviewed === "true" || reviewed === "1") {
        conditions.push("f.reviewed_at IS NOT NULL");
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      params.push(Math.min(Number(limit) || 50, 500));
      params.push(Math.max(Number(offset) || 0, 0));

      const { rows } = await db.query(
        `SELECT f.id, f.employee_id, e.name AS employee_name,
                f.outlet_id, o.name AS outlet_name,
                f.metric, f.value, f.peer_mean, f.peer_stddev, f.z_score,
                f.period_start, f.period_end, f.flagged_at,
                f.reviewed_by, rev.name AS reviewed_by_name,
                f.reviewed_at, f.review_note
           FROM retail_anomaly_flags f
           LEFT JOIN employees e ON e.id = f.employee_id
           LEFT JOIN outlets o ON o.id = f.outlet_id
           LEFT JOIN employees rev ON rev.id = f.reviewed_by
           ${where}
           ORDER BY f.flagged_at DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return res.json({ flags: rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put(
    "/api/risk/anomaly-flags/:id/review",
    feat,
    requirePerm("all_access"),
    validate(ReviewAnomalyFlagSchema),
    async (req, res) => {
      const flagId = Number(req.params.id);
      if (!flagId) return res.status(400).json({ error: "Invalid flag id" });
      const reviewerId = Number(req.employee?.id || req.headers["x-employee-id"] || 0);
      if (!reviewerId) return res.status(401).json({ error: "Unauthorized" });

      try {
        const { rows } = await db.query(
          `UPDATE retail_anomaly_flags
             SET reviewed_by = $1, reviewed_at = NOW(), review_note = $2
           WHERE id = $3
           RETURNING id, reviewed_by, reviewed_at, review_note`,
          [reviewerId, req.body.review_note || null, flagId],
        );
        if (!rows.length) return res.status(404).json({ error: "Flag not found" });
        return res.json(rows[0]);
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    },
  );

  // ── dashboard summary ────────────────────────────────────────────────

  app.get("/api/risk/summary", feat, requirePerm("view_reports"), async (req, res) => {
    try {
      const { rows: [noSale] } = await db.query(
        `SELECT COUNT(*)::int AS no_sale_count_7d
           FROM no_sale_events
          WHERE created_at >= NOW() - INTERVAL '7 days'`,
      );
      const { rows: [flags] } = await db.query(
        `SELECT COUNT(*)::int AS unreviewed_count
           FROM retail_anomaly_flags
          WHERE reviewed_at IS NULL`,
      );
      return res.json({
        no_sale_count_7d: noSale?.no_sale_count_7d || 0,
        unreviewed_anomaly_count: flags?.unreviewed_count || 0,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
};
