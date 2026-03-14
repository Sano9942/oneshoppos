/**
 * Shared CSV export utility.
 * @param {string[]} headers - Column header names
 * @param {Array<Array<string|number>>} rows - 2D array of cell values
 * @param {string} filename - Download filename (without .csv extension)
 */
export function downloadCsv(headers, rows, filename) {
  if (!rows.length) return;
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    headers.map(escape).join(","),
    ...rows.map((r) => r.map(escape).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
