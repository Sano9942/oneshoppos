"use strict";

/**
 * F03 Form builder — customer portal fill tab (M8-style).
 *
 * Mounted BEFORE tenant middleware; auth via loadCustomerAuth (scope
 * "customer"), tenant DB is req.db. Lists ONLY the logged-in customer's own
 * responses (customer_id scope) and submits via the shared
 * services/forms.js:submitResponse path (via = "portal").
 */

const express = require("express");
const { loadCustomerAuth } = require("../../middleware/customer-auth");
const forms = require("../../services/forms");

module.exports = function registerCustomerPortalForms(app, deps) {
  const router = express.Router();
  const authMw = loadCustomerAuth(deps);

  // List the customer's own forms (pending first)
  router.get("/me/forms", authMw, async (req, res) => {
    try {
      const { rows } = await req.db.query(
        `SELECT fr.id, fr.status, fr.submitted_at, fr.created_at,
                ft.name AS form_name, ft.require_signature
           FROM form_responses fr
           JOIN form_templates ft ON ft.id = fr.form_template_id
          WHERE fr.customer_id = $1 AND fr.status <> 'void'
          ORDER BY (fr.status = 'pending') DESC, fr.created_at DESC`,
        [req.customerId]
      );
      res.json({ forms: rows });
    } catch (err) {
      if (String(err.message || "").includes("does not exist")) {
        return res.json({ forms: [] });
      }
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Full detail of one of the customer's own forms (fields + any answers)
  router.get("/me/forms/:id", authMw, async (req, res) => {
    try {
      const { rows: [row] } = await req.db.query(
        `SELECT fr.id, fr.status, fr.fields_snapshot, fr.answers,
                fr.signature_url, fr.submitted_at,
                ft.name AS form_name, ft.require_signature
           FROM form_responses fr
           JOIN form_templates ft ON ft.id = fr.form_template_id
          WHERE fr.id = $1 AND fr.customer_id = $2 AND fr.status <> 'void'`,
        [Number(req.params.id), req.customerId]
      );
      if (!row) return res.status(404).json({ error: "Form not found" });
      res.json(row);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Submit the customer's own pending form
  router.post("/me/forms/:id/submit", authMw, async (req, res) => {
    try {
      const responseId = Number(req.params.id);
      // Ownership check before the shared submit path.
      const { rows: [own] } = await req.db.query(
        "SELECT id FROM form_responses WHERE id = $1 AND customer_id = $2 AND status = 'pending'",
        [responseId, req.customerId]
      );
      if (!own) return res.status(404).json({ error: "Form not found" });

      let signatureUrl = null;
      if (req.body.signature_image_base64) {
        signatureUrl = await forms.uploadSignature(req.body.signature_image_base64, {
          tenantSlug: req.tenant?.slug,
          responseId,
        });
      }
      const row = await forms.submitResponse(req.db, responseId, {
        answers: req.body.answers,
        signatureUrl,
        via: "portal",
      });
      res.json({ ok: true, submitted_at: row.submitted_at });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.use("/api/portal", router);
};
