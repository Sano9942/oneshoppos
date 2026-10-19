/**
 * ots-stock-value-days.test.js — One Toy Store pilot G2 (PHASE-F-PLAN "Reports the owner uses").
 *
 * The total stock value saved at the end of each day, like the figure the
 * owner reads when closing iPOS. Owner, 2026-10-19:
 *   - saved at every Close Shift (printed on the day slip), plus a nightly
 *     save at 23:59 shop time for a day with no Close Shift (shift 5 stayed
 *     open 15–19 Oct), so no date is ever missing;
 *   - totals only: toys in stock, units, value at cost, value at sale price
 *     (same figures as the G1 Stock Value totals);
 *   - the day = the shop date the shift was CLOSED; one figure per branch;
 *   - a reprinted slip shows the figure saved that day, not today's stock;
 *   - listed by date, newest first, the last Close Shift of a day winning.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");
const {
  saveShiftStockValue,
  saveNightlyStockValues,
  nightlyStockValueTick,
  isNightlyHour,
  stockValueTotals,
} = require("../../services/stock-value");

let app, db, cleanup;
const ADMIN_PIN = "2580";
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const admin = () => makeRequest(app, ADMIN_ID);
const num = (v) => (v === null || v === undefined ? v : Number(v));
const figures = (r) => r && ({
  toys: num(r.toys), units: num(r.units), cost_value: num(r.cost_value), retail_value: num(r.retail_value),
});

let teddy;

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  await db.query("UPDATE company_profile SET timezone = 'Asia/Karachi' WHERE id = 1");
  await db.query("DELETE FROM outlet_stock");
  const toy = async (name, price, cost, outlet, qty) => {
    const { id } = await one(
      "INSERT INTO products (name, price, cost_price) VALUES ($1, $2, $3) RETURNING id", [name, price, cost]);
    await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)", [id, outlet, qty]);
    return id;
  };
  // Branch 1: cost 2,000 + 1,000 = 3,000 · sale 4,000 + 2,000 = 6,000 · 12 units, 2 toys.
  await toy("Hot Wheels 5-Pack", 400, 200, 1, 10);
  teddy = await toy("Teddy", 1000, 500, 1, 2);
  await toy("Sold-out car", 400, 200, 1, 0); // no units: not counted
  // Branch 2 (if the test app has one) stays out of branch 1's figure.
  const b2 = await one("SELECT id FROM outlets WHERE id = 2");
  if (b2) await toy("Branch 2 kite", 300, 100, 2, 5);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function openTill(float = 1000) {
  for (const s of await all("SELECT id FROM cash_shifts WHERE status = 'open'")) {
    await db.query("UPDATE cash_shifts SET status = 'closed', closed_at = NOW() WHERE id = $1", [s.id]);
  }
  const res = await admin().post("/api/shifts/open").send({ outlet_id: 1, employee_id: ADMIN_ID, opening_float: float });
  expect(res.status).toBe(200);
  const att = await makeRequest(app).post("/api/attendance/pin-checkin").send({ pin_code: ADMIN_PIN, outlet_id: 1 });
  if (![200, 400].includes(att.status)) throw new Error(`clock-in ${att.status}`);
  return res.body.shift_id;
}

const closeTill = (id, counted = 1000) => admin().post(`/api/shifts/${id}/close`).send({ closing_cash: counted });
const dayReport = async (id) => {
  const res = await admin().get(`/api/shifts/${id}/day-report`);
  expect(res.status).toBe(200);
  return res.body;
};
const list = (q = "") => admin().get(`/api/reports/stock-value-days${q ? `?${q}` : ""}`);
const BRANCH1 = { toys: 2, units: 12, cost_value: 3000, retail_value: 6000 };

describe("G2 — the figure", () => {
  it("is the G1 Stock Value total for the branch", async () => {
    expect(figures(await stockValueTotals(db, 1))).toEqual(BRANCH1);
    const g1 = await admin().get("/api/reports/stock-value-summary?group_by=supplier&outlet_id=1");
    const t = g1.body.totals;
    expect(figures(t)).toEqual(BRANCH1);
  });
});

describe("G2 — saved at Close Shift", () => {
  let shiftId, closed;

  beforeAll(async () => {
    await db.query("DELETE FROM stock_value_days");
    shiftId = await openTill();
    closed = await closeTill(shiftId);
  });

  it("Close Shift saves the branch's stock value for that shift", async () => {
    expect(closed.status).toBe(200);
    const rows = await all("SELECT * FROM stock_value_days WHERE shift_id = $1", [shiftId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("close_shift");
    expect(num(rows[0].outlet_id)).toBe(1);
    expect(figures(rows[0])).toEqual(BRANCH1);
    expect(figures(closed.body.stock_value)).toEqual(BRANCH1);
  });

  it("the day is the shop date of the close", async () => {
    const row = await one(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day,
              to_char(cs.closed_at AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD') AS shop_day
         FROM stock_value_days v JOIN cash_shifts cs ON cs.id = v.shift_id WHERE v.shift_id = $1`, [shiftId]);
    expect(row.day).toBe(row.shop_day);
  });

  it("the day slip carries the saved figure, and a reprint after stock moved still shows it", async () => {
    expect(figures((await dayReport(shiftId)).stock_value)).toEqual(BRANCH1);
    await db.query("UPDATE outlet_stock SET quantity = 7 WHERE product_id = $1 AND outlet_id = 1", [teddy]);
    try {
      const r = await dayReport(shiftId);
      expect(figures(r.stock_value)).toEqual(BRANCH1);
      expect(r.stock_value.live).toBe(false);
    } finally {
      await db.query("UPDATE outlet_stock SET quantity = 2 WHERE product_id = $1 AND outlet_id = 1", [teddy]);
    }
  });

  it("an open shift's check copy shows the stock right now", async () => {
    const open = await openTill();
    const r = await dayReport(open);
    expect(figures(r.stock_value)).toEqual(BRANCH1);
    expect(r.stock_value.live).toBe(true);
    await closeTill(open);
  });

  it("a shift closed before G2 has no figure on its slip", async () => {
    const old = await openTill();
    await db.query("UPDATE cash_shifts SET status = 'closed', closed_at = NOW() WHERE id = $1", [old]);
    expect((await dayReport(old)).stock_value).toBeNull();
  });
});

describe("G2 — shop date at the edges", () => {
  beforeAll(async () => {
    await db.query("DELETE FROM stock_value_days");
  });

  it("a close at 00:30 Pakistan time belongs to that new day", async () => {
    const shift = await one("SELECT * FROM cash_shifts ORDER BY id DESC LIMIT 1");
    // 19:30 UTC on the 21st = 00:30 PKT on the 22nd.
    const row = await saveShiftStockValue(db, { shift, closedAt: new Date("2026-10-21T19:30:00Z") });
    expect(row.day).toBe("2026-10-22");
  });
});

describe("G2 — nightly save for a day with no Close Shift", () => {
  const night = (iso) => saveNightlyStockValues(db, { at: new Date(iso) });

  beforeAll(async () => {
    await db.query("DELETE FROM stock_value_days");
  });

  it("runs only in the 23:00 hour, shop time", () => {
    expect(isNightlyHour("Asia/Karachi", new Date("2026-10-16T18:59:00Z"))).toBe(true); // 23:59 PKT
    expect(isNightlyHour("Asia/Karachi", new Date("2026-10-16T19:59:00Z"))).toBe(false); // 00:59 PKT
    expect(isNightlyHour("Asia/Karachi", new Date("2026-10-16T17:59:00Z"))).toBe(false); // 22:59 PKT
  });

  it("saves the branch figure on a day nobody closed a shift", async () => {
    const saved = await night("2026-10-16T18:59:00Z"); // 16 Oct 23:59 PKT
    expect(saved).toBeGreaterThanOrEqual(1);
    const row = await one(
      "SELECT *, to_char(day, 'YYYY-MM-DD') AS d FROM stock_value_days WHERE outlet_id = 1 AND source = 'nightly'");
    expect(row.d).toBe("2026-10-16");
    expect(row.shift_id).toBeNull();
    expect(figures(row)).toEqual(BRANCH1);
  });

  it("running twice saves it once", async () => {
    await night("2026-10-16T18:59:30Z");
    const { n } = await one(
      "SELECT COUNT(*)::int AS n FROM stock_value_days WHERE outlet_id = 1 AND day = '2026-10-16'");
    expect(n).toBe(1);
  });

  it("saves nothing for a branch that already closed a shift that day", async () => {
    const shift = await one("SELECT * FROM cash_shifts WHERE outlet_id = 1 ORDER BY id DESC LIMIT 1");
    await saveShiftStockValue(db, { shift, closedAt: new Date("2026-10-17T17:30:00Z") }); // 22:30 PKT
    await night("2026-10-17T18:59:00Z");
    const rows = await all("SELECT source FROM stock_value_days WHERE outlet_id = 1 AND day = '2026-10-17'");
    expect(rows.map((r) => r.source)).toEqual(["close_shift"]);
  });

  it("the hourly tick saves only in the shop's 23:00 hour", async () => {
    expect(await nightlyStockValueTick(db, { at: new Date("2026-10-19T17:59:00Z") })).toBe(0); // 22:59 PKT
    const before = await one("SELECT COUNT(*)::int AS n FROM stock_value_days WHERE day = '2026-10-19'");
    expect(before.n).toBe(0);
    expect(await nightlyStockValueTick(db, { at: new Date("2026-10-19T18:59:00Z") })).toBeGreaterThanOrEqual(1); // 23:59
    const after = await one("SELECT COUNT(*)::int AS n FROM stock_value_days WHERE day = '2026-10-19' AND outlet_id = 1");
    expect(after.n).toBe(1);
  });

  it("skips a branch with no stock records at all", async () => {
    const empty = await one("INSERT INTO outlets (name) VALUES ('Empty G2 branch') RETURNING id");
    await night("2026-10-18T18:59:00Z");
    const { n } = await one("SELECT COUNT(*)::int AS n FROM stock_value_days WHERE outlet_id = $1", [empty.id]);
    expect(n).toBe(0);
  });
});

describe("G2 — list by date", () => {
  beforeAll(async () => {
    await db.query("DELETE FROM stock_value_days");
    // Two shifts closed the same evening (e.g. a re-open after a mistake).
    const [first, second] = await all(
      "SELECT * FROM cash_shifts WHERE outlet_id = 1 AND status = 'closed' ORDER BY id DESC LIMIT 2");
    await saveNightlyStockValues(db, { at: new Date("2026-10-15T18:59:00Z") }); // 15 Oct, nightly
    await saveShiftStockValue(db, { shift: second, closedAt: new Date("2026-10-16T17:00:00Z") }); // 16 Oct 22:00
    await db.query("UPDATE outlet_stock SET quantity = 4 WHERE product_id = $1 AND outlet_id = 1", [teddy]);
    await saveShiftStockValue(db, { shift: first, closedAt: new Date("2026-10-16T17:40:00Z") }); // 16 Oct 22:40, later
    await db.query("UPDATE outlet_stock SET quantity = 2 WHERE product_id = $1 AND outlet_id = 1", [teddy]);
  });

  it("one row per day and branch, newest first, the last close winning", async () => {
    const res = await list("outlet_id=1");
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r) => [r.day, r.source])).toEqual([
      ["2026-10-16", "close_shift"],
      ["2026-10-15", "nightly"],
    ]);
    // 22:40 had 4 teddies: cost 2,000 + 2,000, sale 4,000 + 4,000.
    expect(figures(res.body.rows[0])).toEqual({ toys: 2, units: 14, cost_value: 4000, retail_value: 8000 });
    expect(res.body.rows[0].outlet_name).toBeTruthy();
    expect(res.body.rows[0].shift_id).not.toBeNull();
    expect(res.body.rows[0].taken_at).toBeTruthy();
  });

  it("filters by date", async () => {
    const res = await list("outlet_id=1&date_from=2026-10-16&date_to=2026-10-16");
    expect(res.body.rows.map((r) => r.day)).toEqual(["2026-10-16"]);
  });

  it("needs the inventory reports permission", async () => {
    const res = await makeRequest(app, 999999).get("/api/reports/stock-value-days");
    expect([401, 403]).toContain(res.status);
  });
});
