/**
 * ots-hourly-tz.test.js — One Toy Store pilot D54.
 *
 * Live 2026-09-30: INV-2026-00037 rung at 13:01 PKT showed on the dashboard as
 * "Peak hour today: 08:00". Hour / weekday / month buckets and the reports'
 * time-of-day filter read sales.timestamp in the DB SESSION timezone (UTC on
 * prod; db-pg.js sets none, and the Supabase pooler drops a session SET)
 * instead of the shop's timezone.
 *
 * Every check runs twice: session UTC (prod) and session Asia/Karachi (a
 * typical local dev box, where the old code looked right by accident). The
 * answer must be the shop's local time either way.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

const TZ = "Asia/Karachi";
let app, db, deps, cleanup;
const admin = () => makeRequest(app, ADMIN_ID);
const todayPk = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

// Fixed-date bills. 2026-09-29 and 2026-09-01 are Tuesdays (DOW 2).
const FIXED = [
  { at: "2026-09-29T08:01:00Z", total: 4130, method: "Card" }, // Tue 13:01 PKT (UTC: 08:01)
  { at: "2026-09-29T15:40:00Z", total: 300, method: "Cash" },  // Tue 20:40 PKT (UTC: 15:40)
  { at: "2026-08-31T19:30:00Z", total: 500, method: "Cash" },  // Tue 1 Sep 00:30 PKT (UTC: Mon 31 Aug 19:30)
];
// Today's bills, for the dashboard's "today" hourly chart and the busiest-hour card.
const TODAY = [
  { at: `${todayPk}T13:01:00+05:00`, total: 100, method: "Cash" },
  { at: `${todayPk}T13:15:00+05:00`, total: 100, method: "Cash" },
  { at: `${todayPk}T13:40:00+05:00`, total: 100, method: "Cash" },
  { at: `${todayPk}T20:40:00+05:00`, total: 50, method: "Cash" },
];

beforeAll(async () => {
  ({ app, db, deps, cleanup } = await createTestApp({
    deps: {
      loadCompanyProfile: (req, res, next) => {
        req.company = { timezone: TZ };
        next();
      },
    },
  }));
  require("../../routes/reports")(app, deps);
  require("../../routes/insights")(app, deps);

  await db.query("TRUNCATE sales CASCADE");
  for (const s of [...FIXED, ...TODAY]) {
    const { rows: [row] } = await db.query(
      `INSERT INTO sales (outlet_id, employee_id, total_amount, payment_method, voided, timestamp)
       VALUES (1, $1, $2, $3, false, $4) RETURNING id`,
      [ADMIN_ID, s.total, s.method, s.at],
    );
    await db.query(
      "INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES ($1, $2, $3)",
      [row.id, s.method, s.total],
    );
  }
}, 60000);

afterAll(async () => {
  try { await db.query("SET TIME ZONE 'UTC'"); } catch { /* ignore */ }
  if (cleanup) await cleanup();
}, 30000);

for (const sessionTz of ["UTC", TZ]) {
  describe(`DB session TimeZone = ${sessionTz}`, () => {
    beforeAll(async () => {
      await db.query(`SET TIME ZONE '${sessionTz}'`);
    });

    it("dashboard hourly: today's 13:01 PKT bills land in 13:00, 20:40 in 20:00", async () => {
      const res = await admin().get("/api/reports/dashboard");
      expect(res.status).toBe(200);
      const hours = Object.fromEntries(
        res.body.hourlySales.map((h) => [h.hour, { total: Number(h.total), orders: Number(h.orders) }]),
      );
      expect(hours).toEqual({
        "13:00": { total: 300, orders: 3 },
        "20:00": { total: 50, orders: 1 },
      });
    });

    it("dashboard monthly trend: 00:30 PKT on 1 Sep counts in September, not August", async () => {
      const res = await admin().get("/api/reports/dashboard");
      expect(res.status).toBe(200);
      const months = res.body.monthlyTrend.map((m) => m.month);
      expect(months).not.toContain("2026-08");
      expect(months).toContain("2026-09");
    });

    it("Sales Heatmap: hour and weekday in shop time", async () => {
      const res = await admin().get("/api/reports/heatmaps?date_from=2026-08-31&date_to=2026-09-29");
      expect(res.status).toBe(200);
      const cells = res.body.heatmap
        .map((c) => `${c.day_of_week}@${c.hour_of_day}=${Number(c.revenue)}`)
        .sort();
      expect(cells).toEqual(["2@0=500", "2@13=4130", "2@20=300"]);
    });

    it("busiest-hour card: 1 PM, not 8 AM", async () => {
      const res = await admin().get("/api/insights/auto");
      expect(res.status).toBe(200);
      const card = res.body.cards.find((c) => c.type === "busiest_hour");
      expect(card.value).toBe("1 PM");
    });

    it("monthly payment matrix: the 1 Sep 00:30 PKT cash bill is in September", async () => {
      const res = await admin().get("/api/reports/monthly-mop-matrix?date_from=2026-09-01&date_to=2026-09-29");
      expect(res.status).toBe(200);
      const buckets = res.body.matrix.map((m) => m.month_bucket);
      expect(buckets).toEqual(["2026-09"]);
      expect(res.body.matrix[0].Cash).toBe(800);
      expect(res.body.matrix[0].Card).toBe(4130);
    });

    it("time-of-day filter 13:00–13:59 on 29 Sep finds the 13:01 PKT bill only", async () => {
      const res = await admin().get(
        "/api/reports/sales-summary?date_from=2026-09-29&date_to=2026-09-29&time_from=13:00&time_to=13:59",
      );
      expect(res.status).toBe(200);
      expect(res.body.total_revenue).toBe(4130);
    });
  });
}
