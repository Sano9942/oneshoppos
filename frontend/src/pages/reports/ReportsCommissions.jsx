import { useState, useEffect } from "react";
import { useCurrency } from "../../contexts/CurrencyContext";
import { useToast } from "../../contexts/ToastContext";
import { Badge } from "../../ui/primitives";
import { Download } from "lucide-react";
import { fmtUtcDateTime } from "../../utils/dates";
import { downloadCsv } from "../../utils/csvExport";
import { api } from "../../api";

const STATUS_TONES = { pending: "warning", approved: "success", paid: "default", reversed: "danger" };

export default function CommissionSummaryTab({ filters }) {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [earnings, setEarnings] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters?.from) params.set("from", filters.from);
    if (filters?.to) params.set("to", filters.to);
    if (statusFilter) params.set("status", statusFilter);
    const qs = params.toString() ? `?${params}` : "";

    api.get(`/api/commissions/earnings${qs}`).then(r => {
      setEarnings(r.earnings || []);
      setSummary(r.summary || {});
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [filters?.from, filters?.to, statusFilter]);

  const handleExport = () => {
    const headers = ["Employee", "Plan", "Invoice", "Sale Amount", "Commission", "Status", "Date"];
    const rows = earnings.map(e => [
      e.employee_name, e.plan_name, e.invoice_number || "", Number(e.sale_amount).toFixed(2),
      Number(e.commission_amount).toFixed(2), e.status, e.created_at,
    ]);
    downloadCsv(headers, rows, "commission-report.csv");
  };

  if (loading) return <p className="text-(--ui-muted) text-sm py-8 text-center">Loading...</p>;

  return (
    <div className="space-y-4">
      <div className="flex gap-4 flex-wrap">
        <div className="bg-(--ui-bg) border border-(--ui-border) rounded px-4 py-2 text-center">
          <p className="text-xs text-(--ui-muted)">Pending</p>
          <p className="font-semibold text-yellow-600">{fmt(Number(summary.pending_total || 0))}</p>
        </div>
        <div className="bg-(--ui-bg) border border-(--ui-border) rounded px-4 py-2 text-center">
          <p className="text-xs text-(--ui-muted)">Approved</p>
          <p className="font-semibold text-green-600">{fmt(Number(summary.approved_total || 0))}</p>
        </div>
        <div className="bg-(--ui-bg) border border-(--ui-border) rounded px-4 py-2 text-center">
          <p className="text-xs text-(--ui-muted)">Paid</p>
          <p className="font-semibold text-(--ui-text)">{fmt(Number(summary.paid_total || 0))}</p>
        </div>
        <div className="ml-auto flex gap-2 items-center">
          <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text)" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="reversed">Reversed</option>
          </select>
          <button onClick={handleExport} className="flex items-center gap-1 text-sm text-blue-500 hover:underline">
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {earnings.length === 0 ? (
        <p className="text-(--ui-muted) text-sm py-4 text-center">No commission earnings in this period.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--ui-border) text-left text-(--ui-muted)">
              <th className="py-2 font-medium">Employee</th>
              <th className="py-2 font-medium">Plan</th>
              <th className="py-2 font-medium">Invoice</th>
              <th className="py-2 font-medium">Sale Amount</th>
              <th className="py-2 font-medium">Commission</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {earnings.map(e => (
              <tr key={e.id} className="border-b border-(--ui-border)">
                <td className="py-2 text-(--ui-text)">{e.employee_name}</td>
                <td className="py-2">{e.plan_name}</td>
                <td className="py-2">{e.invoice_number || "-"}</td>
                <td className="py-2">{fmt(Number(e.sale_amount))}</td>
                <td className="py-2 font-medium">{fmt(Number(e.commission_amount))}</td>
                <td className="py-2"><Badge tone={STATUS_TONES[e.status]}>{e.status}</Badge></td>
                <td className="py-2">{fmtUtcDateTime(e.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
