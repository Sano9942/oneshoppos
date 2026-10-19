/**
 * One Toy Store pilot G2: the stock value saved at the end of each day,
 * like the "total stock at cost" the owner reads when closing iPOS.
 *
 * Owner, 2026-10-19:
 *   - saved at every Close Shift (printed on the day slip, F4), plus a nightly
 *     save at 23:59 shop time for a branch that closed no shift that day, so
 *     no date is ever missing (live shift 5 stayed open 15–19 Oct);
 *   - totals only: toys in stock, units, value at cost, value at sale price,
 *     the same figures as the G1 Stock Value totals
 *     (routes/reports/inventory.js stock-value-summary);
 *   - the day = the shop date the shift was CLOSED; one figure per branch;
 *   - listed by date, the last Close Shift of a day winning.
 *
 * Stock has no history, so a past day can only be read from what was saved.
 */

const { tenantToday, isValidTz } = require("../utils/tz");

// Same statement in schema-pg.sql and migration v160.
const STOCK_VALUE_DAYS_DDL = `
CREATE TABLE IF NOT EXISTS stock_value_days (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  day DATE NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('close_shift', 'nightly')),
  shift_id INTEGER REFERENCES cash_shifts(id),
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  toys INTEGER NOT NULL,
  units NUMERIC(14,3) NOT NULL,
  cost_value NUMERIC(14,2) NOT NULL,
  retail_value NUMERIC(14,2) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_value_days_shift ON stock_value_days(shift_id) WHERE shift_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_value_days_nightly ON stock_value_days(outlet_id, day) WHERE source = 'nightly';
CREATE INDEX IF NOT EXISTS idx_stock_value_days_day ON stock_value_days(day DESC, outlet_id);
`;

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

function shape(r) {
  if (!r) return null;
  return {
    toys: Number(r.toys),
    units: round2(r.units),
    cost_value: round2(r.cost_value),
    retail_value: round2(r.retail_value),
  };
}

async function shopTimezone(db) {
  const { rows: [cp] } = await db.query("SELECT timezone FROM company_profile WHERE id = 1");
  return isValidTz(cp?.timezone) ? cp.timezone : "UTC";
}

/** The branch's stock right now — the G1 Stock Value totals. */
async function stockValueTotals(db, outletId) {
  const { rows: [r] } = await db.query(
    `WITH stock AS (
       SELECT product_id, SUM(quantity) AS q
         FROM outlet_stock WHERE outlet_id = $1
        GROUP BY product_id HAVING SUM(quantity) <> 0
     )
     SELECT COUNT(*)::int AS toys, COALESCE(SUM(s.q), 0) AS units,
            COALESCE(SUM(s.q * COALESCE(p.cost_price, 0)), 0) AS cost_value,
            COALESCE(SUM(s.q * COALESCE(p.price, 0)), 0) AS retail_value
       FROM stock s JOIN products p ON p.id = s.product_id`,
    [outletId],
  );
  return shape(r);
}

async function insertRow(db, { outletId, day, source, shiftId, takenAt, totals }) {
  const { rows: [row] } = await db.query(
    `INSERT INTO stock_value_days (outlet_id, day, source, shift_id, taken_at, toys, units, cost_value, retail_value)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT DO NOTHING
     RETURNING id, outlet_id, to_char(day, 'YYYY-MM-DD') AS day, source, shift_id, taken_at,
               toys, units, cost_value, retail_value`,
    [outletId, day, source, shiftId || null, takenAt, totals.toys, totals.units, totals.cost_value, totals.retail_value],
  );
  return row ? { ...row, ...shape(row) } : null;
}

/** Close Shift: save the branch's stock, dated the shop day of the close. */
async function saveShiftStockValue(db, { shift, closedAt }) {
  const tz = await shopTimezone(db);
  const totals = await stockValueTotals(db, shift.outlet_id);
  return insertRow(db, {
    outletId: shift.outlet_id,
    day: tenantToday(tz, closedAt),
    source: "close_shift",
    shiftId: shift.id,
    takenAt: closedAt,
    totals,
  });
}

/** True in the 23:00 hour, shop time — when the nightly save runs. */
function isNightlyHour(tz, at = new Date()) {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: isValidTz(tz) ? tz : "UTC", hour: "2-digit", hourCycle: "h23",
  }).format(at);
  return Number(hour) === 23;
}

/**
 * Nightly: every active branch with stock records that has no figure yet for
 * the shop day of `at` gets one. Returns how many were saved.
 */
async function saveNightlyStockValues(db, { at = new Date() } = {}) {
  const tz = await shopTimezone(db);
  const day = tenantToday(tz, at);
  const { rows: outlets } = await db.query(
    `SELECT o.id FROM outlets o
      WHERE COALESCE(o.is_active, TRUE)
        AND EXISTS (SELECT 1 FROM outlet_stock os WHERE os.outlet_id = o.id)
        AND NOT EXISTS (SELECT 1 FROM stock_value_days v WHERE v.outlet_id = o.id AND v.day = $1::date)
      ORDER BY o.id`,
    [day],
  );
  let saved = 0;
  for (const o of outlets) {
    const totals = await stockValueTotals(db, o.id);
    if (await insertRow(db, { outletId: o.id, day, source: "nightly", takenAt: at, totals })) saved += 1;
  }
  return saved;
}

/** The hourly worker's step for one shop: save only in its 23:00 hour. */
async function nightlyStockValueTick(db, { at = new Date() } = {}) {
  if (!isNightlyHour(await shopTimezone(db), at)) return 0;
  return saveNightlyStockValues(db, { at });
}

/** For the day slip: what was saved at this shift's close (null if none). */
async function shiftStockValue(db, shiftId) {
  const { rows: [r] } = await db.query(
    "SELECT taken_at, toys, units, cost_value, retail_value FROM stock_value_days WHERE shift_id = $1",
    [shiftId],
  );
  return r ? { ...shape(r), taken_at: r.taken_at, live: false } : null;
}

/** By date, newest first: one row per day and branch, the last one saved winning. */
async function listStockValueDays(db, { dateFrom, dateTo, outletIds } = {}) {
  const where = [];
  const params = [];
  if (dateFrom) { params.push(dateFrom); where.push(`v.day >= $${params.length}::date`); }
  if (dateTo) { params.push(dateTo); where.push(`v.day <= $${params.length}::date`); }
  if (outletIds && outletIds.length) { params.push(outletIds); where.push(`v.outlet_id = ANY($${params.length}::int[])`); }
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (v.outlet_id, v.day)
              to_char(v.day, 'YYYY-MM-DD') AS day, v.outlet_id, o.name AS outlet_name, v.source, v.shift_id, v.taken_at,
              v.toys, v.units, v.cost_value, v.retail_value
         FROM stock_value_days v
         LEFT JOIN outlets o ON o.id = v.outlet_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY v.outlet_id, v.day, v.taken_at DESC, v.id DESC
     ) x ORDER BY day DESC, outlet_id`,
    params,
  );
  return rows.map((r) => ({
    day: r.day,
    outlet_id: r.outlet_id,
    outlet_name: r.outlet_name,
    source: r.source,
    shift_id: r.shift_id,
    taken_at: r.taken_at,
    ...shape(r),
  }));
}

module.exports = {
  STOCK_VALUE_DAYS_DDL,
  stockValueTotals,
  saveShiftStockValue,
  saveNightlyStockValues,
  nightlyStockValueTick,
  isNightlyHour,
  shiftStockValue,
  listStockValueDays,
};
