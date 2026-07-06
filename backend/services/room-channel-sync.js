"use strict";

/**
 * iCal channel sync (V10 — the pragmatic PK channel manager v1).
 *
 * Export: per room/room-type signed iCal feed (bookings as all-day VEVENTs)
 * that OTAs/Google Calendar poll. Generated from LIVE state on every request
 * — a cancelled or no-show booking drops from the feed on the OTA's next
 * poll, never cached server-side.
 *
 * Import: per-room OTA iCal URLs polled by workers/channel-sync-worker-boss.js.
 * External events land in `channel_blocks`, which checkRoomAvailability
 * treats as occupancy. An external event overlapping a LOCAL booking is a
 * conflict — dead-lettered (`channel_sync_dead_letters`) + in-app notification
 * + staff email, never silent.
 *
 * Full Booking.com/Hostelworld API connectivity is explicitly OUT of v1
 * (partner-program gated) — surfaces must say "iCal sync" honestly.
 */

const crypto = require("crypto");
const logger = require("./logger").child({ component: "room-channel-sync" });
const { buildIcsFeed } = require("../utils/ics");

const FETCH_TIMEOUT_MS = 10_000;
const MAX_FEED_BYTES = 1_000_000; // 1MB — an availability calendar is tiny
// A feed that hasn't successfully synced in this window is stale — surface it.
const FEED_STALE_MINUTES = 60;

// ── ICS parsing (import) ──────────────────────────────────────────

/** Unfold RFC 5545 folded lines (CRLF + single space/tab continuation). */
function unfoldIcsLines(text) {
  return String(text)
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
}

/**
 * Convert a DTSTART/DTEND value into a YYYY-MM-DD date for the block table.
 * VALUE=DATE values map directly (DTEND already exclusive). Datetime values:
 * start truncates to its date; an end with a time-of-day past midnight rounds
 * UP to the next date so the room stays blocked through the last night.
 */
function icsValueToDate(value, { isEnd = false } = {}) {
  if (!value) return null;
  const m = String(value).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  let date = `${y}-${mo}-${d}`;
  if (isEnd && hh !== undefined && (Number(hh) > 0 || Number(mm) > 0)) {
    const dt = new Date(`${date}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + 1);
    date = dt.toISOString().slice(0, 10);
  }
  return date;
}

/** Parse VEVENTs out of an ICS document → [{ uid, start_date, end_date, summary }]. */
function parseIcsEvents(text) {
  const lines = unfoldIcsLines(text);
  const events = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur && cur.uid && cur.start_date && cur.end_date) {
        // Zero/negative-length events can't block anything.
        if (cur.end_date > cur.start_date) events.push(cur);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const keyPart = line.slice(0, idx).toUpperCase();
    const value = line.slice(idx + 1);
    const key = keyPart.split(";")[0];
    if (key === "UID") cur.uid = value.trim();
    else if (key === "DTSTART") cur.start_date = icsValueToDate(value);
    else if (key === "DTEND") cur.end_date = icsValueToDate(value, { isEnd: true });
    else if (key === "SUMMARY") cur.summary = value.trim().slice(0, 500);
  }
  return events;
}

// ── Feed CRUD helpers ─────────────────────────────────────────────

function generateFeedSecret() {
  return crypto.randomBytes(24).toString("hex"); // 48 hex chars — unguessable
}

async function getFeedBySecret(db, secret) {
  const { rows: [feed] } = await db.query(
    "SELECT * FROM room_channel_feeds WHERE secret = $1 AND direction = 'export' AND is_active = TRUE",
    [secret]
  );
  return feed || null;
}

// ── Export feed (live state) ──────────────────────────────────────

/**
 * Build the ICS text for an export feed. Reads live booking state — includes
 * reserved (unexpired), confirmed and checked_in stays; cancelled/no-show/
 * checked-out stays drop out automatically.
 */
async function buildExportFeed(db, feed) {
  const params = [];
  let idx = 0;
  let where = `b.status IN ('reserved','confirmed','checked_in')
    AND NOT (
      b.status = 'reserved'
      AND b.expires_at IS NOT NULL AND b.expires_at < NOW()
      AND b.deposit_status NOT IN ('authorized','captured')
    )
    AND b.check_out_date >= CURRENT_DATE - INTERVAL '7 days'`;
  if (feed.room_id) {
    idx++;
    where += ` AND b.room_id = $${idx}`;
    params.push(Number(feed.room_id));
  } else if (feed.room_type_id) {
    idx++;
    where += ` AND (b.room_type_id = $${idx} OR r.room_type_id = $${idx})`;
    params.push(Number(feed.room_type_id));
  }
  const { rows: bookings } = await db.query(
    `SELECT b.booking_number, b.check_in_date, b.check_out_date, r.room_number
       FROM room_bookings b LEFT JOIN rooms r ON r.id = b.room_id
      WHERE ${where}
      ORDER BY b.check_in_date ASC`,
    params
  );
  // pg DATE → JS Date at LOCAL midnight; toISOString() would shift a day back
  // on UTC+ servers. Use local components.
  const normDate = (d) => {
    if (d instanceof Date) {
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    return String(d).slice(0, 10);
  };
  return buildIcsFeed({
    calName: feed.name || "SanoPOS availability",
    prodId: "-//SanoPOS//RoomChannelSync//EN",
    events: bookings.map((b) => ({
      uid: `${b.booking_number}@sanopos`,
      start: normDate(b.check_in_date),
      end: normDate(b.check_out_date),
      allDay: true,
      // Never leak guest identity to an OTA feed — booking number only.
      summary: `Booked${b.room_number ? " — " + b.room_number : ""} (${b.booking_number})`,
    })),
  });
}

// ── Import sync ───────────────────────────────────────────────────

async function fetchFeedText(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Feed URL must be http(s)");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`Feed fetch failed: HTTP ${res.status}`);
    const text = await res.text();
    if (Buffer.byteLength(text) > MAX_FEED_BYTES) throw new Error("Feed exceeds 1MB cap");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sync ONE import feed: upsert its events into channel_blocks, drop blocks
 * whose external UID disappeared from the feed, and dead-letter any external
 * event that overlaps a live LOCAL booking on the same room.
 *
 * Returns { events, upserted, removed, conflicts } and stamps the feed row's
 * last_synced_at/last_status/last_error either way.
 */
async function syncImportFeed(db, feed, deps = {}) {
  const result = { feed_id: feed.id, events: 0, upserted: 0, removed: 0, conflicts: 0 };
  try {
    const text = await fetchFeedText(feed.url);
    const events = parseIcsEvents(text);
    result.events = events.length;

    const newConflicts = await db.transaction(async (client) => {
      const seenUids = [];
      const conflictsCreated = [];
      for (const ev of events) {
        seenUids.push(ev.uid);
        await client.query(
          `INSERT INTO channel_blocks (source_feed_id, room_id, external_uid, start_date, end_date, summary)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (source_feed_id, external_uid)
           DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
                         summary = EXCLUDED.summary, updated_at = NOW()`,
          [feed.id, feed.room_id, ev.uid, ev.start_date, ev.end_date, ev.summary || null]
        );
        result.upserted++;

        // Conflict: this external event overlaps a live local booking on the
        // same room → double-booked. Dead-letter, never silent.
        const { rows: overlapping } = await client.query(
          `SELECT b.id, b.booking_number FROM room_bookings b
            WHERE b.room_id = $1
              AND b.status IN ('reserved','confirmed','checked_in')
              AND NOT (
                b.status = 'reserved'
                AND b.expires_at IS NOT NULL AND b.expires_at < NOW()
                AND b.deposit_status NOT IN ('authorized','captured')
              )
              AND b.check_in_date < $3 AND b.check_out_date > $2`,
          [feed.room_id, ev.start_date, ev.end_date]
        );
        for (const b of overlapping) {
          const { rows: [dl] } = await client.query(
            `INSERT INTO channel_sync_dead_letters
               (feed_id, external_uid, start_date, end_date, summary, reason, conflicting_booking_id, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
             ON CONFLICT (feed_id, external_uid, conflicting_booking_id)
             DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
                           summary = EXCLUDED.summary, updated_at = NOW()
             RETURNING (xmax = 0) AS is_new, id`,
            [
              feed.id, ev.uid, ev.start_date, ev.end_date, ev.summary || null,
              `External ${feed.channel_name || "OTA"} event overlaps local booking ${b.booking_number}`,
              b.id,
            ]
          );
          result.conflicts++;
          if (dl && dl.is_new) conflictsCreated.push({ dead_letter_id: dl.id, booking_number: b.booking_number, event: ev });
        }
      }

      // Events removed upstream release their blocks.
      const { rowCount } = seenUids.length
        ? await client.query(
            "DELETE FROM channel_blocks WHERE source_feed_id = $1 AND NOT (external_uid = ANY($2))",
            [feed.id, seenUids]
          )
        : await client.query("DELETE FROM channel_blocks WHERE source_feed_id = $1", [feed.id]);
      result.removed = rowCount || 0;

      await client.query(
        "UPDATE room_channel_feeds SET last_synced_at = NOW(), last_status = 'ok', last_error = NULL WHERE id = $1",
        [feed.id]
      );
      return conflictsCreated;
    });

    // Urgent notification for NEW conflicts only (repeat polls stay quiet).
    for (const c of newConflicts) {
      try {
        await db.query(
          "INSERT INTO notifications (type, title, message, link) VALUES ($1, $2, $3, $4)",
          [
            "channel_conflict",
            "Channel sync conflict — possible double booking",
            `An OTA calendar event (${c.event.start_date} → ${c.event.end_date}) overlaps local booking ${c.booking_number}. Resolve it on the Channels page.`,
            "/rooms",
          ]
        );
      } catch { /* notifications table variance — non-fatal */ }
      if (deps.enqueueEmail && deps.staffEmail) {
        try {
          await deps.enqueueEmail(null, {
            type: "channel_sync_conflict",
            to: deps.staffEmail,
            tenant: deps.tenant,
            data: {
              tenantSlug: deps.tenantSlug,
              storeName: deps.storeName,
              bookingNumber: c.booking_number,
              startDate: c.event.start_date,
              endDate: c.event.end_date,
              feedName: feed.name || feed.channel_name || "OTA feed",
            },
            priority: 5,
          });
        } catch (err) {
          logger.warn({ err: err.message }, "conflict email enqueue failed");
        }
      }
    }
    return result;
  } catch (err) {
    try {
      await db.query(
        "UPDATE room_channel_feeds SET last_synced_at = NOW(), last_status = 'error', last_error = $2 WHERE id = $1",
        [feed.id, String(err.message || err).slice(0, 500)]
      );
    } catch { /* feed stamp is best-effort */ }
    return { ...result, error: err.message };
  }
}

/** Sync every active import feed for one tenant DB. */
async function syncAllImportFeeds(db, deps = {}) {
  const { rows: feeds } = await db.query(
    "SELECT * FROM room_channel_feeds WHERE direction = 'import' AND is_active = TRUE"
  );
  const results = [];
  for (const feed of feeds) {
    results.push(await syncImportFeed(db, feed, deps));
  }
  return results;
}

module.exports = {
  parseIcsEvents,
  icsValueToDate,
  generateFeedSecret,
  getFeedBySecret,
  buildExportFeed,
  syncImportFeed,
  syncAllImportFeeds,
  FEED_STALE_MINUTES,
};
