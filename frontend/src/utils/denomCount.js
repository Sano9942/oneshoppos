// D58 (One Toy Store, 30 Sep): note-count boxes on Close Shift / Open Shift
// kept a "0" that could not be deleted, and typing after it showed "0120".
// Keep the count as the text the cashier typed: blank when empty, whole
// notes only, no leading zeros. Totals read it with Number(count || 0).
export function cleanDenomCount(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits === "0" ? "" : digits;
}

export const blankDenoms = (values) => values.map((denomination) => ({ denomination, count: "" }));
