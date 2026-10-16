/**
 * ots-supplier-bills-photo.test.js — One Toy Store pilot F9 step (e).
 *
 * POST /api/supplier-bills/read with photos / scanned PDFs. Reading costs
 * money (Sonnet 5.5, about Rs 11 a photo), so it runs only when the screen
 * asks (`use_ai=1`); otherwise the answer says a photo reader is needed and
 * what it would cost. Files a PDF layout reads are not sent to the AI.
 * Owner 2026-10-16: struck / circled lines come back flagged, as printed.
 *
 * The AI is a stand-in (deps.billPhotoReader): no network, no cost.
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");
const { normaliseRead } = require("../../services/bill-readers/photo-reader");
const { makePdf } = require("../helpers/bill-pdf");

const S = Date.now().toString(36);
const JPEG = (n = 0) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, n)]);
const SCAN = Buffer.from("%PDF-1.4\n%no text in this one\n");

const HAFIZ_BILL = [
  ["INVOICE", 269, 30],
  ["Bill", 432, 50], ["No:", 446, 50], ["M100", 527, 50],
  ["Date:", 432, 62], ["03-01-2026", 507, 62],
  ["SR.", 48, 90], ["ITEM", 91, 90], ["NO.", 115, 90], ["DESCRIPTION", 248, 90], ["QTY", 406, 90], ["RATE", 445, 90], ["AMOUNT", 498, 90],
  ["1", 52, 105], ["A-P", 71, 105], ["CLOWN", 156, 105], ["WIG", 194, 105], ["4", 402, 105], ["Rs525", 444, 105], ["Rs2,100.00", 501, 105],
  ["Total", 417, 150], ["Amount:", 439, 150], ["Rs2,100.00", 498, 150],
];

const A2Z = (supplier) => ({
  supplier_name: supplier, bill_number: "171", bill_date: "2026-07-04",
  gross_total: 2540, line_discount_total: 127, bill_discount: null, net_total: 2413,
  lines: [
    { file: 1, line_no: 1, supplier_code: "B-100-12", barcode: "8859335200140", description: "B-100-12", qty: 12, unit: "Pcs", rate: 160, discount_pct: 5, amount: 1920, net_amount: 1824, paper_mark: "none", unsure: false, note: "" },
    { file: 1, line_no: 41, supplier_code: "No 802", barcode: "6971354530229", description: "No 802", qty: 4, unit: "Pcs", rate: 155, discount_pct: 5, amount: 620, net_amount: 589, paper_mark: "struck", unsure: false, note: "" },
  ],
  notes: [],
});

let app, db, cleanup, a2z;
const calls = [];
let nextRead = null;
const fakeReader = async (files) => {
  calls.push(files.map((f) => ({ mimetype: f.mimetype, file_index: f.file_index, file_name: f.file_name })));
  if (nextRead instanceof Error) throw nextRead;
  const r = normaliseRead(nextRead, files.length, files.map((f) => f.file_index));
  r.ai = { model: "claude-sonnet-5-5", files: files.length, input_tokens: 3000, output_tokens: 4000, cost_usd: 0.046, cost_rs: 12.88 };
  return r;
};

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const read = (parts, fields = {}) => {
  let r = admin().post("/api/supplier-bills/read");
  for (const [k, v] of Object.entries(fields)) r = r.field(k, String(v));
  for (const [buf, name] of parts) {
    r = r.attach("files", buf, { filename: name, contentType: name.endsWith(".pdf") ? "application/pdf" : "image/jpeg" });
  }
  return r;
};

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true, deps: { billPhotoReader: fakeReader, billPhotoDailyCap: 7 } }));
  a2z = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", ["A2Z CONSUMERS LAHORE"])).id;
  await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [`HAFIZ NAWAZ ${S}`]);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

beforeEach(() => {
  calls.length = 0;
  nextRead = A2Z("A2Z CONSUMERS");
});

describe("photos: the AI reads only when asked", () => {
  it("without use_ai: needs the photo reader, says the cost, reads nothing", async () => {
    const res = await read([[JPEG(1), "p1.jpeg"], [JPEG(2), "p2.jpeg"]]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ needs_photo_reader: true, ai_ready: true, ai_files: 2, ai_estimate_rs: 22 });
    expect(calls).toHaveLength(0);
  });

  it("with use_ai: both photos to the AI in order; lines come back like a PDF bill", async () => {
    const res = await read([[JPEG(1), "p1.jpeg"], [JPEG(2), "p2.jpeg"]], { use_ai: 1 });
    expect(res.status).toBe(200);
    expect(calls[0].map((f) => [f.file_name, f.file_index])).toEqual([["p1.jpeg", 0], ["p2.jpeg", 1]]);
    expect(res.body).toMatchObject({
      layout: "photo", bill_number: "171", bill_date: "2026-07-04", lines_total: 2540, total_matches: true,
      needs_photo_reader: false, supplier_name_read: "A2Z CONSUMERS",
    });
    expect(res.body.lines.map((l) => [l.line_no, l.barcode, l.qty, l.rate, l.amount, l.discount_pct, l.paper_mark, l.file_index])).toEqual([
      [1, "8859335200140", 12, 160, 1920, 5, null, 0],
      [41, "6971354530229", 4, 155, 620, 5, "struck", 0],
    ]);
    expect(res.body.printed).toMatchObject({ subtotal: 2540, line_discounts: 127, total: 2413 });
    expect(res.body.warnings.join(" ")).toMatch(/Line 41: struck through on the paper/);
    expect(res.body.ai).toMatchObject({ files: 2, cost_rs: 12.88 });
  });

  it("suggests the supplier from the name the AI read", async () => {
    const res = await read([[JPEG(3), "p.jpeg"]], { use_ai: 1 });
    expect(res.body.supplier_suggestion).toMatchObject({ id: a2z });
    const picked = await read([[JPEG(3), "p.jpeg"]], { use_ai: 1, supplier_id: a2z });
    expect(picked.body.supplier_suggestion).toBeNull();
    expect(picked.body.layout_warning).toBeNull();
  });

  it("a PDF its layout reads is not sent to the AI; the photo is, and the lines join up", async () => {
    nextRead = { ...A2Z(""), gross_total: null, net_total: null, line_discount_total: null, lines: [{ ...A2Z("").lines[0], file: 1 }] };
    const res = await read([[makePdf(HAFIZ_BILL), "bill.pdf"], [JPEG(4), "extra.jpeg"]], { use_ai: 1 });
    expect(res.status).toBe(200);
    expect(calls[0].map((f) => [f.file_name, f.file_index])).toEqual([["extra.jpeg", 1]]);
    expect(res.body.lines.map((l) => [l.file_index, l.amount])).toEqual([[0, 2100], [1, 1920]]);
    expect(res.body.layout).toBe("hafiz_bill_no");
    expect(res.body.layout_warning).toBeNull();
  });

  it("a scanned PDF (no text) goes to the AI as a PDF", async () => {
    const res = await read([[SCAN, "scan.pdf"]], { use_ai: 1 });
    expect(res.status).toBe(200);
    expect(calls[0]).toEqual([{ mimetype: "application/pdf", file_index: 0, file_name: "scan.pdf" }]);
    expect(res.body.layout).toBe("photo");
  });

  it("the AI's own error is shown as is", async () => {
    nextRead = Object.assign(new Error("The AI declined to read this bill: type it in instead"), { statusCode: 422 });
    const res = await read([[JPEG(5), "p.jpeg"]], { use_ai: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/declined/);
  });

  it("a daily limit per shop counts photos read (cost safety cap)", async () => {
    // 7 a day here: 2 + (1 + 1) + 1 + 1 + 1 read above (the declined one counts too).
    const res = await read([[JPEG(6), "p.jpeg"]], { use_ai: 1 });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Daily limit/);
    expect(calls).toHaveLength(0);
  });

  it("a bill saved as 'photo' doesn't become the supplier's usual layout", async () => {
    const hafiz = (await one("SELECT id FROM suppliers WHERE name = $1", [`HAFIZ NAWAZ ${S}`])).id;
    await db.query("INSERT INTO supplier_bills (supplier_id, layout, status) VALUES ($1, 'photo', 'saved')", [hafiz]);
    const res = await read([[makePdf(HAFIZ_BILL), "bill.pdf"]], { supplier_id: hafiz });
    expect(res.body.expected_layout).toBe("hafiz_bill_no");
    expect(res.body.layout_warning).toBeNull();
  });
});

describe("no AI key on this server", () => {
  let app2, cleanup2;
  beforeAll(async () => {
    ({ app: app2, cleanup: cleanup2 } = await createTestApp({ registerAll: true, deps: { billPhotoReader: null } }));
  });
  afterAll(async () => {
    if (cleanup2) await cleanup2();
  });

  it("says the photo reader isn't set up", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const plain = await makeRequest(app2, ADMIN_ID).post("/api/supplier-bills/read")
        .attach("files", JPEG(7), { filename: "p.jpeg", contentType: "image/jpeg" });
      expect(plain.body).toMatchObject({ needs_photo_reader: true, ai_ready: false });
      const res = await makeRequest(app2, ADMIN_ID).post("/api/supplier-bills/read").field("use_ai", "1")
        .attach("files", JPEG(7), { filename: "p.jpeg", contentType: "image/jpeg" });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/not set up/);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
