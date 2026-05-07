import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  Select,
  TableToolbar,
} from "../../ui/primitives";
import { api } from "../../api";
import InvoiceView from "../InvoiceView";
import { Ban, Download, FileText, Gift, Mail, MessageCircle, Printer, RefreshCw, Search, Share2 } from "lucide-react";
import { fmtUtcDateTime } from "../../utils/dates";
import { useCurrency } from "../../contexts/CurrencyContext";
import { useToast } from "../../contexts/ToastContext";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { buildReceiptHtml } from "../../utils/receipt";
import { buildPublicReceiptUrl, buildWhatsAppShareUrl } from "../../utils/publicReceipt";
import POSEmailReceiptModal from "./pos/POSEmailReceiptModal";
import VoidCompModal from "./pos/restaurant/VoidCompModal";

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
  const { fmt: money, symbol: currencySymbol } = useCurrency();
  const navigate = useNavigate();
  const toast = useToast();
  const { authHeaders, hasPerm } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  const canCompVoid =
    flags.phase4_restaurant_void_comp && (hasPerm("manage_restaurant") || hasPerm("all_access"));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [employees, setEmployees] = useState([]);
  const [activeTab, setActiveTab] = useState("all");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [invoiceSaleId, setInvoiceSaleId] = useState(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  // W29 — per-line comp/void on a settled sale. Modal opens with the
  // tapped sale_item_id, posts to /api/restaurant/sale-items/:id/adjust.
  // Adjustments list rendered as inline badges on each item line.
  const [adjustments, setAdjustments] = useState([]);
  const [voidCompState, setVoidCompState] = useState({
    open: false,
    tab: "comp",
    saleItemId: null,
    itemName: null,
    remainingAmount: 0,
  });

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
        const data = await api.get(`/api/sales?${qs.toString()}`);
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

  const loadAdjustments = useCallback(async (saleId) => {
    if (!saleId || !canCompVoid) {
      setAdjustments([]);
      return;
    }
    try {
      const data = await api.get(`/api/restaurant/adjustments?sale_id=${saleId}`);
      setAdjustments(Array.isArray(data) ? data : []);
    } catch {
      // Non-restaurant tenant or flag off — leave empty, no error toast
      setAdjustments([]);
    }
  }, [canCompVoid]);

  const loadDetail = async (sale) => {
    setSelected(sale);
    setDetail(null);
    setAdjustments([]);
    setDetailLoading(true);
    try {
      const data = await api.get(`/api/sales/${sale.id}`);
      setDetail(data);
      loadAdjustments(sale.id);
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

  useEffect(() => {
    api.get("/api/employees")
      .then((d) => setEmployees(d.employees || []))
      .catch(() => {});
  }, []);

  const visibleRows = useMemo(() => {
    let filtered = rows;
    if (activeTab === "completed") filtered = filtered.filter((r) => Number(r.voided || 0) === 0);
    else if (activeTab === "voided") filtered = filtered.filter((r) => Number(r.voided || 0) === 1);
    if (paymentMethod) filtered = filtered.filter((r) => r.payment_method === paymentMethod);
    if (employeeId) filtered = filtered.filter((r) => String(r.employee_id) === String(employeeId));
    return filtered;
  }, [rows, activeTab, paymentMethod, employeeId]);

  const handleVoid = async () => {
    if (!selected || !detail) return;
    const reason = window.prompt("Void reason");
    if (!reason) return;
    try {
      await api.put(`/api/sales/${selected.id}/void`, { void_reason: reason });
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
    const slip = {
      invoiceNumber: s.invoice_number || `#${s.id}`,
      timestamp: formatDate(s.timestamp),
      total: s.total_amount,
      cart: detail.items.map((i) => ({
        name: i.product_name,
        price: i.price_at_sale,
        quantity: i.quantity,
      })),
      payments: (detail.payments || []).map((p) => ({
        method: p.payment_method,
        amount: p.amount,
      })),
      customer: s.customer_name ? { name: s.customer_name } : null,
    };
    buildReceiptHtml(slip, null, currencySymbol);
  };

  const handleShareReceipt = async () => {
    if (!detail?.sale?.invoice_number) {
      toast.error("This sale has no invoice number to share");
      return;
    }
    const url = buildPublicReceiptUrl(detail.sale.invoice_number);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Receipt link copied");
    } catch {
      // Older browsers / iframes without Permissions-Policy=clipboard-write
      // just see the URL in a prompt — still useful as a fallback.
      window.prompt("Copy this receipt link:", url);
    }
  };

  const handleShareWhatsApp = () => {
    if (!detail?.sale?.invoice_number) {
      toast.error("This sale has no invoice number to share");
      return;
    }
    const s = detail.sale;
    const url = buildWhatsAppShareUrl({
      invoiceNumber: s.invoice_number,
      totalLabel: money(s.total_amount),
      outletName: s.outlet_name,
    });
    window.open(url, "_blank");
  };

  const handleEmailReceipt = () => {
    if (!detail?.sale?.id) {
      toast.error("Sale not loaded yet");
      return;
    }
    setShowEmailModal(true);
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
                <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="">All Methods</option>
                  <option value="Cash">Cash</option>
                  <option value="Card">Card</option>
                  <option value="Wallet">Wallet</option>
                  <option value="Split">Split</option>
                </Select>
                <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                  <option value="">All Employees</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </Select>
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
                  <th className="px-3 py-2 text-center">FBR</th>
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
                      <td className="px-3 py-2 text-center">
                        {r.fbr_status === "posted" ? (
                          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" title="Posted" />
                        ) : r.fbr_status === "pending" ? (
                          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" title="Pending" />
                        ) : r.fbr_status === "failed" ? (
                          <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500" title="Failed" />
                        ) : (
                          <span className="inline-block h-2.5 w-2.5 rounded-full bg-(--ui-border)" title="N/A" />
                        )}
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
              {/* F4 (Apr 28 2026): surface refund context from GET /api/sales/:id
                  so the cashier sees what's already been refunded against this
                  sale and can't blindly re-trigger Return on a fully-refunded
                  one. refunded_qty / refund_total are populated by F2. */}
              {(() => {
                const refundTotal = Number(detail.sale.refund_total || 0);
                const itemsWithRemaining = (detail.items || []).map((it) => ({
                  ...it,
                  remainingQty: Math.max(
                    0,
                    Number(it.quantity || 0) - Number(it.refunded_qty || 0),
                  ),
                }));
                const fullyRefunded =
                  refundTotal > 0 &&
                  itemsWithRemaining.every((it) => it.remainingQty <= 0);
                const partiallyRefunded = refundTotal > 0 && !fullyRefunded;

                return (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <SectionCard className="p-2 text-center">
                        <p className="text-xs text-(--ui-text-muted)">Total</p>
                        <p className="font-semibold text-(--ui-text)">{money(detail.sale.total_amount)}</p>
                      </SectionCard>
                      <SectionCard className="p-2 text-center">
                        <p className="text-xs text-(--ui-text-muted)">Payments</p>
                        <p className="font-semibold text-(--ui-text)">{(detail.payments || []).length}</p>
                      </SectionCard>
                    </div>

                    {refundTotal > 0 ? (
                      <SectionCard className="p-2 text-center">
                        <p className="text-xs text-(--ui-text-muted)">
                          {fullyRefunded ? "Fully refunded" : "Partially refunded"}
                        </p>
                        <p className="font-semibold text-rose-600">
                          −{money(refundTotal)}
                        </p>
                      </SectionCard>
                    ) : null}

                    <div>
                      <h4 className="mb-2 text-sm font-semibold text-(--ui-text)">Items</h4>
                      <div className="max-h-56 space-y-2 overflow-auto">
                        {itemsWithRemaining.map((item) => {
                          const refunded = Number(item.refunded_qty || 0);
                          const lineTotal = Number(item.price_at_sale || 0) * Number(item.quantity || 0);
                          const lineAdjustments = adjustments.filter((a) => a.sale_item_id === item.id);
                          const compTotal = lineAdjustments
                            .filter((a) => a.adjustment_type === "comp")
                            .reduce((s, a) => s + Number(a.amount || 0), 0);
                          const voidTotal = lineAdjustments
                            .filter((a) => a.adjustment_type === "void")
                            .reduce((s, a) => s + Number(a.amount || 0), 0);
                          const adjustedTotal = compTotal + voidTotal;
                          const remainingAdjustable = Math.max(0, lineTotal - adjustedTotal);
                          const fullyAdjusted = adjustedTotal >= lineTotal && lineTotal > 0;
                          return (
                            <div key={item.id} className="rounded border border-(--ui-border) p-2 text-xs">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-(--ui-text)">{item.product_name}</p>
                                  <p className="text-(--ui-text-muted)">
                                    {item.quantity} x {money(item.price_at_sale)}
                                    {refunded > 0 ? (
                                      <span className="ml-1 text-rose-600">
                                        ({refunded} refunded
                                        {item.remainingQty > 0 ? `, ${item.remainingQty} remaining` : ""})
                                      </span>
                                    ) : null}
                                  </p>
                                  {lineAdjustments.length > 0 ? (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {lineAdjustments.map((a) => (
                                        <span
                                          key={a.id}
                                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                            a.adjustment_type === "comp"
                                              ? "bg-emerald-50 text-emerald-700"
                                              : "bg-rose-50 text-rose-700"
                                          }`}
                                          title={`${a.reason_label || a.reason_code}${a.reason_note ? ` — ${a.reason_note}` : ""}`}
                                        >
                                          {a.adjustment_type === "comp" ? "Comped" : "Voided"} {money(a.amount)}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                                {canCompVoid && !Number(detail.sale.voided || 0) ? (
                                  <div className="flex shrink-0 gap-1">
                                    <button
                                      type="button"
                                      disabled={fullyAdjusted}
                                      title={fullyAdjusted ? "Line fully adjusted" : "Comp this line (manager PIN required)"}
                                      onClick={() => setVoidCompState({
                                        open: true,
                                        tab: "comp",
                                        saleItemId: item.id,
                                        itemName: item.product_name,
                                        remainingAmount: remainingAdjustable,
                                      })}
                                      className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      <Gift size={11} /> Comp
                                    </button>
                                    <button
                                      type="button"
                                      disabled={fullyAdjusted}
                                      title={fullyAdjusted ? "Line fully adjusted" : "Void this line (manager PIN required)"}
                                      onClick={() => setVoidCompState({
                                        open: true,
                                        tab: "void",
                                        saleItemId: item.id,
                                        itemName: item.product_name,
                                        remainingAmount: remainingAdjustable,
                                      })}
                                      className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      <Ban size={11} /> Void
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" onClick={handleReprint}><Printer size={13} className="mr-1 inline" />Reprint</Button>
                      <Button size="sm" onClick={() => setInvoiceSaleId(selected.id)}><FileText size={13} className="mr-1 inline" />Invoice</Button>
                      <Button size="sm" onClick={handleShareReceipt} title="Copy a public receipt link the customer can open without logging in"><Share2 size={13} className="mr-1 inline" />Share</Button>
                      <Button size="sm" onClick={handleEmailReceipt} title="Email this receipt to a customer"><Mail size={13} className="mr-1 inline" />Email</Button>
                      <Button size="sm" onClick={handleShareWhatsApp} title="Open WhatsApp with the receipt link pre-filled"><MessageCircle size={13} className="mr-1 inline" />WhatsApp</Button>
                      {!Number(detail.sale.voided || 0) ? (
                        <Button size="sm" tone="danger" onClick={handleVoid}><Ban size={13} className="mr-1 inline" />Void</Button>
                      ) : null}
                      <Button
                        size="sm"
                        disabled={fullyRefunded}
                        title={fullyRefunded ? "This sale has been fully refunded" : undefined}
                        onClick={() =>
                          navigate("/returns", {
                            state: {
                              sale_id: selected.id,
                              outlet_id: detail.sale.outlet_id,
                              employee_id: detail.sale.employee_id,
                              customer_id: detail.sale.customer_id,
                              // Pass remaining-refundable qty (not the original
                              // quantity) so the prefill in ReturnsRedesign
                              // matches what the backend will actually accept.
                              items: itemsWithRemaining
                                .filter((it) => it.remainingQty > 0)
                                .map((it) => ({
                                  ...it,
                                  quantity: it.remainingQty,
                                })),
                            },
                          })
                        }
                      >
                        Return
                      </Button>
                      {partiallyRefunded ? (
                        <p className="col-span-2 text-center text-xs text-(--ui-text-muted)">
                          Partial refund recorded — only remaining units are eligible.
                        </p>
                      ) : null}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </SectionCard>
      </div>
      {showEmailModal && detail?.sale?.id && (
        <POSEmailReceiptModal
          saleId={detail.sale.id}
          customerEmail={detail.sale.customer_email || ""}
          onClose={() => setShowEmailModal(false)}
        />
      )}

      <VoidCompModal
        open={voidCompState.open}
        initialTab={voidCompState.tab}
        saleItemId={voidCompState.saleItemId}
        itemName={voidCompState.itemName}
        remainingAmount={voidCompState.remainingAmount}
        onClose={() => setVoidCompState((s) => ({ ...s, open: false }))}
        onSuccess={(adj) => {
          setVoidCompState((s) => ({ ...s, open: false }));
          if (adj?.adjustment_type === "comp") toast.success("Item comped");
          else if (adj?.adjustment_type === "void") toast.success("Item voided");
          if (selected?.id) loadAdjustments(selected.id);
        }}
      />
    </PageShell>
  );
}
