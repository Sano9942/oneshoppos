import { describe, it, expect } from "vitest";
import { toUtcStart, toUtcEnd, toLocalDateStr, getUtcOffsetMinutes, isValidTz } from "../../utils/tz.js";

describe("tz utility — toUtcStart / toUtcEnd", () => {
  // Boundaries are emitted as explicit-UTC ISO 8601 ("…THH:MM:SSZ"). The trailing
  // Z is load-bearing — it forces Postgres to parse the bound as UTC against a
  // timestamptz column regardless of the DB session TimeZone (WS5 hardening).
  it("UTC timezone: start = midnight, end = next midnight", () => {
    expect(toUtcStart("2026-03-06", "UTC")).toBe("2026-03-06T00:00:00Z");
    expect(toUtcEnd("2026-03-06", "UTC")).toBe("2026-03-07T00:00:00Z");
  });

  it("Pakistan (UTC+5): start = prev day 19:00 UTC", () => {
    expect(toUtcStart("2026-03-06", "Asia/Karachi")).toBe("2026-03-05T19:00:00Z");
    expect(toUtcEnd("2026-03-06", "Asia/Karachi")).toBe("2026-03-06T19:00:00Z");
  });

  it("New York (EST = UTC-5): start = same day 05:00 UTC", () => {
    expect(toUtcStart("2026-03-06", "America/New_York")).toBe("2026-03-06T05:00:00Z");
    expect(toUtcEnd("2026-03-06", "America/New_York")).toBe("2026-03-07T05:00:00Z");
  });

  it("Los Angeles (PST = UTC-8): start = same day 08:00 UTC", () => {
    expect(toUtcStart("2026-03-06", "America/Los_Angeles")).toBe("2026-03-06T08:00:00Z");
    expect(toUtcEnd("2026-03-06", "America/Los_Angeles")).toBe("2026-03-07T08:00:00Z");
  });

  it("Auckland (NZDT = UTC+13): start = prev day 11:00 UTC", () => {
    expect(toUtcStart("2026-03-06", "Pacific/Auckland")).toBe("2026-03-05T11:00:00Z");
    expect(toUtcEnd("2026-03-06", "Pacific/Auckland")).toBe("2026-03-06T11:00:00Z");
  });

  it("UTC+14 (Kiritimati): start = prev day 10:00 UTC", () => {
    expect(toUtcStart("2026-03-06", "Pacific/Kiritimati")).toBe("2026-03-05T10:00:00Z");
    expect(toUtcEnd("2026-03-06", "Pacific/Kiritimati")).toBe("2026-03-06T10:00:00Z");
  });

  it("UTC-12 (Baker Island, Etc/GMT+12): start = same day 12:00 UTC", () => {
    expect(toUtcStart("2026-03-06", "Etc/GMT+12")).toBe("2026-03-06T12:00:00Z");
    expect(toUtcEnd("2026-03-06", "Etc/GMT+12")).toBe("2026-03-07T12:00:00Z");
  });

  it("London (GMT in winter = UTC+0): same as UTC", () => {
    // 2026-01-15 is in winter (GMT, not BST)
    expect(toUtcStart("2026-01-15", "Europe/London")).toBe("2026-01-15T00:00:00Z");
    expect(toUtcEnd("2026-01-15", "Europe/London")).toBe("2026-01-16T00:00:00Z");
  });

  it("London (BST in summer = UTC+1): start = prev day 23:00 UTC", () => {
    // 2026-07-15 is in summer (BST = UTC+1)
    expect(toUtcStart("2026-07-15", "Europe/London")).toBe("2026-07-14T23:00:00Z");
    expect(toUtcEnd("2026-07-15", "Europe/London")).toBe("2026-07-15T23:00:00Z");
  });

  it("DST spring-forward day (US 2026-03-08): span is exactly 23 hours", () => {
    const start = toUtcStart("2026-03-08", "America/New_York");
    const end = toUtcEnd("2026-03-08", "America/New_York");
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    expect((endMs - startMs) / 3600000).toBe(23);
  });

  it("DST fall-back day (US 2026-11-01): span is exactly 25 hours", () => {
    const start = toUtcStart("2026-11-01", "America/New_York");
    const end = toUtcEnd("2026-11-01", "America/New_York");
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    expect((endMs - startMs) / 3600000).toBe(25);
  });

  it("full day span is 24h for non-DST date", () => {
    const start = toUtcStart("2026-06-15", "America/New_York"); // EDT = UTC-4
    const end = toUtcEnd("2026-06-15", "America/New_York");
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    expect((endMs - startMs) / 3600000).toBe(24);
  });

  it("invalid timezone falls back to UTC", () => {
    expect(toUtcStart("2026-03-06", "Bogus/Zone")).toBe("2026-03-06T00:00:00Z");
    expect(toUtcStart("2026-03-06", null)).toBe("2026-03-06T00:00:00Z");
    expect(toUtcStart("2026-03-06", "")).toBe("2026-03-06T00:00:00Z");
  });

  it("null/undefined dateStr returns null", () => {
    expect(toUtcStart(null, "UTC")).toBeNull();
    expect(toUtcEnd(undefined, "UTC")).toBeNull();
  });

  it("start < end for any timezone", () => {
    const tzs = ["UTC", "Asia/Karachi", "America/New_York", "Pacific/Auckland", "Etc/GMT+12"];
    for (const tz of tzs) {
      const s = new Date(toUtcStart("2026-03-06", tz)).getTime();
      const e = new Date(toUtcEnd("2026-03-06", tz)).getTime();
      expect(s).toBeLessThan(e);
    }
  });
});

describe("tz utility — toLocalDateStr", () => {
  it("converts UTC timestamp to local date in given timezone", () => {
    expect(toLocalDateStr("2026-03-06 05:30:00", "America/New_York")).toBe("2026-03-06");
    expect(toLocalDateStr("2026-03-06 00:30:00", "America/New_York")).toBe("2026-03-05");
    expect(toLocalDateStr("2026-03-05 19:00:00", "Asia/Karachi")).toBe("2026-03-06");
  });

  it("returns null for null/invalid input", () => {
    expect(toLocalDateStr(null, "UTC")).toBeNull();
    expect(toLocalDateStr("not-a-date", "UTC")).toBeNull();
  });
});

describe("tz utility — isValidTz", () => {
  it("recognizes valid IANA timezone names", () => {
    expect(isValidTz("UTC")).toBe(true);
    expect(isValidTz("Asia/Karachi")).toBe(true);
    expect(isValidTz("America/New_York")).toBe(true);
    expect(isValidTz("Europe/London")).toBe(true);
    expect(isValidTz("Pacific/Auckland")).toBe(true);
  });

  it("rejects invalid timezone strings", () => {
    expect(isValidTz("Bogus/Zone")).toBe(false);
    expect(isValidTz("PKT")).toBe(false);
    expect(isValidTz("")).toBe(false);
    expect(isValidTz(null)).toBe(false);
    expect(isValidTz(undefined)).toBe(false);
    expect(isValidTz(42)).toBe(false);
  });
});

describe("tz utility — getUtcOffsetMinutes", () => {
  it("UTC returns 0", () => {
    expect(getUtcOffsetMinutes("2026-03-06", "UTC")).toBe(0);
  });

  it("Asia/Karachi returns +300 (UTC+5)", () => {
    expect(getUtcOffsetMinutes("2026-03-06", "Asia/Karachi")).toBe(300);
  });

  it("America/New_York returns -300 in winter (EST = UTC-5)", () => {
    expect(getUtcOffsetMinutes("2026-01-15", "America/New_York")).toBe(-300);
  });

  it("America/New_York returns -240 in summer (EDT = UTC-4)", () => {
    expect(getUtcOffsetMinutes("2026-07-15", "America/New_York")).toBe(-240);
  });

  it("Pacific/Auckland returns +780 in southern hemisphere summer (NZDT = UTC+13)", () => {
    expect(getUtcOffsetMinutes("2026-01-15", "Pacific/Auckland")).toBe(780);
  });

  it("invalid timezone falls back to 0 (UTC)", () => {
    expect(getUtcOffsetMinutes("2026-03-06", "Bogus/Zone")).toBe(0);
  });

  it("null dateStr returns 0", () => {
    expect(getUtcOffsetMinutes(null, "UTC")).toBe(0);
  });
});

// ── New helpers (tz-date-boundary class fix, 2026-07) ──────────────────────

import { tenantToday, todayBounds, addDaysStr, pgDateToStr } from "../../utils/tz.js";

describe("tz utility — tenantToday", () => {
  // 2026-07-09T20:30:00Z is a boundary instant: already July 10 in Karachi
  // (01:30 PKT), still July 9 in UTC and Los Angeles (13:30 PDT).
  const boundary = new Date("2026-07-09T20:30:00Z");

  it("Karachi is already on the next day at the boundary instant", () => {
    expect(tenantToday("Asia/Karachi", boundary)).toBe("2026-07-10");
  });

  it("Los Angeles is still on the previous day at the boundary instant", () => {
    expect(tenantToday("America/Los_Angeles", boundary)).toBe("2026-07-09");
  });

  it("UTC date of the boundary instant", () => {
    expect(tenantToday("UTC", boundary)).toBe("2026-07-09");
  });

  it("accepts a non-Date instant (ISO string)", () => {
    expect(tenantToday("Asia/Karachi", "2026-07-09T20:30:00Z")).toBe("2026-07-10");
  });

  it("invalid tz falls back to UTC", () => {
    expect(tenantToday("Bogus/Zone", boundary)).toBe("2026-07-09");
  });

  it("invalid instant returns null", () => {
    expect(tenantToday("UTC", "not-a-date")).toBe(null);
  });
});

describe("tz utility — todayBounds", () => {
  const boundary = new Date("2026-07-09T20:30:00Z");

  it("Karachi: bounds cover the local July 10 day", () => {
    const b = todayBounds("Asia/Karachi", boundary);
    expect(b.today).toBe("2026-07-10");
    expect(b.from).toBe("2026-07-09T19:00:00Z");
    expect(b.to).toBe("2026-07-10T19:00:00Z");
  });

  it("Los Angeles: bounds cover the local July 9 day (DST, UTC-7)", () => {
    const b = todayBounds("America/Los_Angeles", boundary);
    expect(b.today).toBe("2026-07-09");
    expect(b.from).toBe("2026-07-09T07:00:00Z");
    expect(b.to).toBe("2026-07-10T07:00:00Z");
  });

  it("the boundary instant falls inside its own bounds in both zones", () => {
    for (const tz of ["Asia/Karachi", "America/Los_Angeles"]) {
      const b = todayBounds(tz, boundary);
      expect(new Date(b.from) <= boundary).toBe(true);
      expect(boundary < new Date(b.to)).toBe(true);
    }
  });
});

describe("tz utility — addDaysStr", () => {
  it("adds days across a month boundary", () => {
    expect(addDaysStr("2026-07-10", 30)).toBe("2026-08-09");
  });

  it("adds days across a year boundary", () => {
    expect(addDaysStr("2026-12-25", 10)).toBe("2027-01-04");
  });

  it("zero days is identity", () => {
    expect(addDaysStr("2026-07-10", 0)).toBe("2026-07-10");
  });

  it("null input returns null", () => {
    expect(addDaysStr(null, 5)).toBe(null);
  });
});

describe("tz utility — pgDateToStr (pg DATE round-trip)", () => {
  it("string passthrough", () => {
    expect(pgDateToStr("2026-07-10")).toBe("2026-07-10");
  });

  it("local-midnight Date round-trips to the same calendar day", () => {
    // node-postgres parses DATE columns as new Date(y, m, d) — LOCAL midnight.
    // toISOString() on this value shifts a day east of UTC; pgDateToStr must not.
    const d = new Date(2026, 6, 10); // July 10 local midnight
    expect(pgDateToStr(d)).toBe("2026-07-10");
  });

  it("null/empty returns null", () => {
    expect(pgDateToStr(null)).toBe(null);
    expect(pgDateToStr("")).toBe(null);
  });
});
