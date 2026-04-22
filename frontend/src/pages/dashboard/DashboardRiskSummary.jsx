import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Shield, AlertTriangle } from "lucide-react";
import { api } from "../../api";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useAuth } from "../../auth/AuthProvider";
import { SectionCard } from "../../ui/primitives";

/**
 * Retail risk summary card (2-G.17).
 *
 * Feature-flag gated. Hidden entirely when phase2g_risk_controls is off.
 * Shows two rolling counts: no-sale events in the last 7 days and the
 * number of unreviewed anomaly flags. Clicks navigate to /retail-risk.
 */
export default function DashboardRiskSummary() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (flagsLoading || !flags.phase2g_risk_controls) return;
    let cancelled = false;
    setLoading(true);
    api.get("/api/risk/summary")
      .then((d) => { if (!cancelled) setSummary(d); })
      .catch(() => { if (!cancelled) setSummary(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [flagsLoading, flags.phase2g_risk_controls]);

  if (flagsLoading || !flags.phase2g_risk_controls) return null;
  if (loading || !summary) return null;

  const noSale = Number(summary.no_sale_count_7d || 0);
  const unreviewed = Number(summary.unreviewed_anomaly_count || 0);
  if (noSale === 0 && unreviewed === 0) return null;

  return (
    <SectionCard>
      <div className="flex items-center justify-between mb-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-(--ui-text)">
          <Shield size={14} className="text-[#8066FF]" />
          Retail risk
        </h3>
        <Link to="/retail-risk" className="text-xs text-[#8066FF] hover:underline">
          View →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-(--ui-text-muted)">No-sale events (7d)</p>
          <p className="text-2xl font-black text-(--ui-text)">{noSale}</p>
        </div>
        <div>
          <p className="text-xs text-(--ui-text-muted)">Unreviewed anomalies</p>
          <p className={`text-2xl font-black ${unreviewed > 0 ? "text-rose-600" : "text-(--ui-text)"}`}>
            {unreviewed}
            {unreviewed > 0 && (
              <AlertTriangle className="inline-block ml-1 h-5 w-5 text-rose-500" />
            )}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
