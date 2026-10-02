/**
 * One Toy Store pilot F9 step (b): reading a supplier's PDF bill by word
 * position (no AI). Three layouts the shop gets today (PHASE-F-PLAN F9):
 *   hafiz_bill_no   "INVOICE / Bill No 01 / M100" (Hafiz Nawaz; no supplier name printed)
 *   babyland_estimate  "SALES ESTIMATE" (Baby Land; numbers printed a little above the row)
 *   tt_invoice      "#INV-226xx" CODE NAME PKG CTN PCS T QTY PRICE T PRICE
 *                   (Toys and Toys; headings on page 1 only)
 * Every line is checked qty × rate = amount, and the lines are added up
 * against the total printed on the bill.
 *
 * The fixtures are made-up words in the same places as the real bills (the
 * real bills are git-ignored); the last block reads the real sample PDFs when
 * they are on this PC.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseBillWords, detectLayout } = require("../../services/bill-readers/layouts");
const { readBillPdf } = require("../../services/bill-readers");

// A word at (x0, top) on a page; about 5 pt per character, 9 pt tall.
const W = (text, x0, top, page = 1, size = 9) => ({
  text, x0, x1: x0 + text.length * size * 0.55, top, bottom: top + size, page,
});
const line = (top, page, ...pairs) => pairs.map(([t, x]) => W(t, x, top, page));

describe("Hafiz Nawaz 'Bill No' layout", () => {
  const words = [
    ...line(30, 1, ["INVOICE", 269]),
    ...line(50, 1, ["To:-", 41], ["Bill", 432], ["No:", 446], ["01", 542]),
    ...line(62, 1, ["ONE", 41], ["SHOP", 61], ["Date:", 432], ["30-Dec-2025", 506]),
    ...line(90, 1, ["SR.", 48], ["ITEM", 91], ["NO.", 115], ["DESCRIPTION", 248], ["QTY", 406], ["RATE", 445], ["AMOUNT", 498]),
    ...line(105, 1, ["1", 52], ["939-55", 70], ["PET", 154], ["SET", 173], ["2", 413], ["Rs2,275", 447], ["Rs4,550.00", 505]),
    // a wrapped row: description + rate + amount on the line above its S.No line
    ...line(117, 1, ["BEAUTY", 154], ["SET", 194], ["Rs425", 454], ["Rs2,550.00", 505]),
    ...line(120, 1, ["2", 52], ["22191-1", 70], ["6", 413]),
    ...line(135, 1, ["3", 52], ["B0444", 70], ["[B0444]", 151], ["CAPTAIN", 190], ["SHIELD", 230], ["10", 411], ["Rs995", 454], ["Rs9,950.00", 503]),
    ...line(770, 1, ["Page", 292], ["1", 306], ["of", 310], ["2", 316]),
    // page 2 starts with the top half of a wrapped row
    ...line(90, 2, ["SR.", 48], ["ITEM", 91], ["NO.", 115], ["DESCRIPTION", 248], ["QTY", 406], ["RATE", 445], ["AMOUNT", 498]),
    ...line(102, 2, ["[AV-6]", 151], ["BATMAN", 182], ["Rs1,975", 449], ["Rs3,950.00", 505]),
    ...line(105, 2, ["4", 50], ["AV-6", 71], ["2", 415]),
    ...line(132, 2, ["Total", 417], ["Amount:", 439], ["Rs21,000.00", 498]),
    ...line(770, 2, ["Page", 292], ["2", 306], ["of", 310], ["2", 316]),
  ];

  it("is recognised by its headings", () => {
    expect(detectLayout(words)).toBe("hafiz_bill_no");
  });

  it("reads bill number, date and the printed total", () => {
    const r = parseBillWords(words);
    expect(r.bill_number).toBe("01");
    expect(r.bill_date).toBe("2025-12-30");
    expect(r.printed.total).toBe(21000);
  });

  it("rebuilds every row, wrapped rows and rows split over a page too", () => {
    const r = parseBillWords(words);
    expect(r.lines.map((l) => [l.line_no, l.page, l.supplier_code, l.description, l.qty, l.rate, l.amount])).toEqual([
      ["1", 1, "939-55", "PET SET", 2, 2275, 4550],
      ["2", 1, "22191-1", "BEAUTY SET", 6, 425, 2550],
      ["3", 1, "B0444", "CAPTAIN SHIELD", 10, 995, 9950],
      ["4", 2, "AV-6", "BATMAN", 2, 1975, 3950],
    ]);
    expect(r.lines.every((l) => l.check === "ok")).toBe(true);
    expect(r.lines_total).toBe(21000);
    expect(r.total_matches).toBe(true);
  });
});

describe("Baby Land 'Sales Estimate' layout", () => {
  const words = [
    ...line(21, 1, ["SALES", 130], ["ESTIMATE", 184]),
    ...line(45, 1, ["CUSTOMER", 13], ["CODE:", 67], ["ONE", 109], ["SHOP", 136], ["No.", 433], ["62695", 476]),
    ...line(63, 1, ["CUSTOMER", 13], ["NAME:", 67], ["Date", 433], ["23-07-2026", 475]),
    ...line(120, 1, ["Amount", 514], ["Rs.", 552]),
    ...line(123, 1, ["S", 22], ["#", 32], ["Product", 52], ["ID", 95], ["Description", 150], ["Qty", 392], ["Unit", 434], ["Price", 461]),
    // numbers a little above the S.No line
    ...line(140, 1, ["1", 398], ["5,450", 456], ["5,450.00", 514]),
    ...line(143, 1, ["1", 32], ["BCR-69866", 53], ["BABY", 150], ["BOUNCER", 180]),
    ...line(158, 1, ["12", 395], ["140", 468], ["1,680.00", 514]),
    ...line(161, 1, ["2", 32], ["BF-6018", 53], ["FEEDER+SB", 150], ["SILICON", 210]),
    ...line(176, 1, ["3", 32], ["BF-837", 53], ["KIDS", 150], ["STRIP", 180], ["6", 398], ["375", 468], ["2,250.00", 514]),
    ...line(270, 1, ["19", 392]),
    ...line(273, 1, ["Received", 16], ["the", 53], ["above", 66], ["Total", 289], ["Qty", 322], ["Total", 429], [":", 478], ["9,380", 531]),
    ...line(300, 1, ["1,116,135", 507]),
    ...line(303, 1, ["Prev", 429], ["Bal", 456], [":", 478]),
    ...line(318, 1, ["Total", 429], ["Bal:", 462], ["1,125,515", 507]),
    ...line(336, 1, ["Due", 429], ["Date", 451], [":", 478], ["10/09/2026", 497]),
  ];

  it("is recognised by its headings", () => {
    expect(detectLayout(words)).toBe("babyland_estimate");
  });

  it("reads bill number, date, total, previous and new balance, due date", () => {
    const r = parseBillWords(words);
    expect(r.bill_number).toBe("62695");
    expect(r.bill_date).toBe("2026-07-23");
    expect(r.printed).toMatchObject({ total: 9380, prev_balance: 1116135, total_balance: 1125515, due_date: "2026-09-10" });
  });

  it("puts the numbers printed above a row on that row", () => {
    const r = parseBillWords(words);
    expect(r.lines.map((l) => [l.line_no, l.supplier_code, l.description, l.qty, l.rate, l.amount])).toEqual([
      ["1", "BCR-69866", "BABY BOUNCER", 1, 5450, 5450],
      ["2", "BF-6018", "FEEDER+SB SILICON", 12, 140, 1680],
      ["3", "BF-837", "KIDS STRIP", 6, 375, 2250],
    ]);
    expect(r.total_matches).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});

describe("Toys and Toys 'INV-226xx' layout", () => {
  const words = [
    ...line(30, 1, ["Invoice", 404], ["#INV-22670", 468]),
    ...line(45, 1, ["Invoice", 459], ["Date:", 492], ["08-08-2026", 517]),
    ...line(75, 1, ["HASSAAN", 40], ["SB", 89], ["(ONE", 105], ["SHOP)", 131]),
    ...line(100, 1, ["#", 32], ["CODE", 48], ["NAME", 105], ["PKG", 358], ["CTN", 385], ["PCS", 412], ["T", 437], ["QTY", 446], ["PRICE", 475], ["T", 512], ["PRICE", 521]),
    ...line(115, 1, ["1", 32], ["050-82", 48], ["WRITING", 105], ["BOARD", 145], ["18", 358], ["0", 385], ["2", 412], ["2", 437], ["4495", 475], ["8,990", 512]),
    ...line(130, 1, ["2", 32], ["44669", 48], ["INTEX", 105], ["AIR", 133], ["24", 358], ["1", 385], ["0", 412], ["24", 437], ["810", 475], ["19,440", 512]),
    // page 2 has no headings
    ...line(33, 2, ["3", 32], ["MBK-325", 48], ["48", 358], ["0", 385], ["2", 412], ["2", 437], ["1275", 475], ["2,550", 512]),
    ...line(36, 2, ["NAIL", 105], ["BEAUTY", 127], ["SET", 163]),
    ...line(80, 2, ["0", 385], ["4", 412], ["28", 437]),
    ...line(95, 2, ["SUBTOTAL", 454], ["30,980", 512]),
    ...line(110, 2, ["DISCOUNT", 454], ["0", 512], ["(0.0", 521], ["%)", 542]),
    ...line(128, 2, ["TOTAL", 428], ["AMOUNT", 462], ["30,980", 512]),
  ];

  it("is recognised by its headings", () => {
    expect(detectLayout(words)).toBe("tt_invoice");
  });

  it("reads the invoice number, date and totals", () => {
    const r = parseBillWords(words);
    expect(r.bill_number).toBe("INV-22670");
    expect(r.bill_date).toBe("2026-08-08");
    expect(r.printed).toMatchObject({ subtotal: 30980, discount: 0, total: 30980 });
  });

  it("uses the piece count (T QTY), keeps cartons; page 2 rows without headings; total line not a row", () => {
    const r = parseBillWords(words);
    expect(r.lines.map((l) => [l.line_no, l.page, l.supplier_code, l.description, l.qty, l.rate, l.amount])).toEqual([
      ["1", 1, "050-82", "WRITING BOARD", 2, 4495, 8990],
      ["2", 1, "44669", "INTEX AIR", 24, 810, 19440],
      ["3", 2, "MBK-325", "NAIL BEAUTY SET", 2, 1275, 2550],
    ]);
    expect(r.lines[1].packing).toEqual({ pkg: 24, ctn: 1, pcs: 0 });
    expect(r.total_matches).toBe(true);
  });
});

describe("checks", () => {
  it("flags a line whose qty × rate isn't its amount, and a total that doesn't add up", () => {
    const words = [
      ...line(90, 1, ["SR.", 48], ["ITEM", 91], ["NO.", 115], ["DESCRIPTION", 248], ["QTY", 406], ["RATE", 445], ["AMOUNT", 498]),
      ...line(105, 1, ["1", 52], ["X-1", 70], ["CAR", 154], ["2", 413], ["Rs500", 447], ["Rs1,100.00", 505]),
      ...line(132, 1, ["Total", 417], ["Amount:", 439], ["Rs1,000.00", 498]),
    ];
    const r = parseBillWords(words);
    expect(r.lines[0]).toMatchObject({ check: "mismatch", expected_amount: 1000 });
    expect(r.total_matches).toBe(false);
  });

  it("an unknown layout says so instead of guessing", () => {
    const r = parseBillWords(line(50, 1, ["Hello", 40], ["world", 90]));
    expect(r.layout).toBeNull();
    expect(r.lines).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/not recognised/i);
  });
});

// The owner's real sample bills (git-ignored; only on the owner's PC).
const SAMPLES = path.join(__dirname, "../../../docs/onetoystore-pilot/supplier-bills");
const samplePdfs = fs.existsSync(SAMPLES) ? fs.readdirSync(SAMPLES).filter((f) => f.toLowerCase().endsWith(".pdf")) : [];

describe.skipIf(samplePdfs.length === 0)("the real sample bills (local only)", () => {
  it.each(samplePdfs)("%s: every line qty × rate = amount and the lines add up to the printed total", async (file) => {
    const r = await readBillPdf(fs.readFileSync(path.join(SAMPLES, file)));
    expect(r.layout).not.toBeNull();
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.lines.filter((l) => l.check !== "ok")).toEqual([]);
    expect(r.lines.map((l) => Number(l.line_no))).toEqual(r.lines.map((_, i) => i + 1));
    expect(r.total_matches).toBe(true);
    expect(r.warnings).toEqual([]);
  }, 30000);
});
