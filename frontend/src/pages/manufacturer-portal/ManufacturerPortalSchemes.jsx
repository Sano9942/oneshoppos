import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { manufacturerPortalApi } from "../../api/manufacturerPortalApi";
import { daysAgoLocalStr, todayLocalStr } from "../../utils/dates";

// Tier 1.4 Day 7 — Schemes / Promotions impact page.
// Surfaces scheme-level totals scoped to schemes that touched the partner's
// brands. sale_promotion_applications is sale-scoped (no product_id), so
// attribution is at the scheme level, not the per-SKU level — the server
// returns a `note` field documenting this, which we surface verbatim.

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

// Default window: last 30 days in the browser's LOCAL tz. See utils/dates.js.
function defaultDateRange() {
  return { from: daysAgoLocalStr(29), to: todayLocalStr() };
}

const SCHEME_TYPE_LABELS = {
  percent: "% off",
  fixed: "Rs off",
  threshold_percent: "Spend → % off",
  threshold_fixed: "Spend → Rs off",
  bxgy: "Buy X get Y",
  slab_percent: "Volume slab",
};

export default function ManufacturerPortalSchemes() {
  const { tenantSlug } = useOutletContext();
  const init = defaultDateRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [rows, setRows] = useState([]);
  const [note, setNote] = useState(null);
  const [reportWindow, setReportWindow] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    manufacturerPortalApi
      .get(tenantSlug, "/api/manufacturer-portal/promotions", { from, to })
      .then((res) => {
        if (cancelled) return;
        setRows(res?.rows || []);
        setNote(res?.note || null);
        setReportWindow(res?.window || null);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message || "Couldn't load schemes");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, from, to]);

  const totalDiscount = rows.reduce(
    (sum, r) => sum + Number(r.total_discount || 0),
    0
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-(--ui-text)">Schemes</h1>
        <p className="text-(--ui-text-muted) mt-1">
          Volume schemes and promotions that touched your brand SKUs during
          this window.
        </p>
      </div>

      <div className="bg-(--ui-surface) border border-(--ui-border) rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-md">
          <div>
            <label className="block text-xs text-(--ui-text-muted) mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full px-3 py-2 border border-(--ui-border-strong) rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-(--ui-text-muted) mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-3 py-2 border border-(--ui-border-strong) rounded text-sm"
            />
          </div>
        </div>
      </div>

      <div className="bg-(--ui-surface) border border-(--ui-border) rounded-lg">
        <div className="px-4 py-3 border-b border-(--ui-border) flex items-center justify-between">
          <div className="text-sm font-medium text-(--ui-text)">
            {loading
              ? "Loading…"
              : `${rows.length} scheme${rows.length === 1 ? "" : "s"} · ${fmtCurrency(totalDiscount)} total discount`}
          </div>
          {reportWindow && (
            <div className="text-xs text-(--ui-text-muted)">
              {reportWindow.from} → {reportWindow.to} · {reportWindow.timezone}
            </div>
          )}
        </div>

        {err && (
          <div className="px-4 py-3 text-sm text-(--ui-danger-fg) bg-(--ui-danger-bg) border-b border-(--ui-danger-bg)">
            {err}
          </div>
        )}

        {!loading && rows.length === 0 && !err ? (
          <div className="px-4 py-12 text-center text-sm text-(--ui-text-muted)">
            No schemes were applied to sales of your brands in this window.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-(--ui-text-muted) uppercase border-b border-(--ui-border) bg-(--ui-muted-surface)">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Scheme</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-right px-4 py-2 font-medium">Applications</th>
                <th className="text-right px-4 py-2 font-medium">Qualifying qty</th>
                <th className="text-right px-4 py-2 font-medium">Total discount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className="border-b border-(--ui-border)">
                  <td className="px-4 py-2 font-medium">{r.scheme_name}</td>
                  <td className="px-4 py-2 text-(--ui-text-muted)">
                    {SCHEME_TYPE_LABELS[r.scheme_type] || r.scheme_type}
                  </td>
                  <td className="px-4 py-2 text-right">{r.application_count}</td>
                  <td className="px-4 py-2 text-right">
                    {fmtQty(r.total_qty_qualifying)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-(--ui-success-fg)">
                    {fmtCurrency(r.total_discount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {note && (
        <div className="text-xs text-(--ui-text-muted) italic bg-(--ui-muted-surface) border border-(--ui-border) rounded px-4 py-3">
          {note}
        </div>
      )}
    </div>
  );
}
