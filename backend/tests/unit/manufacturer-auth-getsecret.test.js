/**
 * PLAN-V3 Step 4.3 — manufacturer-auth.js:getSecret() production-fallback removal.
 *
 * In production the manufacturer portal must NOT silently fall back to
 * JWT_SECRET (sharing the employee-token secret). getSecret() throws instead.
 * Outside production the dev/test fallback survives so local runs work.
 */
const { getSecret } = require("../../middleware/manufacturer-auth");

describe("Step 4.3 — manufacturer-auth getSecret()", () => {
  let saved;

  beforeEach(() => {
    saved = {
      NODE_ENV: process.env.NODE_ENV,
      MANUFACTURER_PORTAL_JWT_SECRET: process.env.MANUFACTURER_PORTAL_JWT_SECRET,
      JWT_SECRET: process.env.JWT_SECRET,
    };
  });

  afterEach(() => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns the explicit secret when set (any env)", () => {
    process.env.NODE_ENV = "production";
    process.env.MANUFACTURER_PORTAL_JWT_SECRET = "explicit-distinct-manufacturer-secret-value";
    process.env.JWT_SECRET = "employee-secret";
    expect(getSecret()).toBe("explicit-distinct-manufacturer-secret-value");
  });

  it("THROWS in production when the secret is unset (no fallback to JWT_SECRET)", () => {
    process.env.NODE_ENV = "production";
    delete process.env.MANUFACTURER_PORTAL_JWT_SECRET;
    process.env.JWT_SECRET = "employee-secret";
    expect(() => getSecret()).toThrow(/MANUFACTURER_PORTAL_JWT_SECRET is required in production/);
  });

  it("falls back to JWT_SECRET in dev/test when unset (fallback preserved)", () => {
    process.env.NODE_ENV = "test";
    delete process.env.MANUFACTURER_PORTAL_JWT_SECRET;
    process.env.JWT_SECRET = "employee-secret";
    expect(getSecret()).toBe("employee-secret");
  });

  it("falls back to the hardcoded dev literal only when both are unset (dev/test)", () => {
    process.env.NODE_ENV = "development";
    delete process.env.MANUFACTURER_PORTAL_JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(getSecret()).toBe("dev-insecure-secret");
  });
});
