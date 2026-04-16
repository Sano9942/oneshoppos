import { describe, it, expect } from "vitest";
import { PaymentLineSchema, CreateSaleSchema } from "../../schemas/sales.js";

describe("PaymentLineSchema", () => {
  it("fails on empty method", () => {
    expect(() => PaymentLineSchema.parse({ method: "", amount: 100 })).toThrow();
  });
  it("fails on missing method", () => {
    expect(() => PaymentLineSchema.parse({ amount: 100 })).toThrow();
  });
  it("fails on negative amount", () => {
    expect(() => PaymentLineSchema.parse({ method: "cash", amount: -1 })).toThrow();
  });
  it("coerces amount string", () => {
    const r = PaymentLineSchema.parse({ method: "cash", amount: "100" });
    expect(r.amount).toBe(100);
    expect(r.method).toBe("cash");
  });
  it("accepts optional reference + change", () => {
    const r = PaymentLineSchema.parse({
      method: "card",
      amount: 500,
      reference: "TXN-12345",
      change: 0,
    });
    expect(r.reference).toBe("TXN-12345");
    expect(r.change).toBe(0);
  });
  it("passes through extra fields", () => {
    const r = PaymentLineSchema.parse({
      method: "cash",
      amount: 100,
      denomination_breakdown: [{ note: 100, count: 1 }],
    });
    expect(r.denomination_breakdown).toBeDefined();
  });
});

describe("CreateSaleSchema payments field", () => {
  const validCart = { cartItems: [{ id: 1, price: 10, quantity: 1 }], outlet_id: 1 };

  it("accepts valid single cash payment", () => {
    const r = CreateSaleSchema.parse({
      ...validCart,
      payments: [{ method: "cash", amount: 10 }],
    });
    expect(r.payments).toHaveLength(1);
  });
  it("accepts split cash + card payment", () => {
    const r = CreateSaleSchema.parse({
      ...validCart,
      payments: [
        { method: "cash", amount: 5 },
        { method: "card", amount: 5, reference: "TXN-1" },
      ],
    });
    expect(r.payments).toHaveLength(2);
  });
  it("rejects sale with empty-method payment line", () => {
    expect(() =>
      CreateSaleSchema.parse({
        ...validCart,
        payments: [{ method: "", amount: 10 }],
      }),
    ).toThrow();
  });
  it("rejects sale with negative-amount payment line", () => {
    expect(() =>
      CreateSaleSchema.parse({
        ...validCart,
        payments: [{ method: "cash", amount: -10 }],
      }),
    ).toThrow();
  });
  it("accepts sale with no payments field (backwards-compat)", () => {
    const r = CreateSaleSchema.parse(validCart);
    expect(r.payments).toBeUndefined();
  });
});
