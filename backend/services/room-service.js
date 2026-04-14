"use strict";

/**
 * Room management lifecycle — room types, rooms, bookings, folios,
 * availability, overdue detection, invoice generation.
 *
 * Mirrors patterns from services/rental-service.js (CRUD + status machine +
 * activity + invoice generation) and services/restaurant-checks.js
 * (open-tab/folio model).
 */

const { generateInvoiceNumber } = require("./customer-invoicing");

// ── Booking numbering ─────────────────────────────────────────────

async function generateBookingNumber(db) {
  const { rows: [{ next_id }] } = await db.query(
    "SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM room_bookings"
  );
  return `BK-${String(next_id).padStart(6, "0")}`;
}

// ── Rate resolution (pure + unit-testable) ────────────────────────

function addDaysISO(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromStr, toStr) {
  const a = new Date(`${fromStr}T00:00:00Z`).getTime();
  const b = new Date(`${toStr}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / (24 * 60 * 60 * 1000)));
}

async function resolveRateForDate(db, roomTypeId, date) {
  const { rows: [override] } = await db.query(
    `SELECT rate FROM room_rate_overrides
     WHERE room_type_id = $1 AND from_date <= $2 AND to_date >= $2
     ORDER BY from_date DESC
     LIMIT 1`,
    [roomTypeId, date]
  );
  if (override) return Number(override.rate);

  const { rows: [rt] } = await db.query(
    "SELECT base_rate FROM room_types WHERE id = $1",
    [roomTypeId]
  );
  return rt ? Number(rt.base_rate || 0) : 0;
}

async function calculateStayTotal(db, { roomTypeId, checkIn, checkOut }) {
  const nights = daysBetween(checkIn, checkOut);
  if (nights <= 0) {
    return { nights: 0, rate_breakdown: [], subtotal: 0 };
  }
  const breakdown = [];
  let subtotal = 0;
  for (let i = 0; i < nights; i++) {
    const d = addDaysISO(checkIn, i);
    const rate = await resolveRateForDate(db, roomTypeId, d);
    breakdown.push({ date: d, rate });
    subtotal += rate;
  }
  return { nights, rate_breakdown: breakdown, subtotal };
}

// ── Room types ────────────────────────────────────────────────────

async function listRoomTypes(db, filters = {}) {
  const params = [];
  let idx = 0;
  let where = "1=1";
  if (filters.outlet_id) {
    idx++;
    where += ` AND rt.outlet_id = $${idx}`;
    params.push(Number(filters.outlet_id));
  }
  if (filters.is_active !== undefined) {
    idx++;
    where += ` AND rt.is_active = $${idx}`;
    params.push(filters.is_active === "false" || filters.is_active === false ? false : true);
  }
  const { rows } = await db.query(
    `SELECT rt.*,
       (SELECT COUNT(*) FROM rooms r WHERE r.room_type_id = rt.id AND r.is_active = TRUE) AS room_count
     FROM room_types rt
     WHERE ${where}
     ORDER BY rt.name ASC`,
    params
  );
  return rows;
}

async function getRoomType(db, id) {
  const { rows: [rt] } = await db.query("SELECT * FROM room_types WHERE id = $1", [id]);
  if (!rt) return null;
  const { rows: rooms } = await db.query(
    "SELECT * FROM rooms WHERE room_type_id = $1 ORDER BY room_number ASC",
    [id]
  );
  const { rows: overrides } = await db.query(
    "SELECT * FROM room_rate_overrides WHERE room_type_id = $1 ORDER BY from_date ASC",
    [id]
  );
  return { ...rt, rooms, rate_overrides: overrides };
}

async function createRoomType(db, data) {
  const { rows: [rt] } = await db.query(
    `INSERT INTO room_types
       (outlet_id, name, description, capacity, base_rate, deposit_required, amenities, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, TRUE))
     RETURNING *`,
    [
      data.outlet_id || null,
      data.name,
      data.description || null,
      data.capacity ?? 2,
      data.base_rate,
      data.deposit_required ?? 0,
      JSON.stringify(data.amenities || []),
      data.is_active,
    ]
  );
  return rt;
}

async function updateRoomType(db, id, data) {
  const allowed = ["outlet_id", "name", "description", "capacity", "base_rate", "deposit_required", "is_active"];
  const sets = [];
  const params = [];
  let idx = 0;
  for (const key of allowed) {
    if (data[key] !== undefined) {
      idx++;
      sets.push(`${key} = $${idx}`);
      params.push(data[key]);
    }
  }
  if (data.amenities !== undefined) {
    idx++;
    sets.push(`amenities = $${idx}`);
    params.push(JSON.stringify(data.amenities));
  }
  if (!sets.length) {
    const { rows: [current] } = await db.query("SELECT * FROM room_types WHERE id = $1", [id]);
    return current || null;
  }
  sets.push("updated_at = NOW()");
  idx++;
  params.push(id);
  const { rows: [rt] } = await db.query(
    `UPDATE room_types SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return rt || null;
}

async function deleteRoomType(db, id) {
  // Soft delete — preserves historical booking audit trail.
  const { rows: [rt] } = await db.query(
    "UPDATE room_types SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *",
    [id]
  );
  return rt || null;
}

// ── Rate overrides ────────────────────────────────────────────────

async function listRateOverrides(db, roomTypeId) {
  const { rows } = await db.query(
    "SELECT * FROM room_rate_overrides WHERE room_type_id = $1 ORDER BY from_date ASC",
    [roomTypeId]
  );
  return rows;
}

async function createRateOverride(db, roomTypeId, data) {
  const { rows: [row] } = await db.query(
    `INSERT INTO room_rate_overrides (room_type_id, from_date, to_date, rate, label)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [roomTypeId, data.from_date, data.to_date, data.rate, data.label || null]
  );
  return row;
}

async function updateRateOverride(db, id, data) {
  const allowed = ["from_date", "to_date", "rate", "label"];
  const sets = [];
  const params = [];
  let idx = 0;
  for (const key of allowed) {
    if (data[key] !== undefined) {
      idx++;
      sets.push(`${key} = $${idx}`);
      params.push(data[key]);
    }
  }
  if (!sets.length) {
    const { rows: [cur] } = await db.query("SELECT * FROM room_rate_overrides WHERE id = $1", [id]);
    return cur || null;
  }
  idx++;
  params.push(id);
  const { rows: [row] } = await db.query(
    `UPDATE room_rate_overrides SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return row || null;
}

async function deleteRateOverride(db, id) {
  const { rows: [row] } = await db.query(
    "DELETE FROM room_rate_overrides WHERE id = $1 RETURNING *",
    [id]
  );
  return row || null;
}

// ── Rooms ─────────────────────────────────────────────────────────

async function listRooms(db, filters = {}) {
  const params = [];
  let idx = 0;
  let where = "1=1";
  if (filters.outlet_id) {
    idx++;
    where += ` AND r.outlet_id = $${idx}`;
    params.push(Number(filters.outlet_id));
  }
  if (filters.room_type_id) {
    idx++;
    where += ` AND r.room_type_id = $${idx}`;
    params.push(Number(filters.room_type_id));
  }
  if (filters.is_active !== undefined) {
    idx++;
    where += ` AND r.is_active = $${idx}`;
    params.push(filters.is_active === "false" || filters.is_active === false ? false : true);
  }
  const { rows } = await db.query(
    `SELECT r.*, rt.name AS room_type_name, rt.base_rate AS base_rate
     FROM rooms r
     LEFT JOIN room_types rt ON rt.id = r.room_type_id
     WHERE ${where}
     ORDER BY r.room_number ASC`,
    params
  );
  return rows;
}

async function getRoom(db, id) {
  const { rows: [row] } = await db.query(
    `SELECT r.*, rt.name AS room_type_name, rt.base_rate
     FROM rooms r LEFT JOIN room_types rt ON rt.id = r.room_type_id
     WHERE r.id = $1`,
    [id]
  );
  return row || null;
}

async function createRoom(db, data) {
  const { rows: [row] } = await db.query(
    `INSERT INTO rooms
       (room_type_id, outlet_id, room_number, floor,
        occupancy_status, housekeeping_status, notes, is_active)
     VALUES ($1, $2, $3, $4,
             COALESCE($5, 'vacant'), COALESCE($6, 'clean'), $7, COALESCE($8, TRUE))
     RETURNING *`,
    [
      data.room_type_id,
      data.outlet_id || null,
      data.room_number,
      data.floor || null,
      data.occupancy_status,
      data.housekeeping_status,
      data.notes || null,
      data.is_active,
    ]
  );
  return row;
}

async function updateRoom(db, id, data) {
  const allowed = ["room_type_id", "outlet_id", "room_number", "floor", "occupancy_status", "housekeeping_status", "notes", "is_active"];
  const sets = [];
  const params = [];
  let idx = 0;
  for (const key of allowed) {
    if (data[key] !== undefined) {
      idx++;
      sets.push(`${key} = $${idx}`);
      params.push(data[key]);
    }
  }
  if (!sets.length) {
    const { rows: [cur] } = await db.query("SELECT * FROM rooms WHERE id = $1", [id]);
    return cur || null;
  }
  sets.push("updated_at = NOW()");
  idx++;
  params.push(id);
  const { rows: [row] } = await db.query(
    `UPDATE rooms SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return row || null;
}

async function setHousekeepingStatus(db, id, status) {
  const { rows: [row] } = await db.query(
    "UPDATE rooms SET housekeeping_status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [status, id]
  );
  return row || null;
}

// ── Availability (app-level overlap, date-range intersect) ────────

async function checkRoomAvailability(db, { from, to, room_type_id, room_id, excludeBookingId }) {
  // Build rooms filter (candidate room list)
  const roomParams = [];
  let rIdx = 0;
  let roomWhere = "r.is_active = TRUE";
  if (room_type_id) {
    rIdx++;
    roomWhere += ` AND r.room_type_id = $${rIdx}`;
    roomParams.push(Number(room_type_id));
  }
  if (room_id) {
    rIdx++;
    roomWhere += ` AND r.id = $${rIdx}`;
    roomParams.push(Number(room_id));
  }
  const { rows: rooms } = await db.query(
    `SELECT r.id, r.room_number, r.room_type_id, rt.name AS room_type_name,
            rt.base_rate
     FROM rooms r
     LEFT JOIN room_types rt ON rt.id = r.room_type_id
     WHERE ${roomWhere}
     ORDER BY r.room_number ASC`,
    roomParams
  );

  // Conflict detection — app-level overlap (no tstzrange); mirror pattern from
  // services/booking-availability.js:71-76 using JS-side date comparison
  // against active booking rows.
  const conflictParams = [from, to];
  let cIdx = 2;
  let conflictWhere = `b.status NOT IN ('cancelled','no_show','completed','invoiced')
       AND b.check_in_date < $2 AND b.check_out_date > $1`;
  if (room_type_id) {
    cIdx++;
    conflictWhere += ` AND (b.room_type_id = $${cIdx} OR r.room_type_id = $${cIdx})`;
    conflictParams.push(Number(room_type_id));
  }
  if (room_id) {
    cIdx++;
    conflictWhere += ` AND b.room_id = $${cIdx}`;
    conflictParams.push(Number(room_id));
  }
  if (excludeBookingId) {
    cIdx++;
    conflictWhere += ` AND b.id != $${cIdx}`;
    conflictParams.push(Number(excludeBookingId));
  }
  const { rows: conflicts } = await db.query(
    `SELECT b.id, b.room_id, b.check_in_date, b.check_out_date, b.status, b.booking_number
     FROM room_bookings b
     LEFT JOIN rooms r ON r.id = b.room_id
     WHERE ${conflictWhere}`,
    conflictParams
  );

  const conflictRoomIds = new Set(conflicts.filter((c) => c.room_id).map((c) => c.room_id));
  const available = rooms.filter((r) => !conflictRoomIds.has(r.id));
  return {
    from,
    to,
    rooms_total: rooms.length,
    rooms_available: available.length,
    available,
    conflicts,
  };
}

// ── Bookings ──────────────────────────────────────────────────────

async function listBookings(db, filters = {}) {
  const params = [];
  let idx = 0;
  let where = "1=1";

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      const placeholders = filters.status.map(() => {
        idx++;
        return `$${idx}`;
      });
      where += ` AND b.status IN (${placeholders.join(",")})`;
      params.push(...filters.status);
    } else {
      idx++;
      where += ` AND b.status = $${idx}`;
      params.push(filters.status);
    }
  }
  if (filters.customer_id) {
    idx++;
    where += ` AND b.customer_id = $${idx}`;
    params.push(Number(filters.customer_id));
  }
  if (filters.outlet_id) {
    idx++;
    where += ` AND b.outlet_id = $${idx}`;
    params.push(Number(filters.outlet_id));
  }
  if (filters.from) {
    idx++;
    where += ` AND b.check_out_date >= $${idx}`;
    params.push(filters.from);
  }
  if (filters.to) {
    idx++;
    where += ` AND b.check_in_date <= $${idx}`;
    params.push(filters.to);
  }

  const { rows } = await db.query(
    `SELECT b.*,
       c.name AS customer_name,
       r.room_number,
       rt.name AS room_type_name,
       gf.id AS folio_id, gf.status AS folio_status, gf.grand_total AS folio_grand_total
     FROM room_bookings b
     LEFT JOIN customers c ON c.id = b.customer_id
     LEFT JOIN rooms r ON r.id = b.room_id
     LEFT JOIN room_types rt ON rt.id = b.room_type_id
     LEFT JOIN guest_folios gf ON gf.booking_id = b.id
     WHERE ${where}
     ORDER BY b.check_in_date DESC, b.id DESC`,
    params
  );
  return rows;
}

async function getBooking(db, id) {
  const { rows: [booking] } = await db.query(
    `SELECT b.*,
       c.name AS customer_name, c.email AS customer_email, c.mobile AS customer_mobile,
       r.room_number,
       rt.name AS room_type_name, rt.base_rate AS room_type_base_rate,
       cb.name AS created_by_name
     FROM room_bookings b
     LEFT JOIN customers c ON c.id = b.customer_id
     LEFT JOIN rooms r ON r.id = b.room_id
     LEFT JOIN room_types rt ON rt.id = b.room_type_id
     LEFT JOIN employees cb ON cb.id = b.created_by
     WHERE b.id = $1`,
    [id]
  );
  if (!booking) return null;
  const { rows: [folio] } = await db.query(
    "SELECT * FROM guest_folios WHERE booking_id = $1",
    [id]
  );
  return { ...booking, folio: folio || null };
}

async function createBooking(db, data, employeeId) {
  return await db.transaction(async (client) => {
    // Availability check (inside transaction)
    const avail = await checkRoomAvailability(client, {
      from: data.check_in_date,
      to: data.check_out_date,
      room_type_id: data.room_type_id,
      room_id: data.room_id || undefined,
    });
    if (data.room_id) {
      const conflict = avail.conflicts.find((c) => Number(c.room_id) === Number(data.room_id));
      if (conflict) {
        throw Object.assign(
          new Error(
            `Room is already booked for the selected dates (conflicting booking ${conflict.booking_number})`
          ),
          { statusCode: 409 }
        );
      }
    } else if (!avail.available.length) {
      throw Object.assign(new Error("No rooms of this type available for the selected dates"), {
        statusCode: 409,
      });
    }

    const assignedRoomId = data.room_id || avail.available[0]?.id || null;

    const { nights, rate_breakdown, subtotal } = await calculateStayTotal(client, {
      roomTypeId: data.room_type_id,
      checkIn: data.check_in_date,
      checkOut: data.check_out_date,
    });
    const avgRate = nights ? subtotal / nights : 0;

    const bookingNumber = await generateBookingNumber(client);

    const { rows: [booking] } = await client.query(
      `INSERT INTO room_bookings
         (booking_number, customer_id, outlet_id, created_by,
          room_id, room_type_id, status,
          check_in_date, check_out_date, nights,
          rate_snapshot, deposit_collected, deposit_method, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'reserved',
               $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        bookingNumber,
        data.customer_id || null,
        data.outlet_id || null,
        employeeId,
        assignedRoomId,
        data.room_type_id,
        data.check_in_date,
        data.check_out_date,
        nights,
        avgRate,
        data.deposit_collected || 0,
        data.deposit_method || null,
        data.notes || null,
      ]
    );

    // Mark room as reserved if assigned
    if (assignedRoomId) {
      await client.query(
        "UPDATE rooms SET occupancy_status = 'reserved', updated_at = NOW() WHERE id = $1",
        [assignedRoomId]
      );
    }

    return { ...booking, rate_breakdown };
  });
}

async function updateBooking(db, id, data) {
  const { rows: [cur] } = await db.query("SELECT * FROM room_bookings WHERE id = $1", [id]);
  if (!cur) return null;
  if (["checked_out", "completed", "invoiced", "cancelled", "no_show"].includes(cur.status)) {
    throw Object.assign(new Error(`Cannot edit booking in status '${cur.status}'`), {
      statusCode: 400,
    });
  }
  const allowed = ["customer_id", "room_id", "notes"];
  const sets = [];
  const params = [];
  let idx = 0;
  for (const key of allowed) {
    if (data[key] !== undefined) {
      idx++;
      sets.push(`${key} = $${idx}`);
      params.push(data[key]);
    }
  }
  if (!sets.length) return cur;
  sets.push("updated_at = NOW()");
  idx++;
  params.push(id);
  const { rows: [row] } = await db.query(
    `UPDATE room_bookings SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return row;
}

// ── Status transitions ────────────────────────────────────────────

async function confirmBooking(db, id) {
  const { rows: [cur] } = await db.query("SELECT status FROM room_bookings WHERE id = $1", [id]);
  if (!cur) return null;
  if (cur.status !== "reserved") {
    throw Object.assign(new Error(`Cannot confirm booking in status '${cur.status}'`), {
      statusCode: 400,
    });
  }
  const { rows: [row] } = await db.query(
    "UPDATE room_bookings SET status = 'confirmed', updated_at = NOW() WHERE id = $1 RETURNING *",
    [id]
  );
  return row;
}

async function checkInBooking(db, id, data = {}) {
  return await db.transaction(async (client) => {
    const { rows: [cur] } = await client.query(
      "SELECT * FROM room_bookings WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (!cur) return null;
    if (!["reserved", "confirmed"].includes(cur.status)) {
      throw Object.assign(new Error(`Cannot check in booking in status '${cur.status}'`), {
        statusCode: 400,
      });
    }
    const roomId = data.room_id || cur.room_id;
    if (!roomId) {
      throw Object.assign(new Error("No room assigned to booking"), { statusCode: 400 });
    }

    const { rows: [booking] } = await client.query(
      `UPDATE room_bookings
         SET status = 'checked_in',
             actual_checkin = COALESCE($1, NOW()),
             room_id = $2,
             updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [data.actual_checkin || null, roomId, id]
    );

    await client.query(
      "UPDATE rooms SET occupancy_status = 'occupied', updated_at = NOW() WHERE id = $1",
      [roomId]
    );

    // Open folio if not yet present
    const { rows: [existingFolio] } = await client.query(
      "SELECT id FROM guest_folios WHERE booking_id = $1",
      [id]
    );
    if (!existingFolio) {
      await openFolioInternal(client, booking);
    }

    return booking;
  });
}

async function checkOutBooking(db, id, data = {}) {
  return await db.transaction(async (client) => {
    const { rows: [cur] } = await client.query(
      "SELECT * FROM room_bookings WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (!cur) return null;
    if (cur.status !== "checked_in") {
      throw Object.assign(new Error(`Cannot check out booking in status '${cur.status}'`), {
        statusCode: 400,
      });
    }
    const { rows: [booking] } = await client.query(
      `UPDATE room_bookings
         SET status = 'checked_out',
             actual_checkout = COALESCE($1, NOW()),
             updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [data.actual_checkout || null, id]
    );
    if (cur.room_id) {
      await client.query(
        "UPDATE rooms SET occupancy_status = 'vacant', housekeeping_status = 'dirty', updated_at = NOW() WHERE id = $1",
        [cur.room_id]
      );
    }
    return booking;
  });
}

async function cancelBooking(db, id, data = {}) {
  return await db.transaction(async (client) => {
    const { rows: [cur] } = await client.query(
      "SELECT * FROM room_bookings WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (!cur) return null;
    if (["completed", "invoiced", "cancelled"].includes(cur.status)) {
      throw Object.assign(new Error(`Cannot cancel booking in status '${cur.status}'`), {
        statusCode: 400,
      });
    }
    const { rows: [row] } = await client.query(
      `UPDATE room_bookings
         SET status = 'cancelled',
             cancellation_reason = $1,
             updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [data.cancellation_reason || null, id]
    );
    if (cur.room_id && cur.status !== "checked_in") {
      await client.query(
        "UPDATE rooms SET occupancy_status = 'vacant', updated_at = NOW() WHERE id = $1",
        [cur.room_id]
      );
    }
    return row;
  });
}

async function markNoShow(db, id) {
  const { rows: [cur] } = await db.query("SELECT * FROM room_bookings WHERE id = $1", [id]);
  if (!cur) return null;
  if (!["reserved", "confirmed"].includes(cur.status)) {
    throw Object.assign(new Error(`Cannot mark no-show for booking in status '${cur.status}'`), {
      statusCode: 400,
    });
  }
  const { rows: [row] } = await db.query(
    "UPDATE room_bookings SET status = 'no_show', updated_at = NOW() WHERE id = $1 RETURNING *",
    [id]
  );
  if (cur.room_id) {
    await db.query(
      "UPDATE rooms SET occupancy_status = 'vacant', updated_at = NOW() WHERE id = $1",
      [cur.room_id]
    );
  }
  return row;
}

// ── Folios ────────────────────────────────────────────────────────

function normalizeDate(d) {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

async function openFolioInternal(client, booking) {
  const { nights, rate_breakdown, subtotal } = await calculateStayTotal(client, {
    roomTypeId: booking.room_type_id,
    checkIn: normalizeDate(booking.check_in_date),
    checkOut: normalizeDate(booking.check_out_date),
  });
  const { rows: [folio] } = await client.query(
    `INSERT INTO guest_folios (booking_id, status, room_charge_total, grand_total)
     VALUES ($1, 'open', $2, $2) RETURNING *`,
    [booking.id, subtotal]
  );
  for (const line of rate_breakdown) {
    await client.query(
      `INSERT INTO folio_lines (folio_id, line_type, description, quantity, unit_price, line_total)
       VALUES ($1, 'room_night', $2, 1, $3, $3)`,
      [folio.id, `Room night — ${line.date}`, line.rate]
    );
  }
  return folio;
}

async function openFolio(db, bookingId) {
  return await db.transaction(async (client) => {
    const { rows: [booking] } = await client.query(
      "SELECT * FROM room_bookings WHERE id = $1",
      [bookingId]
    );
    if (!booking) throw Object.assign(new Error("Booking not found"), { statusCode: 404 });
    const { rows: [existing] } = await client.query(
      "SELECT * FROM guest_folios WHERE booking_id = $1",
      [bookingId]
    );
    if (existing) return existing;
    return openFolioInternal(client, booking);
  });
}

async function getFolio(db, bookingId) {
  const { rows: [folio] } = await db.query(
    "SELECT * FROM guest_folios WHERE booking_id = $1",
    [bookingId]
  );
  if (!folio) return null;
  const { rows: lines } = await db.query(
    "SELECT * FROM folio_lines WHERE folio_id = $1 ORDER BY id ASC",
    [folio.id]
  );
  return { ...folio, lines };
}

async function recomputeFolioTotals(client, folioId) {
  const { rows } = await client.query(
    `SELECT
       COALESCE(SUM(CASE WHEN line_type = 'room_night' THEN line_total ELSE 0 END), 0) AS room_charge_total,
       COALESCE(SUM(CASE WHEN line_type = 'pos_sale' THEN line_total ELSE 0 END), 0) AS pos_charge_total,
       COALESCE(SUM(CASE WHEN line_type = 'tax' THEN line_total ELSE 0 END), 0) AS tax_total,
       COALESCE(SUM(line_total), 0) AS grand_total
     FROM folio_lines WHERE folio_id = $1`,
    [folioId]
  );
  const t = rows[0];
  await client.query(
    `UPDATE guest_folios
       SET room_charge_total = $1, pos_charge_total = $2, tax_total = $3,
           grand_total = $4, updated_at = NOW()
     WHERE id = $5`,
    [t.room_charge_total, t.pos_charge_total, t.tax_total, t.grand_total, folioId]
  );
}

async function addFolioLine(db, folioId, { line_type, description, quantity, unit_price, sale_id, added_by }) {
  return await db.transaction(async (client) => {
    const { rows: [folio] } = await client.query(
      "SELECT * FROM guest_folios WHERE id = $1 FOR UPDATE",
      [folioId]
    );
    if (!folio) throw Object.assign(new Error("Folio not found"), { statusCode: 404 });
    if (folio.status !== "open") {
      throw Object.assign(new Error("Cannot add lines to a closed folio"), { statusCode: 400 });
    }
    const qty = Number(quantity ?? 1);
    const price = Number(unit_price ?? 0);
    const lineTotal = qty * price;
    const { rows: [line] } = await client.query(
      `INSERT INTO folio_lines
         (folio_id, line_type, description, quantity, unit_price, line_total, sale_id, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [folioId, line_type, description, qty, price, lineTotal, sale_id || null, added_by || null]
    );
    await recomputeFolioTotals(client, folioId);
    return line;
  });
}

/**
 * Attach a POS sale to a folio. Called inside the sale-create transaction
 * so a sale+folio link is atomic — if the folio write fails, the sale rolls
 * back too.
 *
 * @param {Object} client - pg client (must be inside a transaction)
 * @param {Object} opts
 * @param {number} opts.saleId
 * @param {number} opts.folioId
 * @param {number} opts.amount - sale total
 * @param {string} [opts.description]
 * @param {number} [opts.employeeId]
 */
async function attachSaleToFolio(client, { saleId, folioId, amount, description, employeeId }) {
  const { rows: [folio] } = await client.query(
    "SELECT * FROM guest_folios WHERE id = $1 FOR UPDATE",
    [folioId]
  );
  if (!folio) throw Object.assign(new Error("Folio not found"), { statusCode: 404 });
  if (folio.status !== "open") {
    throw Object.assign(new Error("Cannot charge to a closed folio"), { statusCode: 400 });
  }
  const amt = Number(amount || 0);
  await client.query(
    `INSERT INTO folio_lines (folio_id, line_type, description, quantity, unit_price, line_total, sale_id, added_by)
     VALUES ($1, 'pos_sale', $2, 1, $3, $3, $4, $5)`,
    [folioId, description || `POS sale #${saleId}`, amt, saleId, employeeId || null]
  );
  await recomputeFolioTotals(client, folioId);
}

async function settleFolio(db, bookingId, employeeId, opts = {}) {
  return await db.transaction(async (client) => {
    const { rows: [booking] } = await client.query(
      "SELECT * FROM room_bookings WHERE id = $1 FOR UPDATE",
      [bookingId]
    );
    if (!booking) throw Object.assign(new Error("Booking not found"), { statusCode: 404 });
    if (!["checked_out", "checked_in"].includes(booking.status)) {
      throw Object.assign(
        new Error("Can only settle folio for bookings that are checked-in or checked-out"),
        { statusCode: 400 }
      );
    }

    const { rows: [folio] } = await client.query(
      "SELECT * FROM guest_folios WHERE booking_id = $1 FOR UPDATE",
      [bookingId]
    );
    if (!folio) throw Object.assign(new Error("Folio not found"), { statusCode: 404 });
    if (folio.status !== "open") {
      throw Object.assign(new Error(`Folio already ${folio.status}`), { statusCode: 400 });
    }

    await recomputeFolioTotals(client, folio.id);

    const { rows: [freshFolio] } = await client.query(
      "SELECT * FROM guest_folios WHERE id = $1",
      [folio.id]
    );

    const grandTotal = Number(freshFolio.grand_total || 0);
    const depositCollected = Number(booking.deposit_collected || 0);
    const depositApplied = Math.min(depositCollected, grandTotal);
    const balanceDue = Math.max(0, grandTotal - depositApplied);

    const invoiceNumber = await generateInvoiceNumber(client);

    const { rows: [invoice] } = await client.query(
      `INSERT INTO customer_invoices
         (invoice_number, customer_id, outlet_id, employee_id, status,
          subtotal, tax_total, discount_amount, total_amount, balance_due, notes)
       VALUES ($1, $2, $3, $4, 'sent', $5, $6, 0, $7, $8, $9) RETURNING *`,
      [
        invoiceNumber,
        booking.customer_id,
        booking.outlet_id,
        employeeId,
        Number(freshFolio.room_charge_total || 0) + Number(freshFolio.pos_charge_total || 0),
        Number(freshFolio.tax_total || 0),
        grandTotal,
        balanceDue,
        `Folio for room booking ${booking.booking_number}${opts.notes ? " — " + opts.notes : ""}`,
      ]
    );

    // Copy folio lines to invoice line items
    const { rows: lines } = await client.query(
      "SELECT * FROM folio_lines WHERE folio_id = $1 ORDER BY id ASC",
      [folio.id]
    );
    for (const line of lines) {
      await client.query(
        `INSERT INTO customer_invoice_items (invoice_id, description, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [invoice.id, line.description, line.quantity, line.unit_price, line.line_total]
      );
    }
    if (depositApplied > 0) {
      await client.query(
        `INSERT INTO customer_invoice_items (invoice_id, description, quantity, unit_price, line_total)
         VALUES ($1, 'Deposit applied', 1, $2, $2)`,
        [invoice.id, -depositApplied]
      );
    }

    await client.query(
      `UPDATE guest_folios
         SET status = 'settled', deposit_applied = $1, settled_at = NOW(),
             invoice_id = $2, updated_at = NOW()
       WHERE id = $3`,
      [depositApplied, invoice.id, folio.id]
    );

    await client.query(
      `UPDATE room_bookings
         SET status = 'invoiced', invoice_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [invoice.id, bookingId]
    );

    return { invoice, folio_id: folio.id, deposit_applied: depositApplied, balance_due: balanceDue };
  });
}

// ── Overdue checkout (worker + dashboard) ─────────────────────────

async function getOverdueCheckouts(db) {
  const { rows } = await db.query(
    `SELECT b.*, c.name AS customer_name, c.email AS customer_email,
       r.room_number
     FROM room_bookings b
     LEFT JOIN customers c ON c.id = b.customer_id
     LEFT JOIN rooms r ON r.id = b.room_id
     WHERE b.status = 'checked_in'
       AND b.check_out_date < CURRENT_DATE
       AND (b.overdue_email_sent_at IS NULL OR b.overdue_email_sent_at < NOW() - INTERVAL '24 hours')`
  );
  return rows;
}

async function markOverdueEmailSent(db, bookingId) {
  await db.query(
    "UPDATE room_bookings SET overdue_email_sent_at = NOW() WHERE id = $1",
    [bookingId]
  );
}

// ── Timeline (Gantt chart data) ────────────────────────────────────

async function getTimelineData(db, filters = {}) {
  const params = [];
  let idx = 0;
  let where = "b.status NOT IN ('cancelled','no_show')";
  if (filters.outlet_id) {
    idx++;
    where += ` AND b.outlet_id = $${idx}`;
    params.push(Number(filters.outlet_id));
  }
  if (filters.from) {
    idx++;
    where += ` AND b.check_out_date >= $${idx}`;
    params.push(filters.from);
  }
  if (filters.to) {
    idx++;
    where += ` AND b.check_in_date <= $${idx}`;
    params.push(filters.to);
  }

  const { rows: rooms } = await db.query(
    `SELECT r.id, r.room_number, r.floor, rt.name AS room_type_name
     FROM rooms r LEFT JOIN room_types rt ON rt.id = r.room_type_id
     WHERE r.is_active = TRUE
     ORDER BY r.room_number ASC`
  );
  const { rows: bookings } = await db.query(
    `SELECT b.id, b.booking_number, b.status, b.check_in_date, b.check_out_date,
            b.room_id, c.name AS customer_name
     FROM room_bookings b LEFT JOIN customers c ON c.id = b.customer_id
     WHERE ${where}
     ORDER BY b.check_in_date ASC`,
    params
  );
  return { rooms, bookings };
}

module.exports = {
  generateBookingNumber,
  // rate
  resolveRateForDate,
  calculateStayTotal,
  daysBetween,
  addDaysISO,
  // room types
  listRoomTypes,
  getRoomType,
  createRoomType,
  updateRoomType,
  deleteRoomType,
  // rate overrides
  listRateOverrides,
  createRateOverride,
  updateRateOverride,
  deleteRateOverride,
  // rooms
  listRooms,
  getRoom,
  createRoom,
  updateRoom,
  setHousekeepingStatus,
  // availability
  checkRoomAvailability,
  // bookings
  listBookings,
  getBooking,
  createBooking,
  updateBooking,
  confirmBooking,
  checkInBooking,
  checkOutBooking,
  cancelBooking,
  markNoShow,
  // folios
  openFolio,
  getFolio,
  addFolioLine,
  attachSaleToFolio,
  settleFolio,
  // overdue
  getOverdueCheckouts,
  markOverdueEmailSent,
  // timeline
  getTimelineData,
};
