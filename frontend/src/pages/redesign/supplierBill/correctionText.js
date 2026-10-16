// One Toy Store F9 (f) 5/6: corrections to a saved supplier bill in words:
// the four kinds, what a correction will change (the Correct this bill box)
// and what a saved one changed (the bill's Corrections list).

export const CORRECTION_LABELS = {
  pieces: "Pieces received",
  rate: "Wrong rate",
  money: "Money only",
  toy: "Wrong toy",
};

const n = (v) => (v === "" || v == null ? NaN : Number(v));
const q3 = (v) => String(Math.round(Number(v) * 1000) / 1000);

/** What the correction will change, in words (the server works out the same). */
export function correctionPreview(kind, line, form, fmt) {
  if (kind === "money") {
    const a = n(form.amount);
    if (!Number.isFinite(a) || a === 0) return "";
    return a > 0 ? `We owe ${fmt(a)} more` : `We owe ${fmt(-a)} less`;
  }
  if (!line) return "";
  const split = Number(line.split_into) || 1;
  const billed = Number(line.billed_qty);
  const cost = Number(line.unit_cost) || 0;
  const owe = (d) => (Math.abs(d) < 0.005 ? "nothing owed changes" : d > 0 ? `we owe ${fmt(Math.round(d * 100) / 100)} more` : `we owe ${fmt(Math.round(-d * 100) / 100)} less`);
  if (kind === "pieces") {
    const r = n(form.received_qty);
    if (!Number.isFinite(r) || r < 0 || r === Number(line.received_qty)) return "";
    const missing = (x) => (billed > 0 && x < billed ? billed - x : 0);
    const pieces = (r - Number(line.received_qty)) * split;
    return `Stock ${pieces > 0 ? "+" : ""}${q3(pieces)} pcs · ${owe((missing(Number(line.received_qty)) - missing(r)) * cost * split)}`;
  }
  if (kind === "rate") {
    const rate = n(form.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate === Number(line.rate)) return "";
    const oldRate = Number(line.rate);
    const newCost = oldRate > 0 ? (cost * rate) / oldRate : (rate * (1 - Number(line.discount_pct) / 100)) / split;
    const paidFor = Math.max(0, Math.min(Number(line.received_qty), billed)) * split;
    return `Cost per piece ${q3(Math.round(newCost * 100) / 100)} · ${owe(paidFor * (newCost - cost))}`;
  }
  if (kind === "toy") {
    if (!form.to) return "";
    const from = line.toys.find((t) => String(t.product_id) === String(form.from_product_id)) || line.toys[0];
    const pcs = form.qty === "" ? Number(from?.qty) : n(form.qty);
    if (!from || !(pcs > 0)) return "";
    return `${q3(pcs)} pcs move from ${from.name} to ${form.to.name} · cost follows · nothing owed changes`;
  }
  return "";
}

/** One correction in words: what the line was and what it is now. */
export function correctionWords(c) {
  const b = c.before || {};
  const a = c.after || {};
  if (c.kind === "pieces") return `received ${q3(b.received_qty)} → ${q3(a.received_qty)}`;
  if (c.kind === "rate") return `rate ${Number(b.rate).toLocaleString()} → ${Number(a.rate).toLocaleString()} (cost / pc ${Number(a.unit_cost).toLocaleString()})`;
  if (c.kind === "toy") {
    const names = (list) => (list || []).map((t) => `${t.name} ${q3(t.qty)}`).join(", ");
    return `${names(b.toys)} → ${names(a.toys)}`;
  }
  return "money only";
}
