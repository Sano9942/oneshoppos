/**
 * Parse a SQLite UTC timestamp string (e.g. "2026-03-06 08:56:04")
 * into a JS Date object, correctly treating it as UTC.
 *
 * SQLite CURRENT_TIMESTAMP has no 'T' separator and no 'Z' suffix,
 * so plain `new Date(str)` is parsed as LOCAL time by browsers — wrong.
 */
export function parseDbDate(str) {
  if (!str) return new Date();
  // "2026-03-06 08:56:04" → "2026-03-06T08:56:04Z"
  return new Date(String(str).replace(' ', 'T') + 'Z');
}

/** Format a SQLite UTC timestamp as a locale date+time string */
export function fmtDateTime(str) {
  return parseDbDate(str).toLocaleString();
}

/** Format a SQLite UTC timestamp as a locale date string */
export function fmtDate(str) {
  return parseDbDate(str).toLocaleDateString();
}

/** Format a SQLite UTC timestamp as a locale time string */
export function fmtTime(str, opts) {
  return parseDbDate(str).toLocaleTimeString(undefined, opts);
}
