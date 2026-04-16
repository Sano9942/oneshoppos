import { describe, it, expect } from "vitest";
import {
  OpenShiftSchema,
  CloseShiftSchema,
  VarianceApproveSchema,
} from "../../schemas/shifts.js";

describe("OpenShiftSchema", () => {
  it("fails on missing outlet_id", () => {
    expect(() => OpenShiftSchema.parse({ opening_float: 500 })).toThrow();
  });
  it("coerces string outlet_id and opening_float", () => {
    const r = OpenShiftSchema.parse({ outlet_id: "3", opening_float: "500" });
    expect(r.outlet_id).toBe(3);
    expect(r.opening_float).toBe(500);
  });
  it("accepts denominations array", () => {
    const r = OpenShiftSchema.parse({
      outlet_id: 1,
      opening_float: 500,
      denominations: [{ denomination: 100, count: 5 }],
    });
    expect(r.denominations).toHaveLength(1);
    expect(r.denominations[0].denomination).toBe(100);
    expect(r.denominations[0].count).toBe(5);
  });
  it("rejects negative opening_float", () => {
    expect(() =>
      OpenShiftSchema.parse({ outlet_id: 1, opening_float: -10 }),
    ).toThrow();
  });
});

describe("CloseShiftSchema", () => {
  it("fails when closing_cash is negative", () => {
    expect(() => CloseShiftSchema.parse({ closing_cash: -1 })).toThrow();
  });
  it("parses valid close body", () => {
    const r = CloseShiftSchema.parse({
      closing_cash: "1000",
      variance_reason: "test",
    });
    expect(r.closing_cash).toBe(1000);
    expect(r.variance_reason).toBe("test");
  });
  it("fails when closing_cash missing", () => {
    expect(() => CloseShiftSchema.parse({})).toThrow();
  });
});

describe("VarianceApproveSchema", () => {
  it("fails when approved_by is empty string", () => {
    expect(() => VarianceApproveSchema.parse({ approved_by: "" })).toThrow();
  });
  it("fails when approved_by is missing", () => {
    expect(() => VarianceApproveSchema.parse({})).toThrow();
  });
  it("accepts full body", () => {
    const r = VarianceApproveSchema.parse({
      approved_by: "manager",
      approval_note: "reviewed and approved",
    });
    expect(r.approved_by).toBe("manager");
    expect(r.approval_note).toBe("reviewed and approved");
  });
  it("accepts approved_by without note", () => {
    const r = VarianceApproveSchema.parse({ approved_by: "manager" });
    expect(r.approved_by).toBe("manager");
  });
});
