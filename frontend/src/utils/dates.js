/**
 * Parse a SQLite UTC timestamp string (e.g. "2026-03-06 08:56:04")
 * into a JS Date object, correctly treating it as UTC.
 *
 * SQLite CURRENT_TIMESTAMP has no 'T' separator and no 'Z' suffix,
 * so plain `new Date(str)` is parsed as LOCAL time by browsers — wrong.
 */
export function parseDbDate(str) {
  if (!str) return null;
  // Postgres pg driver returns TIMESTAMPTZ as native Date objects
  if (str instanceof Date) return isNaN(str.getTime()) ? null : str;
  // ISO 8601 strings (e.g. "2026-03-06T08:56:04.000Z") — parse directly
  const s = String(str);
  if (s.includes('T') || s.includes('Z')) return new Date(s);
  // SQLite legacy: "2026-03-06 08:56:04" → "2026-03-06T08:56:04Z"
  return new Date(s.replace(' ', 'T') + 'Z');
}

/**
 * Parse a SQLite LOCAL timestamp string (e.g. "2026-03-06 13:56:04")
 * into a JS Date object, treating it as local time (no 'Z' suffix).
 */
export function parseLocalDate(str) {
  if (!str) return null;
  // Postgres pg driver returns TIMESTAMP as native Date objects
  if (str instanceof Date) return isNaN(str.getTime()) ? null : str;
  const s = String(str);
  if (s.includes('T')) return new Date(s);
  // SQLite legacy: "2026-03-06 13:56:04" → "2026-03-06T13:56:04"
  return new Date(s.replace(' ', 'T'));
}

// ── UTC column formatters (sales.timestamp, returns.timestamp, etc.) ──

/** Format a SQLite UTC timestamp as a locale date+time string */
export function fmtUtcDateTime(str) {
  const d = parseDbDate(str);
  return d ? d.toLocaleString() : "—";
}

/** Format a SQLite UTC timestamp as a locale date string */
export function fmtUtcDate(str) {
  const d = parseDbDate(str);
  return d ? d.toLocaleDateString() : "—";
}

/** Format a SQLite UTC timestamp as a locale time string */
export function fmtUtcTime(str, opts) {
  const d = parseDbDate(str);
  return d ? d.toLocaleTimeString(undefined, opts) : "—";
}

// ── LOCAL column formatters (attendance, expenses, GRN, etc.) ──

/** Format a SQLite LOCAL timestamp as a locale date+time string */
export function fmtLocalDateTime(str) {
  const d = parseLocalDate(str);
  return d ? d.toLocaleString() : "—";
}

/** Format a SQLite LOCAL timestamp as a locale date string */
export function fmtLocalDate(str) {
  const d = parseLocalDate(str);
  return d ? d.toLocaleDateString() : "—";
}

/** Format a SQLite LOCAL timestamp as a locale time string */
export function fmtLocalTime(str, opts) {
  const d = parseLocalDate(str);
  return d ? d.toLocaleTimeString(undefined, opts) : "—";
}

// ── Backward-compatible aliases (point to UTC variants) ──
export const fmtDateTime = fmtUtcDateTime;
export const fmtDate = fmtUtcDate;
export const fmtTime = fmtUtcTime;
