/**
 * One Toy Store F9 (b): read a supplier's computer-made bill from the
 * position of its words (no AI). See PHASE-F-PLAN F9 and
 * tests/unit/supplier-bill-reader.test.js.
 *
 * How a table is rebuilt (the same for every layout):
 *   1. the heading line gives each column's place (Toys and Toys prints it on
 *      page 1 only: later pages reuse page 1's places);
 *   2. a row is found from its S.No (left column) paired with its amount
 *      (right column) — on some bills the numbers sit a little above or below
 *      the S.No, or a long description wraps onto a second line;
 *   3. every other word between the heading and the footer goes to the
 *      nearest row; words below the last row (column totals) are left out;
 *   4. each row is checked qty × rate = amount, and the rows are added up
 *      against the total printed on the bill.
 * Words: { text, x0, x1, top, bottom, page } in PDF points, top from the page top.
 */

const ROW_REACH = 14; // a word belongs to a row whose middle is at most this far away
const BELOW_LAST_ROW = 10; // words further below the last row are footer / column totals

const cx = (w) => (w.x0 + w.x1) / 2;
const cy = (w) => (w.top + w.bottom) / 2;
const low = (t) => String(t || "").trim().toLowerCase();

function parseNum(text) {
  const s = String(text || "").trim().replace(/^rs\.?/i, "").replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseDate(text) {
  const t = String(text || "").trim();
  const pad = (n) => String(n).padStart(2, "0");
  let m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = t.match(/^(\d{1,2})-([A-Za-z]{3})[A-Za-z]*-(\d{4})$/);
  if (m && MONTHS[low(m[2])]) return `${m[3]}-${pad(MONTHS[low(m[2])])}-${pad(m[1])}`;
  return null;
}

function groupLines(words, tol = 2.5) {
  const sorted = [...words].sort((a, b) => a.page - b.page || cy(a) - cy(b) || a.x0 - b.x0);
  const lines = [];
  for (const w of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === w.page && Math.abs(cy(w) - last.cy) <= tol) last.words.push(w);
    else lines.push({ page: w.page, cy: cy(w), words: [w] });
  }
  for (const l of lines) l.words.sort((a, b) => a.x0 - b.x0);
  return lines;
}

/** Every place the tokens appear as consecutive words on one line. */
function findPhrase(lines, tokens, { page = null } = {}) {
  const want = tokens.map(low);
  const found = [];
  for (const l of lines) {
    if (page != null && l.page !== page) continue;
    for (let i = 0; i + want.length <= l.words.length; i++) {
      if (want.every((t, k) => low(l.words[i + k].text) === t)) found.push(l.words.slice(i, i + want.length));
    }
  }
  return found;
}

/** The word to the right of a label on the same line (or a little above / below). */
function valueRightOf(words, labelEnd, parse, reach = 9) {
  let best = null;
  for (const w of words) {
    if (w.page !== labelEnd.page || w.x0 <= labelEnd.x0 || w === labelEnd) continue;
    const v = parse(w.text);
    if (v == null) continue;
    const d = Math.abs(cy(w) - cy(labelEnd));
    if (d > reach) continue;
    if (!best || d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && w.x0 < best.w.x0)) best = { w, v, d };
  }
  return best ? best.v : null;
}
const lastOf = (arr) => (arr.length ? arr[arr.length - 1] : null);
function labelValue(words, lines, tokens, parse = parseNum, opts = {}) {
  const hits = findPhrase(lines, tokens).filter((h) => !opts.minX || h[0].x0 >= opts.minX);
  for (const h of [...hits].reverse()) {
    const v = valueRightOf(words, h[h.length - 1], parse, opts.reach);
    if (v != null) return v;
  }
  return null;
}

const headerMap = (hdrWords) => {
  const m = {};
  for (const w of hdrWords) (m[w.text.toUpperCase()] ||= []).push(w);
  return m;
};
const centerOf = (a, b = a) => (a.x0 + b.x1) / 2;

const LAYOUTS = [
  {
    key: "hafiz_bill_no",
    label: "INVOICE · Bill No (Hafiz Nawaz)",
    supplierHint: "HAFIZ NAWAZ",
    header: ["SR.", "ITEM", "NO.", "DESCRIPTION", "QTY", "RATE", "AMOUNT"],
    footers: [["Total", "Amount:"], ["Page"], ["Prepared", "By:-"]],
    columns(h) {
      const sr = h["SR."][0], item = h.ITEM[0], qty = h.QTY[0];
      return {
        sno: (w) => w.x0 < sr.x1 + 3,
        code: (w) => w.x0 >= sr.x1 + 3 && w.x0 < item.x0 + 45,
        numStart: qty.x0 - 6,
        num: [
          { key: "qty", center: centerOf(qty) },
          { key: "rate", center: centerOf(h.RATE[0]) },
          { key: "amount", center: centerOf(h.AMOUNT[0]) },
        ],
      };
    },
    fields(words, lines) {
      const billNo = findPhrase(lines, ["Bill", "No:"], { page: 1 })[0];
      const date = findPhrase(lines, ["Date:"], { page: 1 })[0];
      return {
        bill_number: billNo ? nextWordText(words, billNo[1]) : null,
        bill_date: date ? parseDate(nextWordText(words, date[0])) : null,
        printed: { total: labelValue(words, lines, ["Total", "Amount:"]) },
      };
    },
  },
  {
    key: "babyland_estimate",
    label: "SALES ESTIMATE (Baby Land)",
    supplierHint: "BABY LAND",
    header: ["Product", "ID", "Description", "Qty", "Unit", "Price"],
    footers: [["Received", "the", "above"], ["Software"]],
    columns(h, hdrLine, words) {
      const product = h.PRODUCT[0], desc = h.DESCRIPTION[0], qty = h.QTY[0];
      // "Amount Rs." is printed on the line just above the other headings.
      const amount = words
        .filter((w) => w.page === hdrLine.page && low(w.text) === "amount" && Math.abs(cy(w) - hdrLine.cy) < 12)
        .sort((a, b) => b.x0 - a.x0)[0];
      return {
        sno: (w) => w.x0 < product.x0 - 5,
        code: (w) => w.x0 >= product.x0 - 5 && w.x0 < desc.x0 - 5,
        numStart: qty.x0 - 5,
        num: [
          { key: "qty", center: centerOf(qty) },
          { key: "rate", center: centerOf(h.UNIT[0], h.PRICE[0]) },
          { key: "amount", center: amount ? amount.x0 + 20 : h.PRICE[0].x1 + 60 },
        ],
      };
    },
    fields(words, lines) {
      const no = findPhrase(lines, ["No."], { page: 1 }).find((h) => h[0].x0 > 300);
      const date = findPhrase(lines, ["Date"], { page: 1 }).find((h) => h[0].x0 > 300);
      const right = { minX: 300 };
      return {
        bill_number: no ? nextWordText(words, no[0]) : null,
        bill_date: date ? parseDate(nextWordText(words, date[0])) : null,
        printed: {
          total: labelValue(words, lines, ["Total", ":"], parseNum, right),
          prev_balance: labelValue(words, lines, ["Prev", "Bal"], parseNum, right),
          total_balance: labelValue(words, lines, ["Total", "Bal:"], parseNum, right),
          due_date: labelValue(words, lines, ["Due", "Date"], parseDate, right),
        },
      };
    },
  },
  {
    key: "tt_invoice",
    label: "Invoice #INV (Toys and Toys)",
    supplierHint: "TOYS AND TOYS",
    header: ["#", "CODE", "NAME", "PKG", "CTN", "PCS", "T", "QTY", "PRICE", "T", "PRICE"],
    footers: [["SUBTOTAL"], ["Thank", "you"]],
    columns(h) {
      const code = h.CODE[0], name = h.NAME[0];
      return {
        sno: (w) => w.x0 < code.x0 - 5,
        code: (w) => w.x0 >= code.x0 - 5 && w.x0 < name.x0 - 5,
        numStart: h.PKG[0].x0 - 5,
        num: [
          { key: "pkg", center: centerOf(h.PKG[0]) },
          { key: "ctn", center: centerOf(h.CTN[0]) },
          { key: "pcs", center: centerOf(h.PCS[0]) },
          { key: "qty", center: centerOf(h.T[0], h.QTY[0]) },
          { key: "rate", center: centerOf(h.PRICE[0]) },
          { key: "amount", center: centerOf(h.T[1], h.PRICE[1]) },
        ],
      };
    },
    fields(words, lines) {
      const inv = words.find((w) => w.page === 1 && /^#INV-?\d+/i.test(w.text));
      const date = findPhrase(lines, ["Date:"], { page: 1 })[0];
      const disc = findPhrase(lines, ["DISCOUNT"]).pop();
      let pct = null;
      if (disc) {
        const pw = words.find((w) => w.page === disc[0].page && Math.abs(cy(w) - cy(disc[0])) < 3 && /^\(\d/.test(w.text));
        pct = pw ? parseNum(pw.text.slice(1)) : null;
      }
      return {
        bill_number: inv ? inv.text.replace(/^#/, "") : null,
        bill_date: date ? parseDate(nextWordText(words, date[0])) : null,
        printed: {
          subtotal: labelValue(words, lines, ["SUBTOTAL"]),
          discount: labelValue(words, lines, ["DISCOUNT"]),
          discount_pct: pct,
          total: labelValue(words, lines, ["TOTAL", "AMOUNT"]),
        },
      };
    },
  },
];

function nextWordText(words, after) {
  const next = words
    .filter((w) => w.page === after.page && w.x0 > after.x0 + 1 && Math.abs(cy(w) - cy(after)) < 3)
    .sort((a, b) => a.x0 - b.x0)[0];
  return next ? next.text : null;
}

function headerLineOn(lines, layout, page) {
  const hit = findPhrase(lines, layout.header, { page })[0];
  return hit ? { page, cy: cy(hit[0]), bottom: Math.max(...hit.map((w) => w.bottom)), words: hit } : null;
}

function detectLayout(words) {
  const lines = groupLines(words);
  const l = LAYOUTS.find((x) => headerLineOn(lines, x, 1));
  return l ? l.key : null;
}

/** Read one bill. Returns lines + header + checks; never throws on odd input. */
function parseBillWords(words) {
  const lines = groupLines(words);
  const layout = LAYOUTS.find((x) => headerLineOn(lines, x, 1));
  const result = {
    layout: layout ? layout.key : null,
    layout_label: layout ? layout.label : null,
    supplier_hint: layout ? layout.supplierHint : null,
    bill_number: null,
    bill_date: null,
    printed: {},
    lines: [],
    lines_total: 0,
    total_matches: null,
    warnings: [],
  };
  if (!layout) {
    result.warnings.push("Bill layout not recognised: enter it by hand or use the photo reader");
    return result;
  }

  const firstHeader = headerLineOn(lines, layout, 1);
  const cols = layout.columns(headerMap(firstHeader.words), firstHeader, words);
  const pages = [...new Set(words.map((w) => w.page))].sort((a, b) => a - b);

  for (const page of pages) {
    const pw = words.filter((w) => w.page === page);
    const hdr = headerLineOn(lines, layout, page);
    const top = hdr ? hdr.bottom + 1 : 0;
    let bottom = Infinity;
    for (const f of layout.footers) {
      for (const hit of findPhrase(lines, f, { page })) if (hit[0].top > top) bottom = Math.min(bottom, hit[0].top - 1);
    }
    // Amount line above "Amount Rs." heading etc. are above `top` and ignored.
    const inBand = pw.filter((w) => w.top >= top - 0.5 && cy(w) <= bottom && !(hdr && hdr.words.includes(w)));

    const kind = (w) => {
      if (cx(w) >= cols.numStart) {
        if (parseNum(w.text) == null) return { k: "desc" };
        const near = cols.num.reduce((b, c) => (Math.abs(cx(w) - c.center) < Math.abs(cx(w) - b.center) ? c : b));
        return { k: "num", key: near.key };
      }
      if (cols.sno(w)) return { k: "sno" };
      if (cols.code(w)) return { k: "code" };
      return { k: "desc" };
    };
    const typed = inBand.map((w) => ({ w, ...kind(w) }));
    const anchors = typed.filter((t) => t.k === "sno" && /^\d{1,4}$/.test(t.w.text)).sort((a, b) => cy(a.w) - cy(b.w));
    const amounts = typed.filter((t) => t.k === "num" && t.key === "amount");
    const used = new Set();
    const rows = anchors.map((a) => {
      let best = null;
      for (const m of amounts) {
        if (used.has(m)) continue;
        const d = Math.abs(cy(m.w) - cy(a.w));
        if (d <= ROW_REACH && (!best || d < best.d)) best = { m, d };
      }
      if (best) used.add(best.m);
      const amt = best ? best.m : null;
      return {
        page,
        sno: a.w.text,
        center: amt ? (cy(a.w) + cy(amt.w)) / 2 : cy(a.w),
        bottom: Math.max(a.w.bottom, amt ? amt.w.bottom : 0),
        parts: [a, ...(amt ? [amt] : [])],
      };
    });
    if (!rows.length) continue;
    const end = Math.max(...rows.map((r) => r.bottom)) + BELOW_LAST_ROW;
    for (const t of typed) {
      if (t.k === "sno" && anchors.includes(t)) continue;
      if (used.has(t)) continue;
      if (cy(t.w) > end) continue;
      let best = null;
      for (const r of rows) {
        const d = Math.abs(cy(t.w) - r.center);
        if (!best || d < best.d) best = { r, d };
      }
      if (best && best.d <= ROW_REACH) best.r.parts.push(t);
      else if (cy(t.w) >= rows[0].center - ROW_REACH) result.warnings.push(`Page ${page}: "${t.w.text}" not placed on any line`);
    }

    for (const r of rows) {
      const byLine = (a, b) => cy(a.w) - cy(b.w) || a.w.x0 - b.w.x0;
      const code = r.parts.filter((p) => p.k === "code").sort(byLine).map((p) => p.w.text).join(" ");
      let desc = r.parts.filter((p) => p.k === "desc").sort((a, b) => (Math.abs(cy(a.w) - cy(b.w)) < 2.5 ? a.w.x0 - b.w.x0 : cy(a.w) - cy(b.w))).map((p) => p.w.text).join(" ");
      if (code && desc.startsWith(`[${code}]`)) desc = desc.slice(code.length + 2).trim();
      const num = {};
      for (const p of r.parts.filter((x) => x.k === "num")) {
        if (num[p.key] != null) result.warnings.push(`Line ${r.sno}: two numbers under ${p.key}`);
        else num[p.key] = parseNum(p.w.text);
      }
      const line = {
        line_no: r.sno,
        page: r.page,
        supplier_code: code || null,
        description: desc,
        qty: num.qty ?? null,
        rate: num.rate ?? null,
        amount: num.amount ?? null,
      };
      if (layout.key === "tt_invoice") line.packing = { pkg: num.pkg ?? null, ctn: num.ctn ?? null, pcs: num.pcs ?? null };
      if (line.qty == null || line.rate == null || line.amount == null) {
        line.check = "missing";
      } else {
        line.expected_amount = Math.round(line.qty * line.rate * 100) / 100;
        line.check = Math.abs(line.expected_amount - line.amount) <= 0.5 ? "ok" : "mismatch";
      }
      result.lines.push(line);
    }
  }

  Object.assign(result, layout.fields(words, lines));
  result.lines_total = Math.round(result.lines.reduce((s, l) => s + (l.amount || 0), 0) * 100) / 100;
  const printedLines = result.printed.subtotal ?? result.printed.total;
  result.total_matches = printedLines == null ? null : Math.abs(printedLines - result.lines_total) <= 1;
  for (const l of result.lines) {
    if (l.check === "missing") result.warnings.push(`Line ${l.line_no}: quantity, rate or amount not found`);
  }
  return result;
}

module.exports = { parseBillWords, detectLayout, LAYOUTS, parseDate, parseNum, groupLines };
