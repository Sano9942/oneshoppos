"use strict";

/**
 * F03 Form builder — public tokenized fill (no login).
 *
 * Mounted BEFORE tenant middleware alongside public-bookings. Resolves the
 * tenant via resolvePublicTenantDb and rate-limits like public bookings.
 *
 * Token rules (non-negotiable):
 *  - single-use: burned (public_token = NULL) on submit
 *  - unguessable: 256-bit crypto random (services/forms.js:generatePublicToken)
 *  - 404 (not 403) on any bad/used/unknown token — the route is public by
 *    design, so a wrong token is "not found", never "forbidden"
 *  - no PII leakage: GET returns only the form structure, never customer data
 *    or prior answers
 */

const { resolvePublicTenantDb } = require("../services/public-tenant-context");
const { publicBookingLimiter } = require("../middleware/rate-limit");
const { validate } = require("../middleware/validate");
const { submitResponseSchema } = require("../schemas/forms");
const forms = require("../services/forms");

module.exports = function registerPublicFormRoutes(app, deps) {
  // GET /api/public/forms/:token — render data for the fill page
  app.get("/api/public/forms/:token", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const pending = await forms.getPendingByToken(db, req.params.token);
      if (!pending) return res.status(404).json({ error: "Form not found" });

      res.json({
        form_name: pending.form_name,
        require_signature: pending.require_signature,
        fields: pending.fields,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/public/forms/:token — submit the fill
  app.post(
    "/api/public/forms/:token",
    publicBookingLimiter,
    validate(submitResponseSchema),
    async (req, res) => {
      try {
        const resolved = await resolvePublicTenantDb(req, deps);
        if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
        const { db, tenant } = resolved;

        const row = await forms.submitByToken(db, req.params.token, {
          answers: req.body.answers,
          signatureBase64: req.body.signature_image_base64,
          tenantSlug: tenant?.slug,
        });
        if (!row) return res.status(404).json({ error: "Form not found" });

        res.json({ ok: true, submitted_at: row.submitted_at });
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );
};
