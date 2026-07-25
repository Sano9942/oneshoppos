/**
 * PLAN-V3 Step 4.3 follow-up — customer-auth.js:getSecret() production-fallback
 * removal.
 *
 * In production the customer portal must NOT silently fall back to JWT_SECRET
 * (sharing the employee-token secret). getSecret() throws instead. Outside
 * production the dev/test fallback survives so local runs work.
 *
 * This is the exact mirror of manufacturer-auth-getsecret.test.js — 4.3 fixed
 * the manufacturer portal and left this one documented as a known follow-up.
 * Keep the two files in step: the modules have drifted before.
 */
const { getSecret } = require("../../middleware/customer-auth");

describe("Step 4.3 follow-up — customer-auth getSecret()", () => {
  let saved;

  beforeEach(() => {
    saved = {
      NODE_ENV: process.env.NODE_ENV,
      CUSTOMER_PORTAL_JWT_SECRET: process.env.CUSTOMER_PORTAL_JWT_SECRET,
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
    process.env.CUSTOMER_PORTAL_JWT_SECRET = "explicit-distinct-customer-secret-value";
    process.env.JWT_SECRET = "employee-secret";
    expect(getSecret()).toBe("explicit-distinct-customer-secret-value");
  });

  it("THROWS in production when the secret is unset (no fallback to JWT_SECRET)", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CUSTOMER_PORTAL_JWT_SECRET;
    process.env.JWT_SECRET = "employee-secret";
    expect(() => getSecret()).toThrow(/CUSTOMER_PORTAL_JWT_SECRET is required in production/);
  });

  it("falls back to JWT_SECRET in dev/test when unset (fallback preserved)", () => {
    process.env.NODE_ENV = "test";
    delete process.env.CUSTOMER_PORTAL_JWT_SECRET;
    process.env.JWT_SECRET = "employee-secret";
    expect(getSecret()).toBe("employee-secret");
  });

  it("falls back to the hardcoded dev literal only when both are unset (dev/test)", () => {
    process.env.NODE_ENV = "development";
    delete process.env.CUSTOMER_PORTAL_JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(getSecret()).toBe("dev-insecure-secret");
  });
});
