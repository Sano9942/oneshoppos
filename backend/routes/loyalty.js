/**
 * Phase 2-G Wave 2 — 2-G.3 loyalty admin endpoints.
 *
 * Three endpoints:
 *   GET  /api/loyalty/config                     — tenant earn + redeem rates
 *   GET  /api/loyalty/customers/:id/ledger       — paginated transactions
 *   POST /api/loyalty/customers/:id/adjust       — manual point adjustment
 *
 * The config endpoint is NOT feature-flagged — the POS needs it even
 * when the broader loyalty flag is off, so it can keep using the
 * tenant-configured rate for earn/redeem math rather than the
 * hardcoded constants. Ledger + adjust are gated by phase2g_loyalty
 * since they only make sense once we're actually writing audit rows.
 *
 * Adjust is mutation-only and scoped to manage_customers. The reason
 * for the manager-PIN verification pattern (like price overrides) is
 * reserved for 2-G.5; for now the perm gate is enough.
 */
module.exports = function registerLoyaltyRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, requireFeature } = deps;

  // GET /api/loyalty/config — always available, even when flag off.
  // Falls back to the historical constants if the columns aren't yet
  // present (tenant DB still on < v63).
  app.get("/api/loyalty/config", requirePerm("view_sales_reports"), async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT loyalty_earn_rate::numeric AS earn_rate,
                loyalty_redeem_rate::numeric AS redeem_rate
           FROM company_profile WHERE id = 1`,
      );
      const row = rows[0] || {};
      res.json({
        earn_rate: Number(row.earn_rate ?? 1),
        redeem_rate: Number(row.redeem_rate ?? 10),
      });
    } catch (err) {
      // Pre-v63 tenants: columns may not exist. Ship defaults.
      if (String(err.message || "").match(/column .* does not exist/i)) {
        return res.json({ earn_rate: 1, redeem_rate: 10 });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/loyalty/config — admin sets tenant-wide rates.
  app.put(
    "/api/loyalty/config",
    requireAnyPerm(["all_access"]),
    async (req, res) => {
      try {
        const earn = Number(req.body?.earn_rate);
        const redeem = Number(req.body?.redeem_rate);
        if (!Number.isFinite(earn) || earn < 0) {
          return res.status(400).json({ error: "earn_rate must be >= 0" });
        }
        if (!Number.isFinite(redeem) || redeem < 0) {
          return res.status(400).json({ error: "redeem_rate must be >= 0" });
        }
        await db.query(
          `UPDATE company_profile
              SET loyalty_earn_rate = $1, loyalty_redeem_rate = $2
            WHERE id = 1`,
          [earn, redeem],
        );
        res.json({ success: true, earn_rate: earn, redeem_rate: redeem });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // GET /api/loyalty/customers/:id/ledger — paginated ledger rows.
  app.get(
    "/api/loyalty/customers/:id/ledger",
    requireFeature("phase2g_loyalty"),
    requirePerm("view_customer_reports"),
    async (req, res) => {
      try {
        const customerId = Number(req.params.id);
        if (!Number.isInteger(customerId) || customerId <= 0) {
          return res.status(400).json({ error: "Invalid customer id" });
        }
        const limit = Math.min(
          Math.max(Number(req.query.limit) || 50, 1),
          500,
        );
        const offset = Math.max(Number(req.query.offset) || 0, 0);
        const { rows } = await db.query(
          `SELECT id, customer_id, type, points, reference_type, reference_id, note, created_at
             FROM loyalty_transactions
            WHERE customer_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT $2 OFFSET $3`,
          [customerId, limit, offset],
        );
        const { rows: totals } = await db.query(
          `SELECT
             COALESCE(SUM(CASE WHEN type = 'earn' THEN points ELSE 0 END), 0)::int AS total_earned,
             COALESCE(SUM(CASE WHEN type = 'redeem' THEN points ELSE 0 END), 0)::int AS total_redeemed,
             COALESCE(SUM(CASE WHEN type = 'adjust' THEN points ELSE 0 END), 0)::int AS total_adjusted,
             COALESCE(SUM(CASE WHEN type = 'expire' THEN points ELSE 0 END), 0)::int AS total_expired
             FROM loyalty_transactions WHERE customer_id = $1`,
          [customerId],
        );
        res.json({ rows, totals: totals[0] || {} });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // POST /api/loyalty/customers/:id/adjust — manual add/subtract points.
  // Body: { points: integer (signed), note?: string }
  // Writes one ledger row + updates customers.loyalty_points atomically.
  app.post(
    "/api/loyalty/customers/:id/adjust",
    requireFeature("phase2g_loyalty"),
    requireAnyPerm(["all_access"]),
    async (req, res) => {
      try {
        const customerId = Number(req.params.id);
        const delta = Number(req.body?.points);
        const note = String(req.body?.note || "").slice(0, 500) || null;
        if (!Number.isInteger(customerId) || customerId <= 0) {
          return res.status(400).json({ error: "Invalid customer id" });
        }
        if (!Number.isInteger(delta) || delta === 0) {
          return res
            .status(400)
            .json({ error: "points must be a non-zero integer" });
        }

        const result = await db.transaction(async (client) => {
          const { rows: custRows } = await client.query(
            `SELECT loyalty_points FROM customers WHERE id = $1 FOR UPDATE`,
            [customerId],
          );
          if (!custRows.length) {
            throw Object.assign(new Error("Customer not found"), {
              statusCode: 404,
            });
          }
          const current = Number(custRows[0].loyalty_points || 0);
          if (current + delta < 0) {
            throw Object.assign(
              new Error("Adjustment would leave balance below zero"),
              { statusCode: 400 },
            );
          }
          await client.query(
            `UPDATE customers SET loyalty_points = loyalty_points + $1 WHERE id = $2`,
            [delta, customerId],
          );
          // The ledger stores absolute `points`; sign is implied by type.
          // For adjust we store the signed delta to keep semantics obvious.
          await client.query(
            `INSERT INTO loyalty_transactions
               (customer_id, type, points, reference_type, reference_id, note)
             VALUES ($1, 'adjust', $2, 'manual', NULL, $3)`,
            [customerId, delta, note],
          );
          return { new_balance: current + delta };
        });

        res.json({ success: true, ...result });
      } catch (err) {
        if (err.statusCode) {
          return res.status(err.statusCode).json({ error: err.message });
        }
        res.status(500).json({ error: err.message });
      }
    },
  );
};
