/**
 * One Toy Store pilot F9 step (e): the photo reader. Photographed / handwritten
 * supplier bills and scanned PDFs are read by Claude (owner: Sonnet 5.5, about
 * Rs 11 a photo) into the SAME line shape the PDF readers give, so matching,
 * new toys and saving work unchanged. Owner 2026-10-16: lines struck through
 * or circled on the paper are read as printed and only flagged; the owner sets
 * the pieces received.
 *
 * A fake client stands in for the API: no network, no cost.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readBillPhotos, PHOTO_MODEL, normaliseRead, costOf, photoReaderOn } = require("../../services/bill-readers/photo-reader");

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = Buffer.from("%PDF-1.4 scanned");

// What the model sends back for the A2Z printed invoice (2 photos), cut down.
const A2Z = {
  supplier_name: "A2Z CONSUMERS",
  bill_number: "171",
  bill_date: "2026-07-04",
  gross_total: 3570 + 1700 + 840,
  line_discount_total: 178.5 + 85 + 42,
  bill_discount: null,
  net_total: 3391.5 + 1615 + 798,
  lines: [
    { file: 1, line_no: 33, supplier_code: "No 8835", barcode: "2112345678906", description: "No 8835", qty: 6, unit: "Pcs", rate: 595, discount_pct: 5, amount: 3570, net_amount: 3391.5, paper_mark: "none", unsure: false, note: "" },
    { file: 2, line_no: 34, supplier_code: "No 607", barcode: "2112345678962", description: "No 607", qty: 4, unit: "Pcs", rate: 425, discount_pct: 5, amount: 1700, net_amount: 1615, paper_mark: "circled", unsure: false, note: "" },
    { file: 2, line_no: 41, supplier_code: "No 802", barcode: "6971354530229", description: "No 802", qty: 4, unit: "Pcs", rate: 210, discount_pct: 5, amount: 840, net_amount: 798, paper_mark: "struck", unsure: true, note: "barcode hard to read" },
  ],
  notes: [],
};

function fakeClient(body, { stop_reason = "end_turn", usage = { input_tokens: 3200, output_tokens: 5000 } } = {}) {
  const calls = [];
  const finalMessage = async () => ({
    stop_reason,
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
    usage,
  });
  return {
    calls,
    beta: { messages: { stream: (params) => { calls.push(params); return { finalMessage }; } } },
  };
}

const files = [
  { buffer: JPEG, mimetype: "image/jpeg", file_name: "page1.jpeg", file_index: 0 },
  { buffer: JPEG, mimetype: "image/jpeg", file_name: "page2.jpeg", file_index: 1 },
];

describe("the request", () => {
  it("sends every photo in order, labelled, to Sonnet 5.5 with a JSON schema", async () => {
    const client = fakeClient(A2Z);
    await readBillPhotos(files, { client });
    const p = client.calls[0];
    expect(PHOTO_MODEL).toBe("claude-sonnet-5-5");
    expect(p.model).toBe("claude-sonnet-5-5");
    expect(p.output_config.format.type).toBe("json_schema");
    expect(p.fallbacks).toBe("default");
    expect(p.betas).toContain("server-side-fallback-2026-07-01");
    const blocks = p.messages[0].content;
    const kinds = blocks.map((b) => b.type);
    expect(kinds.filter((k) => k === "image")).toHaveLength(2);
    const labels = blocks.filter((b) => b.type === "text").map((b) => b.text);
    expect(labels[0]).toMatch(/File 1/);
    expect(labels[1]).toMatch(/File 2/);
    expect(blocks.indexOf(blocks.find((b) => b.type === "text" && /File 2/.test(b.text)))).toBeGreaterThan(blocks.findIndex((b) => b.type === "image"));
  });

  it("a scanned PDF goes as a document", async () => {
    const client = fakeClient(A2Z);
    await readBillPhotos([{ buffer: PDF, mimetype: "application/pdf", file_name: "scan.pdf", file_index: 0 }], { client });
    const doc = client.calls[0].messages[0].content.find((b) => b.type === "document");
    expect(doc.source).toMatchObject({ type: "base64", media_type: "application/pdf" });
  });

  it("the schema asks for S.No, code, barcode, discount and the pen marks", async () => {
    const client = fakeClient(A2Z);
    await readBillPhotos(files, { client });
    const line = client.calls[0].output_config.format.schema.properties.lines.items;
    for (const k of ["line_no", "supplier_code", "barcode", "qty", "rate", "discount_pct", "amount", "net_amount", "paper_mark", "file"]) {
      expect(line.properties[k]).toBeTruthy();
    }
    expect(line.properties.paper_mark.enum).toEqual(["none", "struck", "circled"]);
    expect(line.additionalProperties).toBe(false);
  });
});

describe("what comes back", () => {
  it("lines in the PDF readers' shape, with their photo and S.No", async () => {
    const r = await readBillPhotos(files, { client: fakeClient(A2Z) });
    expect(r.layout).toBe("photo");
    expect(r.bill_number).toBe("171");
    expect(r.bill_date).toBe("2026-07-04");
    expect(r.supplier_name_read).toBe("A2Z CONSUMERS");
    expect(r.lines[1]).toMatchObject({
      line_no: 34, file_index: 1, page: 1, supplier_code: "No 607", barcode: "2112345678962",
      qty: 4, rate: 425, amount: 1700, discount_pct: 5, check: "ok",
    });
  });

  it("struck / circled lines are kept as printed and flagged", async () => {
    const r = await readBillPhotos(files, { client: fakeClient(A2Z) });
    expect(r.lines).toHaveLength(3);
    expect(r.lines[1].paper_mark).toBe("circled");
    expect(r.lines[2]).toMatchObject({ paper_mark: "struck", qty: 4, unsure: true });
    expect(r.warnings.join(" ")).toMatch(/Line 41: struck through on the paper/);
    expect(r.warnings.join(" ")).toMatch(/Line 34: circled on the paper/);
    expect(r.warnings.join(" ")).toMatch(/Line 41: .*barcode hard to read/);
  });

  it("gross lines add up to the gross total; line discounts are not a bill discount", async () => {
    const r = await readBillPhotos(files, { client: fakeClient(A2Z) });
    expect(r.lines_total).toBe(6110);
    expect(r.printed).toMatchObject({ subtotal: 6110, total: 5804.5, line_discounts: 305.5 });
    expect(r.printed.discount ?? null).toBeNull();
    expect(r.total_matches).toBe(true);
  });

  it("qty × rate ≠ amount is flagged, never corrected", async () => {
    const bad = { ...A2Z, lines: [{ ...A2Z.lines[0], amount: 3750 }] };
    const r = await readBillPhotos(files.slice(0, 1), { client: fakeClient(bad) });
    expect(r.lines[0]).toMatchObject({ amount: 3750, expected_amount: 3570, check: "mismatch" });
    expect(r.total_matches).toBe(false);
  });

  it("a handwritten cash memo: 96 pcs × 925 = 88,800, no discount", () => {
    const memo = {
      supplier_name: "", bill_number: "98", bill_date: "", gross_total: 88800, line_discount_total: null, bill_discount: null, net_total: 88800,
      lines: [{ file: 1, line_no: null, supplier_code: "", barcode: "", description: "Pepsi + Pant + Spl", qty: 96, unit: "Pcs", rate: 925, discount_pct: null, amount: 88800, net_amount: null, paper_mark: "none", unsure: false, note: "" }],
      notes: ["Date not readable"],
    };
    const r = normaliseRead(memo, 1);
    expect(r.lines[0]).toMatchObject({ line_no: 1, qty: 96, rate: 925, amount: 88800, discount_pct: 0, check: "ok" });
    expect(r.total_matches).toBe(true);
    expect(r.bill_date).toBeNull();
    expect(r.warnings).toContain("Date not readable");
  });

  it("only a net amount printed: the amount before discount is worked back", () => {
    const r = normaliseRead({ ...A2Z, lines: [{ ...A2Z.lines[0], amount: null }] }, 1);
    expect(r.lines[0].amount).toBe(3570);
  });

  it("a whole-bill discount stays a bill discount", () => {
    const r = normaliseRead({ ...A2Z, line_discount_total: null, bill_discount: 500, lines: [{ ...A2Z.lines[0], discount_pct: null, net_amount: null }] }, 1);
    expect(r.printed.discount).toBe(500);
  });
});

describe("cost and stops", () => {
  it("cost from the usage at Sonnet 5.5 prices ($2 in / $10 out per million)", () => {
    const c = costOf({ input_tokens: 1_000_000, output_tokens: 100_000 }, 280);
    expect(c.cost_usd).toBe(3);
    expect(c.cost_rs).toBe(840);
  });

  it("the reading reports its cost and photo count", async () => {
    const r = await readBillPhotos(files, { client: fakeClient(A2Z), usdToRs: 280 });
    expect(r.ai).toMatchObject({ model: "claude-sonnet-5-5", files: 2, input_tokens: 3200, output_tokens: 5000 });
    expect(r.ai.cost_rs).toBe(Math.round((3200 * 2 + 5000 * 10) / 1e6 * 280 * 100) / 100);
  });

  it("a refusal is a plain error, not a crash", async () => {
    await expect(readBillPhotos(files, { client: fakeClient("", { stop_reason: "refusal" }) }))
      .rejects.toThrow(/AI declined to read/);
  });

  it("cut off mid-answer: a clear error", async () => {
    await expect(readBillPhotos(files, { client: fakeClient('{"lines": [', { stop_reason: "max_tokens" }) }))
      .rejects.toThrow(/too long/);
  });
});

// Owner 2026-10-19: deploy with photo reading OFF; it goes on only after a
// real-photo trial, by setting SUPPLIER_BILL_PHOTO_READER=1. An AI key alone
// (Railway already has one for other features) must not switch it on.
describe("photoReaderOn: off unless switched on", () => {
  it("a key alone leaves it off", () => {
    expect(photoReaderOn({ ANTHROPIC_API_KEY: "k" })).toBe(false);
  });
  it("on with the switch and a key", () => {
    expect(photoReaderOn({ ANTHROPIC_API_KEY: "k", SUPPLIER_BILL_PHOTO_READER: "1" })).toBe(true);
  });
  it("the switch without a key stays off", () => {
    expect(photoReaderOn({ SUPPLIER_BILL_PHOTO_READER: "1" })).toBe(false);
  });
  it("any value but 1 is off", () => {
    for (const v of ["0", "", "true", "yes"]) {
      expect(photoReaderOn({ ANTHROPIC_API_KEY: "k", SUPPLIER_BILL_PHOTO_READER: v })).toBe(false);
    }
  });
});
