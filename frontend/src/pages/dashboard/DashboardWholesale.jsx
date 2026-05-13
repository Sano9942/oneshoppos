import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet, AlertTriangle, Users } from "lucide-react";
import { api } from "../../api";
import { SectionCard } from "../../ui/primitives";
import { useCurrency } from "../../contexts/CurrencyContext";

// Wholesale dashboard cards (Tier 0.5). Renders when the tenant has the
// `wholesale` mode set. Cards: Total Outstanding A/R, Overdue >30 days,
// Top 5 buyers by balance.
export default function DashboardWholesale({ refreshKey = 0 }) {
  const navigate = useNavigate();
  const { fmt } = useCurrency();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api
      .get("/api/reports/dashboard/wholesale")
      .then((json) => {
        if (!mounted) return;
        setData(json);
        setError("");
      })
      .catch((e) => {
        if (!mounted) return;
        setError(e.message || "Failed to load wholesale dashboard");
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  if (loading) {
    return (
      <SectionCard className="p-4">
        <p className="text-sm text-(--ui-text-muted)">Loading wholesale summary…</p>
      </SectionCard>
    );
  }
  if (error) {
    return (
      <SectionCard className="p-4">
        <p className="text-sm text-red-600">{error}</p>
      </SectionCard>
    );
  }
  if (!data) return null;

  const overduePct =
    data.total_outstanding > 0
      ? Math.round((data.overdue_amount / data.total_outstanding) * 100)
      : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SectionCard
          className="cursor-pointer p-4 hover:shadow-md transition"
          onClick={() => navigate("/reports/payables-receivables")}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-(--ui-text-muted)">
                Total Outstanding A/R
              </p>
              <p className="mt-1 text-2xl font-bold text-(--ui-text)">
                {fmt(data.total_outstanding)}
              </p>
              <p className="mt-1 text-xs text-(--ui-text-muted)">
                {data.open_invoice_count} open invoice{data.open_invoice_count === 1 ? "" : "s"}
              </p>
            </div>
            <Wallet size={20} className="text-(--ui-text-muted)" />
          </div>
        </SectionCard>

        <SectionCard
          className="cursor-pointer p-4 hover:shadow-md transition"
          onClick={() => navigate("/reports/ar-aging")}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-(--ui-text-muted)">
                Overdue &gt; {data.overdue_days} days
              </p>
              <p
                className={`mt-1 text-2xl font-bold ${
                  data.overdue_amount > 0 ? "text-red-600" : "text-(--ui-text)"
                }`}
              >
                {fmt(data.overdue_amount)}
              </p>
              <p className="mt-1 text-xs text-(--ui-text-muted)">
                {data.overdue_invoice_count} invoice
                {data.overdue_invoice_count === 1 ? "" : "s"}
                {data.total_outstanding > 0 ? ` · ${overduePct}% of A/R` : ""}
              </p>
            </div>
            <AlertTriangle
              size={20}
              className={data.overdue_amount > 0 ? "text-red-500" : "text-(--ui-text-muted)"}
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-(--ui-text-muted)" />
            <p className="text-sm font-semibold text-(--ui-text)">Top 5 Buyers by Balance</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/reports/ar-aging")}
            className="text-xs text-(--ui-primary) hover:underline"
          >
            View A/R aging →
          </button>
        </div>
        {data.top_buyers.length === 0 ? (
          <p className="text-sm text-(--ui-text-muted)">No buyers with outstanding balances.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-xs uppercase tracking-wide text-(--ui-text-muted)">
                  <th className="py-2 text-left font-medium">Buyer</th>
                  <th className="py-2 text-right font-medium">Open</th>
                  <th className="py-2 text-right font-medium">Overdue</th>
                  <th className="py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.top_buyers.map((b) => (
                  <tr
                    key={b.customer_id}
                    className="border-b border-(--ui-border) last:border-0 hover:bg-(--ui-bg-hover) cursor-pointer"
                    onClick={() => navigate(`/customers?focus=${b.customer_id}`)}
                  >
                    <td className="py-2 font-medium text-(--ui-text)">{b.name}</td>
                    <td className="py-2 text-right text-(--ui-text-muted)">
                      {b.open_invoice_count}
                    </td>
                    <td
                      className={`py-2 text-right ${
                        b.overdue_amount > 0 ? "text-red-600" : "text-(--ui-text-muted)"
                      }`}
                    >
                      {b.overdue_amount > 0 ? fmt(b.overdue_amount) : "—"}
                    </td>
                    <td className="py-2 text-right font-semibold text-(--ui-text)">
                      {fmt(b.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
