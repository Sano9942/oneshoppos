/**
 * One Toy Store clock-in (owner 2026-10-20): the kiosk finds the person by PIN
 * alone (POST /api/attendance/pin-checkin), so a PIN may belong to only one
 * employee who isn't deleted. PINs are bcrypt-hashed, so the only way to know
 * is to compare against each one (a shop has a handful of staff).
 */
const bcrypt = require("bcryptjs");

const PIN_TAKEN = { code: "PIN_TAKEN", error: "This PIN is already used by another staff member." };

/** true when another (not deleted) employee already has this PIN. */
async function pinTakenByOther(db, pin, exceptId = null) {
  if (pin == null || String(pin) === "") return false;
  const { rows } = await db.query(
    `SELECT id, pin_hash, pin_code FROM employees
     WHERE deleted_at IS NULL AND (pin_hash IS NOT NULL OR pin_code IS NOT NULL) AND ($1::int IS NULL OR id <> $1)`,
    [exceptId == null ? null : Number(exceptId)]
  );
  for (const row of rows) {
    if (row.pin_code && String(row.pin_code) === String(pin)) return true;
    if (row.pin_hash) {
      try {
        if (await bcrypt.compare(String(pin), row.pin_hash)) return true;
      } catch (_) { /* a malformed hash is nobody's PIN */ }
    }
  }
  return false;
}

module.exports = { pinTakenByOther, PIN_TAKEN };
