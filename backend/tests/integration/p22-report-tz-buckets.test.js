/**
 * P22 — Daily-bucket aggregation in reports must respect tenant timezone.
 *
 * Bug: routes/reports/sales.js line 167 uses `s.timestamp::date` which casts using
 * Postgres session TZ (UTC). For non-UTC tenants, sales straddling UTC midnight
 * are bucketed into the wrong local date.
 *
 * Fix: cast as `(s.timestamp AT TIME ZONE $tz)::date` and emit as text via to_char
 * to avoid pg-driver Date object reinterpretation in JS.
 *
 * Test scenario: tenant timezone = America/New_York (UTC-5). Seed 3 sales:
 *   - Sale A: 2026-04-15 18:00 UTC = 2026-04-15 14:00 EDT → bucket 2026-04-15
 *   - Sale B: 2026-04-16 02:00 UTC = 2026-04-15 22:00 EDT → bucket 2026-04-15
 *   - Sale C: 2026-04-16 14:00 UTC = 2026-04-16 10:00 EDT → bucket 2026-04-16
 *
 * Pre-fix: all three would bucket as 2026-04-15 + 2026-04-16 + 2026-04-16 (UTC).
 *   Sale B (the boundary case) would land in 2026-04-16 instead of 2026-04-15.
 * Post-fix: bucket correctly 2026-04-15 (×2) + 2026-04-16 (×1).
 */
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("P22 — daily-bucket aggregation respects tenant timezone", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // Override loadCompanyProfile to inject America/New_York timezone (UTC-5/-4 DST)
    // The helper hard-codes UTC; we patch the deps object before route registration.
    deps.loadCompanyProfile = (req, res, next) => {
      req.company = { timezone: "America/New_York" };
      next();
    };
    // Re-mount the patched middleware on a child router so reports routes pick it up
    // Since the existing app.use chain already applied the original loadCompanyProfile,
    // we attach a 2nd middleware that overwrites req.company for any route mounted after.
    app.use((req, res, next) => {
      req.company = { timezone: "America/New_York" };
      next();
    });

    require("../../routes/sales")(app, deps);
    require("../../routes/reports")(app, deps);

    // Seed 3 sales with explicit UTC timestamps
    const sales = [
      { id: 100, ts: "2026-04-15 18:00:00+00", total: 100 }, // EDT 14:00 → 2026-04-15
      { id: 101, ts: "2026-04-16 02:00:00+00", total: 200 }, // EDT 22:00 prev day → 2026-04-15
      { id: 102, ts: "2026-04-16 14:00:00+00", total: 300 }, // EDT 10:00 → 2026-04-16
    ];

    // Open a shift so sales reference a valid shift_id (not strictly required by the report query)
    await db.query(
      `INSERT INTO cash_shifts (id, outlet_id, employee_id, status, opened_at, opening_float)
       VALUES (100, 1, 1, 'open', '2026-04-15 12:00:00+00', 0)
       ON CONFLICT (id) DO NOTHING`
    );

    for (const s of sales) {
      await db.query(
        `INSERT INTO sales (id, outlet_id, employee_id, total_amount,
           discount_amount, payment_method, voided, shift_id, timestamp)
         VALUES ($1, 1, 1, $2, 0, 'Cash', false, 100, $3::timestamptz)`,
        [s.id, s.total, s.ts]
      );
      await db.query(
        `INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES ($1, 'Cash', $2)`,
        [s.id, s.total]
      );
    }
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("daily_sales buckets sales by tenant local date, not UTC", async () => {
    const res = await request(app)
      .get("/api/reports/sales-summary")
      .set("x-employee-id", "1")
      .query({ date_from: "2026-04-15", date_to: "2026-04-16" })
      .expect(200);

    // Pre-fix expected (broken): UTC buckets → 2026-04-15: 100, 2026-04-16: 500
    // Post-fix expected: EDT buckets → 2026-04-15: 300 (sales A+B), 2026-04-16: 300 (sale C)
    const buckets = (res.body.daily_sales || []).reduce((acc, row) => {
      acc[row.date] = (acc[row.date] || 0) + Number(row.total);
      return acc;
    }, {});

    expect(buckets["2026-04-15"]).toBe(300); // Sale A (100) + Sale B (200)
    expect(buckets["2026-04-16"]).toBe(300); // Sale C
    expect(Object.keys(buckets).sort()).toEqual(["2026-04-15", "2026-04-16"]);
  });

  it("total_revenue is correct regardless of bucket", async () => {
    const res = await request(app)
      .get("/api/reports/sales-summary")
      .set("x-employee-id", "1")
      .query({ date_from: "2026-04-15", date_to: "2026-04-16" })
      .expect(200);
    expect(Number(res.body.total_revenue)).toBe(600);
  });
});
