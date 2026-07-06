/**
 * Customer portal "My Packages" endpoint (F02).
 *
 * Read-only — lists the authenticated customer's own session packs / passes
 * with remaining balance, expiry, and redemption history. Owner-isolated: the
 * customer_id filter is the sole gate (mirrors treatments.js), so a customer
 * can only ever see their own packages.
 */

const express = require("express");
const { loadCustomerAuth } = require("../../middleware/customer-auth");
const pkgService = require("../../services/packages");

module.exports = function registerCustomerPortalPackages(app, deps) {
  const router = express.Router();
  const authMw = loadCustomerAuth(deps);

  router.get("/me/packages", authMw, async (req, res) => {
    try {
      // Catch up any stale-active-but-expired rows before reporting balances.
      await pkgService.expireStalePackages(req.db, req.customerId);

      const { rows } = await req.db.query(
        `SELECT cp.id, cp.credits_total, cp.credits_used,
                (cp.credits_total - cp.credits_used) AS credits_remaining,
                cp.status, cp.expires_at, cp.created_at,
                pt.name AS template_name, pt.service_scope,
                COALESCE(
                  (SELECT json_agg(json_build_object(
                            'id', pr.id,
                            'credits', pr.credits,
                            'redeemed_at', pr.redeemed_at,
                            'reversed_at', pr.reversed_at)
                          ORDER BY pr.redeemed_at DESC)
                     FROM package_redemptions pr
                    WHERE pr.customer_package_id = cp.id), '[]'
                ) AS history
           FROM customer_packages cp
           JOIN package_templates pt ON pt.id = cp.package_template_id
          WHERE cp.customer_id = $1
          ORDER BY cp.status = 'active' DESC, cp.created_at DESC`,
        [req.customerId],
      );
      res.json({ packages: rows });
    } catch (err) {
      // Pre-v101 tenant (tables absent) → empty list, not a 500.
      if (String(err.message || "").includes("does not exist")) {
        return res.json({ packages: [] });
      }
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.use("/api/portal", router);
};
