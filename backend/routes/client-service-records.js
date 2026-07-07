'use strict';

/**
 * routes/client-service-records.js — V04 salon depth.
 *
 * Client service history / colorist formula notes. Reads back the timeline for
 * a customer + the booking-view "last visit" panel; lets a stylist enrich a
 * record (notes/formula/photos/performed-by) or add one manually for a walk-in.
 *
 * Gated by the appointments mode + phase4_appointments feature (salon and the
 * other appointment-driven presets). Perms are deliberately light — stylists
 * are Cashier-role staff (view_reports), and the plan makes formulas visible
 * to all staff by design. Registered in registerAllRoutes.js.
 */

const multer = require("multer");
const crypto = require("crypto");
const { uploadToR2 } = require("../utils/r2");
const { rasterImageFileFilter, safeExtension, verifyImageMagicBytes } = require("../middleware/upload-validation");
const svc = require("../services/client-service-records");

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: rasterImageFileFilter,
});

module.exports = (app, deps) => {
  const { db } = deps;
  // Source gating middleware from the modules directly (deps doesn't carry
  // requireMode) — same pattern as bookings.js / recalls.js.
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requireAnyPerm } = require("../middleware/permissions");
  const gate = [requireMode("appointments"), requireFeature("phase4_appointments"), requireAnyPerm(["view_reports", "manage_bookings"])];

  // Full timeline for a customer's Service History tab.
  app.get("/api/customers/:customerId/service-records", ...gate, async (req, res) => {
    try {
      const rows = await svc.getHistoryForCustomer(db, Number(req.params.customerId));
      res.json({ records: rows });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Most recent record — the booking-view / appointment-drawer last-visit panel.
  app.get("/api/customers/:customerId/service-records/last-visit", ...gate, async (req, res) => {
    try {
      const record = await svc.getLastVisit(db, Number(req.params.customerId));
      res.json({ record });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.get("/api/service-records/:id", ...gate, async (req, res) => {
    try {
      const record = await svc.getRecord(db, Number(req.params.id));
      if (!record) return res.status(404).json({ error: "Service record not found" });
      res.json({ record });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Manual add — walk-in (no appointment) or backfilling a past visit.
  app.post("/api/service-records", ...gate, async (req, res) => {
    try {
      const { customer_id, booking_service_id, employee_id, service_name, notes, formula, photos } = req.body || {};
      if (!customer_id) return res.status(400).json({ error: "customer_id is required" });
      const record = await svc.createManualRecord(db, {
        customerId: Number(customer_id),
        bookingServiceId: booking_service_id ? Number(booking_service_id) : null,
        employeeId: employee_id ? Number(employee_id) : null,
        serviceName: service_name || null,
        notes: notes || null,
        formula: Array.isArray(formula) ? formula : [],
        photos: Array.isArray(photos) ? photos : [],
      });
      res.status(201).json({ record });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Stylist enriches a record: notes / formula / photos / performed-by.
  app.put("/api/service-records/:id", ...gate, async (req, res) => {
    try {
      const { notes, formula, photos, employee_id } = req.body || {};
      if (formula !== undefined && !Array.isArray(formula)) {
        return res.status(400).json({ error: "formula must be an array of {label,value}" });
      }
      if (photos !== undefined && !Array.isArray(photos)) {
        return res.status(400).json({ error: "photos must be an array of URLs" });
      }
      const record = await svc.updateRecord(db, Number(req.params.id), {
        notes,
        formula,
        photos,
        employeeId: employee_id !== undefined ? (employee_id ? Number(employee_id) : null) : undefined,
      });
      if (!record) return res.status(404).json({ error: "Service record not found" });
      res.json({ record });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Before/after photo capture → R2, appended to the record's photos array.
  app.post("/api/service-records/:id/photo", ...gate, photoUpload.single("photo"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await svc.getRecord(db, id);
      if (!existing) return res.status(404).json({ error: "Service record not found" });

      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      // Sniff the bytes against the declared MIME — same guard as support uploads.
      if (!verifyImageMagicBytes(file.buffer, file.mimetype)) {
        return res.status(400).json({ error: "File contents do not match an image format" });
      }
      const ext = safeExtension(file.originalname, file.mimetype);
      const opaqueId = crypto.randomBytes(12).toString("hex");
      const key = `service-records/${id}/${opaqueId}${ext}`;
      const url = await uploadToR2(file.buffer, key, file.mimetype);

      const photos = Array.isArray(existing.photos) ? existing.photos : [];
      photos.push({ url, label: req.body?.label || null, uploaded_at: new Date().toISOString() });
      const record = await svc.updateRecord(db, id, { photos });
      res.status(201).json({ record, url });
    } catch (err) {
      req.log?.error?.({ err }, "[v04] service-record photo upload failed");
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
