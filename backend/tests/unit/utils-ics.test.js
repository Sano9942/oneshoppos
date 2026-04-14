import { describe, it, expect } from "vitest";
import { buildIcsEvent, escapeIcsText, toIcsUtcStamp } from "../../utils/ics.js";

describe("utils/ics", () => {
  describe("escapeIcsText", () => {
    it("escapes backslash, semicolon, comma, and newline", () => {
      expect(escapeIcsText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
    });

    it("handles null/undefined", () => {
      expect(escapeIcsText(null)).toBe("");
      expect(escapeIcsText(undefined)).toBe("");
    });

    it("normalises CRLF to \\n", () => {
      expect(escapeIcsText("line1\r\nline2")).toBe("line1\\nline2");
    });
  });

  describe("toIcsUtcStamp", () => {
    it("formats a Date as YYYYMMDDTHHMMSSZ", () => {
      const d = new Date(Date.UTC(2026, 3, 14, 10, 30, 15));
      expect(toIcsUtcStamp(d)).toBe("20260414T103015Z");
    });

    it("accepts ISO string input", () => {
      expect(toIcsUtcStamp("2026-04-14T10:30:15.000Z")).toBe("20260414T103015Z");
    });

    it("throws on invalid input", () => {
      expect(() => toIcsUtcStamp("not-a-date")).toThrow(/invalid date/i);
    });
  });

  describe("buildIcsEvent", () => {
    const validArgs = {
      uid: "booking-123@sanopos.com",
      start: "2026-04-14T10:00:00.000Z",
      end: "2026-04-14T10:30:00.000Z",
      summary: "Haircut at Downtown Salon",
      description: "Booking #123",
      location: "123 Main St",
      dtstamp: new Date(Date.UTC(2026, 0, 1)),
    };

    it("produces a well-formed VCALENDAR + VEVENT", () => {
      const ics = buildIcsEvent(validArgs);
      expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
      expect(ics).toMatch(/\r\nEND:VCALENDAR\r\n$/);
      expect(ics).toMatch(/\r\nBEGIN:VEVENT\r\n/);
      expect(ics).toMatch(/\r\nEND:VEVENT\r\n/);
      expect(ics).toMatch(/\r\nUID:booking-123@sanopos.com\r\n/);
      expect(ics).toMatch(/\r\nDTSTART:20260414T100000Z\r\n/);
      expect(ics).toMatch(/\r\nDTEND:20260414T103000Z\r\n/);
      expect(ics).toMatch(/\r\nSUMMARY:Haircut at Downtown Salon\r\n/);
      expect(ics).toMatch(/\r\nLOCATION:123 Main St\r\n/);
    });

    it("omits optional fields when not provided", () => {
      const ics = buildIcsEvent({
        uid: "uid-1",
        start: validArgs.start,
        end: validArgs.end,
        summary: "Simple",
      });
      expect(ics).not.toMatch(/DESCRIPTION:/);
      expect(ics).not.toMatch(/LOCATION:/);
      expect(ics).toMatch(/SUMMARY:Simple\r\n/);
    });

    it("escapes special chars in summary", () => {
      const ics = buildIcsEvent({
        ...validArgs,
        summary: "Booking; with, commas\\backslash",
      });
      expect(ics).toMatch(/SUMMARY:Booking\\; with\\, commas\\\\backslash/);
    });

    it("throws when required fields missing", () => {
      expect(() => buildIcsEvent({})).toThrow();
      expect(() =>
        buildIcsEvent({ uid: "x", start: validArgs.start, end: validArgs.end })
      ).toThrow(/summary/i);
    });

    it("uses CRLF line endings per RFC 5545", () => {
      const ics = buildIcsEvent(validArgs);
      // Should contain \r\n pairs but no orphan \n without \r.
      expect(ics.includes("\r\n")).toBe(true);
      expect(/[^\r]\n/.test(ics)).toBe(false);
    });
  });
});
