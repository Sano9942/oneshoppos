import React, { useState, useEffect, useCallback } from "react";
import { Globe, ShoppingBag, Store, ShoppingCart } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { api } from "../../api";
import { exportCSV, ExportButton, TableShell, CardShell } from "./ReportShared";
import { useCurrency } from "../../contexts/CurrencyContext";

const CHANNEL_COLORS = {
  POS: "#3b82f6",
  Shopify: "#22c55e",
  WooCommerce: "#a855f7",
};

const CHANNEL_ICONS = {
  POS: Store,
  Shopify: ShoppingBag,
  WooCommerce: ShoppingCart,
};

function buildParams(filters) {
  const p = new URLSearchParams();
  if (filters.dateFrom) p.set("from", filters.dateFrom);
  if (filters.dateTo) p.set("to", filters.dateTo);
  if (filters.outletIds?.length === 1) p.set("outlet_id", filters.outletIds[0]);
  return p;
}

// ── Channel Summary Cards ─────────────────────────────────────────────
function ChannelCard({ channel, fmt }) {
  const Icon = CHANNEL_ICONS[channel.channel] || Globe;
  const color = CHANNEL_COLORS[channel.channel] || "#64748b";

  return (
    <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${color}15` }}>
          <Icon size={20} style={{ color }} />
        </div>
        <div>
          <div className="text-sm font-bold text-(--ui-text)">{channel.channel}</div>
          <div className="text-xs text-(--ui-text-muted)">{channel.order_count} orders</div>
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-(--ui-text-muted)">Net Revenue</span>
          <span className="font-bold text-(--ui-text)">{fmt(channel.net_revenue)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-(--ui-text-muted)">Gross Revenue</span>
          <span className="font-medium text-(--ui-text)">{fmt(channel.gross_revenue)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-(--ui-text-muted)">Discounts</span>
          <span className="font-medium text-(--ui-danger-fg)">-{fmt(channel.discount_total)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-(--ui-text-muted)">Tax</span>
          <span className="font-medium text-(--ui-text-muted)">{fmt(channel.tax_total)}</span>
        </div>
        <div className="flex justify-between border-t border-(--ui-border) pt-2">
          <span className="text-(--ui-text-muted)">Avg Order</span>
          <span className="font-bold text-(--ui-text)">{fmt(channel.average_order_value)}</span>
        </div>
      </div>
    </div>
  );
}

function GrandTotalCard({ grand, fmt }) {
  return (
    <div className="rounded-2xl border-2 border-(--ui-focus) bg-(--ui-muted-surface)/50 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-(--ui-muted-surface)">
          <Globe size={20} className="text-(--ui-link)" />
        </div>
        <div>
          <div className="text-sm font-bold text-(--ui-text)">All Channels</div>
          <div className="text-xs text-(--ui-text-muted)">{grand.order_count} total orders</div>
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-(--ui-text-muted)">Net Revenue</span>
          <span className="font-bold text-lg text-(--ui-link)">{fmt(grand.net_revenue)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-(--ui-text-muted)">Gross Revenue</span>
          <span className="font-medium text-(--ui-text)">{fmt(grand.gross_revenue)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-(--ui-text-muted)">Total Discounts</span>
          <span className="font-medium text-(--ui-danger-fg)">-{fmt(grand.discount_total)}</span>
        </div>
        <div className="flex justify-between border-t border-(--ui-border) pt-2">
          <span className="text-(--ui-text-muted)">Avg Order</span>
          <span className="font-bold text-(--ui-text)">{fmt(grand.average_order_value)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Revenue Pie Chart ─────────────────────────────────────────────────
function RevenuePieChart({ channels, fmt }) {
  const data = channels
    .filter((c) => c.net_revenue > 0)
    .map((c) => ({ name: c.channel, value: c.net_revenue }));

  if (!data.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-(--ui-text-muted)">
        No revenue data to chart
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-5">
      <h3 className="mb-3 text-sm font-bold text-(--ui-text) uppercase tracking-tight">Revenue Share by Channel</h3>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={3}
            dataKey="value"
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={CHANNEL_COLORS[entry.name] || "#64748b"} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => fmt(v)} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Daily Trends Table ────────────────────────────────────────────────
function DailyTrendsSection({ filters, fmt }) {
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = buildParams(filters);
      const d = await api.get(`/api/reports/multichannel-daily?${p}`);
      setDays(d.days || []);
    } catch {
      setDays([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => { load(); }, [load]);

  const cols = ["Date", "POS Revenue", "POS Orders", "Shopify Revenue", "Shopify Orders", "WooCommerce Revenue", "WC Orders", "Total Revenue"];

  return (
    <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) overflow-hidden">
      <div className="flex items-center justify-between border-b border-(--ui-border) px-5 py-3">
        <h3 className="text-sm font-bold text-(--ui-text) uppercase tracking-tight">Daily Trends</h3>
        <ExportButton onClick={() => exportCSV("multichannel-daily.csv", [
          { header: "Date", key: "date" },
          { header: "POS Revenue", key: "pos_revenue" },
          { header: "POS Orders", key: "pos_orders" },
          { header: "Shopify Revenue", key: "shopify_revenue" },
          { header: "Shopify Orders", key: "shopify_orders" },
          { header: "WooCommerce Revenue", key: "woocommerce_revenue" },
          { header: "WC Orders", key: "woocommerce_orders" },
          { header: "Total Revenue", key: "total_revenue" },
        ], days)} />
      </div>
      <TableShell cols={cols} loading={loading} empty={!days.length}>
        {days.map((d) => (
          <tr key={d.date} className="hover:bg-(--ui-muted-surface)">
            <td className="px-4 py-2.5 text-xs font-semibold text-(--ui-text) whitespace-nowrap">{d.date}</td>
            <td className="px-4 py-2.5 text-xs font-medium text-(--ui-link)">{fmt(d.pos_revenue)}</td>
            <td className="px-4 py-2.5 text-xs text-(--ui-text-muted)">{d.pos_orders}</td>
            <td className="px-4 py-2.5 text-xs font-medium text-(--ui-success-fg)">{fmt(d.shopify_revenue)}</td>
            <td className="px-4 py-2.5 text-xs text-(--ui-text-muted)">{d.shopify_orders}</td>
            <td className="px-4 py-2.5 text-xs font-medium text-(--ui-text-muted)">{fmt(d.woocommerce_revenue)}</td>
            <td className="px-4 py-2.5 text-xs text-(--ui-text-muted)">{d.woocommerce_orders}</td>
            <td className="px-4 py-2.5 text-xs font-bold text-(--ui-text)">{fmt(d.total_revenue)}</td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}

// ── Top Products Table ────────────────────────────────────────────────
function TopProductsSection({ filters, fmt }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = buildParams(filters);
      const d = await api.get(`/api/reports/multichannel-products?${p}`);
      setProducts(d.products || []);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => { load(); }, [load]);

  const cols = ["Product", "POS Qty", "Shopify Qty", "WC Qty", "Total Qty", "POS Rev", "Shopify Rev", "WC Rev", "Total Revenue"];

  return (
    <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) overflow-hidden">
      <div className="flex items-center justify-between border-b border-(--ui-border) px-5 py-3">
        <h3 className="text-sm font-bold text-(--ui-text) uppercase tracking-tight">Top Products Across Channels</h3>
        <ExportButton onClick={() => exportCSV("multichannel-products.csv", [
          { header: "Product", key: "product_name" },
          { header: "POS Qty", key: "pos_qty" },
          { header: "Shopify Qty", key: "shopify_qty" },
          { header: "WC Qty", key: "woocommerce_qty" },
          { header: "Total Qty", key: "total_qty" },
          { header: "POS Revenue", key: "pos_revenue" },
          { header: "Shopify Revenue", key: "shopify_revenue" },
          { header: "WC Revenue", key: "woocommerce_revenue" },
          { header: "Total Revenue", key: "total_revenue" },
        ], products)} />
      </div>
      <TableShell cols={cols} loading={loading} empty={!products.length}>
        {products.map((p, i) => (
          <tr key={p.product_id || i} className="hover:bg-(--ui-muted-surface)">
            <td className="px-4 py-2.5 text-xs font-semibold text-(--ui-text) max-w-48 truncate">{p.product_name}</td>
            <td className="px-4 py-2.5 text-xs text-(--ui-link)">{p.pos_qty}</td>
            <td className="px-4 py-2.5 text-xs text-(--ui-success-fg)">{p.shopify_qty}</td>
            <td className="px-4 py-2.5 text-xs text-(--ui-text-muted)">{p.woocommerce_qty}</td>
            <td className="px-4 py-2.5 text-xs font-bold text-(--ui-text)">{p.total_qty}</td>
            <td className="px-4 py-2.5 text-xs text-(--ui-link)">{fmt(p.pos_revenue)}</td>
            <td className="px-4 py-2.5 text-xs text-(--ui-success-fg)">{fmt(p.shopify_revenue)}</td>
            <td className="px-4 py-2.5 text-xs text-(--ui-text-muted)">{fmt(p.woocommerce_revenue)}</td>
            <td className="px-4 py-2.5 text-xs font-bold text-(--ui-text)">{fmt(p.total_revenue)}</td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}

// ── Main Tab ──────────────────────────────────────────────────────────
export default function MultichannelTab({ filters }) {
  const { fmt } = useCurrency();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const p = buildParams(filters);
      const d = await api.get(`/api/reports/multichannel-summary?${p}`);
      setSummary(d);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  if (loading) {
    return <div className="p-8 text-center text-(--ui-text-muted) font-medium">Loading multi-channel report...</div>;
  }

  if (!summary) {
    return <div className="p-8 text-center text-(--ui-text-muted)">Failed to load multi-channel data</div>;
  }

  const { channels, grand } = summary;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Globe size={16} className="text-(--ui-link)" />
        <h2 className="text-sm font-bold text-(--ui-text) uppercase tracking-tight">Multi-Channel Overview</h2>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {channels.map((ch) => (
          <ChannelCard key={ch.channel} channel={ch} fmt={fmt} />
        ))}
        <GrandTotalCard grand={grand} fmt={fmt} />
      </div>

      {/* Pie Chart */}
      <RevenuePieChart channels={channels} fmt={fmt} />

      {/* Daily Trends */}
      <DailyTrendsSection filters={filters} fmt={fmt} />

      {/* Top Products */}
      <TopProductsSection filters={filters} fmt={fmt} />
    </div>
  );
}
