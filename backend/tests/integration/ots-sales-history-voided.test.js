/**
 * ots-sales-history-voided.test.js — One Toy Store pilot F6 (defect D47).
 *
 * Sales History never listed a voided bill: GET /api/sales always left them
 * out, and the page's All / Completed / Voided tabs only sorted the 50 bills
 * already loaded. Owner, 2026-10-19:
 *   - "All" lists every bill (voided ones marked), "Completed" hides voided,
 *     "Voided" shows only voided; the Voided counter covers the chosen dates
 *     and search, not just the page;
 *   - a voided bill shows the reason AND who voided it and when — saved from
 *     now on (migration v161: sales.voided_by / voided_at); older voids show
 *     the reason only.
 * Other callers (dashboard Recent Sales, till reprint list, return search)
 * send no status and keep getting voided bills left out.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, MANAGER_ID } = require("../helpers/request");

let app, db, cleanup;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
let active, voidedNow, voidedOld, toyId;

async function sale(no, amount, { voided = false, reason = null } = {}) {
  const s = await one(
    `INSERT INTO sales (total_amount, payment_method, outlet_id, voided, void_reason, invoice_number)
     VALUES ($1, 'Cash', 1, $2, $3, $4) RETURNING id`, [amount, voided, reason, no]);
  await db.query(
    "INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, cost_price_at_sale) VALUES ($1, $2, 1, $3, 0)",
    [s.id, toyId, amount]);
  return s.id;
}

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  await db.query("TRUNCATE sales, returns RESTART IDENTITY CASCADE");
  toyId = (await one("INSERT INTO products (name, price, cost_price, gst, tax_id) VALUES ('F6 toy', 100, 50, 0, NULL) RETURNING id")).id;
  await db.query("INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, 10) ON CONFLICT (product_id, outlet_id) DO NOTHING", [toyId]);
  active = await sale("F6-ACTIVE", 100);
  voidedOld = await sale("F6-OLDVOID", 300, { voided: true, reason: "old test void" });
  voidedNow = await sale("F6-VOIDNOW", 200);
  const res = await makeRequest(app, MANAGER_ID).put(`/api/sales/${voidedNow}/void`).send({ void_reason: "wrong toy rung" });
  expect(res.status).toBe(200);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const list = async (q) => {
  const res = await makeRequest(app, ADMIN_ID).get(`/api/sales?${q}`);
  expect(res.status).toBe(200);
  return res.body;
};
const nos = (b) => b.sales.map((s) => s.invoice_number).sort();

describe("F6 — a void records who and when", () => {
  it("the void route saves voided_by and voided_at", async () => {
    const s = await one("SELECT voided, void_reason, voided_by, voided_at FROM sales WHERE id = $1", [voidedNow]);
    expect(s).toMatchObject({ voided: true, void_reason: "wrong toy rung", voided_by: MANAGER_ID });
    expect(s.voided_at).toBeTruthy();
  });
});

describe("F6 — Sales History status filter", () => {
  it("no status: voided bills stay hidden (dashboard, till reprint, return search)", async () => {
    const b = await list("limit=50");
    expect(nos(b)).toEqual(["F6-ACTIVE"]);
    expect(b.total).toBe(1);
  });

  it("status=all lists every bill, with the voided counter for the same filter", async () => {
    const b = await list("status=all&limit=50");
    expect(nos(b)).toEqual(["F6-ACTIVE", "F6-OLDVOID", "F6-VOIDNOW"]);
    expect(b.total).toBe(3);
    expect(b.voided_count).toBe(2);
  });

  it("status=completed hides voided; status=voided shows only them", async () => {
    expect(nos(await list("status=completed&limit=50"))).toEqual(["F6-ACTIVE"]);
    const v = await list("status=voided&limit=50");
    expect(nos(v)).toEqual(["F6-OLDVOID", "F6-VOIDNOW"]);
    expect(v.total).toBe(2);
    expect(v.voided_count).toBe(2);
  });

  it("the voided counter follows the search", async () => {
    const b = await list("status=all&search=F6-VOIDNOW&limit=50");
    expect(b.total).toBe(1);
    expect(b.voided_count).toBe(1);
  });

  it("a voided row carries the reason and who/when (null for an old void)", async () => {
    const b = await list("status=voided&limit=50");
    const now = b.sales.find((s) => s.invoice_number === "F6-VOIDNOW");
    expect(now).toMatchObject({ void_reason: "wrong toy rung", voided_by_name: expect.any(String) });
    expect(now.voided_by_name.length).toBeGreaterThan(0);
    expect(now.voided_at).toBeTruthy();
    const old = b.sales.find((s) => s.invoice_number === "F6-OLDVOID");
    expect(old).toMatchObject({ void_reason: "old test void", voided_by_name: null, voided_at: null });
  });

  it("an unknown status is refused", async () => {
    const res = await makeRequest(app, ADMIN_ID).get("/api/sales?status=deleted");
    expect(res.status).toBe(400);
  });

  it("the bill detail carries who voided it and when", async () => {
    const res = await makeRequest(app, ADMIN_ID).get(`/api/sales/${voidedNow}`);
    expect(res.status).toBe(200);
    const s = res.body.sale || res.body;
    expect(s.voided_by_name).toBeTruthy();
    expect(s.voided_at).toBeTruthy();
  });
});
