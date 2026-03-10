/**
 * jwt-auth.js — JWT utilities for signing, verifying, and refreshing tokens.
 *
 * Used by routes/auth.js and index.js middleware.
 * All functions are pure (no DB access) — DB calls live in the caller.
 */
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const defaults = {
  accessExpiresIn: process.env.JWT_EXPIRES_IN || "24h",
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
};

/**
 * Sign an access token.
 * @param {{ tid: number, eid: number, rid: number, oid: number|null, scope?: string }} payload
 * @param {string} secret — JWT_SECRET env var
 * @returns {string} signed JWT
 */
function signAccessToken(payload, secret) {
  return jwt.sign(
    { tid: payload.tid, eid: payload.eid, rid: payload.rid, oid: payload.oid || null, scope: payload.scope || "full", jti: crypto.randomUUID() },
    secret,
    { expiresIn: defaults.accessExpiresIn }
  );
}

/**
 * Sign a refresh token and return both the raw token and its SHA-256 hash.
 * The hash is stored in DB; the raw token is sent to the client (httpOnly cookie).
 * @param {{ tid: number, eid: number }} payload
 * @param {string} secret — JWT_REFRESH_SECRET env var
 * @returns {{ token: string, hash: string, expiresAt: string }}
 */
function signRefreshToken(payload, secret) {
  const token = jwt.sign(
    { tid: payload.tid, eid: payload.eid, type: "refresh" },
    secret,
    { expiresIn: defaults.refreshExpiresIn }
  );
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  // Calculate expiry for DB storage
  const decoded = jwt.decode(token);
  const expiresAt = new Date(decoded.exp * 1000).toISOString();
  return { token, hash, expiresAt };
}

/**
 * Verify an access token.
 * @param {string} token
 * @param {string} secret
 * @returns {{ tid: number, eid: number, rid: number, oid: number|null, scope: string }}
 * @throws {jwt.JsonWebTokenError | jwt.TokenExpiredError}
 */
function verifyAccessToken(token, secret) {
  return jwt.verify(token, secret);
}

/**
 * Verify a refresh token.
 * @param {string} token
 * @param {string} secret
 * @returns {{ tid: number, eid: number, type: string }}
 * @throws {jwt.JsonWebTokenError | jwt.TokenExpiredError}
 */
function verifyRefreshToken(token, secret) {
  return jwt.verify(token, secret);
}

/**
 * Hash a refresh token for DB storage.
 * @param {string} token
 * @returns {string} SHA-256 hex hash
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  defaults,
};
