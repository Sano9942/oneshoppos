const { validateConnection } = require("../services/fbr");

module.exports = function registerFbrRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, requireFeature } = deps;

  // GET /api/fbr/config — returns FBR fields from company_profile + feature flag status
  // PLAN-V2 Step 2 / D7: FBR credential/config surface (NTN + API token) is
  // delegable via manage_integrations; Administrators pass via all_access.
  // The invoice-queue dashboard/retry surfaces below stay all_access.
  app.get("/api/fbr/config", requireAnyPerm(["manage_integrations"]), async (req, res) => {
    try {
      const {
        rows: [profile],
      } = await db.query(
        `SELECT ntn, strn, fbr_api_token, fbr_environment, fbr_default_hs_code, fbr_province
         FROM company_profile WHERE id = 1`
      );
      const {
        rows: [flag],
      } = await db.query(
        "SELECT enabled FROM feature_flags WHERE key = 'fbr_integration'"
      );
      res.json({
        ...profile,
        fbr_api_token: profile?.fbr_api_token ? "••••••••" : null,
        enabled: flag?.enabled || false,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/fbr/config — updates FBR fields + optionally toggles feature flag
  app.put("/api/fbr/config", requireAnyPerm(["manage_integrations"]), async (req, res) => {
    try {
      const {
        fbr_api_token,
        fbr_environment,
        fbr_default_hs_code,
        fbr_province,
        enabled,
      } = req.body;

      const sets = [];
      const params = [];
      let idx = 1;

      if (fbr_api_token !== undefined && fbr_api_token !== "••••••••") {
        sets.push(`fbr_api_token = $${idx++}`);
        params.push(fbr_api_token || null);
      }
      if (fbr_environment !== undefined) {
        sets.push(`fbr_environment = $${idx++}`);
        params.push(fbr_environment);
      }
      if (fbr_default_hs_code !== undefined) {
        sets.push(`fbr_default_hs_code = $${idx++}`);
        params.push(fbr_default_hs_code || null);
      }
      if (fbr_province !== undefined) {
        sets.push(`fbr_province = $${idx++}`);
        params.push(fbr_province || null);
      }

      if (sets.length) {
        await db.query(
          `UPDATE company_profile SET ${sets.join(", ")} WHERE id = 1`,
          params
        );
      }

      if (typeof enabled === "boolean") {
        await db.query(
          `UPDATE feature_flags SET enabled = $1, updated_at = NOW() WHERE key = 'fbr_integration'`,
          [enabled]
        );
      } else {
        // Auto-enable when the merchant has saved a complete config (NTN +
        // token + province) and hasn't explicitly toggled the flag in this
        // request. Only flips OFF→ON; never auto-disables a working setup.
        const { rows: [profileNow] } = await db.query(
          `SELECT ntn, fbr_api_token, fbr_province FROM company_profile WHERE id = 1`
        );
        const hasFullConfig =
          profileNow?.ntn?.trim() &&
          profileNow?.fbr_api_token?.trim() &&
          profileNow?.fbr_province?.trim();
        if (hasFullConfig) {
          await db.query(
            `UPDATE feature_flags SET enabled = true, updated_at = NOW()
             WHERE key = 'fbr_integration' AND enabled = false`
          );
        }
      }

      res.json({ message: "FBR config updated" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/fbr/test-connection — validate FBR token
  app.post(
    "/api/fbr/test-connection",
    requireAnyPerm(["manage_integrations"]),
    async (req, res) => {
      try {
        const {
          rows: [profile],
        } = await db.query(
          "SELECT fbr_api_token, fbr_environment FROM company_profile WHERE id = 1"
        );
        if (!profile?.fbr_api_token) {
          return res
            .status(400)
            .json({ error: "FBR API token not configured" });
        }
        const result = await validateConnection(
          profile.fbr_api_token,
          profile.fbr_environment
        );
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // --- Endpoints below require fbr_integration feature flag ---

  // GET /api/fbr/dashboard — summary counts by status
  app.get(
    "/api/fbr/dashboard",
    requirePerm("all_access"),
    requireFeature("fbr_integration"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT status, COUNT(*)::int AS count FROM fbr_invoices GROUP BY status`
        );
        const counts = { pending: 0, posted: 0, failed: 0, processing: 0 };
        rows.forEach((r) => (counts[r.status] = r.count));
        counts.total = Object.values(counts).reduce((a, b) => a + b, 0);

        // posted_at is TIMESTAMPTZ — "today" is the tenant-local day, not the
        // DB session's (UTC on prod, which splits the FBR day at 5 AM PKT).
        const { isValidTz } = require("../utils/tz");
        const fbrTz = isValidTz(req.company?.timezone) ? req.company.timezone : "UTC";
        const {
          rows: [today],
        } = await db.query(
          `SELECT COUNT(*)::int AS count FROM fbr_invoices
           WHERE status = 'posted' AND (posted_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date`,
          [fbrTz]
        );
        counts.posted_today = today?.count || 0;

        res.json(counts);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // GET /api/fbr/invoices — paginated list with status/date filters
  app.get(
    "/api/fbr/invoices",
    requirePerm("all_access"),
    requireFeature("fbr_integration"),
    async (req, res) => {
      try {
        const {
          status,
          from,
          to,
          search,
          page = 1,
          limit = 50,
        } = req.query;
        const where = [];
        const params = [];
        let idx = 1;

        if (status && status !== "all") {
          where.push(`fi.status = $${idx++}`);
          params.push(status);
        }
        if (from) {
          where.push(`fi.created_at >= $${idx++}`);
          params.push(from);
        }
        if (to) {
          where.push(`fi.created_at < $${idx++}`);
          params.push(to);
        }
        if (search) {
          where.push(`(s.invoice_number ILIKE $${idx++})`);
          params.push(`%${search}%`);
        }

        const whereClause = where.length
          ? `WHERE ${where.join(" AND ")}`
          : "";

        const {
          rows: [{ total }],
        } = await db.query(
          `SELECT COUNT(*)::int AS total FROM fbr_invoices fi
           LEFT JOIN sales s ON fi.sale_id = s.id ${whereClause}`,
          params
        );

        const offset = (parseInt(page) - 1) * parseInt(limit);
        params.push(parseInt(limit));
        params.push(offset);

        const { rows } = await db.query(
          `SELECT fi.*, s.invoice_number, s.total_amount
           FROM fbr_invoices fi
           LEFT JOIN sales s ON fi.sale_id = s.id
           ${whereClause}
           ORDER BY fi.created_at DESC
           LIMIT $${idx++} OFFSET $${idx++}`,
          params
        );

        res.json({
          invoices: rows,
          total,
          pages: Math.ceil(total / parseInt(limit)),
          page: parseInt(page),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/fbr/invoices/:id/retry — retry a single failed invoice
  app.post(
    "/api/fbr/invoices/:id/retry",
    requirePerm("all_access"),
    requireFeature("fbr_integration"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { rowCount } = await db.query(
          `UPDATE fbr_invoices SET status = 'pending', retry_count = 0, next_retry_at = NOW(), last_error = NULL
           WHERE id = $1 AND status = 'failed'`,
          [id]
        );
        if (!rowCount)
          return res
            .status(404)
            .json({ error: "Invoice not found or not in failed state" });

        // Dispatch pg-boss job for immediate retry (non-blocking)
        try {
          const { getBoss } = require("../services/boss");
          const boss = await getBoss();
          await boss.send(
            "fbr-invoice",
            { tenantSlug: req.tenantSlug, invoiceId: Number(id) },
            { retryLimit: 5, retryDelay: 60 }
          );
        } catch (_) {}

        res.json({ message: "Invoice queued for retry" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/fbr/invoices/retry-all — retry all failed invoices
  app.post(
    "/api/fbr/invoices/retry-all",
    requirePerm("all_access"),
    requireFeature("fbr_integration"),
    async (req, res) => {
      try {
        const { rows: updatedRows, rowCount } = await db.query(
          `UPDATE fbr_invoices SET status = 'pending', retry_count = 0, next_retry_at = NOW(), last_error = NULL
           WHERE status = 'failed'
           RETURNING id`
        );

        // Dispatch pg-boss jobs for all retried invoices (non-blocking)
        if (updatedRows.length > 0) {
          Promise.resolve().then(async () => {
            try {
              const { getBoss } = require("../services/boss");
              const boss = await getBoss();
              for (const row of updatedRows) {
                await boss.send(
                  "fbr-invoice",
                  { tenantSlug: req.tenantSlug, invoiceId: row.id },
                  { retryLimit: 5, retryDelay: 60 }
                );
              }
            } catch (_) {}
          });
        }

        res.json({ message: `${rowCount} invoice(s) queued for retry` });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
