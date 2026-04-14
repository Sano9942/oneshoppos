/**
 * Customer portal payment endpoints (M8).
 *
 * POST /api/portal/me/invoices/:id/pay
 *   - Validates ownership via customer_id
 *   - Reuses customer_invoice_payment_links (the existing webhook Context 2
 *     in routes/webhooks.js processes portal-initiated payments without
 *     changes — we only need to create the link row and return a checkout URL).
 */

const express = require("express");
const crypto = require("crypto");
const { loadCustomerAuth } = require("../../middleware/customer-auth");
const paymentGateway = require("../../services/payment-gateway");

module.exports = function registerCustomerPortalPayments(app, deps) {
  const router = express.Router();
  const authMw = loadCustomerAuth(deps);

  router.post("/me/invoices/:id/pay", authMw, async (req, res) => {
    try {
      if (!paymentGateway.isEnabled()) {
        return res.status(400).json({
          error: "Online payments are not configured for this store.",
        });
      }

      const { rows: [invoice] } = await req.db.query(
        "SELECT * FROM customer_invoices WHERE id = $1 AND customer_id = $2",
        [req.params.id, req.customerId]
      );
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status === "paid" || invoice.status === "void") {
        return res.status(400).json({ error: "Invoice is already paid or voided" });
      }
      const amount = Number(invoice.balance_due);
      if (!(amount > 0)) {
        return res.status(400).json({ error: "No balance due" });
      }

      // Reuse an active link if one exists (same token → same gateway session).
      const { rows: [existing] } = await req.db.query(
        `SELECT id, link_token, gateway_ref FROM customer_invoice_payment_links
         WHERE invoice_id = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY id DESC LIMIT 1`,
        [invoice.id]
      );

      const frontendUrl = (process.env.FRONTEND_URL || "https://sanopos.com").replace(/\/$/, "");
      const slug = req.tenant?.slug || req.query.tenant;
      const returnUrl = `${frontendUrl}/portal/${encodeURIComponent(slug)}/invoice-paid?invoice=${invoice.id}`;
      const cancelUrl = `${frontendUrl}/portal/${encodeURIComponent(slug)}/invoices/${invoice.id}`;

      let linkToken;
      let gatewayRef;
      let checkoutUrl;

      if (existing) {
        linkToken = existing.link_token;
        gatewayRef = existing.gateway_ref;
        // Rebuild the checkout URL via the gateway (idempotent for sandbox).
        const session = await paymentGateway.createInvoiceCheckout({
          invoiceId: invoice.id,
          amount,
          description: `Invoice ${invoice.invoice_number}`,
          returnUrl,
          cancelUrl,
          linkToken,
        });
        checkoutUrl = session.checkout_url;
        // If the gateway issued a new ref, update the row so the webhook can find it.
        if (session.gateway_ref && session.gateway_ref !== gatewayRef) {
          gatewayRef = session.gateway_ref;
          await req.db.query(
            "UPDATE customer_invoice_payment_links SET gateway_ref = $1 WHERE id = $2",
            [gatewayRef, existing.id]
          );
        }
      } else {
        linkToken = crypto.randomBytes(24).toString("hex");
        const session = await paymentGateway.createInvoiceCheckout({
          invoiceId: invoice.id,
          amount,
          description: `Invoice ${invoice.invoice_number}`,
          returnUrl,
          cancelUrl,
          linkToken,
        });
        checkoutUrl = session.checkout_url;
        gatewayRef = session.gateway_ref;
        const providerName = process.env.PAYMENT_GATEWAY || "manual";
        const expiresAt = new Date(Date.now() + 7 * 86400000);
        await req.db.query(
          `INSERT INTO customer_invoice_payment_links
             (invoice_id, link_token, gateway_ref, amount, status, expires_at, provider)
           VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
          [invoice.id, linkToken, gatewayRef, amount, expiresAt, providerName]
        );
      }

      res.json({
        checkout_url: checkoutUrl,
        link_token: linkToken,
        gateway_ref: gatewayRef,
        amount,
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.use("/api/portal", router);
};
