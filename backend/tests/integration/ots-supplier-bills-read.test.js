/**
 * ots-supplier-bills-read.test.js — One Toy Store F9 step (b):
 * POST /api/supplier-bills/read reads an uploaded bill PDF by word position
 * and saves nothing. The PDF here is built by the test (Hafiz Nawaz's
 * "Bill No" layout, which prints no supplier name).
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, CASHIER_ID } = require("../helpers/request");

let app, db, cleanup, hafiz, other;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();

const { makePdf } = require("../helpers/bill-pdf");

const HAFIZ_BILL = [
  ["INVOICE", 269, 30],
  ["To:-", 41, 50], ["Bill", 432, 50], ["No:", 446, 50], ["M100", 527, 50],
  ["Date:", 432, 62], ["03-01-2026", 507, 62],
  ["SR.", 48, 90], ["ITEM", 91, 90], ["NO.", 115, 90], ["DESCRIPTION", 248, 90], ["QTY", 406, 90], ["RATE", 445, 90], ["AMOUNT", 498, 90],
  ["1", 52, 105], ["A-P", 71, 105], ["CLOWN", 156, 105], ["WIG", 194, 105], ["4", 402, 105], ["Rs525", 444, 105], ["Rs2,100.00", 501, 105],
  ["2", 52, 120], ["W199", 71, 120], ["ELSA", 156, 120], ["WIG", 183, 120], ["3", 402, 120], ["Rs850", 444, 120], ["Rs2,550.00", 501, 120],
  ["Total", 417, 150], ["Amount:", 439, 150], ["Rs4,650.00", 498, 150],
];

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  hafiz = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`HAFIZ NAWAZ ${S}`])).id;
  other = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`BABY LAND LAHORE ${S}`])).id;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const read = (buf, name = "bill.pdf", fields = {}) => {
  let r = admin().post("/api/supplier-bills/read");
  for (const [k, v] of Object.entries(fields)) r = r.field(k, String(v));
  return r.attach("files", buf, { filename: name, contentType: name.endsWith(".pdf") ? "application/pdf" : "image/jpeg" });
};

describe("POST /api/supplier-bills/read", () => {
  it("reads the lines, bill number, date and total; checks every line and the total", async () => {
    const res = await read(makePdf(HAFIZ_BILL));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ layout: "hafiz_bill_no", bill_number: "M100", bill_date: "2026-01-03", lines_total: 4650, total_matches: true });
    expect(res.body.lines.map((l) => [l.line_no, l.supplier_code, l.description, l.qty, l.rate, l.amount, l.check])).toEqual([
      ["1", "A-P", "CLOWN WIG", 4, 525, 2100, "ok"],
      ["2", "W199", "ELSA WIG", 3, 850, 2550, "ok"],
    ]);
    expect(res.body.files[0]).toMatchObject({ file_name: "bill.pdf", kind: "pdf", already: null });
    expect(res.body.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("saves nothing", async () => {
    const n = await one("SELECT (SELECT COUNT(*) FROM supplier_bills)::int AS b, (SELECT COUNT(*) FROM supplier_bill_files)::int AS f");
    expect(n).toEqual({ b: 0, f: 0 });
  });

  it("suggests the supplier for a layout with no supplier name printed", async () => {
    const res = await read(makePdf(HAFIZ_BILL));
    expect(res.body.supplier_suggestion).toMatchObject({ id: hafiz });
  });

  it("warns when the picked supplier's bills usually look different", async () => {
    const res = await read(makePdf(HAFIZ_BILL), "bill.pdf", { supplier_id: other });
    expect(res.body.expected_layout).toBe("babyland_estimate");
    expect(res.body.layout_warning).toMatch(/usually look like/);
    const ok = await read(makePdf(HAFIZ_BILL), "bill.pdf", { supplier_id: hafiz });
    expect(ok.body.layout_warning).toBeNull();
    expect(ok.body.supplier_suggestion).toBeNull();
  });

  it("remembers the layout from the supplier's earlier bills", async () => {
    const renamed = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`Shop with no hint ${S}`])).id;
    await db.query("INSERT INTO supplier_bills (supplier_id, layout, status) VALUES ($1, 'hafiz_bill_no', 'saved')", [renamed]);
    const res = await read(makePdf(HAFIZ_BILL));
    expect(res.body.supplier_suggestion).toMatchObject({ id: renamed });
  });

  it("says when the very same file is already on a bill", async () => {
    const buf = makePdf(HAFIZ_BILL);
    const crypto = require("crypto");
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    const bill = (await one("INSERT INTO supplier_bills (supplier_id, bill_number, status) VALUES ($1, 'M100', 'saved') RETURNING id", [hafiz])).id;
    await db.query("INSERT INTO supplier_bill_files (bill_id, file_name, sha256) VALUES ($1, 'm100.pdf', $2)", [bill, sha]);
    const res = await read(buf);
    expect(res.body.files[0].already).toMatchObject({ bill_id: bill, bill_number: "M100", status: "saved" });
  });

  it("a photo is accepted but needs the photo reader", async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
    const res = await read(jpeg, "memo.jpg");
    expect(res.status).toBe(200);
    expect(res.body.needs_photo_reader).toBe(true);
    expect(res.body.files[0].kind).toBe("image");
  });

  it("an AI key alone does not switch the photo reader on (owner 2026-10-19: off until a real-photo trial)", async () => {
    const before = { key: process.env.ANTHROPIC_API_KEY, sw: process.env.SUPPLIER_BILL_PHOTO_READER };
    process.env.ANTHROPIC_API_KEY = "test-key-not-used";
    delete process.env.SUPPLIER_BILL_PHOTO_READER;
    try {
      const res = await read(makePdf(HAFIZ_BILL));
      expect(res.status).toBe(200);
      expect(res.body.ai_ready).toBe(false);
    } finally {
      if (before.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = before.key;
      if (before.sw !== undefined) process.env.SUPPLIER_BILL_PHOTO_READER = before.sw;
    }
  });

  it("refuses a file that isn't a PDF or image, or pretends to be one", async () => {
    const bad = await admin().post("/api/supplier-bills/read").attach("files", Buffer.from("hello"), { filename: "x.txt", contentType: "text/plain" });
    expect(bad.status).toBe(400);
    const fake = await read(Buffer.from("not really a pdf"), "fake.pdf");
    expect(fake.status).toBe(400);
  });

  it("needs the 'Receive supplier bills' permission", async () => {
    const res = await makeRequest(app, CASHIER_ID).post("/api/supplier-bills/read")
      .attach("files", makePdf(HAFIZ_BILL), { filename: "bill.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(403);
  });
});
