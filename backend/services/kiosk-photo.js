/**
 * kiosk-photo.js — One Toy Store pilot F3b part 3b: a photo on every kiosk press.
 *
 * Owner 2026-10-01 (PHASE-F-PLAN F3b Q3b.8, Q3b.17, Q3b.18): against PIN
 * sharing, the kiosk takes a photo at clock in, break, back and clock out.
 * A failed camera never blocks the press: it is saved with photo_url NULL and
 * the register shows it as "no photo" in red.
 *
 * Photos go to R2 (not the database: prod is on Supabase Free, 500 MB) under
 * attendance/<tenant>/<employee>/<random>.jpg. The URL is only ever handed
 * out by the owner's register endpoint, signed on the way out
 * (middleware/sign-media-urls.js). Without R2: outside production the file is
 * written under <DATA_DIR>/uploads so a local demo can show it; in production
 * no photo is kept rather than putting staff faces on a public path.
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { uploadToR2, r2 } = require("../utils/r2");

const PRESS_DDL = `
CREATE TABLE IF NOT EXISTS attendance_presses (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  outlet_id INTEGER REFERENCES outlets(id),
  action TEXT NOT NULL CHECK (action IN ('in','break','back','out')),
  session_id INTEGER REFERENCES attendance_sessions(id) ON DELETE SET NULL,
  photo_url TEXT,
  pressed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attendance_presses_emp_time ON attendance_presses(employee_id, pressed_at);
`;

// The kiosk compresses to ~100 KB; anything past this is not our camera.
const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Parse a data URL from the kiosk camera. Returns null if it isn't an image. */
function parsePhoto(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl) return null;
  const m = dataUrl.match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = IMAGE_TYPES[mime];
  if (!ext) return null;
  const buffer = Buffer.from(m[2], "base64");
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) return null;
  return { mime, ext, buffer };
}

function localBaseUrl() {
  return (process.env.APP_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, "");
}

/**
 * Store a kiosk photo. Never throws: returns the URL, or null when there is
 * no usable photo or storing it failed (the press still goes through).
 */
async function storePhoto(dataUrl, { tenantSlug, employeeId, log }) {
  const photo = parsePhoto(dataUrl);
  if (!photo) return null;
  const rel = `attendance/${tenantSlug || "default"}/${employeeId}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${photo.ext}`;
  try {
    if (r2) return await uploadToR2(photo.buffer, rel, photo.mime);
    if (process.env.NODE_ENV === "production") {
      log?.warn?.("Kiosk photo not kept: R2 is not configured");
      return null;
    }
    const dir = path.resolve(process.env.DATA_DIR || path.join(__dirname, ".."), "uploads");
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, photo.buffer);
    return `${localBaseUrl()}/uploads/${rel}`;
  } catch (e) {
    log?.warn?.({ err: e.message }, "Kiosk photo upload failed; press kept without photo");
    return null;
  }
}

/** Record one kiosk press (after it succeeded). Never throws. */
async function recordPress(db, { employeeId, outletId, action, sessionId, photoUrl, log }) {
  try {
    await db.query(
      `INSERT INTO attendance_presses (employee_id, outlet_id, action, session_id, photo_url)
       VALUES ($1, $2, $3, $4, $5)`,
      [employeeId, outletId || null, action, sessionId || null, photoUrl || null],
    );
  } catch (e) {
    log?.warn?.({ err: e.message }, "Kiosk press not recorded");
  }
}

module.exports = { PRESS_DDL, parsePhoto, storePhoto, recordPress, MAX_PHOTO_BYTES };
