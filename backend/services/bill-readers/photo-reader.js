/**
 * One Toy Store F9 (e): read photographed / handwritten supplier bills and
 * scanned PDFs with Claude (owner: Sonnet 5.5, about Rs 11 a photo; PHASE-F-PLAN
 * F9). Several files are one bill, read together in the order given.
 *
 * The result has the same shape as the PDF readers (layouts.js) so the check
 * screen, matching, new toys and saving work unchanged. Nothing is corrected:
 * each line is checked qty × rate = amount and the lines are added up against
 * the printed total, as for PDFs. Owner 2026-10-16: lines struck through or
 * circled on the paper are read as printed and only flagged; the owner decides
 * the pieces received.
 *
 * Line discounts: `amount` is the line before its discount and `discount_pct`
 * the line's %; the check screen takes the discount off per line. A discount on
 * the whole bill (not the sum of line discounts) goes in printed.discount.
 */
const PHOTO_MODEL = "claude-sonnet-5-5";
// Sonnet 5.5 list prices, US$ per million tokens.
const PRICE = { input: 2, output: 10 };
const LAYOUT = "photo";
const LAYOUT_LABEL = "Photo / handwritten (read by AI)";
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024; // the API takes up to 5 MB an image

const num = { type: ["number", "null"] };
const LINE_SCHEMA = {
  type: "object",
  properties: {
    file: { type: "integer", description: "Which file the line is on (1 = the first file)" },
    line_no: { type: ["integer", "null"], description: "The bill's own S.No / SR / # for the line, null if none printed" },
    supplier_code: { type: "string", description: "The supplier's item code / article no, \"\" if none" },
    barcode: { type: "string", description: "The item barcode (digits) if printed, \"\" if none" },
    description: { type: "string" },
    qty: { ...num, description: "Quantity billed (pieces)" },
    unit: { type: "string" },
    rate: { ...num, description: "Price of one unit before any discount" },
    discount_pct: { ...num, description: "This line's discount %, null if none" },
    amount: { ...num, description: "The line's amount BEFORE its discount (gross), as printed" },
    net_amount: { ...num, description: "The line's amount after its discount, if printed" },
    paper_mark: { type: "string", enum: ["none", "struck", "circled"], description: "A pen line through the row = struck; a pen circle round the row or one of its numbers = circled; ticks don't count" },
    unsure: { type: "boolean", description: "true if any value on the line is hard to read" },
    note: { type: "string", description: "What is unclear or odd on this line, \"\" if nothing" },
  },
  required: ["file", "line_no", "supplier_code", "barcode", "description", "qty", "unit", "rate", "discount_pct", "amount", "net_amount", "paper_mark", "unsure", "note"],
  additionalProperties: false,
};
const BILL_SCHEMA = {
  type: "object",
  properties: {
    supplier_name: { type: "string", description: "The supplier (seller) name printed or written, \"\" if none" },
    bill_number: { type: "string", description: "Invoice / bill / memo number, \"\" if none" },
    bill_date: { type: "string", description: "Bill date as YYYY-MM-DD, \"\" if not readable" },
    gross_total: { ...num, description: "Total of the line amounts before line discounts, as printed" },
    line_discount_total: { ...num, description: "Total of the line discounts, if printed" },
    bill_discount: { ...num, description: "A discount on the whole bill that is NOT just the sum of the line discounts" },
    net_total: { ...num, description: "The amount to pay (net amount / grand total), as printed" },
    lines: { type: "array", items: LINE_SCHEMA },
    notes: { type: "array", items: { type: "string" }, description: "Anything about the bill as a whole that the shop should check" },
  },
  required: ["supplier_name", "bill_number", "bill_date", "gross_total", "line_discount_total", "bill_discount", "net_total", "lines", "notes"],
  additionalProperties: false,
};

const SYSTEM =
  "You read supplier bills for a toy shop in Lahore, Pakistan: printed invoices photographed on a " +
  "phone, handwritten cash memos (Qty · Particulars · Rate · Amount) and scanned PDFs. The files you " +
  "get are ONE bill, in page order. Copy what is on the paper; never calculate a value that is not " +
  "written, never correct the supplier's arithmetic, never invent a line. Read every item line, in " +
  "the paper's order, including lines someone has struck through or circled in pen (mark them). " +
  "Skip headings, column totals and the totals block (put those in the bill fields). Numbers: plain " +
  "digits, no commas; Rs amounts as numbers. Pakistani dates are day-month-year. If a value can't " +
  "be read, use null (or \"\") and say so in the line's note.";

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const numOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function costOf(usage, usdToRs) {
  const inTok = Number(usage?.input_tokens || 0) + Number(usage?.cache_creation_input_tokens || 0) + Number(usage?.cache_read_input_tokens || 0);
  const outTok = Number(usage?.output_tokens || 0);
  const usd = (inTok * PRICE.input + outTok * PRICE.output) / 1e6;
  return {
    input_tokens: inTok,
    output_tokens: outTok,
    cost_usd: Math.round(usd * 10000) / 10000,
    cost_rs: round2(usd * usdToRs),
  };
}

/** The model's JSON → the PDF readers' result shape. `fileIndexes[i]` = the route's index of file i+1. */
function normaliseRead(raw, fileCount, fileIndexes = null) {
  const warnings = [...(Array.isArray(raw?.notes) ? raw.notes.filter(Boolean).map(String) : [])];
  const idx = (f) => {
    const i = Math.min(Math.max(1, Number(f) || 1), fileCount) - 1;
    return fileIndexes ? fileIndexes[i] : i;
  };
  const lines = (Array.isArray(raw?.lines) ? raw.lines : []).map((l, n) => {
    const qty = numOrNull(l.qty);
    const rate = numOrNull(l.rate);
    const pct = numOrNull(l.discount_pct) || 0;
    const net = numOrNull(l.net_amount);
    let amount = numOrNull(l.amount);
    if (amount == null && net != null) amount = pct ? round2(net / (1 - pct / 100)) : net;
    const line = {
      line_no: Number.isInteger(l.line_no) ? l.line_no : n + 1,
      page: 1,
      file_index: idx(l.file),
      supplier_code: String(l.supplier_code || "").trim() || null,
      barcode: String(l.barcode || "").replace(/\s+/g, "") || null,
      description: String(l.description || "").trim(),
      qty,
      rate,
      amount,
      discount_pct: pct,
      net_amount: net,
      paper_mark: ["struck", "circled"].includes(l.paper_mark) ? l.paper_mark : null,
      unsure: !!l.unsure,
      note: String(l.note || "").trim() || null,
    };
    if (qty == null || rate == null || amount == null) {
      line.check = "missing";
    } else {
      line.expected_amount = round2(qty * rate);
      line.check = Math.abs(line.expected_amount - amount) <= 0.5 ? "ok" : "mismatch";
      if (line.check === "ok" && net != null && pct && Math.abs(round2(amount * (1 - pct / 100)) - net) > 1) line.check = "mismatch";
    }
    return line;
  });
  for (const l of lines) {
    if (l.paper_mark === "struck") warnings.push(`Line ${l.line_no}: struck through on the paper, check the pieces received`);
    if (l.paper_mark === "circled") warnings.push(`Line ${l.line_no}: circled on the paper, check it`);
    if (l.unsure || l.note) warnings.push(`Line ${l.line_no}: hard to read${l.note ? ` (${l.note})` : ""}`);
    if (l.check === "missing") warnings.push(`Line ${l.line_no}: quantity, rate or amount not found`);
    if (l.check === "mismatch") warnings.push(`Line ${l.line_no}: quantity × rate doesn't make the amount`);
  }

  const linesTotal = round2(lines.reduce((s, l) => s + (l.amount || 0), 0));
  const gross = numOrNull(raw?.gross_total);
  const net = numOrNull(raw?.net_total);
  const lineDisc = numOrNull(raw?.line_discount_total);
  const billDisc = numOrNull(raw?.bill_discount);
  const printed = {};
  if (gross != null) printed.subtotal = gross;
  if (lineDisc != null) printed.line_discounts = lineDisc;
  if (billDisc != null && billDisc > 0) printed.discount = billDisc;
  if (net != null) printed.total = net;
  const printedLines = printed.subtotal ?? (lines.some((l) => l.discount_pct) || printed.discount ? null : printed.total);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.bill_date || "")) ? raw.bill_date : null;
  return {
    layout: LAYOUT,
    layout_label: LAYOUT_LABEL,
    supplier_hint: null,
    supplier_name_read: String(raw?.supplier_name || "").trim() || null,
    bill_number: String(raw?.bill_number || "").trim() || null,
    bill_date: date,
    printed,
    lines,
    lines_total: linesTotal,
    total_matches: printedLines == null ? null : Math.abs(printedLines - linesTotal) <= 1,
    warnings,
  };
}

// Owner 2026-10-19: off until a real-photo trial. The AI key alone is not
// enough (the live server has one for other features); the switch
// SUPPLIER_BILL_PHOTO_READER=1 turns photo reading on.
function photoReaderOn(env = process.env) {
  return !!env.ANTHROPIC_API_KEY && env.SUPPLIER_BILL_PHOTO_READER === "1";
}

function getClient() {
  const Anthropic = require("@anthropic-ai/sdk");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function shrinkIfBig(f) {
  if (f.mimetype === "application/pdf" || f.buffer.length <= MAX_IMAGE_BYTES) return { data: f.buffer, mediaType: f.mimetype };
  const sharp = require("sharp");
  const data = await sharp(f.buffer).rotate().resize({ width: 2576, height: 2576, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 }).toBuffer();
  return { data, mediaType: "image/jpeg" };
}

/**
 * files: [{ buffer, mimetype, file_name, file_index }] (images or PDFs), one bill.
 * deps: { client?, usdToRs? }. Throws a plain-English error the screen can show.
 */
async function readBillPhotos(files, deps = {}) {
  if (!files?.length) throw Object.assign(new Error("No photo to read"), { statusCode: 400 });
  const client = deps.client || getClient();
  const usdToRs = Number(deps.usdToRs || process.env.AI_USD_TO_RS || 280);

  const content = [];
  for (const [i, f] of files.entries()) {
    const { data, mediaType } = await shrinkIfBig(f);
    content.push({ type: "text", text: `File ${i + 1} of ${files.length}: ${f.file_name || "photo"}` });
    content.push(mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: data.toString("base64") } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: data.toString("base64") } });
  }
  content.push({ type: "text", text: "Read this supplier bill into the JSON format." });

  const msg = await client.beta.messages.stream({
    model: PHOTO_MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: { type: "json_schema", schema: BILL_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  }).finalMessage();

  if (msg.stop_reason === "refusal") {
    throw Object.assign(new Error("The AI declined to read this bill: type it in instead"), { statusCode: 422 });
  }
  if (msg.stop_reason === "max_tokens") {
    throw Object.assign(new Error("This bill is too long to read in one go: read fewer photos at a time"), { statusCode: 422 });
  }
  const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Object.assign(new Error("The AI's answer could not be read: try again"), { statusCode: 502 });
  }
  const result = normaliseRead(raw, files.length, files.map((f, i) => f.file_index ?? i));
  result.ai = { model: PHOTO_MODEL, files: files.length, ...costOf(msg.usage, usdToRs) };
  return result;
}

module.exports = { readBillPhotos, photoReaderOn, normaliseRead, costOf, PHOTO_MODEL, BILL_SCHEMA, LAYOUT };
