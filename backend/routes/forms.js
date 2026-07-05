"use strict";

/**
 * F03 Form builder — staff/admin routes (tenant-scoped, mounted AFTER tenant
 * middleware). Template CRUD, send (creates pending response + public token),
 * staff-assisted fill, entity/staff response views, and void.
 *
 * The public fill route lives in routes/public-forms.js and the portal fill
 * route in routes/customer-portal/forms.js — all three converge on
 * services/forms.js:submitResponse (one validation + write path).
 */

module.exports = function registerFormsRoutes(app, deps) {
  const { requireFeature } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const {
    createTemplateSchema,
    updateTemplateSchema,
    sendFormSchema,
    submitResponseSchema,
  } = require("../schemas/forms");
  const forms = require("../services/forms");

  const gate = [requireFeature("custom_forms"), requirePerm("manage_forms")];

  function publicFillUrl(req, token) {
    const base = process.env.FRONTEND_URL || "https://sanopos.com";
    const slug = req.tenantSlug ? `?tenant=${encodeURIComponent(req.tenantSlug)}` : "";
    return `${base}/forms/fill/${token}${slug}`;
  }

  // ── Templates ──────────────────────────────────────────────────────
  app.get("/api/forms/templates", ...gate, async (req, res) => {
    try {
      const rows = await forms.listTemplates(deps.db, {
        includeInactive: req.query.include_inactive === "1",
      });
      res.json({ templates: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/forms/templates/:id", ...gate, async (req, res) => {
    try {
      const row = await forms.getTemplate(deps.db, Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Form template not found" });
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/forms/templates", ...gate, validate(createTemplateSchema), async (req, res) => {
    try {
      const row = await forms.createTemplate(deps.db, req.body);
      res.status(201).json(row);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/forms/templates/:id", ...gate, validate(updateTemplateSchema), async (req, res) => {
    try {
      const row = await forms.updateTemplate(deps.db, Number(req.params.id), req.body);
      if (!row) return res.status(404).json({ error: "Form template not found" });
      res.json(row);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // DELETE = deactivate (responses reference the template; never hard-delete).
  app.delete("/api/forms/templates/:id", ...gate, async (req, res) => {
    try {
      const row = await forms.deactivateTemplate(deps.db, Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Form template not found" });
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Send (create pending response + public token) ──────────────────
  app.post("/api/forms/templates/:id/send", ...gate, validate(sendFormSchema), async (req, res) => {
    try {
      const resp = await forms.sendForm(deps.db, Number(req.params.id), {
        customerId: req.body.customer_id || null,
        patientSubjectId: req.body.patient_subject_id || null,
        entityType: req.body.entity_type || null,
        entityId: req.body.entity_id || null,
      });
      const fillUrl = publicFillUrl(req, resp.public_token);

      // Best-effort email of the fill link (non-fatal). SMS rides F05 when
      // present; here we always return the URL so staff can share it manually.
      if (req.body.channel === "email" && req.body.customer_id) {
        try {
          const { enqueueEmail } = require("../services/email");
          const { rows: [cust] } = await deps.db.query(
            "SELECT name, email FROM customers WHERE id = $1",
            [req.body.customer_id]
          );
          if (cust?.email) {
            await enqueueEmail({
              type: "form_link",
              to: cust.email,
              tenant: { slug: req.tenantSlug, name: req.company?.company_name },
              data: {
                customer_name: cust.name,
                form_name: (await forms.getTemplate(deps.db, Number(req.params.id)))?.name,
                fill_url: fillUrl,
              },
            });
          }
        } catch (e) {
          // swallow — link is still returned for manual share
        }
      }

      res.status(201).json({ response: resp, fill_url: fillUrl });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Staff-assisted fill (one of the three converging paths) ────────
  app.post("/api/forms/responses/:id/submit", ...gate, validate(submitResponseSchema), async (req, res) => {
    try {
      const responseId = Number(req.params.id);
      let signatureUrl = null;
      if (req.body.signature_image_base64) {
        signatureUrl = await forms.uploadSignature(req.body.signature_image_base64, {
          tenantSlug: req.tenantSlug,
          responseId,
        });
      }
      const row = await forms.submitResponse(deps.db, responseId, {
        answers: req.body.answers,
        signatureUrl,
        via: "staff",
      });
      res.json(row);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Response views (staff) ─────────────────────────────────────────
  app.get("/api/forms/responses", ...gate, async (req, res) => {
    try {
      const rows = await forms.listResponses(deps.db, {
        entityType: req.query.entity_type || null,
        entityId: req.query.entity_id ? Number(req.query.entity_id) : null,
        customerId: req.query.customer_id ? Number(req.query.customer_id) : null,
        templateId: req.query.template_id ? Number(req.query.template_id) : null,
        status: req.query.status || null,
      });
      res.json({ responses: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/forms/responses/:id", ...gate, async (req, res) => {
    try {
      const row = await forms.getResponse(deps.db, Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Form response not found" });
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/forms/responses/:id/void", ...gate, async (req, res) => {
    try {
      const row = await forms.voidResponse(deps.db, Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Form response not found or already void" });
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
