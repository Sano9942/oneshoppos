/**
 * Customer portal "My Stays" endpoints (M9).
 *
 * Read-only v1 — lists a guest's past + upcoming room bookings with folio
 * totals and linked invoices. Scoped to the authenticated customer.
 */

const express = require("express");
const { loadCustomerAuth } = require("../../middleware/customer-auth");

module.exports = function registerCustomerPortalStays(app, deps) {
  const router = express.Router();
  const authMw = loadCustomerAuth(deps);

  router.get("/me/stays", authMw, async (req, res) => {
    try {
      const { rows } = await req.db.query(
        `SELECT b.id, b.booking_number, b.status, b.check_in_date, b.check_out_date,
                b.nights, b.rate_snapshot, b.deposit_collected, b.deposit_status,
                b.actual_checkin, b.actual_checkout, b.invoice_id,
                r.room_number,
                rt.name AS room_type_name,
                gf.id AS folio_id, gf.status AS folio_status, gf.grand_total AS folio_grand_total,
                ci.invoice_number, ci.balance_due, ci.total_amount AS invoice_total
         FROM room_bookings b
         LEFT JOIN rooms r ON r.id = b.room_id
         LEFT JOIN room_types rt ON rt.id = b.room_type_id
         LEFT JOIN guest_folios gf ON gf.booking_id = b.id
         LEFT JOIN customer_invoices ci ON ci.id = b.invoice_id
         WHERE b.customer_id = $1
         ORDER BY b.check_in_date DESC, b.id DESC`,
        [req.customerId]
      );
      res.json({ stays: rows });
    } catch (err) {
      // Table missing for tenants pre-v38 → empty list (graceful degradation)
      if (String(err.message || "").includes("does not exist")) {
        return res.json({ stays: [] });
      }
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.use("/api/portal", router);
};
