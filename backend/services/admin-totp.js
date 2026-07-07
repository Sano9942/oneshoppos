/**
 * services/admin-totp.js — Super-admin TOTP 2FA helpers (Batch B1).
 *
 * Thin, dependency-injectable wrapper around otplib (RFC 6238 TOTP) plus
 * one-time recovery codes. No DB access here — the caller owns persistence
 * (super_admins.totp_secret / totp_enabled_at / recovery_codes).
 *
 * Recovery codes are stored as bcrypt hashes (never plaintext) and are
 * single-use: verifyRecoveryCode returns the matched index so the caller can
 * burn exactly that entry.
 */
const { authenticator } = require("otplib");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

// A one-step (±30s) clock skew window is the widely-accepted default — it
// tolerates a slightly slow/fast authenticator app without meaningfully
// widening the brute-force surface (the totp endpoint is also hard rate-limited).
authenticator.options = { window: 1 };

const ISSUER = "SanoPOS Admin";
const RECOVERY_CODE_COUNT = 10;

/** Generate a fresh base32 TOTP secret. */
function generateSecret() {
  return authenticator.generateSecret();
}

/** Build the otpauth:// provisioning URI for QR rendering / manual entry. */
function keyUri(secret, accountEmail) {
  return authenticator.keyuri(accountEmail, ISSUER, secret);
}

/** Verify a 6-digit TOTP code against a secret. Returns boolean, never throws. */
function verifyToken(token, secret) {
  if (!token || !secret) return false;
  try {
    return authenticator.verify({ token: String(token).trim(), secret });
  } catch (_) {
    return false;
  }
}

/**
 * Generate N recovery codes.
 * @returns {Promise<{ plain: string[], hashes: string[] }>}
 *   plain — shown to the admin exactly once; hashes — persisted.
 */
async function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const plain = [];
  const hashes = [];
  for (let i = 0; i < count; i++) {
    // 10 hex chars, dash-grouped for readability: e.g. "a1b2c-3d4e5"
    const raw = crypto.randomBytes(5).toString("hex");
    const code = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    plain.push(code);
    hashes.push(await bcrypt.hash(code, 10));
  }
  return { plain, hashes };
}

/**
 * Check a candidate recovery code against the stored hash array.
 * @returns {Promise<number>} matched index (to be burned), or -1 if no match.
 */
async function verifyRecoveryCode(candidate, hashes) {
  if (!candidate || !Array.isArray(hashes)) return -1;
  const norm = String(candidate).trim().toLowerCase();
  for (let i = 0; i < hashes.length; i++) {
    if (!hashes[i]) continue;
    try {
      if (await bcrypt.compare(norm, hashes[i])) return i;
    } catch (_) { /* skip malformed hash */ }
  }
  return -1;
}

module.exports = {
  ISSUER,
  RECOVERY_CODE_COUNT,
  generateSecret,
  keyUri,
  verifyToken,
  generateRecoveryCodes,
  verifyRecoveryCode,
};
