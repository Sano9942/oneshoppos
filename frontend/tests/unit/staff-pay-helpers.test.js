import { describe, expect, it } from "vitest";
import { dayOf, emptyDays, monthOf, nextMonth, pastDays, prevMonth, signed } from "../../src/pages/redesign/staff/staffPay";

describe("F3b staff register helpers", () => {
  it("months step across the year end", () => {
    expect(prevMonth("2026-01")).toBe("2025-12");
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(prevMonth("2026-10")).toBe("2026-09");
    expect(monthOf(new Date(2026, 9, 1))).toBe("2026-10");
    expect(dayOf("2026-09", 7)).toBe("2026-09-07");
  });

  it("past days: whole past month, up to today in this month, none in a future month", () => {
    const today = new Date(2026, 9, 1); // 1 Oct 2026
    expect(pastDays("2026-09", 30, today)).toBe(30);
    expect(pastDays("2026-10", 31, today)).toBe(1);
    expect(pastDays("2026-11", 30, today)).toBe(0);
  });

  it("empty days skip marked or clocked boxes", () => {
    expect(emptyDays({ 1: { mark: "A" }, 3: { mark: "P" } }, 4)).toEqual([2, 4]);
    expect(emptyDays(undefined, 2)).toEqual([1, 2]);
  });

  it("signed shows a plus for extra days", () => {
    expect(signed(6)).toBe("+6");
    expect(signed(-2)).toBe("-2");
    expect(signed(0)).toBe("0");
  });
});
