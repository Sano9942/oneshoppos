import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Mock api BEFORE importing the hook — useLoyaltyWallet fetches the
// customer's wallet balance on checkoutCustomerId change; we only
// need the call to resolve successfully, not return useful data.
vi.mock("../../src/api", () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ balance: 0 })),
  },
}));

import { useLoyaltyWallet } from "../../src/pages/redesign/pos/hooks/useLoyaltyWallet";

const CUSTOMERS = [
  {
    id: 1,
    loyalty_points: 200,
    tier_name: "Silver",
    tier_multiplier: 1.5,
    tier_discount: 5,
  },
];

describe("useLoyaltyWallet — tenant-configured earn + redeem rates", () => {
  it("falls back to defaults when no loyaltyConfig passed", () => {
    const { result } = renderHook(() =>
      useLoyaltyWallet({
        customers: CUSTOMERS,
        checkoutCustomerId: null,
        total: 1000,
      }),
    );
    expect(result.current.LOYALTY_EARN_RATE).toBe(1);
    expect(result.current.LOYALTY_REDEEM_RATE).toBe(10);
    // 1000 / 100 = 10 base points — no tier multiplier (customer null).
    expect(result.current.pointsEarned).toBe(10);
  });

  it("falls back to defaults when loyaltyConfig is null", () => {
    const { result } = renderHook(() =>
      useLoyaltyWallet({
        customers: CUSTOMERS,
        checkoutCustomerId: null,
        total: 1000,
        loyaltyConfig: null,
      }),
    );
    expect(result.current.LOYALTY_EARN_RATE).toBe(1);
    expect(result.current.LOYALTY_REDEEM_RATE).toBe(10);
  });

  it("uses tenant-configured rates when provided", () => {
    const { result } = renderHook(() =>
      useLoyaltyWallet({
        customers: CUSTOMERS,
        checkoutCustomerId: null,
        total: 1000,
        loyaltyConfig: { earn_rate: 2, redeem_rate: 15 },
      }),
    );
    expect(result.current.LOYALTY_EARN_RATE).toBe(2);
    expect(result.current.LOYALTY_REDEEM_RATE).toBe(15);
    // 1000 / 100 * 2 = 20 base points.
    expect(result.current.pointsEarned).toBe(20);
  });

  it("applies tier multiplier on top of earn_rate", () => {
    const { result } = renderHook(() =>
      useLoyaltyWallet({
        customers: CUSTOMERS,
        checkoutCustomerId: "1",
        total: 1000,
        loyaltyConfig: { earn_rate: 2, redeem_rate: 15 },
      }),
    );
    // 1000 / 100 * 2 (earn) * 1.5 (tier mult) = 30 pts.
    expect(result.current.pointsEarned).toBe(30);
  });

  it("only computes pointsDiscount when redeemPointsOn is flipped", () => {
    const { result } = renderHook(() =>
      useLoyaltyWallet({
        customers: CUSTOMERS,
        checkoutCustomerId: "1",
        total: 1000,
        loyaltyConfig: { earn_rate: 1, redeem_rate: 20 },
      }),
    );
    // Off by default.
    expect(result.current.pointsDiscount).toBe(0);
    expect(result.current.pointsRedeemed).toBe(0);
  });

  it("coerces string rates (common when fetched from NUMERIC columns)", () => {
    const { result } = renderHook(() =>
      useLoyaltyWallet({
        customers: CUSTOMERS,
        checkoutCustomerId: null,
        total: 500,
        // Postgres NUMERIC columns often arrive as strings via pg driver.
        loyaltyConfig: { earn_rate: "3", redeem_rate: "25" },
      }),
    );
    expect(result.current.LOYALTY_EARN_RATE).toBe(3);
    expect(result.current.LOYALTY_REDEEM_RATE).toBe(25);
    // 500 / 100 * 3 = 15.
    expect(result.current.pointsEarned).toBe(15);
  });
});
