// One Toy Store F9 (c1): the supplier bill check screen's arithmetic.
// Owner decisions (PHASE-F-PLAN F9): cost = actual cost after discounts (a
// line discount lowers that line; a whole-bill discount is spread over the
// lines by value); a pack split into N pieces → qty × N, cost ÷ N; freight is
// never toy cost. A minus line is goods sent back to the supplier.

import { priceRule } from "./priceRules";

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** Cost of ONE piece after the line discount, the bill discount share and the split. */
export function unitCost(line, billDiscountRatio = 0) {
  const rate = Number(line.rate) || 0;
  const pct = Number(line.discount_pct) || 0;
  const split = Math.max(1, Number(line.split_into) || 1);
  return round2((rate * (1 - pct / 100) * (1 - (Number(billDiscountRatio) || 0))) / split);
}

/**
 * Owner 2026-10-20: correct a misread rate or line discount %. A new rate
 * makes the line amount billed × rate (what cost per piece and the bill total
 * are worked out from, here and in the save), so the toy's cost and the
 * supplier's account change together. The first read figures are kept to show.
 */
export function correctLine(line, { rate, discount_pct } = {}) {
  const readRate = line.read_rate ?? (Number(line.rate) || 0);
  const readPct = line.read_discount_pct ?? (Number(line.discount_pct) || 0);
  const next = { ...line, read_rate: readRate, read_discount_pct: readPct };
  if (rate !== undefined) {
    next.rate = rate === "" ? "" : Number(rate);
    next.amount = round2((Number(line.billed) || 0) * (Number(next.rate) || 0));
  }
  if (discount_pct !== undefined) next.discount_pct = discount_pct === "" ? "" : Number(discount_pct);
  next.corrected = Number(next.rate) !== readRate || (Number(next.discount_pct) || 0) !== readPct;
  return next;
}

/** A check-screen line from a read bill line + its match result. */
export function lineFromRead(read, match = { matches: [], chosen: [] }) {
  const chosen = (match.matches || []).filter((m) => (match.chosen || []).includes(m.product_id));
  const split = Math.max(1, Number(chosen[0]?.split_into) || 1);
  const received = Number(read.qty) || 0;
  const pieces = received * split;
  return {
    key: `${read.file_index ?? 0}-${read.page}-${read.line_no}`,
    line_no: read.line_no,
    page: read.page,
    file_index: read.file_index ?? 0,
    supplier_code: read.supplier_code || "",
    description: read.description || "",
    billed: received,
    received,
    rate: Number(read.rate) || 0,
    amount: Number(read.amount) || 0,
    // F9 (e): a photo bill's reader finds the line discount itself.
    discount_pct: Number(read.discount_pct) || 0,
    split_into: split,
    read_check: read.check,
    // Owner 2026-10-16: struck / circled on the paper is only flagged.
    paper_mark: read.paper_mark || null,
    unsure: !!read.unsure,
    read_note: read.note || null,
    toys: chosen.map((m) => ({ ...m, qty: chosen.length === 1 ? pieces : 0 })),
    suggestions: (match.matches || []).filter((m) => !(match.chosen || []).includes(m.product_id)),
    is_new: false,
    // Step (d): a new toy's details; category and brand suggested from the
    // most similar toy of this supplier (owner: both required).
    new_toy: {
      name: read.description || "",
      category_id: match.like?.category_id ?? "",
      is_brand: match.like ? !!match.like.brand_id : null,
      brand_name: match.like?.brand_name || "",
      price: "",
      rule: "",
      code: "",
      barcode: read.barcode || "",
    },
    is_return: received < 0,
  };
}

/** Pieces of a line coming into stock now: received × split, less waiting extras it bills. */
export function piecesNow(line) {
  return (Number(line.received) || 0) * Math.max(1, Number(line.split_into) || 1) - (Number(line.waiting_matched) || 0);
}

/**
 * F9 (f) 6/6: offer each line the extra pieces of its toy(s) still waiting for
 * this supplier's bill (oldest first, never more than the line's billed and
 * received pieces, each waiting piece offered once). Pre-ticked: the owner
 * unticks (waiting_off) when the line is different pieces. A ticked offer
 * counts as received but not as stock now; a line with one toy is re-shared.
 */
export function applyWaiting(lines, waiting = []) {
  const used = new Map();
  return lines.map((l) => {
    const base = { ...l, waiting_offer: [], waiting_matched: 0 };
    if (l.is_return || l.is_new || !l.toys?.length || !waiting.length) {
      return l.waiting_offer?.length || l.waiting_matched ? reshareOne(base) : l;
    }
    const split = Math.max(1, Number(l.split_into) || 1);
    let left = Math.max(0, Math.min(Number(l.billed) || 0, Number(l.received) || 0)) * split;
    const offer = [];
    for (const t of l.toys) {
      for (const w of waiting) {
        if (left <= 0) break;
        if (w.product_id !== t.product_id) continue;
        const take = Math.min(Number(w.qty) - (used.get(w.id) || 0), left);
        if (take <= 0) continue;
        offer.push({ id: w.id, product_id: w.product_id, qty: take, bill_number: w.bill_number, bill_date: w.bill_date });
        left -= take;
        if (!l.waiting_off) used.set(w.id, (used.get(w.id) || 0) + take);
      }
    }
    const matched = l.waiting_off ? 0 : offer.reduce((a, w) => a + w.qty, 0);
    return reshareOne({ ...base, waiting_offer: offer, waiting_matched: matched });
  });
}
function reshareOne(l) {
  if (l.toys?.length === 1 && !l.is_new) return { ...l, toys: [{ ...l.toys[0], qty: Math.max(0, piecesNow(l)) }] };
  return l;
}

/** ready | pick (no toy) | confirm (a suggestion to say yes to) | split (share the pieces out) | newtoy (fill in the new toy) */
export function lineStatus(line) {
  if (line.is_new) {
    const t = line.new_toy || {};
    const brandOk = t.is_brand === false || (t.is_brand === true && String(t.brand_name || "").trim());
    return String(t.name || "").trim() && t.category_id && brandOk ? "ready" : "newtoy";
  }
  if (!line.toys.length) return line.suggestions.length ? "confirm" : "pick";
  const pieces = piecesNow(line);
  const shared = line.toys.reduce((s, t) => s + (Number(t.qty) || 0), 0);
  return shared === pieces ? "ready" : "split";
}

/**
 * F9 (e), owner 2026-10-20: a supplier who rounds each line to whole rupees
 * (A2Z: 48 lines less 5 %) is off by up to 50 paisa a line; that still counts
 * as matching, but never a gap of Rs 5 or more. Same rule as the save
 * (backend services/supplier-bill-save.js roundingAllowance).
 */
export function roundingAllowance(lineCount) {
  return Math.min(0.5 * Math.max(1, Number(lineCount) || 0), 5);
}

/**
 * Counts by status + the bill's total against the total written on it.
 * Bill total = Σ line values (amount less the line discount) − bill discount,
 * the same rule as the save (backend services/supplier-bill-save.js).
 */
export function billSummary(lines, writtenTotal, billDiscount = 0) {
  const s = { ready: 0, pick: 0, confirm: 0, split: 0, newtoy: 0, new_toys: 0, returns: 0 };
  for (const l of lines) {
    s[lineStatus(l)] += 1;
    if (l.is_new) s.new_toys += 1;
    if (l.is_return) s.returns += 1;
  }
  const linesTotal = round2(lines.reduce((a, l) => a + (Number(l.amount) || 0) * (1 - (Number(l.discount_pct) || 0) / 100), 0));
  const billTotal = round2(linesTotal - (Number(billDiscount) || 0));
  const written = writtenTotal === "" || writtenTotal == null ? null : Number(writtenTotal);
  const difference = written == null ? null : round2(written - billTotal);
  return {
    ...s,
    lines_total: linesTotal,
    bill_total: billTotal,
    difference,
    total_matches: difference == null ? null : Math.abs(difference) < roundingAllowance(lines.length),
  };
}

/**
 * A new toy's selling price: the shop's typed price, else the price rule
 * (priceRules.js) on its cost per piece. ctx: { supplierId, billDiscountRatio, rules }
 * (rules = GET /api/price-rules; the defaults until it loads).
 */
export function newToyPrice(line, ctx = {}) {
  const t = line.new_toy || {};
  const rule = priceRule({
    cost: unitCost(line, ctx.billDiscountRatio), supplierId: ctx.supplierId, name: t.name,
    isBrand: !!t.is_brand, brandName: t.brand_name, rule: t.rule || undefined,
  }, ctx.rules);
  const typed = Number(t.price);
  return typed > 0 ? { ...rule, price: typed, typed: true, rule_price: rule.price } : { ...rule, typed: false, rule_price: rule.price };
}

/**
 * An existing toy whose cost changes on this bill: the rule's price, shown as
 * a suggestion (owner: show, don't change, unless the shop says). null when
 * the cost is the same or the rule gives today's price.
 */
export function suggestedPrice(line, toy, ctx = {}) {
  const cost = unitCost(line, ctx.billDiscountRatio);
  if (!(cost > 0) || round2(cost) === round2(Number(toy.cost_price) || 0)) return null;
  const r = priceRule({ cost, supplierId: ctx.supplierId, name: toy.name, isBrand: !!toy.brand_id, brandId: toy.brand_id, brandName: toy.brand_name }, ctx.rules);
  return r.price === Number(toy.price) ? null : r;
}

/** What the save endpoint takes (POST /api/supplier-bills, field "payload"). */
export function savePayload({ supplierId, outletId, header, result, lines, paidNow, billDiscountRatio = 0, rules }) {
  return {
    supplier_id: Number(supplierId),
    outlet_id: Number(outletId),
    bill_number: header.bill_number,
    bill_date: header.bill_date,
    layout: result?.layout || null,
    written_total: header.written_total,
    bill_discount: Number(result?.printed?.discount) || 0,
    printed_prev_balance: result?.printed?.prev_balance ?? null,
    total_differs: !!header.differs,
    total_note: header.differs_note,
    account_amount: header.differs ? header.account_amount : null,
    paid_now: paidNow && paidNow.method ? { ...paidNow, amount: Number(paidNow.amount) || 0 } : null,
    lines: lines.map((l) => ({
      line_no: l.line_no,
      page: l.page,
      file_index: l.file_index,
      supplier_code: l.supplier_code,
      description: l.description,
      billed_qty: Number(l.billed) || 0,
      received_qty: Number(l.received) || 0,
      rate: l.rate,
      discount_pct: Number(l.discount_pct) || 0,
      amount: l.amount,
      split_into: Number(l.split_into) || 1,
      // (f) 6/6: waiting extras this line bills (already in stock).
      waiting: !l.is_new && !l.waiting_off ? (l.waiting_offer || []).map((w) => ({ id: w.id, qty: w.qty })) : [],
      is_new: !!l.is_new,
      new_toy: l.is_new ? {
        name: String(l.new_toy.name || "").trim(),
        category_id: Number(l.new_toy.category_id) || null,
        is_brand: l.new_toy.is_brand,
        brand_name: l.new_toy.is_brand ? String(l.new_toy.brand_name || "").trim() : null,
        price: newToyPrice(l, { supplierId: Number(supplierId), billDiscountRatio, rules }).price,
        code: String(l.new_toy.code || "").trim(),
        barcode: String(l.new_toy.barcode || "").trim(),
      } : undefined,
      toys: l.is_new ? [] : l.toys.map((t) => ({
        product_id: t.product_id,
        qty: Number(t.qty) || 0,
        ...(Number(t.new_price) > 0 ? { new_price: Number(t.new_price) } : {}),
      })),
    })),
  };
}
