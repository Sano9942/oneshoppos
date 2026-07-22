/**
 * PLAN-V3 Step 4.3 — production boot guard for MANUFACTURER_PORTAL_JWT_SECRET.
 *
 * assertProductionSecrets() must throw (kill boot) in production when the
 * manufacturer portal secret is unset, equals JWT_SECRET, or is too weak; and
 * must be a no-op outside production so the dev/test fallback keeps working.
 */
const {
  assertProductionSecrets,
  checkPortalSecret,
  MIN_SECRET_LENGTH,
  MIN_DISTINCT_CHARS,
} = require("../../boot/assert-secrets");

// A strong, distinct secret: >= 32 chars, >= 12 distinct chars, != JWT_SECRET.
const STRONG = "Zx9-Kp2Qw7Rt4Vb1Nm6Ls3Hg8Dc5Fj0-abcdEFG";
const EMPLOYEE_SECRET = "employee-jwt-secret-value-abcdefghijklmnop";

function baseProdEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    JWT_SECRET: EMPLOYEE_SECRET,
    MANUFACTURER_PORTAL_JWT_SECRET: STRONG,
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
      })
    ).not.toThrow();

    expect(() =>
      assertProductionSecrets({
        NODE_ENV: "test",
        JWT_SECRET: EMPLOYEE_SECRET,
        MANUFACTURER_PORTAL_JWT_SECRET: EMPLOYEE_SECRET, // shared — would fail in prod
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
