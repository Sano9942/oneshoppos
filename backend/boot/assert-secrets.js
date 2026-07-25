/**
 * assert-secrets.js — production boot guard for portal JWT secrets.
 *
 * Fail-closed startup assertion, mirroring the ensureCriticalRoutesRegistered
 * posture (throw + kill boot) — deliberately NOT the console.error-and-continue
 * posture, which fails open and only warns.
 *
 * Background (PLAN-V3 Step 4.3): each portal signs its JWTs with a dedicated
 * secret. When that var is unset, the portal's auth middleware used to silently
 * fall back to JWT_SECRET — the same key that signs employee access tokens.
 * That both weakens scope isolation and lets the config error recur invisibly
 * in every environment that forgets to set the var. Setting the env var fixes
 * today; this guard makes forgetting it fatal, so the error can't recur
 * silently.
 *
 * The guard is a no-op outside production (NODE_ENV !== "production"), so the
 * dev/test fallbacks in manufacturer-auth.js/customer-auth.js:getSecret() still
 * work.
 *
 * Coverage: BOTH portal secrets. MANUFACTURER_PORTAL_JWT_SECRET landed with 4.3;
 * CUSTOMER_PORTAL_JWT_SECRET was that release's documented follow-up and is
 * covered here on the same terms (both vars are set on prod today — this guard
 * keeps them that way).
 */

const MIN_SECRET_LENGTH = 32;
const MIN_DISTINCT_CHARS = 12;

// Obvious placeholder values that clear the length bar but carry no real
// entropy. `dev-insecure-secret` is the portal middlewares' own dev fallback.
const WEAK_LITERALS = new Set([
  "dev-insecure-secret",
  "changeme",
  "change-me",
  "secret",
  "password",
]);

function distinctCharCount(s) {
  return new Set(s.split("")).size;
}

/**
 * Check one required portal secret. Returns an array of human-readable problems
 * (empty array = OK) rather than throwing, so a caller can aggregate several
 * secrets into one boot error.
 *
 * @param {string} name — env var name, for the message
 * @param {string|undefined} value — the secret value
 * @param {string|undefined} employeeSecret — JWT_SECRET, which it must differ from
 * @returns {string[]} problems
 */
function checkPortalSecret(name, value, employeeSecret) {
  const problems = [];
  if (!value) {
    problems.push(`${name} is not set`);
    return problems; // nothing else is checkable
  }
  if (employeeSecret && value === employeeSecret) {
    problems.push(
      `${name} must differ from JWT_SECRET (sharing the employee-token secret defeats scope isolation)`
    );
  }
  if (value.length < MIN_SECRET_LENGTH) {
    problems.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters (got ${value.length})`);
  }
  if (distinctCharCount(value) < MIN_DISTINCT_CHARS) {
    problems.push(`${name} has too little entropy (needs >= ${MIN_DISTINCT_CHARS} distinct characters)`);
  }
  if (WEAK_LITERALS.has(value)) {
    problems.push(`${name} is a known placeholder value`);
  }
  return problems;
}

/**
 * Production boot guard. No-op unless NODE_ENV === "production". Throws an Error
 * listing every problem when a required secret is missing, shared with
 * JWT_SECRET, or too weak. Kills boot by design — the deploy fails until the
 * secret is set correctly.
 *
 * @param {object} [env=process.env] — injectable for testing
 */
function assertProductionSecrets(env = process.env) {
  if (env.NODE_ENV !== "production") return;

  const problems = [
    ...checkPortalSecret(
      "MANUFACTURER_PORTAL_JWT_SECRET",
      env.MANUFACTURER_PORTAL_JWT_SECRET,
      env.JWT_SECRET
    ),
    ...checkPortalSecret(
      "CUSTOMER_PORTAL_JWT_SECRET",
      env.CUSTOMER_PORTAL_JWT_SECRET,
      env.JWT_SECRET
    ),
  ];

  // Two portal secrets sharing ONE value is the same scope-isolation failure as
  // either sharing JWT_SECRET — checkPortalSecret only compares against
  // JWT_SECRET, so cross-compare them here.
  if (
    env.MANUFACTURER_PORTAL_JWT_SECRET &&
    env.MANUFACTURER_PORTAL_JWT_SECRET === env.CUSTOMER_PORTAL_JWT_SECRET
  ) {
    problems.push(
      "MANUFACTURER_PORTAL_JWT_SECRET and CUSTOMER_PORTAL_JWT_SECRET must differ from each other"
    );
  }

  if (problems.length) {
    throw new Error(
      "Production boot aborted — insecure portal secret configuration:\n  - " +
        problems.join("\n  - ")
    );
  }
}

module.exports = {
  assertProductionSecrets,
  checkPortalSecret,
  MIN_SECRET_LENGTH,
  MIN_DISTINCT_CHARS,
  WEAK_LITERALS,
};
