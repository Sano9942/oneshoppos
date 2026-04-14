/**
 * Customer portal appointment endpoints (M8).
 *
 * Book / reschedule / cancel flows for the logged-in customer.
 * Reuses booking-services.js so existing overlap + guard logic is applied.
 */

const express = require("express");
const { validate } = require("../../middleware/validate");
const { loadCustomerAuth } = require("../../middleware/customer-auth");
const {
  createAppointment,
  rescheduleAppointment,
  cancelAppointment,
} = require("../../services/booking-services");
const {
  bookAppointmentSchema,
  rescheduleAppointmentSchema,
  cancelAppointmentSchema,
} = require("../../schemas/customer-portal");

const MIN_NOTICE_MS = 15 * 60 * 1000;

async function loadCustomerRow(db, customerId) {
  const { rows: [c] } = await db.query(
    "SELECT id, name, email, mobile FROM customers WHERE id = $1 AND deleted_at IS NULL",
    [customerId]
  );
  return c;
}

async function loadServiceRow(db, serviceId) {
  const { rows: [s] } = await db.query(
    "SELECT id, name, duration_minutes FROM booking_services WHERE id = $1",
    [serviceId]
  );
  return s;
}

async function loadCompanyProfile(db) {
  try {
    const { rows: [p] } = await db.query(
      "SELECT company_name, address, phone FROM company_profile LIMIT 1"
    );
    return p || null;
  } catch {
    return null;
  }
}

async function enqueueAppointmentEmail(db, tenant, type, customer, data) {
  try {
    if (!customer?.email) return;
    const { enqueueEmail } = require("../../services/email");
    await enqueueEmail(db, {
      tenantId: tenant.id,
      type,
      to: customer.email,
      tenant: { slug: tenant.slug, name: tenant.name || tenant.slug },
      data,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[portal-appointments] enqueue ${type} failed:`, err.message);
  }
}

module.exports = function registerCustomerPortalAppointments(app, deps) {
  const router = express.Router();
  const authMw = loadCustomerAuth(deps);

  // ── POST /me/appointments ─────────────────────────────────────────
  router.post(
    "/me/appointments",
    authMw,
    validate(bookAppointmentSchema),
    async (req, res) => {
      try {
        const customer = await loadCustomerRow(req.db, req.customerId);
        if (!customer) return res.status(404).json({ error: "Customer not found" });

        const profile = await loadCompanyProfile(req.db);
        const appt = await createAppointment(
          req.db,
          {
            service_id: req.body.service_id,
            employee_id: req.body.employee_id || null,
            outlet_id: req.body.outlet_id || null,
            start_at: req.body.start_at,
            customer_id: customer.id,
            customer_name: customer.name,
            customer_email: customer.email,
            customer_phone: customer.mobile,
            notes: req.body.notes || null,
          },
          "portal",
          {
            tenant: req.tenant,
            companyProfile: profile,
            frontendUrl: process.env.FRONTEND_URL,
          }
        );

        const service = await loadServiceRow(req.db, req.body.service_id);
        await enqueueAppointmentEmail(
          req.db,
          req.tenant,
          "customer_portal_appointment_confirmation",
          customer,
          {
            storeName: profile?.company_name || req.tenant.name || req.tenant.slug,
            customerName: customer.name,
            serviceName: service?.name || "Service",
            startAt: appt.start_at,
            endAt: appt.end_at,
            status: appt.status,
            storeAddress: profile?.address || null,
            storePhone: profile?.phone || null,
          }
        );

        res.status(201).json(appt);
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

  // ── PUT /me/appointments/:id/reschedule ───────────────────────────
  router.put(
    "/me/appointments/:id/reschedule",
    authMw,
    validate(rescheduleAppointmentSchema),
    async (req, res) => {
      try {
        // Ownership check first.
        const { rows: [existing] } = await req.db.query(
          "SELECT id, customer_id, start_at, service_id FROM appointments WHERE id = $1",
          [req.params.id]
        );
        if (!existing || Number(existing.customer_id) !== Number(req.customerId)) {
          return res.status(404).json({ error: "Appointment not found" });
        }

        // Portal-only 15-min-notice guard (service enforces admin-bypass only).
        const newStart = new Date(req.body.start_at);
        if (!(newStart.getTime() > Date.now() + MIN_NOTICE_MS)) {
          return res.status(400).json({
            error: "Appointments must be rescheduled at least 15 minutes in advance",
          });
        }

        const updated = await rescheduleAppointment(req.db, Number(req.params.id), {
          start_at: req.body.start_at,
          employee_id: req.body.employee_id || null,
        });

        const customer = await loadCustomerRow(req.db, req.customerId);
        const service = await loadServiceRow(req.db, updated.service_id);
        const profile = await loadCompanyProfile(req.db);
        await enqueueAppointmentEmail(
          req.db,
          req.tenant,
          "customer_portal_appointment_rescheduled",
          customer,
          {
            storeName: profile?.company_name || req.tenant.name || req.tenant.slug,
            customerName: customer?.name,
            serviceName: service?.name || "Service",
            oldStartAt: existing.start_at,
            newStartAt: updated.start_at,
            endAt: updated.end_at,
          }
        );

        res.json(updated);
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

  // ── PUT /me/appointments/:id/cancel ───────────────────────────────
  router.put(
    "/me/appointments/:id/cancel",
    authMw,
    validate(cancelAppointmentSchema),
    async (req, res) => {
      try {
        const { rows: [existing] } = await req.db.query(
          "SELECT id, customer_id, service_id, start_at FROM appointments WHERE id = $1",
          [req.params.id]
        );
        if (!existing || Number(existing.customer_id) !== Number(req.customerId)) {
          return res.status(404).json({ error: "Appointment not found" });
        }
        const cancelled = await cancelAppointment(
          req.db,
          Number(req.params.id),
          req.body.reason || null
        );

        const customer = await loadCustomerRow(req.db, req.customerId);
        const service = await loadServiceRow(req.db, cancelled.service_id);
        const profile = await loadCompanyProfile(req.db);
        await enqueueAppointmentEmail(
          req.db,
          req.tenant,
          "customer_portal_appointment_cancelled",
          customer,
          {
            storeName: profile?.company_name || req.tenant.name || req.tenant.slug,
            customerName: customer?.name,
            serviceName: service?.name || "Service",
            startAt: cancelled.start_at,
            reason: req.body.reason || null,
          }
        );

        res.json(cancelled);
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

  app.use("/api/portal", router);
};
