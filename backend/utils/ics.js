/**
 * Minimal RFC 5545 iCalendar (.ics) event builder.
 *
 * No external lib — kept tiny on purpose. Handles one VEVENT per call.
 * Emits UTC times (suffix `Z`) so the invite is unambiguous across
 * timezones. Values are escaped per RFC 5545 §3.3.11.
 */

const CRLF = "\r\n";

function escapeIcsText(value) {
  if (value == null) return "";
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\n");
}

function toIcsUtcStamp(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error("ics: invalid date input");
  }
  // YYYYMMDDTHHMMSSZ
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

/**
 * Fold long lines to 75 octets per RFC 5545 §3.1.
 * We approximate using character count, which is fine for ASCII output.
 */
function foldLine(line) {
  if (line.length <= 75) return line;
  const chunks = [];
  let i = 0;
  while (i < line.length) {
    const size = i === 0 ? 75 : 74;
    const chunk = line.slice(i, i + size);
    chunks.push(i === 0 ? chunk : " " + chunk);
    i += size;
  }
  return chunks.join(CRLF);
}

/**
 * Build an ICS string containing a single VEVENT.
 *
 * @param {object} opts
 * @param {string|number} opts.uid       — stable event identifier (required)
 * @param {Date|string}   opts.start     — event start (required)
 * @param {Date|string}   opts.end       — event end (required)
 * @param {string}        opts.summary   — event title (required)
 * @param {string}        [opts.description]
 * @param {string}        [opts.location]
 * @param {Date|string}   [opts.dtstamp] — default: now
 * @param {string}        [opts.prodId]  — default: "-//SanoPOS//Bookings//EN"
 * @returns {string} ICS text (CRLF line endings)
 */
function buildIcsEvent(opts) {
  if (!opts || !opts.uid || !opts.start || !opts.end || !opts.summary) {
    throw new Error("ics: uid, start, end, summary are required");
  }
  const prodId = opts.prodId || "-//SanoPOS//Bookings//EN";
  const dtstamp = toIcsUtcStamp(opts.dtstamp || new Date());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${escapeIcsText(prodId)}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(opts.uid)}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${toIcsUtcStamp(opts.start)}`,
    `DTEND:${toIcsUtcStamp(opts.end)}`,
    `SUMMARY:${escapeIcsText(opts.summary)}`,
  ];
  if (opts.description) lines.push(`DESCRIPTION:${escapeIcsText(opts.description)}`);
  if (opts.location) lines.push(`LOCATION:${escapeIcsText(opts.location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(foldLine).join(CRLF) + CRLF;
}

/**
 * Build an ICS calendar containing MANY VEVENTs (subscription feed).
 *
 * @param {object} opts
 * @param {Array}  opts.events   — [{ uid, start, end, summary, description?, location? }]
 * @param {string} [opts.calName] — X-WR-CALNAME shown by calendar clients
 * @param {string} [opts.prodId]
 * @returns {string} ICS text (CRLF line endings)
 */
function buildIcsFeed(opts) {
  const events = (opts && opts.events) || [];
  const prodId = (opts && opts.prodId) || "-//SanoPOS//Bookings//EN";
  const dtstamp = toIcsUtcStamp(new Date());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${escapeIcsText(prodId)}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  if (opts && opts.calName) lines.push(`X-WR-CALNAME:${escapeIcsText(opts.calName)}`);
  for (const ev of events) {
    if (!ev || !ev.uid || !ev.start || !ev.end || !ev.summary) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(ev.uid)}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${toIcsUtcStamp(ev.start)}`,
      `DTEND:${toIcsUtcStamp(ev.end)}`,
      `SUMMARY:${escapeIcsText(ev.summary)}`
    );
    if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}

module.exports = { buildIcsEvent, buildIcsFeed, escapeIcsText, toIcsUtcStamp };
