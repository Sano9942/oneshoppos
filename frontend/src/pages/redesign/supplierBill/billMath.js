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

/** Counts by status + the lines' total against the total written on the bill. */
export function billSummary(lines, writtenTotal) {
  const s = { ready: 0, pick: 0, confirm: 0, split: 0, new_toys: 0, returns: 0 };
  for (const l of lines) {
    s[lineStatus(l)] += 1;
    if (l.is_new) s.new_toys += 1;
    if (l.is_return) s.returns += 1;
  }
  const linesTotal = round2(lines.reduce((a, l) => a + (Number(l.amount) || 0), 0));
  const written = writtenTotal === "" || writtenTotal == null ? null : Number(writtenTotal);
  const difference = written == null ? null : round2(written - linesTotal);
  return {
    ...s,
    lines_total: linesTotal,
    difference,
    total_matches: difference == null ? null : Math.abs(difference) < 0.5,
  };
}
