/**
 * ots-supplier-bills-drafts.test.js — One Toy Store F9 step (f): drafts.
 * Owner decision (PHASE-F-PLAN F9, "Drafts"): a bill can be saved as a draft
 * and finished later; a draft changes nothing (no stock, no supplier money)
 * until the final Save; drafts are listed as "Draft" with who started them.
 *
 *   POST   /api/supplier-bills/drafts      multipart: payload {draft_id?, supplier_id, outlet_id,
 *                                          bill_number, bill_date, state} + new files
 *   GET    /api/supplier-bills/drafts      the open drafts
 *   GET    /api/supplier-bills/drafts/:id  one draft: the check screen as it was + its files
 *   DELETE /api/supplier-bills/drafts/:id  throw a draft away
 *   POST   /api/supplier-bills {draft_id}  finish it: the same bill becomes saved, its files kept
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, CASHIER_ID } = require("../helpers/request");

let app, db, cleanup, sup, outletId, ball, draftId;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const count = async (sql, params = []) => Number((await one(sql, params)).n);
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();
const pdf = (text) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`, "latin1");
const FILE = pdf(`draft ${S}`);
const stockOf = async () => Number((await one("SELECT COALESCE(SUM(quantity),0) AS q FROM outlet_stock WHERE product_id = $1", [ball])).q);

const STATE = {
  header: { bill_number: `DR-${S}`, bill_date: "2026-10-10", written_total: "300", differs: false, differs_note: "", account_amount: "300" },
  result: { layout: "hafiz_bill_no", files: [{ file_name: "bill.pdf", kind: "pdf" }], lines: [{ line_no: 1, amount: 300 }], lines_total: 300, printed: { total: 300 } },
  lines: [{ key: "0", line_no: 1, received: "3", toys: [{ product_id: 0, qty: 3 }] }],
  paidNow: { method: "", amount: "", reference: "" },
};

function postDraft(payload, files = []) {
  let r = admin().post("/api/supplier-bills/drafts").field("payload", JSON.stringify(payload));
  for (const f of files) r = r.attach("files", f.buf, { filename: f.name, contentType: "application/pdf" });
  return r;
}
const draftPayload = (over = {}) => ({ supplier_id: sup, outlet_id: outletId, bill_number: `DR-${S}`, bill_date: "2026-10-10", state: STATE, ...over });
const finalBill = (over = {}) => ({
  supplier_id: sup, outlet_id: outletId, bill_number: `DR-${S}`, bill_date: "2026-10-10", layout: "hafiz_bill_no", written_total: 300,
  lines: [{ line_no: "1", page: 1, file_index: 0, billed_qty: 3, received_qty: 3, rate: 100, amount: 300, discount_pct: 0, split_into: 1, toys: [{ product_id: ball, qty: 3 }] }],
  ...over,
});
const saveBill = (payload, files = []) => {
  let r = admin().post("/api/supplier-bills").field("payload", JSON.stringify(payload));
  for (const f of files) r = r.attach("files", f.buf, { filename: f.name, contentType: "application/pdf" });
  return r;
};

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  outletId = (await one("SELECT id FROM outlets ORDER BY id LIMIT 1")).id;
  sup = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`DRAFT SUP ${S}`])).id;
  ball = (await one("INSERT INTO products (name, sku, price, cost_price) VALUES ($1, $2, 300, 100) RETURNING id", [`Ball ${S}`, `DB-${S}`])).id;
  STATE.lines[0].toys[0].product_id = ball;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("saving a draft", () => {
  let res, stockBefore;
  beforeAll(async () => {
    stockBefore = await stockOf();
    res = await postDraft(draftPayload(), [{ name: "bill.pdf", buf: FILE }]);
    draftId = res.body.draft?.id;
  });

  it("is kept as a Draft", () => {
    expect(res.status).toBe(201);
    expect(res.body.draft).toMatchObject({ status: "draft", bill_number: `DR-${S}`, supplier_id: sup });
  });

  it("changes nothing: no stock, no supplier money, no delivery note, no codes learned", async () => {
    expect(await stockOf()).toBe(stockBefore);
    expect(await count("SELECT COUNT(*) AS n FROM supplier_invoices WHERE supplier_id = $1", [sup])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM goods_received_notes WHERE supplier_id = $1", [sup])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM supplier_item_codes WHERE supplier_id = $1", [sup])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM supplier_bill_lines WHERE bill_id = $1", [draftId])).toBe(0);
  });

  it("keeps the bill's file with the draft", async () => {
    const f = await one("SELECT file_name, active FROM supplier_bill_files WHERE bill_id = $1", [draftId]);
    expect(f).toMatchObject({ file_name: "bill.pdf", active: true });
  });

  it("is listed with the supplier, the bill and who started it", async () => {
    const me = (await one("SELECT name FROM employees WHERE id = $1", [ADMIN_ID])).name;
    const r = await admin().get("/api/supplier-bills/drafts");
    expect(r.status).toBe(200);
    const d = r.body.drafts.find((x) => x.id === draftId);
    expect(d).toMatchObject({ supplier_name: `DRAFT SUP ${S}`, bill_number: `DR-${S}`, bill_date: "2026-10-10", started_by_name: me, lines: 1, files: 1 });
  });

  it("opens as it was left, with its files", async () => {
    const r = await admin().get(`/api/supplier-bills/drafts/${draftId}`);
    expect(r.status).toBe(200);
    expect(r.body.draft).toMatchObject({ id: draftId, supplier_id: sup, outlet_id: outletId, state: STATE });
    expect(r.body.draft.files.map((f) => f.file_name)).toEqual(["bill.pdf"]);
  });

  it("saving the draft again updates it (still one draft)", async () => {
    const state = { ...STATE, header: { ...STATE.header, written_total: "301" } };
    const r = await postDraft(draftPayload({ draft_id: draftId, state }));
    expect(r.status).toBe(200);
    expect(r.body.draft.id).toBe(draftId);
    const o = await admin().get(`/api/supplier-bills/drafts/${draftId}`);
    expect(o.body.draft.state.header.written_total).toBe("301");
    expect(await count("SELECT COUNT(*) AS n FROM supplier_bills WHERE supplier_id = $1", [sup])).toBe(1);
  });

  it("its file can't go on another bill meanwhile", async () => {
    const r = await saveBill(finalBill({ bill_number: `OTHER-${S}` }), [{ name: "copy.pdf", buf: FILE }]);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/already on the draft of bill/i);
    const d = await postDraft(draftPayload({ bill_number: `OTHER-${S}` }), [{ name: "copy.pdf", buf: FILE }]);
    expect(d.status).toBe(409);
  });

  it("needs the 'Receive supplier bills' permission", async () => {
    expect((await makeRequest(app, CASHIER_ID).get("/api/supplier-bills/drafts")).status).toBe(403);
    expect((await makeRequest(app, CASHIER_ID).get(`/api/supplier-bills/drafts/${draftId}`)).status).toBe(403);
  });
});

describe("finishing a draft", () => {
  let res, stockBefore;
  beforeAll(async () => {
    stockBefore = await stockOf();
    res = await saveBill(finalBill({ draft_id: draftId }));
  });

  it("the same bill becomes saved, the screen state cleared", async () => {
    expect(res.status).toBe(201);
    expect(res.body.bill).toMatchObject({ id: draftId, status: "saved" });
    const b = await one("SELECT draft_state, saved_by, saved_at FROM supplier_bills WHERE id = $1", [draftId]);
    expect(b.draft_state).toBeNull();
    expect(b.saved_by).toBe(ADMIN_ID);
    expect(b.saved_at).toBeTruthy();
  });

  it("only now: stock in and the bill on the supplier's account", async () => {
    expect(await stockOf()).toBe(stockBefore + 3);
    expect(await count("SELECT COUNT(*) AS n FROM supplier_invoices WHERE supplier_id = $1", [sup])).toBe(1);
  });

  it("keeps the draft's file, linked to the lines", async () => {
    const f = await one("SELECT id FROM supplier_bill_files WHERE bill_id = $1", [draftId]);
    const l = await one("SELECT file_id FROM supplier_bill_lines WHERE bill_id = $1", [draftId]);
    expect(l.file_id).toBe(f.id);
  });

  it("is no longer a draft: not listed, can't be finished or opened again", async () => {
    expect((await admin().get("/api/supplier-bills/drafts")).body.drafts.some((x) => x.id === draftId)).toBe(false);
    expect((await admin().get(`/api/supplier-bills/drafts/${draftId}`)).status).toBe(404);
    const again = await saveBill(finalBill({ draft_id: draftId, same_number_ok: true }));
    expect(again.status).toBe(409);
    expect(await stockOf()).toBe(stockBefore + 3);
  });
});

describe("throwing a draft away", () => {
  it("removes it and frees its file", async () => {
    const buf = pdf(`thrown ${S}`);
    const d = await postDraft(draftPayload({ bill_number: `TH-${S}` }), [{ name: "t.pdf", buf }]);
    expect(d.status).toBe(201);
    const del = await admin().delete(`/api/supplier-bills/drafts/${d.body.draft.id}`);
    expect(del.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM supplier_bills WHERE id = $1", [d.body.draft.id])).toBe(0);
    const again = await postDraft(draftPayload({ bill_number: `TH-${S}` }), [{ name: "t.pdf", buf }]);
    expect(again.status).toBe(201);
  });

  it("a saved bill can't be thrown away as a draft", async () => {
    expect((await admin().delete(`/api/supplier-bills/drafts/${draftId}`)).status).toBe(404);
    expect(await count("SELECT COUNT(*) AS n FROM supplier_bills WHERE id = $1", [draftId])).toBe(1);
  });
});
