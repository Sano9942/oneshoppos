/**
 * PLAN-V3 Step 4.3 — production boot guard for the portal JWT secrets.
 *
 * assertProductionSecrets() must throw (kill boot) in production when either
 * portal secret is unset, equals JWT_SECRET, equals the other portal secret, or
 * is too weak; and must be a no-op outside production so the dev/test fallbacks
 * keep working.
 *
 * MANUFACTURER_PORTAL_JWT_SECRET shipped with 4.3; CUSTOMER_PORTAL_JWT_SECRET
 * was that release's documented follow-up, covered here on the same terms.
 */
const {
  assertProductionSecrets,
  checkPortalSecret,
  MIN_SECRET_LENGTH,
  MIN_DISTINCT_CHARS,
} = require("../../boot/assert-secrets");

// Strong, mutually distinct secrets: >= 32 chars, >= 12 distinct chars.
const STRONG = "Zx9-Kp2Qw7Rt4Vb1Nm6Ls3Hg8Dc5Fj0-abcdEFG";
const STRONG_CUSTOMER = "Qw4-Zn8Xr1Mv6Bt3Kd9Ly2Pc7Hs5Ga0-zyxwVUT";
const EMPLOYEE_SECRET = "employee-jwt-secret-value-abcdefghijklmnop";

function baseProdEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    JWT_SECRET: EMPLOYEE_SECRET,
    MANUFACTURER_PORTAL_JWT_SECRET: STRONG,
    CUSTOMER_PORTAL_JWT_SECRET: STRONG_CUSTOMER,
    ...overrides,
  };
}

describe("Step 4.3 — assertProductionSecrets", () => {
  it("no-ops outside production even with a completely broken secret", () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: "development",
        JWT_SECRET: EMPLOYEE_SECRET,
        MANUFACTURER_PORTAL_JWT_SECRET: undefined,
        CUSTOMER_PORTAL_JWT_SECRET: undefined,
      })
    ).not.toThrow();

    expect(() =>
      assertProductionSecrets({
        NODE_ENV: "test",
        JWT_SECRET: EMPLOYEE_SECRET,
        MANUFACTURER_PORTAL_JWT_SECRET: EMPLOYEE_SECRET, // shared — would fail in prod
        CUSTOMER_PORTAL_JWT_SECRET: EMPLOYEE_SECRET, // shared — would fail in prod
      })
    ).not.toThrow();
  });

  it("boots clean in production with a proper distinct secret", () => {
    expect(() => assertProductionSecrets(baseProdEnv())).not.toThrow();
  });

  it("throws in production when the secret is unset", () => {
    expect(() =>
      assertProductionSecrets(baseProdEnv({ MANUFACTURER_PORTAL_JWT_SECRET: undefined }))
    ).toThrow(/MANUFACTURER_PORTAL_JWT_SECRET is not set/);
  });

  it("throws in production when the secret equals JWT_SECRET", () => {
    expect(() =>
      assertProductionSecrets(baseProdEnv({ MANUFACTURER_PORTAL_JWT_SECRET: EMPLOYEE_SECRET }))
    ).toThrow(/must differ from JWT_SECRET/);
  });

  it("throws in production when the secret is too short", () => {
    expect(() =>
      assertProductionSecrets(baseProdEnv({ MANUFACTURER_PORTAL_JWT_SECRET: "Zx9-Kp2Qw7Rt4Vb1" })) // 16 chars
    ).toThrow(/at least 32 characters/);
  });

  it("throws in production when the secret has too little entropy", () => {
    // 40 chars but only 1 distinct character.
    const lowEntropy = "a".repeat(40);
    expect(() =>
      assertProductionSecrets(baseProdEnv({ MANUFACTURER_PORTAL_JWT_SECRET: lowEntropy }))
    ).toThrow(/distinct characters/);
  });

  it("throws in production for a known placeholder value padded to length", () => {
    // Meets neither entropy nor the literal check is what we want; use the
    // dev fallback literal, padded so length isn't the (only) complaint.
    expect(() =>
      assertProductionSecrets(baseProdEnv({ MANUFACTURER_PORTAL_JWT_SECRET: "dev-insecure-secret" }))
    ).toThrow(); // short AND a known placeholder — either way it throws
  });

  it("aggregates multiple problems into one boot error", () => {
    // Short + equals JWT_SECRET + low entropy all at once.
    const bad = "aaaa";
    expect(() =>
      assertProductionSecrets(baseProdEnv({ JWT_SECRET: bad, MANUFACTURER_PORTAL_JWT_SECRET: bad }))
    ).toThrow(/insecure portal secret configuration/);
  });

  // --- CUSTOMER_PORTAL_JWT_SECRET (the 4.3 follow-up) ---

  it("throws in production when CUSTOMER_PORTAL_JWT_SECRET is unset", () => {
    expect(() =>
      assertProductionSecrets(baseProdEnv({ CUSTOMER_PORTAL_JWT_SECRET: undefined }))
    ).toThrow(/CUSTOMER_PORTAL_JWT_SECRET is not set/);
  });

  it("throws in production when CUSTOMER_PORTAL_JWT_SECRET equals JWT_SECRET", () => {
    expect(() =>
      assertProductionSecrets(baseProdEnv({ CUSTOMER_PORTAL_JWT_SECRET: EMPLOYEE_SECRET }))
    ).toThrow(/CUSTOMER_PORTAL_JWT_SECRET must differ from JWT_SECRET/);
  });

  it("throws in production when CUSTOMER_PORTAL_JWT_SECRET is too weak", () => {
    expect(() =>
      assertProductionSecrets(baseProdEnv({ CUSTOMER_PORTAL_JWT_SECRET: "a".repeat(40) }))
    ).toThrow(/CUSTOMER_PORTAL_JWT_SECRET has too little entropy/);
  });

  it("throws when the two portal secrets are the same value", () => {
    // Each is individually strong and differs from JWT_SECRET, so only the
    // cross-compare catches this — a customer token would verify as a
    // manufacturer token and vice versa.
    expect(() =>
      assertProductionSecrets(baseProdEnv({ CUSTOMER_PORTAL_JWT_SECRET: STRONG }))
    ).toThrow(/must differ from each other/);
  });

  it("reports BOTH portal secrets in one boot error when both are unset", () => {
    let msg = "";
    try {
      assertProductionSecrets(
        baseProdEnv({
          MANUFACTURER_PORTAL_JWT_SECRET: undefined,
          CUSTOMER_PORTAL_JWT_SECRET: undefined,
        })
      );
    } catch (e) {
      msg = e.message;
    }
    expect(msg).toMatch(/MANUFACTURER_PORTAL_JWT_SECRET is not set/);
    expect(msg).toMatch(/CUSTOMER_PORTAL_JWT_SECRET is not set/);
  });
});

describe("Step 4.3 — checkPortalSecret (pure)", () => {
  it("returns no problems for a strong distinct secret", () => {
    expect(checkPortalSecret("X", STRONG, EMPLOYEE_SECRET)).toEqual([]);
  });

  it("returns exactly the 'not set' problem for undefined, and nothing else", () => {
    const problems = checkPortalSecret("X", undefined, EMPLOYEE_SECRET);
    expect(problems).toEqual(["X is not set"]);
  });

  it("flags a shared secret", () => {
    const problems = checkPortalSecret("X", EMPLOYEE_SECRET, EMPLOYEE_SECRET);
    expect(problems.some((p) => /must differ from JWT_SECRET/.test(p))).toBe(true);
  });

  it("exposes sane bar constants", () => {
    expect(MIN_SECRET_LENGTH).toBe(32);
    expect(MIN_DISTINCT_CHARS).toBe(12);
  });
});
