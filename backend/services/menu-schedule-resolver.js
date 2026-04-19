// Phase 2-R Wave B — 2-R.6 menu-schedule resolver (day-parting).
//
// Philosophy: menu_schedules are *restrictions*, not allowlists. A product
// with zero schedule rows is always available. Products with one or more
// schedules are only available within those windows.
//
// Cache is scoped per outlet (60s) because the public menu endpoint can
// be hit by QR scanners at high rate and the schedule row set changes
// rarely. CRUD routes call invalidateMenuScheduleCache() on writes.

const ONE_MIN = 60_000;
const _cache = new Map(); // key = outletId (or "_global"), val = { at, rows }

function cacheKey(outletId) {
  return outletId == null ? "_global" : String(outletId);
}

function invalidateMenuScheduleCache(outletId) {
  if (outletId == null) { _cache.clear(); return; }
  _cache.delete(cacheKey(outletId));
}

async function loadSchedulesForOutlet(db, outletId) {
  const key = cacheKey(outletId);
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.at < ONE_MIN) return cached.rows;

  // Match schedules for the outlet OR schedules with outlet_id IS NULL
  // (global schedules applying to every outlet).
  const { rows } = await db.query(
    `SELECT s.id, s.name, s.outlet_id, s.day_of_week, s.start_time, s.end_time,
            s.timezone, s.is_active, sp.product_id
     FROM menu_schedules s
     JOIN menu_schedule_products sp ON sp.schedule_id = s.id
     WHERE s.is_active = true
       AND (s.outlet_id IS NULL OR s.outlet_id = $1)`,
    [outletId || null]
  );
  _cache.set(key, { at: Date.now(), rows });
  return rows;
}

async function loadOutletTimezone(db, outletId) {
  if (!outletId) return null;
  try {
    const { rows: [row] } = await db.query(
      "SELECT timezone FROM outlets WHERE id = $1",
      [outletId]
    );
    return row?.timezone || null;
  } catch { return null; }
}

async function loadCompanyTimezone(db) {
  try {
    const { rows: [row] } = await db.query("SELECT timezone FROM company_profile LIMIT 1");
    return row?.timezone || "UTC";
  } catch { return "UTC"; }
}

// Parse 'HH:MM:SS' or 'HH:MM' to minutes-since-midnight.
function timeStrToMinutes(str) {
  if (!str) return null;
  const parts = String(str).split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] || 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

// Compute the {weekday:0-6 Sun=0, minutes:0-1439} for a given Date in IANA tz.
function localWeekdayMinutes(date, tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const weekdayStr = get("weekday");
    const hour = Number(get("hour"));
    const minute = Number(get("minute"));
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekday = weekdayMap[weekdayStr];
    return { weekday, minutes: hour * 60 + minute };
  } catch {
    // Fallback: UTC
    return { weekday: date.getUTCDay(), minutes: date.getUTCHours() * 60 + date.getUTCMinutes() };
  }
}

/**
 * isProductAvailableNow(db, productId, outletId, nowTs = new Date())
 *
 * Returns true iff the product either has zero active schedules OR at
 * least one matching schedule covers the current local time.
 */
async function isProductAvailableNow(db, productId, outletId, nowTs = new Date()) {
  const rows = await loadSchedulesForOutlet(db, outletId);
  const applicable = rows.filter((r) => Number(r.product_id) === Number(productId));
  if (applicable.length === 0) return true; // no schedule restrictions

  const tz =
    (await loadOutletTimezone(db, outletId)) ||
    (await loadCompanyTimezone(db)) ||
    "UTC";

  const { weekday, minutes } = localWeekdayMinutes(nowTs, tz);

  for (const r of applicable) {
    const start = timeStrToMinutes(r.start_time);
    const end = timeStrToMinutes(r.end_time);
    if (start == null || end == null) continue;
    const dowMatches = r.day_of_week == null || Number(r.day_of_week) === weekday;
    if (!dowMatches) continue;
    // Handle same-day window; overnight windows (end < start) also supported.
    if (end > start) {
      if (minutes >= start && minutes < end) return true;
    } else if (end < start) {
      if (minutes >= start || minutes < end) return true;
    }
  }
  return false;
}

/**
 * filterAvailableProducts(db, products, outletId, nowTs) — batch-friendly.
 * Pre-fetches schedules + timezone once, then filters in memory so the
 * public menu endpoint isn't N+1.
 */
async function filterAvailableProducts(db, products, outletId, nowTs = new Date()) {
  if (!Array.isArray(products) || products.length === 0) return products;
  const rows = await loadSchedulesForOutlet(db, outletId);
  if (rows.length === 0) return products;

  const tz =
    (await loadOutletTimezone(db, outletId)) ||
    (await loadCompanyTimezone(db)) ||
    "UTC";
  const { weekday, minutes } = localWeekdayMinutes(nowTs, tz);

  // Group schedule rows by product_id.
  const byProduct = new Map();
  for (const r of rows) {
    const arr = byProduct.get(Number(r.product_id)) || [];
    arr.push(r);
    byProduct.set(Number(r.product_id), arr);
  }

  return products.filter((p) => {
    const applicable = byProduct.get(Number(p.id));
    if (!applicable || applicable.length === 0) return true;
    for (const r of applicable) {
      const start = timeStrToMinutes(r.start_time);
      const end = timeStrToMinutes(r.end_time);
      if (start == null || end == null) continue;
      const dowMatches = r.day_of_week == null || Number(r.day_of_week) === weekday;
      if (!dowMatches) continue;
      if (end > start) {
        if (minutes >= start && minutes < end) return true;
      } else if (end < start) {
        if (minutes >= start || minutes < end) return true;
      }
    }
    return false;
  });
}

module.exports = {
  isProductAvailableNow,
  filterAvailableProducts,
  invalidateMenuScheduleCache,
};
