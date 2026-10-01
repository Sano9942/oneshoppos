// One Toy Store pilot F3b part 3a (owner, 2026-10-01): sign-in needs a password,
// for everyone. A PIN is for the kiosk clock-in, the till's lock screen and
// manager approvals only; none of those hand out a login.
//
// Before this, /api/auth/login and /api/auth/mt-login took name + PIN for anyone
// without a password, so a no-permission staff member could sign in and ring
// sales. Both routes share this check so they can't drift apart again.

const bcrypt = require("bcryptjs");

const NO_PASSWORD_ERROR =
  "No password set for this person. Use the kiosk to clock in; ask the owner to set a password to sign in.";

async function checkLoginCredentials(employee, { password } = {}) {
  if (!employee.password_hash) {
    return { ok: false, error: NO_PASSWORD_ERROR };
  }
  if (!password) {
    return { ok: false, error: "Please use your password to log in" };
  }
  const ok = await bcrypt.compare(String(password), employee.password_hash);
  return ok ? { ok: true } : { ok: false, error: "Invalid credentials" };
}

module.exports = { checkLoginCredentials, NO_PASSWORD_ERROR };
