/**
 * media-url.js — short-lived signatures for the /r2/<key> proxy.
 *
 * WHY THIS EXISTS
 *
 * uploadToR2() writes an absolute `${APP_PUBLIC_BASE_URL}/r2/<key>` URL into a
 * database column, and the UI renders those columns straight into <img src> and
 * <a href>. The proxy served exactly three prefixes (products/, company/,
 * support/) and 404'd everything else, so eleven prefixes' worth of uploaded
 * files — clinical documents, consent signatures, guest ID scans, field-rep
 * selfies, service-record photos, repair-ticket device photos, handouts,
 * project galleries, receipt logos, invoice photos, proof-of-delivery
 * signatures, form signatures, scheduled report exports — were silently broken
 * in production.
 *
 * WHY NOT JUST WIDEN THE ALLOWLIST
 *
 * Because a prefix cannot express "belongs to this tenant". Four of the
 * prefixes key on a bare row id with no tenant segment — clinical/<planId>/,
 * consents/<planId>/, service-records/<recordId>/, tickets/<ticketId>/ — so
 * plan 42 in one tenant and plan 42 in another share a directory. Adding them
 * to the allowlist would publish clinical attachments and CNIC scans to anyone
 * holding the URL.
 *
 * WHY NOT AN AUTHENTICATED ROUTE
 *
 * Because <img src> cannot carry the Authorization header. AuthProvider patches
 * window.fetch, not image loading, so a Bearer-guarded media route would force
 * every render site to fetch-to-blob. That is the same trap the Import page's
 * <a href> template download hit (401 AUTH_REQUIRED, fixed by moving to
 * fetch+blob) and it would have to be solved a dozen more times, once per
 * render site, forever.
 *
 * WHAT THIS DOES INSTEAD
 *
 * The read endpoints that return these columns already sit behind permission
 * gates. So when a response carries a media URL, middleware/sign-media-urls.js
 * stamps it with an expiry and an HMAC on the way out. The proxy verifies the
 * signature instead of consulting an allowlist. The authorisation decision is
 * the gate the row already passed; the signature is only proof that the API
 * released this key to someone who passed it.
 *
 * The signing key is derived from JWT_SECRET rather than being its own env var,
 * deliberately: a new required secret would crash boot on every environment
 * that has not set it yet, and the failure would land at deploy time on an
 * unrelated change. Domain separation via the HKDF-style info string keeps a
 * media signature from being interchangeable with anything else signed by the
 * same secret. Rotating JWT_SECRET invalidates outstanding media URLs, which is
 * correct — that rotation is a "assume everything leaked" event.
 */
const crypto = require("crypto");

// Signature lifetime. Long enough that a page left open, or a list rendered
// before a slow image loads, does not break; short enough that a URL leaked
// into a referrer header, a screenshot or a support ticket stops working.
// The URL is only ever handed to a caller who already passed the row's
// permission gate, so this bounds accidental spread rather than access.
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

// Never signable, at any callsite, for any reason. backups/ holds full pg_dump
// archives spanning every tenant. It is excluded from the proxy's public
// prefixes too — this is the second, independent guard, so a mistake in the
// response middleware cannot mint a working backup URL.
const NEVER_SIGN = ["backups/"];

let cachedKey = null;

/**
 * Derive the media signing key from JWT_SECRET.
 *
 * @returns {Buffer}
 * @throws when JWT_SECRET is absent in production
 */
function signingKey() {
  if (cachedKey) return cachedKey;
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET is required to sign media URLs");
    }
    // Non-production only. Deterministic so a dev/test run can verify what it
    // signed; useless anywhere real because production throws above.
    cachedKey = crypto.createHmac("sha256", "insecure-dev-only").update("sanopos-media-url-v1").digest();
    return cachedKey;
  }
  cachedKey = crypto.createHmac("sha256", secret).update("sanopos-media-url-v1").digest();
  return cachedKey;
}

/** Test seam — forget the derived key so a changed JWT_SECRET takes effect. */
function resetSigningKey() {
  cachedKey = null;
}

/** True when this key must never be handed out through the proxy. */
function isNeverSignable(key) {
  return NEVER_SIGN.some((p) => key.startsWith(p));
}

/**
 * Compute the signature for a key/expiry pair.
 * The key is bound into the MAC, so a signature cannot be moved to another
 * object, and so is the expiry, so it cannot be extended.
 *
 * @param {string} key - R2 object key, e.g. "clinical/42/doc_x.pdf"
 * @param {number} exp - expiry, epoch ms
 * @returns {string} hex signature
 */
function computeSignature(key, exp) {
  return crypto.createHmac("sha256", signingKey()).update(`${key}\n${exp}`).digest("hex").slice(0, 32);
}

/**
 * Verify a signature presented to the proxy.
 * Constant-time compare; rejects expired, malformed and never-signable keys.
 *
 * @param {string} key
 * @param {string|number} exp
 * @param {string} sig
 * @returns {boolean}
 */
function verifySignature(key, exp, sig) {
  if (!key || !exp || !sig) return false;
  if (isNeverSignable(key)) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false;
  let expected;
  try {
    expected = computeSignature(key, expNum);
  } catch {
    return false;
  }
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Append a signature to a stored media URL.
 *
 * Returns the input unchanged when it is not a proxy URL, when it is already
 * signed, or when the key must never be signed — callers treat this as a pure
 * string rewrite and must not have to special-case any of those.
 *
 * @param {string} url    - absolute URL of the form <base>/r2/<key>
 * @param {number} [ttlMs]
 * @returns {string}
 */
function signMediaUrl(url, ttlMs = DEFAULT_TTL_MS) {
  if (typeof url !== "string") return url;
  const marker = "/r2/";
  const at = url.indexOf(marker);
  if (at === -1) return url;
  if (url.includes("sig=")) return url;
  const key = url.slice(at + marker.length).split("?")[0];
  if (!key || isNeverSignable(key)) return url;
  const exp = Date.now() + ttlMs;
  let sig;
  try {
    sig = computeSignature(key, exp);
  } catch {
    // Production without JWT_SECRET cannot boot, so this is a non-production
    // edge. Returning the URL unsigned keeps the response shape intact; the
    // proxy will 404 it, which is the safe direction.
    return url;
  }
  return `${url}${url.includes("?") ? "&" : "?"}exp=${exp}&sig=${sig}`;
}

module.exports = {
  signMediaUrl,
  verifySignature,
  computeSignature,
  isNeverSignable,
  resetSigningKey,
  DEFAULT_TTL_MS,
  NEVER_SIGN,
};
