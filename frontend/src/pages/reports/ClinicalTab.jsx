import { useEffect, useState } from "react";
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";

export default function ClinicalTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { fmt } = useCurrency();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [completion, attendance, revenue, retention, labs] = await Promise.all([
          api.get("/api/reports/clinical/plan-completion").catch(() => ({ by_provider: [] })),
          api.get("/api/reports/clinical/session-attendance").catch(() => ({ by_provider: [] })),
          api.get("/api/reports/clinical/revenue-per-plan").catch(() => ({ plans: {}, sessions: {} })),
          api.get("/api/reports/clinical/patient-retention").catch(() => ({ retention: {} })),
          api.get("/api/reports/clinical/lab-turnaround").catch(() => ({ by_vendor: [] })),
        ]);
        if (!cancelled) setData({ completion, attendance, revenue, retention, labs });
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load clinical report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="p-4 text-slate-500">Loading clinical reports…</div>;
  if (error) return <div className="p-4 text-red-600">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <Card title="Plan Completion by Provider">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b text-slate-600">
              <th className="py-2">Provider</th>
              <th>Total plans</th>
              <th>Completed</th>
              <th>Completion %</th>
            </tr>
          </thead>
          <tbody>
            {(data.completion.by_provider || []).map((r, i) => (
              <tr key={i} className="border-b">
                <td className="py-2">{r.provider_name}</td>
                <td>{r.total_plans}</td>
                <td>{r.completed_plans}</td>
                <td>{r.completion_pct != null ? `${r.completion_pct}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Session Attendance (no-show rates)">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b text-slate-600">
              <th className="py-2">Provider</th>
              <th>Scheduled</th>
              <th>Completed</th>
              <th>No-show</th>
              <th>No-show %</th>
            </tr>
          </thead>
          <tbody>
            {(data.attendance.by_provider || []).map((r, i) => (
              <tr key={i} className="border-b">
                <td className="py-2">{r.provider_name}</td>
                <td>{r.scheduled_count}</td>
                <td>{r.completed_count}</td>
                <td>{r.no_show_count}</td>
                <td className={r.no_show_pct >= 10 ? "text-red-600 font-semibold" : ""}>
                  {r.no_show_pct != null ? `${r.no_show_pct}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Revenue per Plan">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Completed plans" value={data.revenue.plans?.plan_count || 0} />
            <Stat label="Total revenue" value={fmt(data.revenue.plans?.total_revenue || 0)} />
            <Stat label="Avg per plan" value={fmt(data.revenue.plans?.avg_revenue_per_plan || 0)} />
            <Stat label="Avg per session" value={fmt(data.revenue.sessions?.avg_revenue_per_session || 0)} />
          </dl>
        </Card>

        <Card title="Patient Retention">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Total patients" value={data.retention.retention?.total_patients || 0} />
            <Stat label="Returned 30d" value={data.retention.retention?.returned_30_count || 0} />
            <Stat label="Returned 60d" value={data.retention.retention?.returned_60_count || 0} />
            <Stat label="Returned 90d" value={data.retention.retention?.returned_90_count || 0} />
          </dl>
        </Card>
      </div>

      <Card title="Lab Turnaround by Vendor">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b text-slate-600">
              <th className="py-2">Vendor</th>
              <th>Orders</th>
              <th>Completed</th>
              <th>Avg turnaround (days)</th>
            </tr>
          </thead>
          <tbody>
            {(data.labs.by_vendor || []).map((r, i) => (
              <tr key={i} className="border-b">
                <td className="py-2">{r.lab_vendor}</td>
                <td>{r.total_orders}</td>
                <td>{r.completed_orders}</td>
                <td>{r.avg_turnaround_days != null ? r.avg_turnaround_days : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h3 className="font-semibold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}
