import { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useAuth } from "../../auth/AuthProvider";
import { SectionCard } from "../../ui/primitives";
import { fmtUtcDate } from "../../utils/dates";

export default function DashboardHoldsExpiring() {
  const { fmt } = useCurrency();
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (flagsLoading || !flags.phase2g_holds) return;
    let cancelled = false;
    setLoading(true);
    api.get("/api/holds/expiring", { days: 7 })
      .then((d) => { if (!cancelled) setRows(d.holds || []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [flagsLoading, flags.phase2g_holds]);

  if (flagsLoading || !flags.phase2g_holds) return null;
  if (!loading && rows.length === 0) return null;

  const top = rows.slice(0, 5);

  return (
    <SectionCard>
      <div className="flex items-center justify-between mb-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-(--ui-text)">
          <Package size={14} className="text-(--ui-warning-fg)" />
          Holds expiring this week
          <span className="text-xs font-normal text-(--ui-text-muted)">({rows.length})</span>
        </h3>
        <Link to="/holds?expiring=7" className="text-xs font-medium text-(--ui-link) hover:underline">
          View all →
        </Link>
      </div>
      <div className="divide-y divide-(--ui-border)">
        {top.map((h) => (
          <div key={h.id} className="flex items-center justify-between py-2 text-sm">
            <div className="min-w-0">
              <div className="font-semibold truncate">{h.hold_number}</div>
              <div className="text-xs text-(--ui-text-muted) truncate">
                {h.customer_name_full || h.customer_name || "Walk-in"}
                {h.customer_phone && <span> · {h.customer_phone}</span>}
              </div>
            </div>
            <div className="text-right shrink-0 ml-3">
              <div className="font-bold text-(--ui-text)">{fmt(h.balance_due)}</div>
              <div className="text-xs text-(--ui-warning-fg)">{fmtUtcDate(h.hold_until)}</div>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
