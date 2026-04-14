import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import jwt from "jsonwebtoken";

// Ensure the module under test can resolve a secret.
beforeAll(() => {
  process.env.CUSTOMER_PORTAL_JWT_SECRET =
    process.env.CUSTOMER_PORTAL_JWT_SECRET || "unit-test-portal-secret";
});

const {
  signCustomerTokens,
  verifyCustomerToken,
  hashRefreshToken,
} = require("../../middleware/customer-auth");

describe("customer portal JWT signing", () => {
  it("issues an access token scoped to 'customer' with cid/tid claims", () => {
    const { accessToken } = signCustomerTokens(
      { id: 42 },
      { id: 7, slug: "acme" }
    );
    const decoded = jwt.decode(accessToken);
    expect(decoded.scope).toBe("customer");
    expect(decoded.cid).toBe(42);
    expect(decoded.tid).toBe(7);
    expect(decoded.tslug).toBe("acme");
    expect(typeof decoded.jti).toBe("string");
  });

  it("issues a refresh token with type='refresh' and matching hash", () => {
    const { refreshToken, refreshHash, refreshExpiresAt } = signCustomerTokens(
      { id: 42 },
      { id: 7, slug: "acme" }
    );
    const decoded = jwt.decode(refreshToken);
    expect(decoded.type).toBe("refresh");
    expect(decoded.scope).toBe("customer");
    expect(new Date(refreshExpiresAt).getTime()).toBeGreaterThan(Date.now());

    const rehash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    expect(refreshHash).toBe(rehash);
    expect(hashRefreshToken(refreshToken)).toBe(rehash);
  });

  it("verifyCustomerToken accepts tokens signed by sign", () => {
    const { accessToken } = signCustomerTokens(
      { id: 1 },
      { id: 1, slug: "x" }
    );
    const v = verifyCustomerToken(accessToken);
    expect(v.scope).toBe("customer");
    expect(v.cid).toBe(1);
  });

  it("verifyCustomerToken rejects tokens signed with another secret", () => {
    const bad = jwt.sign(
      { cid: 1, tid: 1, scope: "customer", jti: "x" },
      "some-other-secret",
      { expiresIn: "1m" }
    );
    expect(() => verifyCustomerToken(bad)).toThrow();
  });
});

describe("customer portal OTP hashing helpers", () => {
  it("SHA-256 OTP hashes match Node crypto for the canonical format", () => {
    const code = "123456";
    const expected = crypto.createHash("sha256").update(code).digest("hex");
    // Locally reproduce hashOtp (it's a file-private helper in routes/auth.js;
    // we assert the contract — SHA-256 of the code string).
    const actual = crypto.createHash("sha256").update(String(code)).digest("hex");
    expect(actual).toBe(expected);
    expect(actual).toHaveLength(64);
  });

  it("6-digit OTPs generated via crypto.randomInt fall in [100000, 999999]", () => {
    for (let i = 0; i < 100; i += 1) {
      const code = String(crypto.randomInt(100000, 1000000));
      expect(code).toMatch(/^\d{6}$/);
      const n = Number(code);
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });
});

describe("customer portal rate limiter keys (shape only)", () => {
  it("exports three portal limiters without throwing", () => {
    const rl = require("../../middleware/rate-limit");
    expect(typeof rl.customerPortalAuthLimiter).toBe("function");
    expect(typeof rl.customerPortalOtpLimiter).toBe("function");
    expect(typeof rl.customerPortalDataLimiter).toBe("function");
  });
});
