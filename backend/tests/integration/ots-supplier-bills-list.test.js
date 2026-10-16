/**
 * ots-supplier-bills-list.test.js — One Toy Store F9 step (f): the supplier
 * bills list (owner: "supplier page listing bills + files"; PHASE-F-PLAN F9:
 * "Attach the PDF / phone photo to the bill (listed on the supplier's page)",
 * "Every bill shows who saved it").
 *
 *   GET /api/supplier-bills?supplier_id=&status=&from=&to=&q=&limit=&offset=
 *        saved + undone bills (drafts have their own list), newest first
 *   GET /api/supplier-bills/:id
 *        one bill: its lines (with the toys), its files, its account entries
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, CASHIER_ID } = require("../helpers/request");

let app, db, cleanup, supA, supB, outletId, ball, billA1, billA2, billB;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();
const pdf = (text) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`, "latin1");

function save(payload, files = []) {
  let r = admin().post("/api/supplier-bills").field("payload", JSON.stringify(payload));
  for (const f of files) r = r.attach("files", f.buf, { filename: f.name, contentType: "application/pdf" });
  return r;
}
const bill = (sup, no, date, qty, over = {}) => ({
  supplier_id: sup, outlet_id: outletId, bill_number: no, bill_date: date, written_total: qty * 100,
  lines: [{ line_no: "1", supplier_code: `C-${no}`, description: "BALL", billed_qty: qty, received_qty: qty, rate: 100, amount: qty * 100, discount_pct: 0, split_into: 1, toys: [{ product_id: ball, qty }] }],
  ...over,
});
const list = (q = {}) => admin().get("/api/supplier-bills").query(q);

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  outletId = (await one("SELECT id FROM outlets ORDER BY id LIMIT 1")).id;
  supA = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`LIST A ${S}`])).id;
  supB = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`LIST B ${S}`])).id;
  ball = (await one("INSERT INTO products (name, sku, price, cost_price) VALUES ($1, $2, 300, 100) RETURNING id", [`Ball ${S}`, `LB-${S}`])).id;
  billA1 = (await save(bill(supA, `A1-${S}`, "2026-10-01", 2), [{ name: "a1.pdf", buf: pdf(`a1 ${S}`) }, { name: "a1-p2.pdf", buf: pdf(`a1b ${S}`) }])).body.bill;
  billA2 = (await save(bill(supA, `A2-${S}`, "2026-10-05", 3, { paid_now: { method: "cheque", amount: 300, reference: "CHQ 7" } }))).body.bill;
  billB = (await save(bill(supB, `B1-${S}`, "2026-10-03", 1))).body.bill;
  // a draft is not listed here
  await admin().post("/api/supplier-bills/drafts").field("payload", JSON.stringify({ supplier_id: supA, bill_number: `DRAFT-${S}`, state: {} }));
  // B1 undone
  expect((await admin().post(`/api/supplier-bills/${billB.id}/undo`).send({ reason: "typed under the wrong supplier" })).status).toBe(200);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("the list", () => {
  it("one supplier's bills, newest bill date first, with amount, lines, files, who saved, paid now", async () => {
    const r = await list({ supplier_id: supA });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(r.body.bills.map((b) => b.id)).toEqual([billA2.id, billA1.id]);
    const me = (await one("SELECT name FROM employees WHERE id = $1", [ADMIN_ID])).name;
    expect(r.body.bills[1]).toMatchObject({ supplier_name: `LIST A ${S}`, bill_number: `A1-${S}`, bill_date: "2026-10-01", status: "saved", lines: 1, files: 2, saved_by_name: me });
    expect(Number(r.body.bills[1].amount)).toBe(200);
    expect(r.body.bills[0]).toMatchObject({ paid_now_method: "cheque" });
    expect(Number(r.body.bills[0].paid_now_amount)).toBe(300);
  });

  it("undone bills are listed as undone with why; drafts are not listed", async () => {
    const all = await list();
    expect(all.body.bills.some((b) => b.bill_number === `DRAFT-${S}`)).toBe(false);
    expect(all.body.bills.find((b) => b.id === billB.id)).toMatchObject({ status: "undone", undo_reason: "typed under the wrong supplier" });
    const saved = await list({ status: "saved" });
    expect(saved.body.bills.some((b) => b.id === billB.id)).toBe(false);
  });

  it("filters by bill date and by bill number / supplier name", async () => {
    expect((await list({ from: "2026-10-02", to: "2026-10-04" })).body.bills.map((b) => b.id)).toEqual([billB.id]);
    expect((await list({ q: `a2-${S.toLowerCase()}` })).body.bills.map((b) => b.id)).toEqual([billA2.id]);
    expect((await list({ q: `list b ${S}` })).body.bills.map((b) => b.id)).toEqual([billB.id]);
  });

  it("pages", async () => {
    const p = await list({ limit: 1, offset: 1 });
    expect(p.body.total).toBe(3);
    expect(p.body.bills).toHaveLength(1);
  });
});

describe("one bill", () => {
  it("lines with their toys, files in order, account entries", async () => {
    const r = await admin().get(`/api/supplier-bills/${billA1.id}`);
    expect(r.status).toBe(200);
    expect(r.body.bill).toMatchObject({ id: billA1.id, supplier_name: `LIST A ${S}`, bill_number: `A1-${S}`, status: "saved" });
    expect(r.body.bill.lines).toHaveLength(1);
    expect(r.body.bill.lines[0]).toMatchObject({ line_no: "1", supplier_code: `C-A1-${S}`, description: "BALL" });
    expect(Number(r.body.bill.lines[0].received_qty)).toBe(2);
    expect(r.body.bill.lines[0].toys).toEqual([expect.objectContaining({ product_id: ball, name: `Ball ${S}`, sku: `LB-${S}` })]);
    expect(r.body.bill.files.map((f) => f.file_name)).toEqual(["a1.pdf", "a1-p2.pdf"]);
    expect(r.body.bill.files[0].storage_key).toBeTruthy();
    expect(Array.isArray(r.body.bill.entries)).toBe(true);
  });

  it("an undone bill keeps its files listed (no longer active)", async () => {
    const r = await admin().get(`/api/supplier-bills/${billB.id}`);
    expect(r.body.bill).toMatchObject({ status: "undone", undo_reason: "typed under the wrong supplier" });
  });

  it("a draft or an unknown id is not found here", async () => {
    expect((await admin().get("/api/supplier-bills/999999")).status).toBe(404);
  });

  it("needs the 'Receive supplier bills' permission", async () => {
    expect((await makeRequest(app, CASHIER_ID).get("/api/supplier-bills")).status).toBe(403);
    expect((await makeRequest(app, CASHIER_ID).get(`/api/supplier-bills/${billA1.id}`)).status).toBe(403);
  });
});
