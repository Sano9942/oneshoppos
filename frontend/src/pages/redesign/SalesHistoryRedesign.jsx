import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";
import { API_BASE as API } from "../../config";
import InvoiceView from "../InvoiceView";
import { Ban, Download, FileText, Printer, RefreshCw, Search } from "lucide-react";
import { fmtUtcDateTime } from "../../utils/dates";

function money(n) {
  return `PKRs ${Number(n || 0).toFixed(2)}`;
}

const formatDate = fmtUtcDateTime;

function exportCsv(rows) {
  if (!rows.length) return;
  const headers = [
    "id",
    "timestamp",
    "cashier",
    "outlet",
    "item_count",
    "discount_amount",
    "total_amount",
    "payment_method",
    "status",
  ];
  const body = rows.map((s) =>
    [
      s.id,
      s.timestamp,
      s.employee_name || "",
      s.outlet_name || "",
      s.item_count || 0,
      s.discount_amount || 0,
      s.total_amount || 0,
      s.payment_method || "",
      Number(s.voided || 0) ? "voided" : "active",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[headers.join(","), ...body].join("\n")], {
    type: "text/csv",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sales_history_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function SalesHistoryRedesign() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [invoiceSaleId, setInvoiceSaleId] = useState(null);

  const loadSales = useCallback(
    async (nextPage = page) => {
      setLoading(true);
      setError("");
      try {
        const qs = new URLSearchParams({
          page: String(nextPage),
          limit: "50",
          search,
          date_from: dateFrom,
          date_to: dateTo,
        });
        const res = await fetch(`${API}/api/sales?${qs.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load sales");
        setRows(data.sales || []);
        setTotal(Number(data.total || 0));
        setPages(Math.max(1, Number(data.pages || 1)));
        setPage(Number(data.page || nextPage));
      } catch (e) {
        setError(e.message || "Failed to load sales");
      } finally {
        setLoading(false);
      }
    },
    [page, search, dateFrom, dateTo],
  );

  const loadDetail = async (sale) => {
    setSelected(sale);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`${API}/api/sales/${sale.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load sale details");
      setDetail(data);
    } catch (e) {
      setError(e.message || "Failed to load sale details");
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    loadSales(1);
  }, [loadSales]);

  useEffect(() => {
    const t = setTimeout(() => loadSales(1), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleRows = useMemo(() => {
    if (activeTab === "all") return rows;
    if (activeTab === "completed") return rows.filter((r) => Number(r.voided || 0) === 0);
    if (activeTab === "voided") return rows.filter((r) => Number(r.voided || 0) === 1);
    return rows;
  }, [rows, activeTab]);

  const handleVoid = async () => {
    if (!selected || !detail) return;
    const reason = window.prompt("Void reason");
    if (!reason) return;
    try {
      const res = await fetch(`${API}/api/sales/${selected.id}/void`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ void_reason: reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to void sale");
      await loadSales(page);
      setSelected(null);
      setDetail(null);
    } catch (e) {
      setError(e.message || "Failed to void sale");
    }
  };

  const handleReprint = () => {
    if (!detail?.sale || !detail?.items) return;
    const s = detail.sale;
    const printWindow = window.open("", "_blank", "width=420,height=700");
    const lines = detail.items
      .map(
        (i) =>
          `<tr><td>${i.quantity}x ${i.product_name}</td><td style="text-align:right">${money(
            i.price_at_sale * i.quantity,
          )}</td></tr>`,
      )
      .join("");
    const pays = (detail.payments || [])
      .map(
        (p) =>
          `<tr><td>${p.payment_method}</td><td style="text-align:right">${money(
            p.amount,
          )}</td></tr>`,
      )
      .join("");
    printWindow.document.write(`
      <html><head><title>Receipt #${s.id}</title></head>
      <body style="font-family:monospace;max-width:320px;margin:0 auto;padding:8px;">
      <h3 style="margin:0">SanoPOS</h3>
      <p style="margin:4px 0">Receipt #${s.id} (Reprint)</p>
      <p style="margin:4px 0">${formatDate(s.timestamp)}</p>
      <hr/>
      <table style="width:100%">${lines}</table>
      <hr/>
      <table style="width:100%">
        <tr><td>Total</td><td style="text-align:right;font-weight:700">${money(s.total_amount)}</td></tr>
        ${pays}
      </table>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.onload = () => printWindow.print();
  };

  if (invoiceSaleId) {
    return <InvoiceView saleId={invoiceSaleId} onBack={() => setInvoiceSaleId(null)} />;
  }

  return (
    <PageShell
      title="Sales History"
      subtitle="View all completed sales with void, return, and invoice actions."
      right={
        <div className="flex gap-2">
          <Button onClick={() => exportCsv(visibleRows)}>
            <Download size={14} className="mr-1 inline" />
            Export CSV
          </Button>
          <Button onClick={() => loadSales(page)}>
            <RefreshCw size={14} className="mr-1 inline" />
            Refresh
          </Button>
        </div>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <SectionCard className="p-3"><p className="text-xs text-(--ui-text-muted)">Transactions</p><p className="text-2xl font-semibold text-(--ui-text)">{total}</p></SectionCard>
        <SectionCard className="p-3"><p className="text-xs text-(--ui-text-muted)">Visible Rows</p><p className="text-2xl font-semibold text-(--ui-text)">{visibleRows.length}</p></SectionCard>
        <SectionCard className="p-3"><p className="text-xs text-(--ui-text-muted)">Voided</p><p className="text-2xl font-semibold text-rose-700">{rows.filter((r) => Number(r.voided || 0) === 1).length}</p></SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <SectionCard className="xl:col-span-8">
          <TableToolbar
            left={
              <>
                <div className="relative min-w-65">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" />
                  <Input
                    className="pl-8"
                    placeholder="Search receipt, cashier, outlet"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                <div className="flex gap-1 rounded border border-(--ui-border) p-1">
                  {[
                    ["all", "All"],
                    ["completed", "Completed"],
                    ["voided", "Voided"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={`rounded px-2 py-1 text-xs ${activeTab === id ? "bg-(--ui-primary) text-white" : "text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"}`}
                      onClick={() => setActiveTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            }
            right={<span className="text-xs text-(--ui-text-muted)">Page {page} of {pages}</span>}
          />

          <div className="overflow-auto">
            <table className="min-w-full border-t border-(--ui-border) text-sm">
              <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                <tr>
                  <th className="px-3 py-2 text-left">Receipt</th>
                  <th className="px-3 py-2 text-left">Timestamp</th>
                  <th className="px-3 py-2 text-left">Cashier</th>
                  <th className="px-3 py-2 text-left">Outlet</th>
                  <th className="px-3 py-2 text-center">Items</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {!loading &&
                  visibleRows.map((r) => (
                    <tr
                      key={r.id}
                      className={`cursor-pointer border-t border-(--ui-border) hover:bg-(--ui-muted-surface) ${selected?.id === r.id ? "bg-emerald-50" : ""}`}
                      onClick={() => loadDetail(r)}
                    >
                      <td className="px-3 py-2 font-medium text-(--ui-text)">#{r.id}</td>
                      <td className="px-3 py-2 text-(--ui-text-muted)">{formatDate(r.timestamp)}</td>
                      <td className="px-3 py-2 text-(--ui-text-muted)">{r.employee_name || "-"}</td>
                      <td className="px-3 py-2 text-(--ui-text-muted)">{r.outlet_name || "-"}</td>
                      <td className="px-3 py-2 text-center text-(--ui-text)">{r.item_count || 0}</td>
                      <td className="px-3 py-2 text-right font-semibold text-(--ui-text)">{money(r.total_amount)}</td>
                      <td className="px-3 py-2">
                        <Badge tone={Number(r.voided || 0) ? "danger" : "success"}>
                          {Number(r.voided || 0) ? "voided" : "active"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {loading ? <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading sales...</div> : null}
            {!loading && visibleRows.length === 0 ? (
              <EmptyState title="No sales found" body="Adjust filters and try again." />
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-(--ui-border) p-3">
            <Button size="sm" disabled={page <= 1} onClick={() => loadSales(page - 1)}>Previous</Button>
            <Button size="sm" disabled={page >= pages} onClick={() => loadSales(page + 1)}>Next</Button>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-4 p-3">
          {!selected ? (
            <EmptyState title="Select a sale" body="Click a row to inspect items and actions." />
          ) : detailLoading ? (
            <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading details...</div>
          ) : !detail ? (
            <EmptyState title="Details unavailable" body="Try reloading this sale." />
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-(--ui-text)">Receipt #{selected.id}</h3>
                <p className="text-xs text-(--ui-text-muted)">{formatDate(selected.timestamp)}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SectionCard className="p-2 text-center"><p className="text-xs text-(--ui-text-muted)">Total</p><p className="font-semibold text-(--ui-text)">{money(detail.sale.total_amount)}</p></SectionCard>
                <SectionCard className="p-2 text-center"><p className="text-xs text-(--ui-text-muted)">Payments</p><p className="font-semibold text-(--ui-text)">{(detail.payments || []).length}</p></SectionCard>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-(--ui-text)">Items</h4>
                <div className="max-h-44 space-y-2 overflow-auto">
                  {(detail.items || []).map((item) => (
                    <div key={item.id} className="rounded border border-(--ui-border) p-2 text-xs">
                      <p className="font-medium text-(--ui-text)">{item.product_name}</p>
                      <p className="text-(--ui-text-muted)">{item.quantity} x {money(item.price_at_sale)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" onClick={handleReprint}><Printer size={13} className="mr-1 inline" />Reprint</Button>
                <Button size="sm" onClick={() => setInvoiceSaleId(selected.id)}><FileText size={13} className="mr-1 inline" />Invoice</Button>
                {!Number(detail.sale.voided || 0) ? (
                  <Button size="sm" tone="danger" onClick={handleVoid}><Ban size={13} className="mr-1 inline" />Void</Button>
                ) : null}
                <Button
                  size="sm"
                  onClick={() =>
                    navigate("/returns", {
                      state: {
                        sale_id: selected.id,
                        outlet_id: detail.sale.outlet_id,
                        employee_id: detail.sale.employee_id,
                        customer_id: detail.sale.customer_id,
                        items: detail.items,
                      },
                    })
                  }
                >
                  Return
                </Button>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </PageShell>
  );
}
