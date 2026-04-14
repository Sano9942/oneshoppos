"use strict";

module.exports = function registerRoomRoutes(app, deps) {
  const { requireFeature } = require("../middleware/feature-flags");
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
  } = require("../schemas/rooms");
  const rooms = require("../services/room-service");
  const deposits = require("../services/room-deposits");

  const gate = [requireFeature("phase4_room_management"), requirePerm("manage_rooms")];

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

  app.get("/api/rooms/:id", ...gate, async (req, res) => {
    try {
      const row = await rooms.getRoom(deps.db, Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Room not found" });
      res.json(row);
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
      const booking = await rooms.checkInBooking(deps.db, Number(req.params.id), req.body);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      res.json(booking);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
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
      const booking = await rooms.cancelBooking(deps.db, Number(req.params.id), req.body);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      res.json(booking);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/room-bookings/:id/noshow", ...gate, async (req, res) => {
    try {
      const booking = await rooms.markNoShow(deps.db, Number(req.params.id));
      if (!booking) return res.status(404).json({ error: "Booking not found" });
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
      const result = await rooms.settleFolio(
        deps.db,
        Number(req.params.id),
        req.employee?.id,
        req.body || {}
      );
      // After folio settles, capture or release deposit.
      try {
        await deposits.captureDepositOnCheckout(deps.db, Number(req.params.id), {
          capture: !!req.body?.capture_deposit,
        });
      } catch (depositErr) {
        // Non-fatal — log but allow settlement response through.
        console.warn("[rooms/settle] deposit capture/release failed:", depositErr.message);
      }
      res.status(201).json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });
};
