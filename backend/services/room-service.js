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
const { resolveTaxForExplicitRate } = require("./tax-snapshot");

// Unpaid online reservations expire and release inventory (denial-of-inventory
// guard). Gateway on → guest is expected to pay the deposit immediately;
// gateway off/manual → front desk gets a working day to confirm.
const ONLINE_RESERVATION_TTL_MINUTES = { gateway: 60, manual: 24 * 60 };

// A 'reserved' booking no longer blocks inventory once its TTL lapses without
// a deposit — shared predicate between the availability read and the cancel
// sweep so the two can never disagree.
const STALE_RESERVATION_PREDICATE = `(
  b.status = 'reserved'
  AND b.expires_at IS NOT NULL AND b.expires_at < NOW()
  AND b.deposit_status NOT IN ('authorized','captured')
)`;

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
  // V10 hostel: a bed is a child room. It inherits the dorm's type/outlet so
  // every existing lifecycle/folio/rate path works unmodified. One level only
  // (a bed can't itself be a dorm).
  let roomTypeId = data.room_type_id;
  let outletId = data.outlet_id || null;
  if (data.parent_room_id) {
    const { rows: [parent] } = await db.query(
      "SELECT id, room_type_id, outlet_id, parent_room_id FROM rooms WHERE id = $1",
      [Number(data.parent_room_id)]
    );
    if (!parent) throw Object.assign(new Error("Parent room not found"), { statusCode: 404 });
    if (parent.parent_room_id) {
      throw Object.assign(new Error("A bed cannot be nested under another bed"), { statusCode: 400 });
    }
    roomTypeId = roomTypeId || parent.room_type_id;
    outletId = outletId || parent.outlet_id;
  }
  const { rows: [row] } = await db.query(
    `INSERT INTO rooms
       (room_type_id, outlet_id, room_number, floor,
        occupancy_status, housekeeping_status, notes, is_active, parent_room_id)
     VALUES ($1, $2, $3, $4,
             COALESCE($5, 'vacant'), COALESCE($6, 'clean'), $7, COALESCE($8, TRUE), $9)
     RETURNING *`,
    [
      roomTypeId,
      outletId,
      data.room_number,
      data.floor || null,
      data.occupancy_status,
      data.housekeeping_status,
      data.notes || null,
      data.is_active,
      data.parent_room_id || null,
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
  if (row) {
    // Housekeeping stays dorm-level — children inherit (V10 hostel).
    try {
      await db.query(
        "UPDATE rooms SET housekeeping_status = $1, updated_at = NOW() WHERE parent_room_id = $2",
        [status, id]
      );
    } catch { /* pre-v119 tenant */ }
  }
  return row || null;
}

// ── Availability (app-level overlap, date-range intersect) ────────

async function checkRoomAvailability(db, { from, to, room_type_id, room_id, excludeBookingId }) {
  // Build rooms filter (candidate room list). A dorm parent (a room that has
  // active child beds) is never directly bookable — its beds are (V10 hostel).
  const roomParams = [];
  let rIdx = 0;
  let roomWhere = `r.is_active = TRUE
    AND NOT EXISTS (SELECT 1 FROM rooms c WHERE c.parent_room_id = r.id AND c.is_active = TRUE)`;
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
  // Overlap math is checkout-day-exclusive by design (check_in < to AND
  // check_out > from) — a guest leaving on the day another arrives is NOT a
  // conflict (back-to-back stays). Expired unpaid online reservations stop
  // blocking inventory immediately (the cancel sweep formalizes them later).
  let conflictWhere = `b.status NOT IN ('cancelled','no_show','completed','invoiced')
       AND NOT ${STALE_RESERVATION_PREDICATE}
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

  // OTA channel blocks (V10 iCal import) count as occupancy. try/catch: the
  // table only exists from v119 — availability must not break mid-rollout.
  let channelBlocks = [];
  try {
    const blockParams = [from, to];
    let bIdx = 2;
    let blockWhere = "cb.start_date < $2 AND cb.end_date > $1";
    if (room_id) {
      bIdx++;
      blockWhere += ` AND cb.room_id = $${bIdx}`;
      blockParams.push(Number(room_id));
    }
    const { rows } = await db.query(
      `SELECT cb.id, cb.room_id, cb.start_date, cb.end_date, cb.summary, cb.source_feed_id
       FROM channel_blocks cb
       WHERE ${blockWhere}`,
      blockParams
    );
    channelBlocks = rows;
    for (const blk of channelBlocks) {
      if (blk.room_id) conflictRoomIds.add(blk.room_id);
    }
  } catch { /* pre-v119 tenant — no channel sync yet */ }

  const available = rooms.filter((r) => !conflictRoomIds.has(r.id));
  return {
    from,
    to,
    rooms_total: rooms.length,
    rooms_available: available.length,
    available,
    conflicts,
    channel_blocks: channelBlocks,
  };
}

/**
 * Cancel 'reserved' bookings whose hold TTL lapsed without a deposit (the
 * public engine's denial-of-inventory guard). Availability already ignores
 * them via STALE_RESERVATION_PREDICATE — this sweep formalizes the cancel and
 * frees the room row. Non-throwing per booking.
 */
async function expireStaleRoomReservations(db) {
  const { rows } = await db.query(
    `UPDATE room_bookings b
        SET status = 'cancelled',
            cancellation_reason = 'Reservation expired unpaid (auto)',
            updated_at = NOW()
      WHERE ${STALE_RESERVATION_PREDICATE}
      RETURNING b.id, b.room_id, b.booking_number`
  );
  for (const b of rows) {
    if (!b.room_id) continue;
    try {
      // Free the room only if no other live booking holds it.
      await db.query(
        `UPDATE rooms r SET occupancy_status = 'vacant', updated_at = NOW()
          WHERE r.id = $1
            AND NOT EXISTS (
              SELECT 1 FROM room_bookings ob
              WHERE ob.room_id = r.id
                AND ob.status IN ('reserved','confirmed','checked_in')
            )`,
        [b.room_id]
      );
    } catch { /* room release is best-effort */ }
  }
  return rows;
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

/**
 * THE single booking choke point (V10 task 1). Every booking writer — front
 * desk, public engine, group flow, any future channel — goes through here;
 * never a route-local availability check.
 *
 * Race fix: pg_advisory_xact_lock on the room TYPE (covers both type-level
 * and specific-room bookings; beds are child rooms sharing the dorm's type,
 * so the hostel last-bed race serializes here too). xact-scoped advisory
 * locks are safe under the Supabase transaction pooler (session-scoped ones
 * are not). Key includes current_schema() — advisory locks are cluster-wide,
 * so two tenants' type #3 must not contend.
 *
 * @param {object} [opts] { source: 'staff'|'online', expiresAt: ISO|null }
 */
async function createBooking(db, data, employeeId, opts = {}) {
  const source = opts.source || "staff";
  return await db.transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':room_type:' || $1::text))",
      [Number(data.room_type_id)]
    );

    // A dorm parent is never directly bookable — book one of its beds.
    if (data.room_id) {
      const { rows: [child] } = await client.query(
        "SELECT 1 FROM rooms WHERE parent_room_id = $1 AND is_active = TRUE LIMIT 1",
        [Number(data.room_id)]
      );
      if (child) {
        throw Object.assign(
          new Error("This room is a dorm — book one of its beds instead"),
          { statusCode: 400 }
        );
      }
    }

    // Availability check (inside transaction, behind the lock)
    const avail = await checkRoomAvailability(client, {
      from: data.check_in_date,
      to: data.check_out_date,
      room_type_id: data.room_type_id,
      room_id: data.room_id || undefined,
    });
    if (data.room_id) {
      // The room must survive the FULL availability verdict — local booking
      // conflicts AND OTA channel blocks (V10) both disqualify it.
      const stillAvailable = avail.available.some((r) => Number(r.id) === Number(data.room_id));
      if (!stillAvailable) {
        const conflict = avail.conflicts.find((c) => Number(c.room_id) === Number(data.room_id));
        throw Object.assign(
          new Error(
            conflict
              ? `Room is already booked for the selected dates (conflicting booking ${conflict.booking_number})`
              : "Room is blocked for the selected dates (external channel calendar)"
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
          rate_snapshot, deposit_collected, deposit_method, notes,
          source, expires_at, group_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'reserved',
               $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
        source,
        opts.expiresAt || null,
        opts.groupId || null,
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
  // Staff confirmation ends the unpaid-hold TTL — the stay is now committed.
  const { rows: [row] } = await db.query(
    "UPDATE room_bookings SET status = 'confirmed', expires_at = NULL, updated_at = NOW() WHERE id = $1 RETURNING *",
    [id]
  );
  return row;
}

async function checkInBooking(db, id, data = {}, opts = {}) {
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

    // V10 guest registration: capture guests presented at the desk, then —
    // when the tenant enforces registration (room_guest_registration flag,
    // ON for lodging presets; PK hotels must keep a police-reportable guest
    // register) — require a primary guest with an ID document number unless
    // staff explicitly skip (audit-noted).
    if (Array.isArray(data.guests)) {
      for (const g of data.guests) {
        if (!g || !g.name) continue;
        await addBookingGuest(client, id, g);
      }
    }
    if (opts.requireRegistration && !data.skip_registration) {
      const { rows: [primary] } = await client.query(
        `SELECT 1 FROM booking_guests
          WHERE booking_id = $1 AND is_primary = TRUE AND COALESCE(cnic_passport, '') != ''
          LIMIT 1`,
        [id]
      );
      if (!primary) {
        throw Object.assign(
          new Error("Guest registration required: capture the primary guest's CNIC/passport before check-in (or pass skip_registration)"),
          { statusCode: 400, code: "REGISTRATION_REQUIRED" }
        );
      }
    }

    const { rows: [booking] } = await client.query(
      `UPDATE room_bookings
         SET status = 'checked_in',
             actual_checkin = COALESCE($1, NOW()),
             room_id = $2,
             expires_at = NULL,
             updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [data.actual_checkin || null, roomId, id]
    );
    if (data.skip_registration) {
      try {
        await client.query(
          "UPDATE room_bookings SET notes = COALESCE(notes, '') || $1 WHERE id = $2",
          ["\n[Guest registration skipped at check-in]", id]
        );
      } catch { /* audit note is best-effort */ }
    }

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
  if (d instanceof Date) {
    // pg parses DATE columns to a JS Date at LOCAL midnight — toISOString()
    // would shift it a day back on UTC+ servers (TZ=Asia/Karachi in prod).
    // Use local components.
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return String(d).slice(0, 10);
}

/**
 * Resolve the tax treatment for a room-type charge (V10 folio-tax slice of
 * the approved proposal — same resolveTaxForExplicitRate entry point as V09
 * rentals). room_types.tax_inclusive=TRUE forces inclusive treatment for that
 * type's rates even when the tenant's tax_mode is 'exclusive' (this makes the
 * previously-dead v49 column real).
 */
async function resolveRoomTypeTax(client, roomTypeId, price, quantity = 1) {
  const { rows: [cp] } = await client.query("SELECT tax_mode FROM company_profile WHERE id = 1");
  const taxMode = cp?.tax_mode || "none";
  const { rows: [rt] } = await client.query(
    "SELECT tax_id, tax_inclusive FROM room_types WHERE id = $1",
    [roomTypeId]
  );
  const inclusive = rt?.tax_inclusive === true ? true : taxMode === "inclusive";
  const tax = await resolveTaxForExplicitRate(client, {
    taxId: rt?.tax_id ?? null,
    price,
    quantity,
    taxMode,
    taxInclusive: inclusive,
  });
  return { ...tax, inclusive: taxMode === "none" ? true : inclusive };
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
    const tax = await resolveRoomTypeTax(client, booking.room_type_id, line.rate, 1);
    await client.query(
      `INSERT INTO folio_lines
         (folio_id, line_type, description, quantity, unit_price, line_total,
          tax_rate_at_charge, tax_amount_at_charge, tax_inclusive_at_charge)
       VALUES ($1, 'room_night', $2, 1, $3, $3, $4, $5, $6)`,
      [folio.id, `Room night — ${line.date}`, line.rate, tax.rate, tax.amount, tax.inclusive]
    );
  }
  await recomputeFolioTotals(client, folio.id);
  const { rows: [fresh] } = await client.query("SELECT * FROM guest_folios WHERE id = $1", [folio.id]);
  return fresh || folio;
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
  // V10 folio-tax: tax_total = Σ per-line snapshots (+ legacy 'tax'-type
  // lines). Lines stamped exclusive add their tax ON TOP of line_total in the
  // grand total; inclusive lines (and pos_sale lines, whose line_total is the
  // sale's tax-included grand total) already carry their tax inside.
  const { rows } = await client.query(
    `SELECT
       COALESCE(SUM(CASE WHEN line_type = 'room_night' THEN line_total ELSE 0 END), 0) AS room_charge_total,
       COALESCE(SUM(CASE WHEN line_type = 'pos_sale' THEN line_total ELSE 0 END), 0) AS pos_charge_total,
       COALESCE(SUM(CASE WHEN line_type = 'tax' THEN line_total ELSE 0 END), 0)
         + COALESCE(SUM(tax_amount_at_charge), 0) AS tax_total,
       COALESCE(SUM(line_total), 0)
         + COALESCE(SUM(CASE WHEN tax_inclusive_at_charge = FALSE THEN tax_amount_at_charge ELSE 0 END), 0)
         AS grand_total
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

async function addFolioLine(db, folioId, { line_type, description, quantity, unit_price, sale_id, added_by, tax_id }) {
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

    // Manual charges may carry an explicit tax_id (minibar, laundry…);
    // discounts and untaxed charges stamp 0. Same entry point as room nights.
    let tax = { rate: 0, amount: 0, inclusive: true };
    if (tax_id != null && line_type === "manual_charge") {
      const { rows: [cp] } = await client.query("SELECT tax_mode FROM company_profile WHERE id = 1");
      const taxMode = cp?.tax_mode || "none";
      const t = await resolveTaxForExplicitRate(client, {
        taxId: tax_id, price, quantity: qty, taxMode,
      });
      tax = { ...t, inclusive: taxMode === "none" ? true : taxMode === "inclusive" };
    }

    const { rows: [line] } = await client.query(
      `INSERT INTO folio_lines
         (folio_id, line_type, description, quantity, unit_price, line_total, sale_id, added_by,
          tax_rate_at_charge, tax_amount_at_charge, tax_inclusive_at_charge)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [folioId, line_type, description, qty, price, lineTotal, sale_id || null, added_by || null,
       tax.rate, tax.amount, tax.inclusive]
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
  // Group bookings (V10): when the folio's booking belongs to a group with a
  // master folio, the charge routes to the master — one bill for the block.
  // Single redirect hop (a master folio never points at another master).
  let targetFolioId = folioId;
  try {
    const { rows: [redirect] } = await client.query(
      `SELECT mf.id AS master_folio_id
         FROM guest_folios f
         JOIN room_bookings b   ON b.id = f.booking_id
         JOIN booking_groups g  ON g.id = b.group_id
         JOIN guest_folios mf   ON mf.booking_id = g.master_folio_booking_id
        WHERE f.id = $1
          AND g.master_folio_booking_id IS NOT NULL
          AND g.master_folio_booking_id != f.booking_id
          AND mf.status = 'open'`,
      [folioId]
    );
    if (redirect) targetFolioId = redirect.master_folio_id;
  } catch { /* pre-v119 tenant — no groups yet */ }

  const { rows: [folio] } = await client.query(
    "SELECT * FROM guest_folios WHERE id = $1 FOR UPDATE",
    [targetFolioId]
  );
  if (!folio) throw Object.assign(new Error("Folio not found"), { statusCode: 404 });
  if (folio.status !== "open") {
    throw Object.assign(new Error("Cannot charge to a closed folio"), { statusCode: 400 });
  }
  const amt = Number(amount || 0);

  // The sale's own v83 tax snapshot rides along informationally — its
  // line_total is the sale's tax-INCLUDED grand total in every mode, so the
  // line is always stamped inclusive (never re-added on top).
  let saleTax = 0;
  try {
    const { rows: [sale] } = await client.query("SELECT tax_total FROM sales WHERE id = $1", [saleId]);
    saleTax = Number(sale?.tax_total || 0);
  } catch { /* tax_total column pre-v83 */ }

  await client.query(
    `INSERT INTO folio_lines
       (folio_id, line_type, description, quantity, unit_price, line_total, sale_id, added_by,
        tax_rate_at_charge, tax_amount_at_charge, tax_inclusive_at_charge)
     VALUES ($1, 'pos_sale', $2, 1, $3, $3, $4, $5, 0, $6, TRUE)`,
    [targetFolioId, description || `POS sale #${saleId}`, amt, saleId, employeeId || null, saleTax]
  );
  await recomputeFolioTotals(client, targetFolioId);
  return { folio_id: targetFolioId, redirected: targetFolioId !== folioId };
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

    // V10 folio-tax: tax_total = Σ per-line snapshots; subtotal is the net
    // (grand − tax) in BOTH modes — exclusive lines already added their tax
    // into grand_total at recompute, inclusive lines carried it inside.
    const invoiceTax = Number(freshFolio.tax_total || 0);
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
        Math.max(0, grandTotal - invoiceTax),
        invoiceTax,
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

// ── Guest registration (V10 — PK legal register) ──────────────────

async function addBookingGuest(clientOrDb, bookingId, g) {
  const { rows: [guest] } = await clientOrDb.query(
    `INSERT INTO booking_guests
       (booking_id, name, cnic_passport, nationality, phone, document_photos, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, FALSE))
     RETURNING *`,
    [
      bookingId,
      g.name,
      g.cnic_passport || null,
      g.nationality || null,
      g.phone || null,
      JSON.stringify(g.document_photos || []),
      g.is_primary,
    ]
  );
  return guest;
}

async function listBookingGuests(db, bookingId) {
  const { rows } = await db.query(
    "SELECT * FROM booking_guests WHERE booking_id = $1 ORDER BY is_primary DESC, id ASC",
    [bookingId]
  );
  return rows;
}

async function deleteBookingGuest(db, bookingId, guestId) {
  const { rows: [row] } = await db.query(
    "DELETE FROM booking_guests WHERE id = $1 AND booking_id = $2 RETURNING *",
    [guestId, bookingId]
  );
  return row || null;
}

/** Date-range guest register (police-reporting reality). Staff-only PII. */
async function getGuestRegistry(db, { from, to }) {
  const { rows } = await db.query(
    `SELECT g.id, g.name, g.cnic_passport, g.nationality, g.phone, g.is_primary,
            g.created_at AS registered_at,
            b.booking_number, b.check_in_date, b.check_out_date, b.status,
            r.room_number
       FROM booking_guests g
       JOIN room_bookings b ON b.id = g.booking_id
       LEFT JOIN rooms r ON r.id = b.room_id
      WHERE b.check_in_date <= $2 AND b.check_out_date >= $1
      ORDER BY b.check_in_date ASC, b.id ASC, g.is_primary DESC`,
    [from, to]
  );
  return rows;
}

// ── Group bookings (V10 — wedding blocks, tour groups) ────────────

/**
 * Create N rooms in one flow. Each booking goes through the createBooking
 * choke point (own transaction + lock); on any failure the already-created
 * bookings are compensating-cancelled so a half-booked block never survives.
 */
async function createBookingGroup(db, { name, customer_id, notes, bookings }, employeeId) {
  const { rows: [group] } = await db.query(
    "INSERT INTO booking_groups (name, customer_id, notes) VALUES ($1, $2, $3) RETURNING *",
    [name, customer_id || null, notes || null]
  );
  const created = [];
  try {
    for (const b of bookings) {
      const booking = await createBooking(
        db,
        { ...b, customer_id: b.customer_id ?? customer_id ?? null },
        employeeId,
        { groupId: group.id }
      );
      created.push(booking);
    }
  } catch (err) {
    for (const b of created) {
      try { await cancelBooking(db, b.id, { cancellation_reason: "Group booking failed — auto-rollback" }); }
      catch { /* best-effort compensation */ }
    }
    try { await db.query("DELETE FROM booking_groups WHERE id = $1", [group.id]); }
    catch { /* leave the empty group if delete races */ }
    throw err;
  }
  return { ...group, bookings: created };
}

async function getBookingGroup(db, id) {
  const { rows: [group] } = await db.query(
    `SELECT g.*, c.name AS customer_name
       FROM booking_groups g LEFT JOIN customers c ON c.id = g.customer_id
      WHERE g.id = $1`,
    [id]
  );
  if (!group) return null;
  const bookings = await listBookings(db, {});
  const groupBookings = bookings.filter((b) => Number(b.group_id) === Number(id));
  const totals = groupBookings.reduce(
    (acc, b) => ({ grand_total: acc.grand_total + Number(b.folio_grand_total || 0) }),
    { grand_total: 0 }
  );
  return { ...group, bookings: groupBookings, combined_folio_total: totals.grand_total };
}

async function listBookingGroups(db) {
  const { rows } = await db.query(
    `SELECT g.*, c.name AS customer_name,
            (SELECT COUNT(*) FROM room_bookings b WHERE b.group_id = g.id) AS booking_count
       FROM booking_groups g LEFT JOIN customers c ON c.id = g.customer_id
      ORDER BY g.id DESC`
  );
  return rows;
}

/** Route all POS charges for the block to one booking's folio. */
async function setGroupMasterFolio(db, groupId, bookingId) {
  const { rows: [b] } = await db.query(
    "SELECT id FROM room_bookings WHERE id = $1 AND group_id = $2",
    [bookingId, groupId]
  );
  if (!b) throw Object.assign(new Error("Booking is not part of this group"), { statusCode: 400 });
  const { rows: [folio] } = await db.query(
    "SELECT id, status FROM guest_folios WHERE booking_id = $1",
    [bookingId]
  );
  if (!folio || folio.status !== "open") {
    throw Object.assign(new Error("Master booking must have an open folio (check it in first)"), { statusCode: 400 });
  }
  const { rows: [group] } = await db.query(
    "UPDATE booking_groups SET master_folio_booking_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [bookingId, groupId]
  );
  return group;
}

// ── Hostel dorm map (V10 — beds as child rooms) ───────────────────

/** Dorm view: children with live occupancy + tonight's bookings ("7/10 beds"). */
async function getDormMap(db, dormRoomId) {
  const { rows: [dorm] } = await db.query(
    `SELECT r.*, rt.name AS room_type_name FROM rooms r
     LEFT JOIN room_types rt ON rt.id = r.room_type_id WHERE r.id = $1`,
    [dormRoomId]
  );
  if (!dorm) return null;
  const { rows: beds } = await db.query(
    `SELECT r.*,
            b.id AS current_booking_id, b.booking_number, b.status AS booking_status,
            b.check_in_date, b.check_out_date, c.name AS guest_name
       FROM rooms r
       LEFT JOIN room_bookings b
         ON b.room_id = r.id
        AND b.status IN ('reserved','confirmed','checked_in')
        AND b.check_in_date <= CURRENT_DATE AND b.check_out_date > CURRENT_DATE
        AND NOT ${STALE_RESERVATION_PREDICATE}
       LEFT JOIN customers c ON c.id = b.customer_id
      WHERE r.parent_room_id = $1 AND r.is_active = TRUE
      ORDER BY r.room_number ASC`,
    [dormRoomId]
  );
  const occupied = beds.filter((b) => b.current_booking_id).length;
  return { dorm, beds, beds_total: beds.length, beds_occupied: occupied };
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
  expireStaleRoomReservations,
  ONLINE_RESERVATION_TTL_MINUTES,
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
  // guests (V10)
  addBookingGuest,
  listBookingGuests,
  deleteBookingGuest,
  getGuestRegistry,
  // groups (V10)
  createBookingGroup,
  getBookingGroup,
  listBookingGroups,
  setGroupMasterFolio,
  // hostel (V10)
  getDormMap,
  // overdue
  getOverdueCheckouts,
  markOverdueEmailSent,
  // timeline
  getTimelineData,
};
