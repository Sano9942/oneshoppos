"use strict";

module.exports = function registerRoomRoutes(app, deps) {
  const { requireFeature, requireMode, getFeatureFlagsMap } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const {
    createRoomTypeSchema,
    updateRoomTypeSchema,
    createRateOverrideSchema,
    updateRateOverrideSchema,
    createRoomSchema,
    updateRoomSchema,
    housekeepingSchema,
    createBookingSchema,
    updateBookingSchema,
    cancelBookingSchema,
    checkInSchema,
    checkOutSchema,
    addFolioLineSchema,
    attachSaleSchema,
    settleFolioSchema,
    depositPreAuthSchema,
    bookingGuestSchema,
    createBookingGroupSchema,
    createChannelFeedSchema,
    updateChannelFeedSchema,
    nightAuditRunSchema,
  } = require("../schemas/rooms");
  const rooms = require("../services/room-service");
  const deposits = require("../services/room-deposits");
  const channelSync = require("../services/room-channel-sync");
  const nightAudit = require("../services/room-night-audit");

  const gate = [requireMode("room_management"), requireFeature("phase4_room_management"), requirePerm("manage_rooms")];

  // ── Room types ──────────────────────────────────────────────────

  app.get("/api/room-types", ...gate, async (req, res) => {
    try {
      const rows = await rooms.listRoomTypes(deps.db, req.query);
      res.json({ room_types: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/room-types/:id", ...gate, async (req, res) => {
    try {
      const rt = await rooms.getRoomType(deps.db, Number(req.params.id));
      if (!rt) return res.status(404).json({ error: "Room type not found" });
      res.json(rt);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/room-types", ...gate, validate(createRoomTypeSchema), async (req, res) => {
    try {
      const rt = await rooms.createRoomType(deps.db, req.body);
      res.status(201).json(rt);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/room-types/:id", ...gate, validate(updateRoomTypeSchema), async (req, res) => {
    try {
      const rt = await rooms.updateRoomType(deps.db, Number(req.params.id), req.body);
      if (!rt) return res.status(404).json({ error: "Room type not found" });
      res.json(rt);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.delete("/api/room-types/:id", ...gate, async (req, res) => {
    try {
      const rt = await rooms.deleteRoomType(deps.db, Number(req.params.id));
      if (!rt) return res.status(404).json({ error: "Room type not found" });
      res.json({ ok: true, room_type: rt });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Rate overrides ─────────────────────────────────────────────

  app.get("/api/room-types/:id/rate-overrides", ...gate, async (req, res) => {
    try {
      const list = await rooms.listRateOverrides(deps.db, Number(req.params.id));
      res.json({ overrides: list });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/room-types/:id/rate-overrides", ...gate, validate(createRateOverrideSchema), async (req, res) => {
    try {
      const row = await rooms.createRateOverride(deps.db, Number(req.params.id), req.body);
      res.status(201).json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/room-types/:id/rate-overrides/:overrideId", ...gate, validate(updateRateOverrideSchema), async (req, res) => {
    try {
      const row = await rooms.updateRateOverride(deps.db, Number(req.params.overrideId), req.body);
      if (!row) return res.status(404).json({ error: "Override not found" });
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.delete("/api/room-types/:id/rate-overrides/:overrideId", ...gate, async (req, res) => {
    try {
      const row = await rooms.deleteRateOverride(deps.db, Number(req.params.overrideId));
      if (!row) return res.status(404).json({ error: "Override not found" });
      res.json({ ok: true, override: row });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Quote — live rate breakdown for a stay window
  app.get("/api/room-types/:id/quote", ...gate, async (req, res) => {
    try {
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ error: "from and to query params required" });
      const result = await rooms.calculateStayTotal(deps.db, {
        roomTypeId: Number(req.params.id),
        checkIn: from,
        checkOut: to,
      });
      res.json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // ── Rooms ───────────────────────────────────────────────────────

  app.get("/api/rooms", ...gate, async (req, res) => {
    try {
      const rows = await rooms.listRooms(deps.db, req.query);
      res.json({ rooms: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/rooms/availability", ...gate, async (req, res) => {
    try {
      const { from, to, room_type_id, room_id } = req.query;
      if (!from || !to) return res.status(400).json({ error: "from and to query params required" });
      const result = await rooms.checkRoomAvailability(deps.db, {
        from, to,
        room_type_id: room_type_id ? Number(room_type_id) : undefined,
        room_id: room_id ? Number(room_id) : undefined,
      });
      res.json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // ── V10 Night audit (registered BEFORE /api/rooms/:id — ordering) ──

  app.post("/api/rooms/night-audit/run", ...gate, validate(nightAuditRunSchema), async (req, res) => {
    try {
      let date = req.body.date;
      if (!date) {
        // Default: the hotel night that just ended (yesterday, tenant TZ).
        const { toLocalDateStr } = require("../utils/tz");
        const todayLocal = toLocalDateStr(new Date().toISOString(), req.company?.timezone || "UTC");
        const d = new Date(`${todayLocal}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        date = d.toISOString().slice(0, 10);
      }
      const snapshot = await nightAudit.runNightAudit(deps.db, date, req.employee?.id || null);
      res.status(201).json(snapshot);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.get("/api/rooms/night-audit/history", ...gate, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 30, 120);
      const { rows } = await deps.db.query(
        "SELECT s.*, s.audit_date::text AS audit_date FROM night_audit_snapshots s ORDER BY s.audit_date DESC LIMIT $1",
        [limit]
      );
      res.json({ snapshots: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/rooms/:id", ...gate, async (req, res) => {
    try {
      const row = await rooms.getRoom(deps.db, Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Room not found" });
      res.json(row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // V10 hostel — dorm map: beds + live occupancy ("7/10 beds").
  app.get("/api/rooms/:id/dorm-map", ...gate, async (req, res) => {
    try {
      const map = await rooms.getDormMap(deps.db, Number(req.params.id));
      if (!map) return res.status(404).json({ error: "Room not found" });
      res.json(map);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/rooms", ...gate, validate(createRoomSchema), async (req, res) => {
    try {
      const row = await rooms.createRoom(deps.db, req.body);
      res.status(201).json(row);
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "Room number already exists for this outlet" });
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/rooms/:id", ...gate, validate(updateRoomSchema), async (req, res) => {
    try {
      const row = await rooms.updateRoom(deps.db, Number(req.params.id), req.body);
      if (!row) return res.status(404).json({ error: "Room not found" });
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/rooms/:id/housekeeping", ...gate, validate(housekeepingSchema), async (req, res) => {
    try {
      const row = await rooms.setHousekeepingStatus(deps.db, Number(req.params.id), req.body.housekeeping_status);
      if (!row) return res.status(404).json({ error: "Room not found" });
      res.json(row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Bookings ────────────────────────────────────────────────────

  app.get("/api/room-bookings", ...gate, async (req, res) => {
    try {
      const filters = { ...req.query };
      if (typeof filters.status === "string" && filters.status.includes(",")) {
        filters.status = filters.status.split(",");
      }
      const rows = await rooms.listBookings(deps.db, filters);
      res.json({ bookings: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/room-bookings/timeline", ...gate, async (req, res) => {
    try {
      const data = await rooms.getTimelineData(deps.db, req.query);
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/room-bookings/:id", ...gate, async (req, res) => {
    try {
      const booking = await rooms.getBooking(deps.db, Number(req.params.id));
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      res.json(booking);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/room-bookings", ...gate, validate(createBookingSchema), async (req, res) => {
    try {
      const booking = await rooms.createBooking(deps.db, req.body, req.employee?.id);
      try {
        await deps.db.query(
          "INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)",
          [req.employee?.id || null, "room_booking_created", JSON.stringify({ id: booking.id, booking_number: booking.booking_number })]
        );
      } catch {}
      res.status(201).json(booking);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/room-bookings/:id", ...gate, validate(updateBookingSchema), async (req, res) => {
    try {
      const booking = await rooms.updateBooking(deps.db, Number(req.params.id), req.body);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      res.json(booking);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/room-bookings/:id/confirm", ...gate, async (req, res) => {
    try {
      const booking = await rooms.confirmBooking(deps.db, Number(req.params.id));
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      res.json(booking);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/room-bookings/:id/checkin", ...gate, validate(checkInSchema), async (req, res) => {
    try {
      // V10: lodging presets enforce the PK guest register at check-in
      // (room_guest_registration flag); skip_registration is the audited
      // front-desk escape hatch.
      let requireRegistration = false;
      try {
        const flags = await getFeatureFlagsMap(req.tenantId);
        requireRegistration = flags.room_guest_registration === true;
      } catch { /* flag lookup best-effort — default unenforced */ }
      const booking = await rooms.checkInBooking(deps.db, Number(req.params.id), req.body, {
        requireRegistration,
      });
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      res.json(booking);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
    }
  });

  app.post("/api/room-bookings/:id/checkout", ...gate, validate(checkOutSchema), async (req, res) => {
    try {
      const booking = await rooms.checkOutBooking(deps.db, Number(req.params.id), req.body);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      res.json(booking);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/room-bookings/:id/cancel", ...gate, validate(cancelBookingSchema), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const booking = await rooms.cancelBooking(deps.db, id, req.body);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      // F04: a cancelled booking must not keep the guest's deposit frozen —
      // release any authorized hold (no-op if none). Non-fatal.
      try { await deposits.captureDepositOnCheckout(deps.db, id, { capture: false }); }
      catch (depErr) { console.warn("[rooms/cancel] deposit release failed:", depErr.message); }
      res.json(booking);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/room-bookings/:id/noshow", ...gate, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const booking = await rooms.markNoShow(deps.db, id);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      // F04: no stay → no damage → release the security-deposit hold. Non-fatal.
      try { await deposits.captureDepositOnCheckout(deps.db, id, { capture: false }); }
      catch (depErr) { console.warn("[rooms/noshow] deposit release failed:", depErr.message); }
      res.json(booking);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // ── Deposit pre-auth (adapter-agnostic) ─────────────────────────

  app.post("/api/room-bookings/:id/deposit/preauth", ...gate, validate(depositPreAuthSchema), async (req, res) => {
    try {
      const result = await deposits.createDepositPreAuth(deps.db, {
        bookingId: Number(req.params.id),
        amount: req.body.amount,
        returnUrl: req.body.return_url,
        cancelUrl: req.body.cancel_url,
      });
      res.json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // ── Folio ───────────────────────────────────────────────────────

  app.get("/api/room-bookings/:id/folio", ...gate, async (req, res) => {
    try {
      const folio = await rooms.getFolio(deps.db, Number(req.params.id));
      if (!folio) return res.status(404).json({ error: "Folio not found" });
      res.json(folio);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/room-bookings/:id/folio/lines", ...gate, validate(addFolioLineSchema), async (req, res) => {
    try {
      const folio = await rooms.getFolio(deps.db, Number(req.params.id));
      if (!folio) return res.status(404).json({ error: "Folio not found" });
      const line = await rooms.addFolioLine(deps.db, folio.id, {
        ...req.body,
        added_by: req.employee?.id,
      });
      res.status(201).json(line);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/room-bookings/:id/folio/settle", ...gate, validate(settleFolioSchema), async (req, res) => {
    try {
      // Idempotent settle/capture ordering (V10 harden): the deposit is
      // captured BEFORE the folio settles so a crash between the two leaves a
      // captured-but-unposted deposit that a re-run resolves — the deposit
      // engine's capture() is a no-op unless status='authorized', and
      // settleFolio itself locks + refuses a second settle. Order: capture →
      // settle → (release path handled inside capture:false).
      const bookingId = Number(req.params.id);
      let depositError = null;
      try {
        await deposits.captureDepositOnCheckout(deps.db, bookingId, {
          capture: !!req.body?.capture_deposit,
        });
      } catch (depositErr) {
        // Non-fatal — a manual/gateway-less tenant settles cash-side anyway.
        depositError = depositErr.message;
        console.warn("[rooms/settle] deposit capture/release failed:", depositErr.message);
      }
      const result = await rooms.settleFolio(deps.db, bookingId, req.employee?.id, req.body || {});
      res.status(201).json({ ...result, deposit_error: depositError });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // ── V10 Guest registration ──────────────────────────────────────

  app.get("/api/room-bookings/:id/guests", ...gate, async (req, res) => {
    try {
      const guests = await rooms.listBookingGuests(deps.db, Number(req.params.id));
      res.json({ guests });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/room-bookings/:id/guests", ...gate, validate(bookingGuestSchema), async (req, res) => {
    try {
      const guest = await rooms.addBookingGuest(deps.db, Number(req.params.id), req.body);
      res.status(201).json(guest);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.delete("/api/room-bookings/:id/guests/:guestId", ...gate, async (req, res) => {
    try {
      const row = await rooms.deleteBookingGuest(deps.db, Number(req.params.id), Number(req.params.guestId));
      if (!row) return res.status(404).json({ error: "Guest not found" });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Guest ID document upload → R2 under a non-guessable prefix. Staff-only
  // PII (this route sits behind manage_rooms; keys never reach the portal).
  const multer = require("multer");
  const crypto = require("crypto");
  const { rasterImageFileFilter, safeExtension } = require("../middleware/upload-validation");
  const guestDocUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: rasterImageFileFilter,
  });
  app.post(
    "/api/room-bookings/:id/guests/documents",
    ...gate,
    guestDocUpload.single("document"),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "document file required" });
        const { uploadToR2 } = require("../utils/r2");
        const ext = safeExtension(req.file.originalname) || ".jpg";
        const key = `booking-guests/${req.tenantSlug || "st"}/${crypto.randomBytes(12).toString("hex")}${ext}`;
        const url = await uploadToR2(req.file.buffer, key, req.file.mimetype);
        res.status(201).json({ key, url });
      } catch (err) { res.status(500).json({ error: err.message }); }
    }
  );

  // Guest registry — the police-reporting report (date range). PII: gated
  // behind manage_rooms, never exposed to portal payloads.
  app.get("/api/reports/guest-registry", ...gate, async (req, res) => {
    try {
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ error: "from and to query params required" });
      const guests = await rooms.getGuestRegistry(deps.db, { from, to });
      res.json({ from, to, guests });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── V10 Group bookings ──────────────────────────────────────────

  app.get("/api/room-booking-groups", ...gate, async (req, res) => {
    try {
      const groups = await rooms.listBookingGroups(deps.db);
      res.json({ groups });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/room-booking-groups/:id", ...gate, async (req, res) => {
    try {
      const group = await rooms.getBookingGroup(deps.db, Number(req.params.id));
      if (!group) return res.status(404).json({ error: "Group not found" });
      res.json(group);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/room-booking-groups", ...gate, validate(createBookingGroupSchema), async (req, res) => {
    try {
      const group = await rooms.createBookingGroup(deps.db, req.body, req.employee?.id);
      res.status(201).json(group);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/room-booking-groups/:id/master-folio", ...gate, async (req, res) => {
    try {
      const group = await rooms.setGroupMasterFolio(
        deps.db,
        Number(req.params.id),
        Number(req.body?.booking_id)
      );
      res.json(group);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // ── V10 Occupancy / ADR / RevPAR report ─────────────────────────

  app.get("/api/reports/occupancy", ...gate, async (req, res) => {
    try {
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ error: "from and to query params required" });
      const report = await nightAudit.getOccupancyReport(deps.db, { from, to });
      res.json(report);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── V10 iCal channel feeds (honest copy: iCal sync, NOT a Booking.com
  //     API integration — that is partner-program gated and out of v1) ──

  const channelGate = [
    requireMode("room_management"),
    requireFeature("phase4_room_management"),
    requireFeature("room_channel_sync"),
    requirePerm("manage_rooms"),
  ];

  app.get("/api/room-channel-feeds", ...channelGate, async (req, res) => {
    try {
      const { rows } = await deps.db.query(
        `SELECT f.*, r.room_number, rt.name AS room_type_name,
                (SELECT COUNT(*) FROM channel_blocks cb WHERE cb.source_feed_id = f.id) AS block_count,
                (f.direction = 'import' AND f.is_active
                  AND (f.last_synced_at IS NULL OR f.last_synced_at < NOW() - INTERVAL '${channelSync.FEED_STALE_MINUTES} minutes')
                ) AS is_stale
           FROM room_channel_feeds f
           LEFT JOIN rooms r ON r.id = f.room_id
           LEFT JOIN room_types rt ON rt.id = f.room_type_id
          ORDER BY f.id ASC`
      );
      // Export URLs are assembled client-side from the secret; return as-is
      // (staff-only surface — the secret IS the credential OTAs will hold).
      res.json({ feeds: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/room-channel-feeds", ...channelGate, validate(createChannelFeedSchema), async (req, res) => {
    try {
      const secret = req.body.direction === "export" ? channelSync.generateFeedSecret() : null;
      const { rows: [feed] } = await deps.db.query(
        `INSERT INTO room_channel_feeds
           (direction, name, channel_name, room_id, room_type_id, url, secret, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,TRUE)) RETURNING *`,
        [
          req.body.direction, req.body.name, req.body.channel_name || null,
          req.body.room_id || null, req.body.room_type_id || null,
          req.body.url || null, secret, req.body.is_active,
        ]
      );
      res.status(201).json(feed);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/room-channel-feeds/:id", ...channelGate, validate(updateChannelFeedSchema), async (req, res) => {
    try {
      const sets = [];
      const params = [];
      let idx = 0;
      for (const key of ["name", "channel_name", "url", "is_active"]) {
        if (req.body[key] !== undefined) {
          idx++;
          sets.push(`${key} = $${idx}`);
          params.push(req.body[key]);
        }
      }
      if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
      idx++;
      params.push(Number(req.params.id));
      const { rows: [feed] } = await deps.db.query(
        `UPDATE room_channel_feeds SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
        params
      );
      if (!feed) return res.status(404).json({ error: "Feed not found" });
      res.json(feed);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.delete("/api/room-channel-feeds/:id", ...channelGate, async (req, res) => {
    try {
      const { rows: [feed] } = await deps.db.query(
        "DELETE FROM room_channel_feeds WHERE id = $1 RETURNING *",
        [Number(req.params.id)]
      );
      if (!feed) return res.status(404).json({ error: "Feed not found" });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Rotate an export feed's secret (invalidate a leaked URL).
  app.post("/api/room-channel-feeds/:id/rotate-secret", ...channelGate, async (req, res) => {
    try {
      const { rows: [feed] } = await deps.db.query(
        "UPDATE room_channel_feeds SET secret = $1, updated_at = NOW() WHERE id = $2 AND direction = 'export' RETURNING *",
        [channelSync.generateFeedSecret(), Number(req.params.id)]
      );
      if (!feed) return res.status(404).json({ error: "Export feed not found" });
      res.json(feed);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // "Sync now" — run one import feed inline (front desk sanity button).
  app.post("/api/room-channel-feeds/:id/sync", ...channelGate, async (req, res) => {
    try {
      const { rows: [feed] } = await deps.db.query(
        "SELECT * FROM room_channel_feeds WHERE id = $1 AND direction = 'import'",
        [Number(req.params.id)]
      );
      if (!feed) return res.status(404).json({ error: "Import feed not found" });
      const { enqueueEmail } = require("../services/email");
      const result = await channelSync.syncImportFeed(deps.db, feed, {
        enqueueEmail,
        staffEmail: req.company?.email || null,
        storeName: req.company?.store_name || null,
        tenantSlug: req.tenantSlug || "single",
        tenant: { slug: req.tenantSlug, name: req.company?.store_name },
      });
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Conflict dead letters — review + resolve/dismiss, never silent.
  app.get("/api/room-channel-dead-letters", ...channelGate, async (req, res) => {
    try {
      const { rows } = await deps.db.query(
        `SELECT dl.*, f.name AS feed_name, f.channel_name, b.booking_number
           FROM channel_sync_dead_letters dl
           LEFT JOIN room_channel_feeds f ON f.id = dl.feed_id
           LEFT JOIN room_bookings b ON b.id = dl.conflicting_booking_id
          WHERE dl.status = COALESCE($1, 'open')
          ORDER BY dl.created_at DESC`,
        [req.query.status || null]
      );
      res.json({ dead_letters: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // (Express 5: no regex-in-param — validate :action in the handler.)
  app.post("/api/room-channel-dead-letters/:id/:action", ...channelGate, async (req, res) => {
    try {
      if (!["resolve", "dismiss"].includes(req.params.action)) {
        return res.status(400).json({ error: "action must be resolve or dismiss" });
      }
      const status = req.params.action === "resolve" ? "resolved" : "dismissed";
      const { rows: [dl] } = await deps.db.query(
        "UPDATE channel_sync_dead_letters SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
        [status, Number(req.params.id)]
      );
      if (!dl) return res.status(404).json({ error: "Dead letter not found" });
      res.json(dl);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
