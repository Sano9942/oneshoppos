const { computeNextPeriod } = require("../../services/subscriptions");

// All anchors are expressed in UTC (Z) so the assertions are TZ-independent.
const iso = (d) => d.toISOString();

describe("subscriptions.computeNextPeriod — calendar-month anchoring", () => {
  it("monthly: mid-month bills the same day next month (not +30 days)", () => {
    const { end } = computeNextPeriod("2026-01-15T00:00:00.000Z", "monthly");
    expect(iso(end)).toBe("2026-02-15T00:00:00.000Z");
  });

  it("monthly: Jan 31 clamps to Feb 28 (non-leap)", () => {
    const { end } = computeNextPeriod("2026-01-31T00:00:00.000Z", "monthly");
    expect(iso(end)).toBe("2026-02-28T00:00:00.000Z");
  });

  it("monthly: Jan 31 clamps to Feb 29 in a leap year", () => {
    const { end } = computeNextPeriod("2028-01-31T00:00:00.000Z", "monthly");
    expect(iso(end)).toBe("2028-02-29T00:00:00.000Z");
  });

  it("monthly: Jan 30 → Feb 28 → Mar 28 (clamp does not resurrect the 30th)", () => {
    const feb = computeNextPeriod("2026-01-30T00:00:00.000Z", "monthly").end;
    expect(iso(feb)).toBe("2026-02-28T00:00:00.000Z");
    const mar = computeNextPeriod(feb, "monthly").end;
    expect(iso(mar)).toBe("2026-03-28T00:00:00.000Z");
  });

  it("monthly: preserves the time-of-day", () => {
    const { end } = computeNextPeriod("2026-03-10T09:30:00.000Z", "monthly");
    expect(iso(end)).toBe("2026-04-10T09:30:00.000Z");
  });

  it("monthly across a year boundary: Dec 15 → Jan 15", () => {
    const { end } = computeNextPeriod("2026-12-15T00:00:00.000Z", "monthly");
    expect(iso(end)).toBe("2027-01-15T00:00:00.000Z");
  });

  it("quarterly adds 3 calendar months", () => {
    const { end } = computeNextPeriod("2026-01-31T00:00:00.000Z", "quarterly");
    expect(iso(end)).toBe("2026-04-30T00:00:00.000Z"); // Apr has 30 days → clamp
  });

  it("yearly adds 12 calendar months (leap-day clamps)", () => {
    const { end } = computeNextPeriod("2028-02-29T00:00:00.000Z", "yearly");
    expect(iso(end)).toBe("2029-02-28T00:00:00.000Z");
  });

  it("intervalCount multiplies the month step", () => {
    const { end } = computeNextPeriod("2026-01-15T00:00:00.000Z", "monthly", 2);
    expect(iso(end)).toBe("2026-03-15T00:00:00.000Z");
  });

  it("start echoes the passed-in current period end", () => {
    const { start } = computeNextPeriod("2026-05-01T00:00:00.000Z", "monthly");
    expect(iso(start)).toBe("2026-05-01T00:00:00.000Z");
  });

  it("unknown interval falls back to a 30-day step (never throws)", () => {
    const { end } = computeNextPeriod("2026-01-01T00:00:00.000Z", "fortnightly");
    expect(iso(end)).toBe("2026-01-31T00:00:00.000Z");
  });

  it("weekly interval uses the 7-day fallback", () => {
    const { end } = computeNextPeriod("2026-01-01T00:00:00.000Z", "weekly");
    expect(iso(end)).toBe("2026-01-08T00:00:00.000Z");
  });
});
