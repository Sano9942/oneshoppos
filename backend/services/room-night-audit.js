"use strict";

/**
 * Night audit + occupancy/ADR/RevPAR (V10).
 *
 * A "hotel night" D covers D → D+1; a booking occupies night D when
 * check_in <= D < check_out (checkout-day-exclusive, same math as
 * availability). Revenue per occupied night resolves through the SAME rate +
 * folio-tax chain the folio uses (resolveRateForDate + room-type tax
 * resolution) so audit numbers and folio settles can't drift apart: ADR and
 * room_revenue are NET of inclusive tax (coordinated with the approved
 * folio-tax proposal; FBR stays out of folio invoices).
 *
 * rooms_ooo uses CURRENT housekeeping state — historical OOO isn't tracked;
 * re-running an old date reflects today's OOO count. Documented trade-off.
 */

const logger = require("./logger").child({ component: "room-night-audit" });
const rooms = require("./room-service");
const { resolveTaxForExplicitRate } = require("./tax-snapshot");

function normDate(d) {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  if (d instanceof Date) {
    // pg parses DATE to a JS Date at LOCAL midnight — toISOString() shifts a
    // day back on UTC+ servers. Use local components.
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return String(d).slice(0, 10);
}

/** Compute (without persisting) the audit numbers for one hotel night. */
async function computeNightAudit(db, auditDate) {
  const date = normDate(auditDate);

  // Bookable inventory: active rooms that aren't dorm parents.
  const { rows: [inv] } = await db.query(
    `SELECT COUNT(*)::int AS rooms_total,
            COUNT(*) FILTER (WHERE housekeeping_status = 'out_of_order')::int AS rooms_ooo
       FROM rooms r
      WHERE r.is_active = TRUE
        AND NOT EXISTS (SELECT 1 FROM rooms c WHERE c.parent_room_id = r.id AND c.is_active = TRUE)`
  );

  // Bookings occupying night D (any non-dead status; expired unpaid holds out).
  const { rows: occupying } = await db.query(
    `SELECT b.id, b.room_id, b.room_type_id, b.rate_snapshot
       FROM room_bookings b
      WHERE b.status NOT IN ('cancelled','no_show')
        AND NOT (
          b.status = 'reserved'
          AND b.expires_at IS NOT NULL AND b.expires_at < NOW()
          AND b.deposit_status NOT IN ('authorized','captured')
        )
        AND b.check_in_date <= $1 AND b.check_out_date > $1`,
    [date]
  );

  const { rows: [moves] } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE check_in_date  = $1 AND status NOT IN ('cancelled','no_show'))::int AS arrivals,
       COUNT(*) FILTER (WHERE check_out_date = $1 AND status NOT IN ('cancelled','no_show'))::int AS departures,
       COUNT(*) FILTER (WHERE check_in_date  = $1 AND status = 'no_show')::int AS no_shows
     FROM room_bookings`,
    [date]
  );

  // OTA channel blocks occupying the night (inventory held, revenue elsewhere).
  let roomsBlocked = 0;
  try {
    const { rows: [blk] } = await db.query(
      "SELECT COUNT(DISTINCT room_id)::int AS n FROM channel_blocks WHERE start_date <= $1 AND end_date > $1",
      [date]
    );
    roomsBlocked = blk?.n || 0;
  } catch { /* pre-v119 */ }

  // Net room revenue for the night through the shared rate + tax chain.
  const { rows: [cp] } = await db.query("SELECT tax_mode FROM company_profile WHERE id = 1");
  const taxMode = cp?.tax_mode || "none";
  const rtCache = new Map();
  let roomRevenue = 0;
  for (const b of occupying) {
    let rate = 0;
    try {
      rate = await rooms.resolveRateForDate(db, b.room_type_id, date);
    } catch { rate = Number(b.rate_snapshot || 0); }
    let rt = rtCache.get(b.room_type_id);
    if (!rt) {
      const { rows: [row] } = await db.query(
        "SELECT tax_id, tax_inclusive FROM room_types WHERE id = $1",
        [b.room_type_id]
      );
      rt = row || {};
      rtCache.set(b.room_type_id, rt);
    }
    const inclusive = rt.tax_inclusive === true ? true : taxMode === "inclusive";
    const tax = await resolveTaxForExplicitRate(db, {
      taxId: rt.tax_id ?? null, price: rate, quantity: 1, taxMode, taxInclusive: inclusive,
    });
    roomRevenue += inclusive ? rate - tax.amount : rate;
  }
  roomRevenue = Math.round(roomRevenue * 100) / 100;

  // Departed guests whose folio never settled — the audit's action list.
  const { rows: unsettled } = await db.query(
    `SELECT b.id AS booking_id, b.booking_number, gf.id AS folio_id, gf.grand_total,
            c.name AS customer_name
       FROM guest_folios gf
       JOIN room_bookings b ON b.id = gf.booking_id
       LEFT JOIN customers c ON c.id = b.customer_id
      WHERE gf.status = 'open' AND b.status = 'checked_out'
      ORDER BY b.check_out_date ASC`
  );

  const roomsOccupied = occupying.length;
  const sellable = Math.max(0, (inv.rooms_total || 0) - (inv.rooms_ooo || 0));
  const occupancyPct = sellable ? Math.round((roomsOccupied / sellable) * 10000) / 100 : 0;
  const adr = roomsOccupied ? Math.round((roomRevenue / roomsOccupied) * 100) / 100 : 0;
  const revpar = sellable ? Math.round((roomRevenue / sellable) * 100) / 100 : 0;

  return {
    audit_date: date,
    rooms_total: inv.rooms_total || 0,
    rooms_ooo: inv.rooms_ooo || 0,
    rooms_occupied: roomsOccupied,
    rooms_blocked: roomsBlocked,
    arrivals: moves.arrivals || 0,
    departures: moves.departures || 0,
    no_shows: moves.no_shows || 0,
    occupancy_pct: occupancyPct,
    adr,
    revpar,
    room_revenue: roomRevenue,
    unsettled_folio_total: unsettled.reduce((s, f) => s + Number(f.grand_total || 0), 0),
    unsettled_folios: unsettled,
  };
}

/** Compute + persist (upsert — re-running a date updates in place). */
async function runNightAudit(db, auditDate, runBy = null) {
  const snap = await computeNightAudit(db, auditDate);
  const { rows: [row] } = await db.query(
    `INSERT INTO night_audit_snapshots
       (audit_date, rooms_total, rooms_ooo, rooms_occupied, rooms_blocked,
        arrivals, departures, no_shows, occupancy_pct, adr, revpar,
        room_revenue, unsettled_folio_total, payload, run_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (audit_date) DO UPDATE SET
       rooms_total = EXCLUDED.rooms_total, rooms_ooo = EXCLUDED.rooms_ooo,
       rooms_occupied = EXCLUDED.rooms_occupied, rooms_blocked = EXCLUDED.rooms_blocked,
       arrivals = EXCLUDED.arrivals, departures = EXCLUDED.departures,
       no_shows = EXCLUDED.no_shows, occupancy_pct = EXCLUDED.occupancy_pct,
       adr = EXCLUDED.adr, revpar = EXCLUDED.revpar,
       room_revenue = EXCLUDED.room_revenue,
       unsettled_folio_total = EXCLUDED.unsettled_folio_total,
       payload = EXCLUDED.payload, run_by = EXCLUDED.run_by, created_at = NOW()
     RETURNING *`,
    [
      snap.audit_date, snap.rooms_total, snap.rooms_ooo, snap.rooms_occupied, snap.rooms_blocked,
      snap.arrivals, snap.departures, snap.no_shows, snap.occupancy_pct, snap.adr, snap.revpar,
      snap.room_revenue, snap.unsettled_folio_total,
      JSON.stringify({ unsettled_folios: snap.unsettled_folios }),
      runBy,
    ]
  );
  logger.info({ auditDate: snap.audit_date, occupancy: snap.occupancy_pct }, "night audit run");
  return { ...row, unsettled_folios: snap.unsettled_folios };
}

/**
 * Occupancy/ADR/RevPAR over a range. Persisted snapshots win; missing dates
 * (never audited) compute live without persisting.
 */
async function getOccupancyReport(db, { from, to }) {
  const { rows: snaps } = await db.query(
    "SELECT * FROM night_audit_snapshots WHERE audit_date >= $1 AND audit_date <= $2 ORDER BY audit_date ASC",
    [from, to]
  );
  const bySnap = new Map(snaps.map((s) => [normDate(s.audit_date), s]));
  const days = [];
  const start = new Date(`${normDate(from)}T00:00:00Z`);
  const end = new Date(`${normDate(to)}T00:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    if (bySnap.has(key)) {
      days.push({ ...bySnap.get(key), audit_date: key, source: "audit" });
    } else {
      const live = await computeNightAudit(db, key);
      days.push({ ...live, source: "live" });
    }
  }
  const totals = days.reduce(
    (acc, d) => {
      acc.occupied += Number(d.rooms_occupied || 0);
      acc.sellable += Math.max(0, Number(d.rooms_total || 0) - Number(d.rooms_ooo || 0));
      acc.revenue += Number(d.room_revenue || 0);
      return acc;
    },
    { occupied: 0, sellable: 0, revenue: 0 }
  );
  return {
    from: normDate(from),
    to: normDate(to),
    days,
    summary: {
      occupancy_pct: totals.sellable ? Math.round((totals.occupied / totals.sellable) * 10000) / 100 : 0,
      adr: totals.occupied ? Math.round((totals.revenue / totals.occupied) * 100) / 100 : 0,
      revpar: totals.sellable ? Math.round((totals.revenue / totals.sellable) * 100) / 100 : 0,
      room_revenue: Math.round(totals.revenue * 100) / 100,
      room_nights_sold: totals.occupied,
    },
  };
}

module.exports = { computeNightAudit, runNightAudit, getOccupancyReport };
