import { useState } from "react";
import { FileSpreadsheet, Download, Search } from "lucide-react";
import { api } from "../../api";
import { downloadCsv } from "../../utils/csvExport";

export default function FBRExportTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState([]);
  const [company, setCompany] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    if (!from || !to) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.get("/api/reports/fbr-export", { from, to });
      setRows(data.rows || []);
      setCompany(data.company || {});
    } catch (err) {
      setError(err.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const headers = [
      "NTN", "STRN", "Invoice #", "Date", "Buyer", "Phone",
      "Item", "Qty", "Unit Price", "Tax Rate %", "Tax Amount", "Total"
    ];
    const csvRows = rows.map((r) => [
      r.ntn, r.strn, r.invoice_number, r.invoice_date,
      r.buyer_name, r.buyer_phone, r.item_description,
      r.quantity, r.unit_price, r.tax_rate, r.tax_amount, r.total_amount,
    ]);
    downloadCsv(headers, csvRows, "fbr_export");
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-(--ui-border) bg-(--ui-surface) p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-(--ui-border) px-3 py-2 text-sm focus:border-(--ui-focus) focus:outline-none focus:ring-2 focus:ring-(--ui-focus)/10"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-(--ui-border) px-3 py-2 text-sm focus:border-(--ui-focus) focus:outline-none focus:ring-2 focus:ring-(--ui-focus)/10"
          />
        </div>
        <button
          onClick={generate}
          disabled={!from || !to || loading}
          className="flex items-center gap-2 rounded-lg bg-(--ui-primary) px-4 py-2 text-sm font-semibold text-(--ui-on-primary) transition-colors hover:bg-(--ui-primary-strong) disabled:opacity-50"
        >
          <Search size={14} />
          {loading ? "Generating..." : "Generate"}
        </button>
        {rows.length > 0 && (
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 rounded-lg bg-(--ui-success-fg) px-4 py-2 text-sm font-semibold text-(--ui-on-primary) transition-colors hover:bg-(--ui-success-fg)"
          >
            <Download size={14} />
            Download CSV
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-(--ui-danger-bg) bg-(--ui-danger-bg) p-3 text-sm text-(--ui-danger-fg)">
          {error}
        </div>
      )}

      {/* Company info */}
      {rows.length > 0 && company.company_name && (
        <div className="rounded-lg border border-(--ui-border) bg-(--ui-muted-surface) p-3 text-xs text-(--ui-text-muted)">
          <span className="font-semibold">{company.company_name}</span>
          {company.ntn && <span className="ml-3">NTN: {company.ntn}</span>}
          {company.strn && <span className="ml-3">STRN: {company.strn}</span>}
          <span className="ml-3">{rows.length} line items</span>
        </div>
      )}

      {/* Table */}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-(--ui-border) bg-(--ui-surface)">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-(--ui-border) bg-(--ui-muted-surface) text-xs font-semibold text-(--ui-text-muted)">
                <th className="px-3 py-2">Invoice #</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Buyer</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit Price</th>
                <th className="px-3 py-2 text-right">Tax %</th>
                <th className="px-3 py-2 text-right">Tax Amt</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-(--ui-border) hover:bg-(--ui-muted-surface)">
                  <td className="px-3 py-2 font-medium">{r.invoice_number}</td>
                  <td className="px-3 py-2">{r.invoice_date}</td>
                  <td className="px-3 py-2">{r.buyer_name}</td>
                  <td className="px-3 py-2">{r.item_description}</td>
                  <td className="px-3 py-2 text-right">{r.quantity}</td>
                  <td className="px-3 py-2 text-right">{r.unit_price}</td>
                  <td className="px-3 py-2 text-right">{r.tax_rate}%</td>
                  <td className="px-3 py-2 text-right">{r.tax_amount}</td>
                  <td className="px-3 py-2 text-right font-medium">{r.total_amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-(--ui-border) bg-(--ui-muted-surface) py-12 text-(--ui-text-muted)">
          <FileSpreadsheet size={32} className="mb-2" />
          <p className="text-sm font-medium">Select a date range and click Generate</p>
          <p className="text-xs">FBR-compliant invoice data will appear here</p>
        </div>
      )}
    </div>
  );
}
