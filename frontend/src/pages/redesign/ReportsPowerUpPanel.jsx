import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, RefreshCw } from "lucide-react";
import { API_BASE as API } from "../../config";
import useReportFilters from "../../hooks/useReportFilters";

const money = (v) => `PKRs ${Number(v || 0).toFixed(2)}`;

function toCsv(filename, rows, columns, meta) {
  const lines = [];
  lines.push(`# generated_at: ${new Date().toISOString()}`);
  lines.push(`# data_as_of: ${new Date().toISOString()}`);
  lines.push(`# currency: PKR`);
  lines.push(`# filters_applied: ${JSON.stringify(meta || {})}`);
  lines.push(columns.map((c) => c.header).join(","));
  rows.forEach((row) => {
    lines.push(
      columns
        .map((c) => {
          const raw = row[c.key] == null ? "" : String(row[c.key]);
          return `"${raw.replace(/"/g, '""')}"`;
        })
        .join(","),
    );
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Filters({ filters, setFilters, show }) {
  if (!show) return null;
  return (
    <div className="mb-3 grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-5">
      <input
        type="date"
        value={filters.date_from}
        onChange={(e) => setFilters((p) => ({ ...p, date_from: e.target.value }))}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <input
        type="date"
        value={filters.date_to}
        onChange={(e) => setFilters((p) => ({ ...p, date_to: e.target.value }))}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <input
        placeholder="Outlet ID"
        value={filters.outlet_id}
        onChange={(e) => setFilters((p) => ({ ...p, outlet_id: e.target.value }))}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <input
        placeholder="Employee ID"
        value={filters.employee_id}
        onChange={(e) => setFilters((p) => ({ ...p, employee_id: e.target.value }))}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <input
        placeholder="Category ID"
        value={filters.category_id}
        onChange={(e) => setFilters((p) => ({ ...p, category_id: e.target.value }))}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
    </div>
  );
}

export default function ReportsPowerUpPanel({
  flags,
  authHeaders,
}) {
  const { filters, setFilters, query } = useReportFilters();
  const [exceptionType, setExceptionType] = useState("negative_margin_sales");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [profitSummary, setProfitSummary] = useState(null);
  const [profitByProduct, setProfitByProduct] = useState([]);
  const [profitByOutlet, setProfitByOutlet] = useState([]);
  const [discountLeakage, setDiscountLeakage] = useState([]);
  const [deadStock, setDeadStock] = useState([]);
  const [stockAging, setStockAging] = useState([]);
  const [stockoutRisk, setStockoutRisk] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [forecastRows, setForecastRows] = useState([]);
  const [replenishmentSmart, setReplenishmentSmart] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [savedViews, setSavedViews] = useState([]);
  const [definitions, setDefinitions] = useState([]);
  const [deliveryLog, setDeliveryLog] = useState([]);
  const [scheduleDraft, setScheduleDraft] = useState({
    name: "",
    report_key: "profit-by-product",
    frequency: "daily",
    run_hour: 6,
    run_minute: 0,
    recipient: "",
  });
  const [viewDraft, setViewDraft] = useState({
    report_key: "overview",
    name: "",
    scope: "personal",
  });
  const [defDraft, setDefDraft] = useState({
    report_key: "forecast-demand",
    version: "",
    query_signature: "",
    notes: "",
  });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const calls = [];
      if (flags.reports_profit_layer) {
        calls.push(fetch(`${API}/api/reports/profit-summary?${query}`, { headers: authHeaders() }).then((r) => r.json()));
        calls.push(fetch(`${API}/api/reports/profit-by-product?${query}`, { headers: authHeaders() }).then((r) => r.json()));
        calls.push(fetch(`${API}/api/reports/profit-by-outlet?${query}`, { headers: authHeaders() }).then((r) => r.json()));
        calls.push(fetch(`${API}/api/reports/discount-leakage?${query}`, { headers: authHeaders() }).then((r) => r.json()));
      }
      if (flags.reports_inventory_health_plus) {
        calls.push(fetch(`${API}/api/reports/dead-stock?${query}`, { headers: authHeaders() }).then((r) => r.json()));
        calls.push(fetch(`${API}/api/reports/stock-aging?${query}`, { headers: authHeaders() }).then((r) => r.json()));
        calls.push(fetch(`${API}/api/reports/stockout-risk?${query}`, { headers: authHeaders() }).then((r) => r.json()));
        calls.push(fetch(`${API}/api/reports/forecast-demand?${query}`, { headers: authHeaders() }).then((r) => r.json()));
        calls.push(fetch(`${API}/api/reports/replenishment-smart?${query}`, { headers: authHeaders() }).then((r) => r.json()));
      }
      if (flags.reports_exceptions) {
        calls.push(fetch(`${API}/api/reports/exceptions?${query}&type=${encodeURIComponent(exceptionType)}`, { headers: authHeaders() }).then((r) => r.json()));
      }
      if (flags.reports_scheduled_exports) {
        calls.push(fetch(`${API}/api/reports/schedules`, { headers: authHeaders() }).then((r) => r.json()));
        calls.push(fetch(`${API}/api/reports/saved-views?report_key=overview`, { headers: authHeaders() }).then((r) => r.json()));
        calls.push(fetch(`${API}/api/reports/governance/definitions`, { headers: authHeaders() }).then((r) => r.json()));
        calls.push(fetch(`${API}/api/reports/delivery-log`, { headers: authHeaders() }).then((r) => r.json()));
      }

      const results = await Promise.all(calls);
      let idx = 0;
      if (flags.reports_profit_layer) {
        setProfitSummary(results[idx++].summary || null);
        setProfitByProduct(results[idx++].rows || []);
        setProfitByOutlet(results[idx++].rows || []);
        setDiscountLeakage(results[idx++].rows || []);
      }
      if (flags.reports_inventory_health_plus) {
        setDeadStock(results[idx++].rows || []);
        setStockAging(results[idx++].rows || []);
        setStockoutRisk(results[idx++].rows || []);
        setForecastRows(results[idx++].rows || []);
        setReplenishmentSmart(results[idx++].rows || []);
      }
      if (flags.reports_exceptions) {
        setExceptions(results[idx++].rows || []);
      }
      if (flags.reports_scheduled_exports) {
        setSchedules(results[idx++].schedules || []);
        setSavedViews(results[idx++].views || []);
        setDefinitions(results[idx++].definitions || []);
        setDeliveryLog(results[idx++].log || []);
      }
    } catch (e) {
      setError(e.message || "Failed to load enhanced reports.");
    } finally {
      setLoading(false);
    }
  };

  const createSchedule = async () => {
    const res = await fetch(`${API}/api/reports/schedules`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        ...scheduleDraft,
        run_hour: Number(scheduleDraft.run_hour || 6),
        run_minute: Number(scheduleDraft.run_minute || 0),
        filters,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create schedule");
    setScheduleDraft((p) => ({ ...p, name: "", recipient: "" }));
    await load();
  };

  const runScheduleNow = async (id) => {
    const res = await fetch(`${API}/api/reports/schedules/${id}/run-now`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to run schedule");
    await load();
  };

  const createSavedView = async () => {
    const res = await fetch(`${API}/api/reports/saved-views`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        ...viewDraft,
        filters,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save view");
    setViewDraft((p) => ({ ...p, name: "" }));
    await load();
  };

  const createDefinition = async () => {
    const res = await fetch(`${API}/api/reports/governance/definitions`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(defDraft),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save definition");
    setDefDraft((p) => ({ ...p, version: "", query_signature: "", notes: "" }));
    await load();
  };

  useEffect(() => {
    if (!flags.reports_profit_layer && !flags.reports_inventory_health_plus && !flags.reports_exceptions) return;
    load();
  }, [query, exceptionType]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!flags.reports_profit_layer && !flags.reports_inventory_health_plus && !flags.reports_exceptions) {
    return null;
  }

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Reports Power-Up</h2>
          <p className="text-xs text-slate-500">Feature-flagged profitability and inventory control analytics.</p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <Filters filters={filters} setFilters={setFilters} show={flags.reports_enhanced_filters} />
      {error ? <p className="mb-2 text-sm text-rose-600">{error}</p> : null}
      {loading ? <p className="mb-2 text-sm text-slate-500">Loading enhanced reports...</p> : null}

      {flags.reports_profit_layer ? (
        <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Profit Layer</h3>
            <button
              onClick={() =>
                toCsv(
                  "profit-by-product.csv",
                  profitByProduct,
                  [
                    { header: "Product", key: "product_name" },
                    { header: "Revenue", key: "revenue" },
                    { header: "COGS", key: "cogs" },
                    { header: "Gross Profit", key: "gross_profit" },
                    { header: "Margin %", key: "margin_pct" },
                  ],
                  filters,
                )
              }
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600"
            >
              <Download size={12} />
              Export
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
            <div className="rounded-lg bg-slate-50 p-2">Gross Sales: <b>{money(profitSummary?.gross_sales)}</b></div>
            <div className="rounded-lg bg-slate-50 p-2">COGS: <b>{money(profitSummary?.cogs)}</b></div>
            <div className="rounded-lg bg-slate-50 p-2">Gross Profit: <b>{money(profitSummary?.gross_profit)}</b></div>
            <div className="rounded-lg bg-slate-50 p-2">Net Profit: <b>{money(profitSummary?.net_profit)}</b></div>
            <div className="rounded-lg bg-slate-50 p-2">Net Margin: <b>{Number(profitSummary?.net_margin_pct || 0).toFixed(2)}%</b></div>
          </div>
          <div className="mt-2 text-xs text-slate-600">
            Top margin products: {(profitByProduct || []).slice(0, 5).map((r) => `${r.product_name} (${Number(r.margin_pct || 0).toFixed(1)}%)`).join(", ") || "—"}
          </div>
          <div className="mt-1 text-xs text-slate-600">
            Outlet leaders: {(profitByOutlet || []).slice(0, 3).map((r) => `${r.outlet_name} (${money(r.gross_profit)})`).join(", ") || "—"}
          </div>
          <div className="mt-1 text-xs text-slate-600">
            Discount leakage records: {discountLeakage.length}
            <Link to={`/reports/sales-detail${query ? `?${query}` : ""}`} className="ml-2 text-blue-600 underline">Drill down</Link>
          </div>
        </div>
      ) : null}

      {flags.reports_inventory_health_plus ? (
        <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Inventory Health+</h3>
          <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-2">
              Dead stock rows: <b>{deadStock.length}</b>
              <div className="text-slate-500">Value tied: {money(deadStock.reduce((s, r) => s + Number(r.stock_cost_value || 0), 0))}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              Aging tracked: <b>{stockAging.length}</b>
              <div className="text-slate-500">Oldest: {Math.max(0, ...stockAging.map((r) => Number(r.days_since_sale || 0)))} days</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              Stockout risk high: <b>{stockoutRisk.filter((r) => r.risk_level === "high").length}</b>
              <div className="text-slate-500">
                <Link to={`/reports/replenishment${query ? `?${query}` : ""}`} className="text-blue-600 underline">Drill to replenishment</Link>
              </div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-2">
              Forecast rows: <b>{forecastRows.length}</b>
              <div className="text-slate-500">
                Avg 7d demand (top): {forecastRows[0] ? Number(forecastRows[0].forecast_7d_units || 0).toFixed(2) : "0.00"}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              Smart replenishment rows: <b>{replenishmentSmart.length}</b>
              <div className="text-slate-500">
                Suggested reorder (top): {replenishmentSmart[0] ? Number(replenishmentSmart[0].suggested_reorder_qty || 0) : 0}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {flags.reports_exceptions ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Exceptions</h3>
            <select
              value={exceptionType}
              onChange={(e) => setExceptionType(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
            >
              <option value="negative_margin_sales">Negative Margin Sales</option>
              <option value="high_discount_orders">High Discount Orders</option>
              <option value="frequent_voids_by_employee">Frequent Voids by Employee</option>
              <option value="frequent_returns_by_product">Frequent Returns by Product</option>
            </select>
          </div>
          <p className="text-xs text-slate-600">
            Current exception rows: <b>{exceptions.length}</b>
            <Link to={`/reports/sales-detail${query ? `?${query}` : ""}`} className="ml-2 text-blue-600 underline">Open detail view</Link>
          </p>
        </div>
      ) : null}

      {flags.reports_scheduled_exports ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Phase 2: Schedules, Saved Views, Governance</h3>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-2 text-xs">
              <p className="mb-2 font-semibold">Create Schedule</p>
              <input
                value={scheduleDraft.name}
                onChange={(e) => setScheduleDraft((p) => ({ ...p, name: e.target.value }))}
                placeholder="Name"
                className="mb-1 w-full rounded border border-slate-200 px-2 py-1"
              />
              <select
                value={scheduleDraft.report_key}
                onChange={(e) => setScheduleDraft((p) => ({ ...p, report_key: e.target.value }))}
                className="mb-1 w-full rounded border border-slate-200 px-2 py-1"
              >
                <option value="profit-by-product">profit-by-product</option>
                <option value="stock-aging">stock-aging</option>
                <option value="stockout-risk">stockout-risk</option>
                <option value="exceptions-high-discount">exceptions-high-discount</option>
              </select>
              <div className="mb-1 grid grid-cols-2 gap-1">
                <select
                  value={scheduleDraft.frequency}
                  onChange={(e) => setScheduleDraft((p) => ({ ...p, frequency: e.target.value }))}
                  className="rounded border border-slate-200 px-2 py-1"
                >
                  <option value="daily">daily</option>
                  <option value="weekly">weekly</option>
                </select>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={scheduleDraft.run_hour}
                  onChange={(e) => setScheduleDraft((p) => ({ ...p, run_hour: e.target.value }))}
                  placeholder="hour"
                  className="rounded border border-slate-200 px-2 py-1"
                />
              </div>
              <input
                value={scheduleDraft.recipient}
                onChange={(e) => setScheduleDraft((p) => ({ ...p, recipient: e.target.value }))}
                placeholder="Recipient (optional)"
                className="mb-1 w-full rounded border border-slate-200 px-2 py-1"
              />
              <button
                onClick={async () => {
                  try {
                    await createSchedule();
                  } catch (e) {
                    setError(e.message || "Create schedule failed");
                  }
                }}
                className="rounded bg-slate-900 px-2 py-1 font-medium text-white"
              >
                Save Schedule
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 p-2 text-xs">
              <p className="mb-2 font-semibold">Create Saved View</p>
              <input
                value={viewDraft.name}
                onChange={(e) => setViewDraft((p) => ({ ...p, name: e.target.value }))}
                placeholder="View name"
                className="mb-1 w-full rounded border border-slate-200 px-2 py-1"
              />
              <select
                value={viewDraft.report_key}
                onChange={(e) => setViewDraft((p) => ({ ...p, report_key: e.target.value }))}
                className="mb-1 w-full rounded border border-slate-200 px-2 py-1"
              >
                <option value="overview">overview</option>
                <option value="profit-layer">profit-layer</option>
                <option value="inventory-health">inventory-health</option>
                <option value="exceptions">exceptions</option>
              </select>
              <select
                value={viewDraft.scope}
                onChange={(e) => setViewDraft((p) => ({ ...p, scope: e.target.value }))}
                className="mb-1 w-full rounded border border-slate-200 px-2 py-1"
              >
                <option value="personal">personal</option>
                <option value="global">global</option>
              </select>
              <button
                onClick={async () => {
                  try {
                    await createSavedView();
                  } catch (e) {
                    setError(e.message || "Create saved view failed");
                  }
                }}
                className="rounded bg-slate-900 px-2 py-1 font-medium text-white"
              >
                Save View
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 p-2 text-xs">
              <p className="mb-2 font-semibold">Register Definition Version</p>
              <input
                value={defDraft.report_key}
                onChange={(e) => setDefDraft((p) => ({ ...p, report_key: e.target.value }))}
                placeholder="Report key"
                className="mb-1 w-full rounded border border-slate-200 px-2 py-1"
              />
              <input
                value={defDraft.version}
                onChange={(e) => setDefDraft((p) => ({ ...p, version: e.target.value }))}
                placeholder="Version (e.g. v1.0.0)"
                className="mb-1 w-full rounded border border-slate-200 px-2 py-1"
              />
              <input
                value={defDraft.query_signature}
                onChange={(e) => setDefDraft((p) => ({ ...p, query_signature: e.target.value }))}
                placeholder="Query signature"
                className="mb-1 w-full rounded border border-slate-200 px-2 py-1"
              />
              <button
                onClick={async () => {
                  try {
                    await createDefinition();
                  } catch (e) {
                    setError(e.message || "Create definition failed");
                  }
                }}
                className="rounded bg-slate-900 px-2 py-1 font-medium text-white"
              >
                Save Definition
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="mb-1 font-semibold">Schedules ({schedules.length})</p>
              <div className="max-h-36 space-y-1 overflow-auto">
                {schedules.slice(0, 20).map((s) => (
                  <div key={s.id} className="rounded border border-slate-200 bg-white p-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{s.name}</span>
                      <button
                        onClick={async () => {
                          try {
                            await runScheduleNow(s.id);
                          } catch (e) {
                            setError(e.message || "Run now failed");
                          }
                        }}
                        className="rounded border border-slate-200 px-2 py-0.5"
                      >
                        Run now
                      </button>
                    </div>
                    <p className="text-slate-500">{s.report_key} | next: {s.next_run_at || "—"}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="mb-1 font-semibold">Saved Views ({savedViews.length})</p>
              <div className="max-h-36 space-y-1 overflow-auto">
                {savedViews.slice(0, 20).map((v) => (
                  <div key={v.id} className="rounded border border-slate-200 bg-white p-1.5">
                    <p className="font-medium">{v.name}</p>
                    <p className="text-slate-500">{v.report_key} | {v.scope}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="mb-1 font-semibold">Definition Versions ({definitions.length})</p>
              <div className="max-h-28 space-y-1 overflow-auto">
                {definitions.slice(0, 20).map((d) => (
                  <div key={d.id} className="rounded border border-slate-200 bg-white p-1.5">
                    <p className="font-medium">{d.report_key} {d.version}</p>
                    <p className="text-slate-500">{d.query_signature || "—"}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="mb-1 font-semibold">Delivery Log ({deliveryLog.length})</p>
              <div className="max-h-28 space-y-1 overflow-auto">
                {deliveryLog.slice(0, 20).map((d) => (
                  <div key={d.id} className="rounded border border-slate-200 bg-white p-1.5">
                    <p className="font-medium">{d.status} | {d.channel}</p>
                    <p className="text-slate-500">{d.message || "—"}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
