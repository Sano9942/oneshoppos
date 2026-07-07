"use strict";

/**
 * V08 — Public inquiry form → CRM lead.
 *
 * Mounted BEFORE tenant middleware (same posture as public-bookings.js): no
 * req.employee / deps.db proxy — tenant is resolved manually via
 * resolvePublicTenantDb(?tenant=slug). This is the top of the photography
 * funnel: a prospect submits name/contact/event details from an embeddable
 * /inquire page and lands as a CRM lead (routes/tier4/crm.js) with a staff
 * notification. Anti-spam: Cloudflare Turnstile (enforced only when
 * TURNSTILE_SECRET_KEY is configured — same guard as auth.js signup).
 */

const { resolvePublicTenantDb } = require("../services/public-tenant-context");
const { publicBookingLimiter } = require("../middleware/rate-limit");
const { validate } = require("../middleware/validate");
const { publicInquirySchema } = require("../schemas/inquiries");

// Mirrors the auth.js signup Turnstile check. Returns null on success or when
// no secret is configured (dev/test/staging); returns an error string to 4xx.
async function verifyTurnstile(req) {
  if (!process.env.TURNSTILE_SECRET_KEY) return null;
  const token = req.body?.turnstile_token;
  if (!token) return "Captcha verification required";
  try {
    const resp = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: process.env.TURNSTILE_SECRET_KEY,
          response: token,
        }),
      }
    );
    const data = await resp.json();
    return data.success ? null : "Captcha verification failed";
  } catch {
    // Fail-open on Cloudflare outage — a down captcha endpoint must not block
    // the funnel (matches auth.js signup behaviour).
    return null;
  }
}

module.exports = function registerPublicInquiryRoutes(app, deps) {
  // POST /api/public/inquiries — create a lead from a public inquiry form
  app.post(
    "/api/public/inquiries",
    publicBookingLimiter,
    validate(publicInquirySchema),
    async (req, res) => {
      try {
        const resolved = await resolvePublicTenantDb(req, deps);
        if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
        const { db } = resolved;

        const captchaErr = await verifyTurnstile(req);
        if (captchaErr) return res.status(400).json({ error: captchaErr });

        const { name, phone, email, event_date, event_type, message } = req.body;

        // Event details have no dedicated columns on crm_leads — pack them into
        // notes as a readable block (v1). source='inquiry_form' distinguishes
        // funnel leads from staff-entered ones; stage='new'.
        const noteLines = [];
        if (event_type) noteLines.push(`Event type: ${event_type}`);
        if (event_date) noteLines.push(`Event date: ${event_date}`);
        if (message) noteLines.push(`Message: ${message}`);
        const notes = noteLines.join("\n") || null;

        const { rows: [lead] } = await db.query(
          `INSERT INTO crm_leads (name, phone, email, source, stage, priority, notes, created_at, updated_at)
           VALUES ($1, $2, $3, 'inquiry_form', 'new', 'medium', $4, NOW(), NOW())
           RETURNING id`,
          [name, phone || null, email || null, notes]
        );

        // Staff notification. Public routes have no ALS context, so write to
        // the resolved tenant db directly rather than the createNotification
        // helper (which reads the ALS-bound _notifDb).
        db.query(
          `INSERT INTO notifications (type, title, message, link)
           VALUES ('inquiry_received', 'New inquiry', $1, '/crm')`,
          [`New inquiry from ${name}${event_type ? ` — ${event_type}` : ""}`]
        ).catch(() => {});

        res.status(201).json({ id: lead.id, message: "Thanks — we'll be in touch shortly." });
      } catch (err) {
        const status = err.statusCode || 500;
        res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
      }
    }
  );
};
