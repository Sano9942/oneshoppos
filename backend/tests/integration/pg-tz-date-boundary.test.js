/**
 * TZ date-boundary class — DB-level regression test (fix/tz-date-boundary-class).
 *
 * The bug class: business "day" logic computed via the UTC date
 * (`new Date().toISOString().slice(0,10)`) or the DB SESSION timezone
 * (`col::date`, `CURRENT_DATE`) instead of the tenant's timezone. The session
 * TZ is UTC on prod (Supabase) but typically Asia/Karachi on local dev, so
 * the old predicates gave different answers per environment.
 *
 * This file pins the required property of the FIXED predicate — used by
 * sales.js getEmployeeCheckoutStatus, field.js, attendance sweeps, etc.:
 *
 *   (col AT TIME ZONE $tz)::date = (now AT TIME ZONE $tz)::date
 *
 * must produce the SAME, tenant-correct answer no matter what the DB session
 * TimeZone is. The old predicate is asserted to be session/environment
 * dependent (documented wrongness), the new one invariant.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createTestApp } = require("../helpers/createTestApp-pg.js");

let db, cleanup;

beforeAll(async () => {
  ({ db, cleanup } = await createTestApp({ seed: false }));
}, 60000);

afterAll(async () => {
  try { await db.query("SET TIME ZONE 'UTC'"); } catch { /* ignore */ }
  if (cleanup) await cleanup();
}, 30000);

// The confirmed production case: a Los Angeles employee clocks in at 9:00 AM
// PDT and rings a sale at 5:00 PM PDT the same local day. In UTC the two
// instants fall on DIFFERENT dates (the sale is past UTC midnight).
const LA = {
  tz: "America/Los_Angeles",
  clockin: "2026-07-09T16:00:00Z", // 09:00 PDT Jul 9
  sale: "2026-07-10T00:00:00Z",    // 17:00 PDT Jul 9
};
// The local-dev case: Karachi overnight staff, clock-in 00:30 PKT, sale 01:30
// PKT — same local day, and same UTC date too (Jul 9). Under a Karachi
// session TZ the bare ::date cast puts the clock-in on Jul 10 while the old
// UTC "today" string said Jul 9 → blocked.
const PK = {
  tz: "Asia/Karachi",
  clockin: "2026-07-09T19:30:00Z", // 00:30 PKT Jul 10
  sale: "2026-07-09T20:30:00Z",    // 01:30 PKT Jul 10
};

async function oldPredicate(c) {
  // OLD code: today = new Date(sale).toISOString().slice(0,10) (UTC date),
  // compared against a bare session-TZ cast of the clock-in.
  const todayUtc = c.sale.slice(0, 10);
  const { rows: [r] } = await db.query(
    "SELECT ($1::timestamptz)::date = $2::date AS matched",
    [c.clockin, todayUtc]
  );
  return r.matched;
}

async function newPredicate(c) {
  const { rows: [r] } = await db.query(
    `SELECT ($1::timestamptz AT TIME ZONE $3)::date
          = ($2::timestamptz AT TIME ZONE $3)::date AS matched`,
    [c.clockin, c.sale, c.tz]
  );
  return r.matched;
}

describe("tz date-boundary predicate — session-TZ independence", () => {
  for (const sessionTz of ["UTC", "Asia/Karachi"]) {
    describe(`DB session TimeZone = ${sessionTz}`, () => {
      beforeAll(async () => {
        await db.query(`SET TIME ZONE '${sessionTz}'`);
      });

      it("NEW predicate: LA same-local-day clock-in is recognized", async () => {
        expect(await newPredicate(LA)).toBe(true);
      });

      it("NEW predicate: PK overnight same-local-day clock-in is recognized", async () => {
        expect(await newPredicate(PK)).toBe(true);
      });

      it("NEW predicate: a clock-in from the previous local day is rejected", async () => {
        // 26h before the sale is never the same local day in any zone.
        const stale = {
          ...PK,
          clockin: new Date(new Date(PK.sale).getTime() - 26 * 3600 * 1000).toISOString(),
        };
        expect(await newPredicate(stale)).toBe(false);
      });

      it("OLD predicate documents the bug: LA evening checkout was blocked", async () => {
        expect(await oldPredicate(LA)).toBe(false); // valid clock-in rejected
      });
    });
  }

  it("OLD predicate was environment-dependent for the PK overnight case", async () => {
    await db.query("SET TIME ZONE 'UTC'");
    const onProd = await oldPredicate(PK);
    await db.query("SET TIME ZONE 'Asia/Karachi'");
    const onLocalDev = await oldPredicate(PK);
    // Same data, different answers per environment — the core of the class.
    expect(onProd).toBe(true);
    expect(onLocalDev).toBe(false);
  });
});
