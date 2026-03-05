import { describe, it, expect } from "vitest";
import { toUtcStart, toUtcEnd, toLocalDateStr, getUtcOffsetMinutes, isValidTz } from "../../utils/tz.js";

describe("tz utility — toUtcStart / toUtcEnd", () => {
  it("UTC timezone: start = midnight, end = next midnight", () => {
    expect(toUtcStart("2026-03-06", "UTC")).toBe("2026-03-06 00:00:00");
    expect(toUtcEnd("2026-03-06", "UTC")).toBe("2026-03-07 00:00:00");
  });

  it("Pakistan (UTC+5): start = prev day 19:00 UTC", () => {
    expect(toUtcStart("2026-03-06", "Asia/Karachi")).toBe("2026-03-05 19:00:00");
    expect(toUtcEnd("2026-03-06", "Asia/Karachi")).toBe("2026-03-06 19:00:00");
  });

  it("New York (EST = UTC-5): start = same day 05:00 UTC", () => {
    expect(toUtcStart("2026-03-06", "America/New_York")).toBe("2026-03-06 05:00:00");
    expect(toUtcEnd("2026-03-06", "America/New_York")).toBe("2026-03-07 05:00:00");
  });

  it("Los Angeles (PST = UTC-8): start = same day 08:00 UTC", () => {
    expect(toUtcStart("2026-03-06", "America/Los_Angeles")).toBe("2026-03-06 08:00:00");
    expect(toUtcEnd("2026-03-06", "America/Los_Angeles")).toBe("2026-03-07 08:00:00");
  });

  it("Auckland (NZDT = UTC+13): start = prev day 11:00 UTC", () => {
    expect(toUtcStart("2026-03-06", "Pacific/Auckland")).toBe("2026-03-05 11:00:00");
    expect(toUtcEnd("2026-03-06", "Pacific/Auckland")).toBe("2026-03-06 11:00:00");
  });

  it("UTC+14 (Kiritimati): start = prev day 10:00 UTC", () => {
    expect(toUtcStart("2026-03-06", "Pacific/Kiritimati")).toBe("2026-03-05 10:00:00");
    expect(toUtcEnd("2026-03-06", "Pacific/Kiritimati")).toBe("2026-03-06 10:00:00");
  });

  it("UTC-12 (Baker Island, Etc/GMT+12): start = same day 12:00 UTC", () => {
    expect(toUtcStart("2026-03-06", "Etc/GMT+12")).toBe("2026-03-06 12:00:00");
    expect(toUtcEnd("2026-03-06", "Etc/GMT+12")).toBe("2026-03-07 12:00:00");
  });

  it("London (GMT in winter = UTC+0): same as UTC", () => {
    // 2026-01-15 is in winter (GMT, not BST)
    expect(toUtcStart("2026-01-15", "Europe/London")).toBe("2026-01-15 00:00:00");
    expect(toUtcEnd("2026-01-15", "Europe/London")).toBe("2026-01-16 00:00:00");
  });

  it("London (BST in summer = UTC+1): start = prev day 23:00 UTC", () => {
    // 2026-07-15 is in summer (BST = UTC+1)
    expect(toUtcStart("2026-07-15", "Europe/London")).toBe("2026-07-14 23:00:00");
    expect(toUtcEnd("2026-07-15", "Europe/London")).toBe("2026-07-15 23:00:00");
  });

  it("DST spring-forward day (US 2026-03-08): span is exactly 23 hours", () => {
    const start = toUtcStart("2026-03-08", "America/New_York");
    const end = toUtcEnd("2026-03-08", "America/New_York");
    const startMs = new Date(start.replace(" ", "T") + "Z").getTime();
    const endMs = new Date(end.replace(" ", "T") + "Z").getTime();
    expect((endMs - startMs) / 3600000).toBe(23);
  });

  it("DST fall-back day (US 2026-11-01): span is exactly 25 hours", () => {
    const start = toUtcStart("2026-11-01", "America/New_York");
    const end = toUtcEnd("2026-11-01", "America/New_York");
    const startMs = new Date(start.replace(" ", "T") + "Z").getTime();
    const endMs = new Date(end.replace(" ", "T") + "Z").getTime();
    expect((endMs - startMs) / 3600000).toBe(25);
  });

  it("full day span is 24h for non-DST date", () => {
    const start = toUtcStart("2026-06-15", "America/New_York"); // EDT = UTC-4
    const end = toUtcEnd("2026-06-15", "America/New_York");
    const startMs = new Date(start.replace(" ", "T") + "Z").getTime();
    const endMs = new Date(end.replace(" ", "T") + "Z").getTime();
    expect((endMs - startMs) / 3600000).toBe(24);
  });

  it("invalid timezone falls back to UTC", () => {
    expect(toUtcStart("2026-03-06", "Bogus/Zone")).toBe("2026-03-06 00:00:00");
    expect(toUtcStart("2026-03-06", null)).toBe("2026-03-06 00:00:00");
    expect(toUtcStart("2026-03-06", "")).toBe("2026-03-06 00:00:00");
  });

  it("null/undefined dateStr returns null", () => {
    expect(toUtcStart(null, "UTC")).toBeNull();
    expect(toUtcEnd(undefined, "UTC")).toBeNull();
  });

  it("start < end for any timezone", () => {
    const tzs = ["UTC", "Asia/Karachi", "America/New_York", "Pacific/Auckland", "Etc/GMT+12"];
    for (const tz of tzs) {
      const s = new Date(toUtcStart("2026-03-06", tz).replace(" ", "T") + "Z").getTime();
      const e = new Date(toUtcEnd("2026-03-06", tz).replace(" ", "T") + "Z").getTime();
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
