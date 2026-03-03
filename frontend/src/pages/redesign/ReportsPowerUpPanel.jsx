import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, Download, RefreshCw } from "lucide-react";
import { API_BASE as API } from "../../config";
import useReportFilters from "../../hooks/useReportFilters";
import { indentLabel, sortCategories } from "../../utils/categoryTree";

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
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Filters({ filters, setFilters, show, categories }) {
  if (!show) return null;
  return (
    <div className="mb-3 grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-5">
      <input
        type="date"
        value={filters.date_from}
        onChange={(e) =>
          setFilters((p) => ({ ...p, date_from: e.target.value }))
        }
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
        onChange={(e) =>
          setFilters((p) => ({ ...p, outlet_id: e.target.value }))
        }
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <input
        placeholder="Employee ID"
        value={filters.employee_id}
        onChange={(e) =>
          setFilters((p) => ({ ...p, employee_id: e.target.value }))
        }
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <select
        value={filters.category_id}
        onChange={(e) =>
          setFilters((p) => ({ ...p, category_id: e.target.value }))
        }
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
      >
        <option value="">All categories</option>
        {(categories || []).map((category) => (
          <option key={category.id} value={category.id}>
            {indentLabel(category)}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function ReportsPowerUpPanel({ flags, authHeaders }) {
  const { filters, setFilters, query } = useReportFilters();
  const [isExpanded, setIsExpanded] = useState(false);
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
  const [categories, setCategories] = useState([]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const calls = [];
      if (flags.reports_profit_layer) {
        calls.push(
          fetch(`${API}/api/reports/profit-summary?${query}`, {
            headers: authHeaders(),
          }).then((r) => r.json()),
        );
        calls.push(
          fetch(`${API}/api/reports/profit-by-product?${query}`, {
            headers: authHeaders(),
          }).then((r) => r.json()),
        );
        calls.push(
          fetch(`${API}/api/reports/profit-by-outlet?${query}`, {
            headers: authHeaders(),
          }).then((r) => r.json()),
        );
        calls.push(
          fetch(`${API}/api/reports/discount-leakage?${query}`, {
            headers: authHeaders(),
          }).then((r) => r.json()),
        );
      }
      if (flags.reports_inventory_health_plus) {
        calls.push(
          fetch(`${API}/api/reports/dead-stock?${query}`, {
            headers: authHeaders(),
          }).then((r) => r.json()),
        );
        calls.push(
          fetch(`${API}/api/reports/stock-aging?${query}`, {
            headers: authHeaders(),
          }).then((r) => r.json()),
        );
        calls.push(
          fetch(`${API}/api/reports/stockout-risk?${query}`, {
            headers: authHeaders(),
          }).then((r) => r.json()),
        );
        calls.push(
          fetch(`${API}/api/reports/forecast-demand?${query}`, {
            headers: authHeaders(),
          }).then((r) => r.json()),
        );
        calls.push(
          fetch(`${API}/api/reports/replenishment-smart?${query}`, {
            headers: authHeaders(),
          }).then((r) => r.json()),
        );
      }
      if (flags.reports_exceptions) {
        calls.push(
          fetch(
            `${API}/api/reports/exceptions?${query}&type=${encodeURIComponent(exceptionType)}`,
            { headers: authHeaders() },
          ).then((r) => r.json()),
        );
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
    } catch (e) {
      setError(e.message || "Failed to load enhanced reports.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch(`${API}/api/categories`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => setCategories(sortCategories(data.categories || [])))
      .catch(() => setCategories([]));
  }, [authHeaders]);

  useEffect(() => {
    if (!isExpanded) return;
    if (
      !flags.reports_profit_layer &&
      !flags.reports_inventory_health_plus &&
      !flags.reports_exceptions
    ) {
      return;
    }
    load();
  }, [query, exceptionType, isExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (
    !flags.reports_profit_layer &&
    !flags.reports_inventory_health_plus &&
    !flags.reports_exceptions
  ) {
    return null;
  }

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div
        className={`flex items-center justify-between gap-2 ${isExpanded ? "mb-2" : ""}`}
      >
        <div>
          <h2 className="text-lg font-semibold text-slate-800">
            Reports Power-Up
          </h2>
          <p className="text-xs text-slate-500">
            Feature-gated profitability, inventory control, and exception analytics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <button
              onClick={load}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          ) : null}
          <button
            onClick={() => setIsExpanded((p) => !p)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            {isExpanded ? (
              <>
                <ChevronUp size={14} />
                Collapse
              </>
            ) : (
              <>
                <ChevronDown size={14} />
                Expand Analytics
              </>
            )}
          </button>
        </div>
      </div>

      {isExpanded ? (
        <>
          <Filters
            filters={filters}
            setFilters={setFilters}
            show={flags.reports_enhanced_filters}
            categories={categories}
          />
          {error ? <p className="mb-2 text-sm text-rose-600">{error}</p> : null}
          {loading ? (
            <p className="mb-2 text-sm text-slate-500">
              Loading enhanced reports...
            </p>
          ) : null}

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
                <div className="rounded-lg bg-slate-50 p-2">
                  Gross Sales: <b>{money(profitSummary?.gross_sales)}</b>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  COGS: <b>{money(profitSummary?.cogs)}</b>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  Gross Profit: <b>{money(profitSummary?.gross_profit)}</b>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  Net Profit: <b>{money(profitSummary?.net_profit)}</b>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  Net Margin:{" "}
                  <b>{Number(profitSummary?.net_margin_pct || 0).toFixed(2)}%</b>
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-600">
                Top margin products:{" "}
                {(profitByProduct || [])
                  .slice(0, 5)
                  .map(
                    (row) =>
                      `${row.product_name} (${Number(row.margin_pct || 0).toFixed(1)}%)`,
                  )
                  .join(", ") || "-"}
              </div>
              <div className="mt-1 text-xs text-slate-600">
                Outlet leaders:{" "}
                {(profitByOutlet || [])
                  .slice(0, 3)
                  .map((row) => `${row.outlet_name} (${money(row.gross_profit)})`)
                  .join(", ") || "-"}
              </div>
              <div className="mt-1 text-xs text-slate-600">
                Discount leakage records: {discountLeakage.length}
                <Link
                  to={`/reports/sales-detail${query ? `?${query}` : ""}`}
                  className="ml-2 text-blue-600 underline"
                >
                  Drill down
                </Link>
              </div>
            </div>
          ) : null}

          {flags.reports_inventory_health_plus ? (
            <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">
                Inventory Health+
              </h3>
              <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-2">
                  Dead stock rows: <b>{deadStock.length}</b>
                  <div className="text-slate-500">
                    Value tied:{" "}
                    {money(
                      deadStock.reduce(
                        (sum, row) => sum + Number(row.stock_cost_value || 0),
                        0,
                      ),
                    )}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  Aging tracked: <b>{stockAging.length}</b>
                  <div className="text-slate-500">
                    Oldest:{" "}
                    {Math.max(
                      0,
                      ...stockAging.map((row) => Number(row.days_since_sale || 0)),
                    )}{" "}
                    days
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  Stockout risk high:{" "}
                  <b>{stockoutRisk.filter((row) => row.risk_level === "high").length}</b>
                  <div className="text-slate-500">
                    <Link
                      to={`/reports/replenishment${query ? `?${query}` : ""}`}
                      className="text-blue-600 underline"
                    >
                      Drill to replenishment
                    </Link>
                  </div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-2">
                  Forecast rows: <b>{forecastRows.length}</b>
                  <div className="text-slate-500">
                    Avg 7d demand (top):{" "}
                    {forecastRows[0]
                      ? Number(forecastRows[0].forecast_7d_units || 0).toFixed(2)
                      : "0.00"}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  Smart replenishment rows: <b>{replenishmentSmart.length}</b>
                  <div className="text-slate-500">
                    Suggested reorder (top):{" "}
                    {replenishmentSmart[0]
                      ? Number(replenishmentSmart[0].suggested_reorder_qty || 0)
                      : 0}
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
                  <option value="frequent_voids_by_employee">
                    Frequent Voids by Employee
                  </option>
                  <option value="frequent_returns_by_product">
                    Frequent Returns by Product
                  </option>
                </select>
              </div>
              <p className="text-xs text-slate-600">
                Current exception rows: <b>{exceptions.length}</b>
                <Link
                  to={`/reports/sales-detail${query ? `?${query}` : ""}`}
                  className="ml-2 text-blue-600 underline"
                >
                  Open detail view
                </Link>
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
