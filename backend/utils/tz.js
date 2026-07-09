/**
 * Timezone utilities for SaaS multi-tenant date handling.
 *
 * All business-critical timestamps are stored as UTC in SQLite.
 * These helpers convert a local "YYYY-MM-DD" date string (in the company's
 * timezone) into UTC boundary strings suitable for direct timestamp comparison,
 * avoiding SQLite's 'localtime' modifier which uses the server OS timezone.
 *
 * No external dependencies — uses Node.js built-in Intl.DateTimeFormat.
 */

// Emit an explicit-UTC ISO 8601 timestamp ("YYYY-MM-DDTHH:MM:SSZ"). The trailing
// `Z` is load-bearing: these strings are bound as query params against
// `timestamptz` columns. A naive "YYYY-MM-DD HH:MM:SS" string (the old shape) is
// interpreted by Postgres in the *session* TimeZone, so under a non-UTC session
// (local dev often is) the day boundary lands hours off and reports mis-bucket.
// With `Z`, Postgres parses it as UTC regardless of session TZ.
const UTC_FMT = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
};

/**
 * Return the UTC millisecond at which local midnight begins for a given
 * YYYY-MM-DD date string in the given IANA timezone.
 *
 * Uses binary search because DST transitions mean offsets vary.
 */
function localMidnightUtcMs(dateStr, tz) {
  const [year, month, day] = dateStr.split("-").map(Number);

  // Formatter that produces the local date parts in the target timezone
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // Search from 30 hours before to 30 hours after UTC midnight on that date.
  // This covers all IANA offsets (max is UTC+14, min is UTC-12).
  let lo = Date.UTC(year, month - 1, day) - 30 * 3600 * 1000;
  let hi = Date.UTC(year, month - 1, day) + 30 * 3600 * 1000;

  // Binary search to within 1 second
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    const parts = fmt.format(new Date(mid)).split("-").map(Number);
    // parts is [year, month, day] in local tz via "en-CA" locale (YYYY-MM-DD)
    const localDay = parts[2];
    const localMonth = parts[1];
    const localYear = parts[0];
    if (
      localYear < year ||
      (localYear === year && localMonth < month) ||
      (localYear === year && localMonth === month && localDay < day)
    ) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return hi;
}

/**
 * Convert a local date string to the UTC start bound (inclusive).
 * '2026-03-06', 'America/New_York' → '2026-03-06T05:00:00Z'
 */
function toUtcStart(dateStr, tz) {
  if (!dateStr) return null;
  const safeTz = isValidTz(tz) ? tz : "UTC";
  return UTC_FMT(localMidnightUtcMs(dateStr, safeTz));
}

/**
 * Convert a local date string to the UTC end bound (exclusive — start of next day).
 * '2026-03-06', 'America/New_York' → '2026-03-07T05:00:00Z'
 *
 * Use with `timestamp < toUtcEnd(...)` (strict less-than) to cover the full day.
 */
function toUtcEnd(dateStr, tz) {
  if (!dateStr) return null;
  const safeTz = isValidTz(tz) ? tz : "UTC";
  // Next day's midnight in local time = exclusive upper bound
  const [year, month, day] = dateStr.split("-").map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDayStr = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDay.getUTCDate()).padStart(2, "0")}`;
  return UTC_FMT(localMidnightUtcMs(nextDayStr, safeTz));
}

/**
 * Convert a UTC SQLite timestamp string to a local date string (YYYY-MM-DD)
 * in the given timezone. Used for GROUP BY date in reports.
 * '2026-03-06 05:30:00', 'America/New_York' → '2026-03-06'
 */
function toLocalDateStr(utcStr, tz) {
  if (!utcStr) return null;
  const safeTz = isValidTz(tz) ? tz : "UTC";
  // SQLite format: 'YYYY-MM-DD HH:MM:SS' — treat as UTC
  const ms = Date.parse(utcStr.replace(" ", "T") + "Z");
  if (isNaN(ms)) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: safeTz }).format(new Date(ms));
}

/**
 * Get the UTC offset in minutes for a given date in a timezone.
 * Positive = east of UTC. Used for strftime-based GROUP BY in SQL.
 * '2026-03-06', 'America/New_York' → -300
 */
function getUtcOffsetMinutes(dateStr, tz) {
  if (!dateStr) return 0;
  const safeTz = isValidTz(tz) ? tz : "UTC";
  const midnightUtc = localMidnightUtcMs(dateStr, safeTz);
  // midnight UTC in local tz should be 00:00. The difference between
  // local midnight UTC ms and the reference UTC midnight tells us the offset.
  const [year, month, day] = dateStr.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  return Math.round((utcMidnight - midnightUtc) / 60000);
}

/**
 * Current date string (YYYY-MM-DD) in the given IANA timezone.
 *
 * THE canonical "what day is it for this tenant" helper. Never compute
 * "today" via `new Date().toISOString().slice(0, 10)` (always UTC) or via
 * SQL `CURRENT_DATE` / bare `col::date` on a timestamptz (casts in the DB
 * SESSION timezone — UTC on prod/Supabase, Asia/Karachi on local dev, so the
 * result differs by environment). This helper is explicit about the zone and
 * therefore produces the same answer everywhere.
 *
 * Optional second arg converts an arbitrary instant (JS Date or parseable
 * value) to its local date in tz — e.g. `tenantToday(tz, sale.timestamp)`.
 */
function tenantToday(tz, at = new Date()) {
  const safeTz = isValidTz(tz) ? tz : "UTC";
  const d = at instanceof Date ? at : new Date(at);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: safeTz }).format(d);
}

/**
 * UTC boundaries of the current tenant-local day.
 * Returns { from, to, today } — `from`/`to` are explicit-UTC ISO strings for
 * `timestamp >= $from AND timestamp < $to` filters, `today` is the local
 * YYYY-MM-DD date string.
 */
function todayBounds(tz, at = new Date()) {
  const today = tenantToday(tz, at);
  return { from: toUtcStart(today, tz), to: toUtcEnd(today, tz), today };
}

/**
 * Pure calendar arithmetic on a YYYY-MM-DD string (no timezone involved).
 * addDaysStr('2026-07-10', 30) → '2026-08-09'. Use for due dates / expiry
 * dates derived from a tenant-local day.
 */
function addDaysStr(dateStr, days) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(days || 0)));
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Convert a value read from a Postgres DATE column back to 'YYYY-MM-DD'.
 *
 * node-postgres parses DATE columns into a JS Date at LOCAL-process midnight,
 * so `row.date.toISOString().slice(0, 10)` yields the PREVIOUS day whenever
 * the process TZ is east of UTC (Railway runs TZ=Asia/Karachi — this fires in
 * prod). Local getters read the same zone pg used to construct the Date, so
 * this round-trips correctly regardless of process TZ.
 */
function pgDateToStr(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Cache of validated timezone strings to avoid repeated try/catch
const _validTzCache = new Map();

function isValidTz(tz) {
  if (!tz || typeof tz !== "string") return false;
  if (_validTzCache.has(tz)) return _validTzCache.get(tz);
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    _validTzCache.set(tz, true);
    return true;
  } catch {
    _validTzCache.set(tz, false);
    return false;
  }
}

module.exports = {
  toUtcStart,
  toUtcEnd,
  toLocalDateStr,
  getUtcOffsetMinutes,
  isValidTz,
  tenantToday,
  todayBounds,
  addDaysStr,
  pgDateToStr,
};
