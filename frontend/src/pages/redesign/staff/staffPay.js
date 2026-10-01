// Pure helpers for the staff register + salaries pages (One Toy Store F3b).

/** "YYYY-MM" for a Date (local time). */
export function monthOf(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** The month before "YYYY-MM". */
export function prevMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function nextMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });
}

/** F4b: shop staff first, home staff (owner's home: driver, maids) last. */
export function orderStaff(list) {
  return [...(list || []).filter((s) => !s.home_staff), ...(list || []).filter((s) => s.home_staff)];
}

/** F4b: salary totals kept apart: a home staff salary is Owner / home money, not a shop cost. */
export function splitTotals(list) {
  const t = { shop: { gross: 0, paid: 0 }, home: { gross: 0, paid: 0 } };
  for (const s of list || []) {
    const side = s.home_staff ? t.home : t.shop;
    side.gross += s.paid ? s.paid.gross : s.gross;
    side.paid += s.paid?.net_pay || 0;
  }
  return t;
}

/** "YYYY-MM-DD" for day d of month. */
export function dayOf(month, d) {
  return `${month}-${String(d).padStart(2, "0")}`;
}

/** Days of `month` up to today (all of them for a past month, none for a future one). */
export function pastDays(month, days, today = new Date()) {
  const cur = monthOf(today);
  if (month < cur) return days;
  if (month > cur) return 0;
  return today.getDate();
}

/** Boxes with nothing in them for one person, up to `upTo` (inclusive). */
export function emptyDays(marks, upTo) {
  const out = [];
  for (let d = 1; d <= upTo; d += 1) if (!marks?.[d]) out.push(d);
  return out;
}

export const signed = (n) => (n > 0 ? `+${n}` : String(n));

export const rs = (n) =>
  `Rs ${Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

export const MARK_LABEL = { P: "Present", A: "Absent", S: "Sick" };
