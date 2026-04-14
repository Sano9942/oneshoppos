import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

function statusColor(status) {
  switch (status) {
    case "paid":
      return "bg-emerald-100 text-emerald-700";
    case "overdue":
      return "bg-red-100 text-red-700";
    case "partial":
      return "bg-amber-100 text-amber-700";
    case "void":
      return "bg-slate-200 text-slate-600";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export default function PortalInvoices() {
  const { tenantSlug } = useParams();
  const [invoices, setInvoices] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .get(tenantSlug, "/api/portal/me/invoices")
      .then((rows) => {
        if (!cancelled) setInvoices(rows);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  const filtered = invoices.filter((i) => (filter === "all" ? true : i.status === filter));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border border-slate-300 rounded px-3 py-1 text-sm"
        >
          <option value="all">All</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
        </select>
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          No invoices to show.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left font-medium px-4 py-3">Invoice #</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-right font-medium px-4 py-3">Total</th>
                <th className="text-right font-medium px-4 py-3">Balance</th>
                <th className="text-left font-medium px-4 py-3">Due</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium">{inv.invoice_number}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusColor(inv.status)}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {Number(inv.total_amount).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {Number(inv.balance_due).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/portal/${tenantSlug}/invoices/${inv.id}`}
                      className="text-emerald-700 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
