// One Toy Store F9 (c1): the supplier bill check screen's arithmetic.
// Owner decisions (PHASE-F-PLAN F9): cost = actual cost after discounts (a
// line discount lowers that line; a whole-bill discount is spread over the
// lines by value); a pack split into N pieces → qty × N, cost ÷ N; freight is
// never toy cost. A minus line is goods sent back to the supplier.

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** Cost of ONE piece after the line discount, the bill discount share and the split. */
export function unitCost(line, billDiscountRatio = 0) {
  const rate = Number(line.rate) || 0;
  const pct = Number(line.discount_pct) || 0;
  const split = Math.max(1, Number(line.split_into) || 1);
  return round2((rate * (1 - pct / 100) * (1 - (Number(billDiscountRatio) || 0))) / split);
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
    discount_pct: 0,
    split_into: split,
    read_check: read.check,
    toys: chosen.map((m) => ({ ...m, qty: chosen.length === 1 ? pieces : 0 })),
    suggestions: (match.matches || []).filter((m) => !(match.chosen || []).includes(m.product_id)),
    is_new: false,
    new_name: read.description || "",
    is_return: received < 0,
  };
}

/** ready | pick (no toy) | confirm (a suggestion to say yes to) | split (share the pieces out) */
export function lineStatus(line) {
  if (line.is_new) return String(line.new_name || "").trim() ? "ready" : "pick";
  if (!line.toys.length) return line.suggestions.length ? "confirm" : "pick";
  const pieces = (Number(line.received) || 0) * Math.max(1, Number(line.split_into) || 1);
  const shared = line.toys.reduce((s, t) => s + (Number(t.qty) || 0), 0);
  return shared === pieces ? "ready" : "split";
}

/**
 * Counts by status + the bill's total against the total written on it.
 * Bill total = Σ line values (amount less the line discount) − bill discount,
 * the same rule as the save (backend services/supplier-bill-save.js).
 */
export function billSummary(lines, writtenTotal, billDiscount = 0) {
  const s = { ready: 0, pick: 0, confirm: 0, split: 0, new_toys: 0, returns: 0 };
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
    total_matches: difference == null ? null : Math.abs(difference) < 0.5,
  };
}

/** What the save endpoint takes (POST /api/supplier-bills, field "payload"). */
export function savePayload({ supplierId, outletId, header, result, lines, paidNow }) {
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
      is_new: !!l.is_new,
      new_name: l.new_name,
      toys: l.toys.map((t) => ({ product_id: t.product_id, qty: Number(t.qty) || 0 })),
    })),
  };
}
