import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useMfgPortalAuth } from "./ManufacturerPortalAuthProvider";
import { manufacturerPortalApi } from "../../api/manufacturerPortalApi";

function fmtCurrency(n) {
  return "Rs " + Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function fmtQty(n) {
  return Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function StatCard({ title, value, sub }) {
  return (
    <div className="bg-(--ui-surface) border border-(--ui-border) rounded-lg p-4">
      <div className="text-sm text-(--ui-text-muted)">{title}</div>
      <div className="text-2xl font-bold text-(--ui-text) mt-1">{value}</div>
      {sub && <div className="text-xs text-(--ui-text-muted) mt-1">{sub}</div>}
    </div>
  );
}

function WindowCard({ label, data }) {
  if (!data) return null;
  return (
    <div className="bg-(--ui-surface) border border-(--ui-border) rounded-lg p-4">
      <div className="text-sm font-medium text-(--ui-text) mb-3">{label}</div>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-(--ui-text-muted)">Qty</span>
          <span className="font-semibold">{fmtQty(data.qty)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-(--ui-text-muted)">Gross</span>
          <span className="font-semibold">{fmtCurrency(data.gross_revenue)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-(--ui-text-muted)">Scheme discount</span>
          <span className="font-semibold text-(--ui-success-fg)">
            {fmtCurrency(data.scheme_discount)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-(--ui-text-muted)">Sales</span>
          <span className="font-semibold">{data.sales_count}</span>
        </div>
      </div>
    </div>
  );
}

export default function ManufacturerPortalDashboard() {
  const { tenantSlug } = useOutletContext();
  const auth = useMfgPortalAuth();
  const [me, setMe] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      manufacturerPortalApi.get(tenantSlug, "/api/manufacturer-portal/me"),
      manufacturerPortalApi.get(tenantSlug, "/api/manufacturer-portal/summary"),
    ])
      .then(([m, s]) => {
        if (cancelled) return;
        setMe(m);
        setSummary(s);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message || "Couldn't load dashboard");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  if (loading) {
    return <div className="text-(--ui-text-muted)">Loading dashboard…</div>;
  }
  if (err) {
    return (
      <div className="text-(--ui-danger-fg) bg-(--ui-danger-bg) border border-(--ui-danger-bg) rounded px-4 py-3">
        {err}
      </div>
    );
  }

  const brands = me?.brands || [];
  const window = summary?.window;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-(--ui-text)">
          Welcome, {auth.partner?.name || me?.partner?.name || "there"}
        </h1>
        <p className="text-(--ui-text-muted) mt-1">
          Real-time secondary sales of{" "}
          <strong>
            {brands.length
              ? brands.map((b) => b.name).join(", ")
              : "your brands"}
          </strong>{" "}
          through {tenantSlug}.
        </p>
        {window && (
          <p className="text-xs text-(--ui-text-muted) mt-1">
            Showing {window.from} → {window.to} ({window.timezone})
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <WindowCard label="Today" data={summary?.today} />
        <WindowCard label="Last 7 days" data={summary?.last_7d} />
        <WindowCard label="Last 30 days" data={summary?.last_30d} />
      </div>

      <div className="bg-(--ui-surface) border border-(--ui-border) rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-(--ui-text)">
            Top SKUs (last 30 days)
          </div>
          <Link
            to={`/manufacturer-portal/${tenantSlug}/sales`}
            className="text-xs text-(--ui-link) hover:text-(--ui-link)"
          >
            View all →
          </Link>
        </div>
        {(!summary?.top_skus || summary.top_skus.length === 0) ? (
          <div className="text-sm text-(--ui-text-muted) py-4">
            No sales recorded for your brands in this window.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-(--ui-text-muted) uppercase border-b border-(--ui-border)">
              <tr>
                <th className="text-left py-2 font-medium">Product</th>
                <th className="text-left py-2 font-medium">Brand</th>
                <th className="text-right py-2 font-medium">Qty</th>
                <th className="text-right py-2 font-medium">Gross</th>
              </tr>
            </thead>
            <tbody>
              {summary.top_skus.map((row) => (
                <tr key={row.product_id} className="border-b border-(--ui-border)">
                  <td className="py-2">{row.product_name}</td>
                  <td className="py-2 text-(--ui-text-muted)">{row.brand_name || "—"}</td>
                  <td className="py-2 text-right font-medium">{fmtQty(row.qty)}</td>
                  <td className="py-2 text-right font-medium">
                    {fmtCurrency(row.gross_revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <StatCard
        title="Your brands"
        value={brands.length}
        sub={brands.map((b) => b.name).join(" · ") || "No brands assigned yet"}
      />
    </div>
  );
}
