import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Download, Eye, Package, RefreshCw, Save, Search, Send, Truck } from "lucide-react";
import { fmtUtcDateTime } from "../../utils/dates";
import { useCurrency } from "../../contexts/CurrencyContext";
import { useToast } from "../../contexts/ToastContext";
import { api } from "../../api";
import {
  Badge,
  BulkActionBar,
  Button,
  EmptyState,
  Input,
  Modal,
  ModalFooter,
  PageShell,
  SectionCard,
  Select,
  TableToolbar,
} from "../../ui/primitives";

const PAGE_SIZE = 25;

const AGING_BUCKETS = [
  { key: "fresh", label: "Fresh", color: "bg-green-500", textColor: "text-green-700", sub: "0-2 days" },
  { key: "aging", label: "Aging", color: "bg-yellow-500", textColor: "text-yellow-700", sub: "3-5 days" },
  { key: "stale", label: "Stale", color: "bg-orange-500", textColor: "text-orange-700", sub: "6-10 days" },
  { key: "critical", label: "Critical", color: "bg-red-500", textColor: "text-red-700", sub: "10+ days" },
];

function agingBucket(days) {
  const d = Number(days) || 0;
  if (d <= 2) return "fresh";
  if (d <= 5) return "aging";
  if (d <= 10) return "stale";
  return "critical";
}

function AgingDot({ days }) {
  const d = Number(days) || 0;
  const bucket = agingBucket(d);
  const dotColor =
    bucket === "fresh" ? "bg-green-500" :
    bucket === "aging" ? "bg-yellow-500" :
    bucket === "stale" ? "bg-orange-500" : "bg-red-500";

  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
      {bucket === "critical" && (
        <span className="text-xs font-medium text-red-600">{d}d</span>
      )}
    </span>
  );
}

function pillTone(value) {
  const v = String(value || "").toLowerCase();
  if (["paid", "fulfilled", "closed", "matched"].includes(v)) return "success";
  if (["failed", "cancelled", "voided", "mismatch"].includes(v)) return "danger";
  return "warning";
}

function exportCsv(rows) {
  if (!rows.length) return;
  const headers = [
    "id",
    "external_order_number",
    "customer_name",
    "order_status",
    "payment_status",
    "fulfillment_status",
    "shipping_total",
    "grand_total",
  ];
  const body = rows.map((r) =>
    [
      r.id,
      r.external_order_number || r.external_order_id || "",
      r.customer_name || "",
      r.order_status || "",
      r.payment_status || "",
      r.fulfillment_status || "",
      Number(r.shipping_total || 0),
      Number(r.grand_total || 0),
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[headers.join(","), ...body].join("\n")], {
    type: "text/csv",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `orders_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function OrdersRedesign() {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    order_status: "",
    payment_status: "",
    fulfillment_status: "",
  });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkForm, setBulkForm] = useState({
    order_status: "",
    payment_status: "",
    fulfillment_status: "",
  });
  const [busy, setBusy] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailTab, setDetailTab] = useState("items");
  const [page, setPage] = useState(1);
  const [agingSummary, setAgingSummary] = useState({ fresh: 0, aging: 0, stale: 0, critical: 0 });
  const [agingFilter, setAgingFilter] = useState(null);
  const [couriers, setCouriers] = useState([]);
  const [shipModalOrder, setShipModalOrder] = useState(null);

  const loadAgingSummary = async () => {
    try {
      const data = await api.get("/api/orders/aging-summary");
      setAgingSummary(data.buckets || { fresh: 0, aging: 0, stale: 0, critical: 0 });
    } catch {
      // non-critical, silently ignore
    }
  };

  const loadCouriers = async () => {
    try {
      const data = await api.get("/api/couriers");
      setCouriers((data.couriers || data || []).filter((c) => c.enabled));
    } catch {
      // non-critical, silently ignore
    }
  };

  const loadOrders = async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (filters.search) qs.set("search", filters.search);
      if (filters.order_status) qs.set("order_status", filters.order_status);
      if (filters.payment_status) qs.set("payment_status", filters.payment_status);
      if (filters.fulfillment_status) {
        qs.set("fulfillment_status", filters.fulfillment_status);
      }
      const data = await api.get(`/api/orders?${qs.toString()}`);
      setRows(data.orders || []);
      setSelectedIds(new Set());
      setPage(1);
    } catch (e) {
      setError(e.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id) => {
    setError("");
    try {
      const data = await api.get(`/api/orders/${id}`);
      setDetail(data);
      setSelectedOrder(data.order);
    } catch (e) {
      setError(e.message || "Failed to load order details");
    }
  };

  useEffect(() => {
    loadOrders();
    loadAgingSummary();
    loadCouriers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(loadOrders, filters.search ? 250 : 0);
    return () => clearTimeout(t);
  }, [
    filters.search,
    filters.order_status,
    filters.payment_status,
    filters.fulfillment_status,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!agingFilter) return rows;
    return rows.filter((r) => agingBucket(r.aging_days) === agingFilter);
  }, [rows, agingFilter]);

  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, filtered],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const toggleSelectRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectPage = () => {
    const allSelected = paged.length > 0 && paged.every((r) => selectedIds.has(r.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      paged.forEach((r) => {
        if (allSelected) next.delete(r.id);
        else next.add(r.id);
      });
      return next;
    });
  };

  const runBulkUpdate = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (
      !bulkForm.order_status &&
      !bulkForm.payment_status &&
      !bulkForm.fulfillment_status
    ) {
      alert("Choose at least one status value to apply.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.post("/api/orders/bulk-update", {
        ids,
        order_status: bulkForm.order_status || null,
        payment_status: bulkForm.payment_status || null,
        fulfillment_status: bulkForm.fulfillment_status || null,
      });
      setBulkForm({ order_status: "", payment_status: "", fulfillment_status: "" });
      toast.success(`${result.updated || ids.length} order(s) updated`);
      await loadOrders();
      if (selectedOrder?.id && ids.includes(selectedOrder.id)) {
        await loadDetail(selectedOrder.id);
      }
    } catch (e) {
      toast.error(e.message || "Bulk update failed");
    } finally {
      setBusy(false);
    }
  };

  const markComplete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.post("/api/orders/mark-complete", { ids });
      toast.success(`${result.updated || ids.length} order(s) marked complete`);
      await loadOrders();
      if (selectedOrder?.id && ids.includes(selectedOrder.id)) {
        await loadDetail(selectedOrder.id);
      }
    } catch (e) {
      toast.error(e.message || "Failed to mark complete");
    } finally {
      setBusy(false);
    }
  };

  const bookShipment = async ({ courier_id, weight }) => {
    if (!shipModalOrder) return;
    setBusy(true);
    try {
      await api.post(`/api/orders/${shipModalOrder.id}/shipments/book`, {
        courier_id: Number(courier_id),
        weight: weight ? Number(weight) : undefined,
      });
      toast.success("Shipment booked");
      setShipModalOrder(null);
      await loadOrders();
      if (selectedOrder?.id === shipModalOrder.id) {
        await loadDetail(shipModalOrder.id);
      }
    } catch (e) {
      toast.error(e.message || "Failed to book shipment");
    } finally {
      setBusy(false);
    }
  };

  const saveSelectedStatuses = async () => {
    if (!selectedOrder) return;
    setBusy(true);
    setError("");
    try {
      await api.put(`/api/orders/${selectedOrder.id}/status`, {
        order_status: selectedOrder.order_status,
        payment_status: selectedOrder.payment_status,
        fulfillment_status: selectedOrder.fulfillment_status,
      });
      toast.success("Order status updated");
      await loadOrders();
      await loadDetail(selectedOrder.id);
    } catch (e) {
      toast.error(e.message || "Failed to update status");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      title="Orders"
      subtitle="View and manage customer orders and fulfilment status."
      right={
        <div className="flex gap-2">
          <Button onClick={() => exportCsv(rows)}>
            <Download size={14} className="mr-1 inline" />
            Export CSV
          </Button>
          <Button onClick={loadOrders}>
            <RefreshCw size={14} className="mr-1 inline" />
            Refresh
          </Button>
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {AGING_BUCKETS.map((b) => (
          <button
            key={b.key}
            onClick={() => { setAgingFilter((prev) => (prev === b.key ? null : b.key)); setPage(1); }}
            className={`rounded-lg border p-3 text-left transition-all ${
              agingFilter === b.key
                ? "border-2 border-(--ui-primary) ring-2 ring-(--ui-primary)/20"
                : "border-(--ui-border)"
            } bg-(--ui-surface) hover:shadow-sm`}
          >
            <div className="flex items-center gap-2">
              <span className={`inline-block h-3 w-3 rounded-full ${b.color}`} />
              <span className="text-xs uppercase text-(--ui-text-muted)">{b.label}</span>
            </div>
            <p className={`mt-1 text-2xl font-semibold ${b.textColor}`}>{agingSummary[b.key]}</p>
            <p className="text-xs text-(--ui-text-muted)">{b.sub}</p>
          </button>
        ))}
      </div>

      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <SectionCard className="xl:col-span-8">
          <TableToolbar
            left={
              <>
                <div className="relative min-w-55">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)"
                  />
                  <Input
                    className="pl-8"
                    placeholder="Search order/customer"
                    value={filters.search}
                    onChange={(e) =>
                      setFilters((p) => ({ ...p, search: e.target.value }))
                    }
                  />
                </div>
                <Select
                  value={filters.order_status}
                  onChange={(e) =>
                    setFilters((p) => ({ ...p, order_status: e.target.value }))
                  }
                >
                  <option value="">All order statuses</option>
                  <option value="open">open</option>
                  <option value="closed">closed</option>
                  <option value="cancelled">cancelled</option>
                  <option value="on_hold">on_hold</option>
                </Select>
                <Select
                  value={filters.payment_status}
                  onChange={(e) =>
                    setFilters((p) => ({ ...p, payment_status: e.target.value }))
                  }
                >
                  <option value="">All payment statuses</option>
                  <option value="pending">pending</option>
                  <option value="authorized">authorized</option>
                  <option value="paid">paid</option>
                  <option value="failed">failed</option>
                </Select>
                <Select
                  value={filters.fulfillment_status}
                  onChange={(e) =>
                    setFilters((p) => ({
                      ...p,
                      fulfillment_status: e.target.value,
                    }))
                  }
                >
                  <option value="">All fulfillment statuses</option>
                  <option value="unfulfilled">unfulfilled</option>
                  <option value="partial">partial</option>
                  <option value="fulfilled">fulfilled</option>
                  <option value="restocked">restocked</option>
                </Select>
              </>
            }
            right={
              <span className="text-xs text-(--ui-text-muted)">
                {filtered.length} orders{agingFilter ? ` (${agingFilter})` : ""}
              </span>
            }
          />

          <div className="p-3">
            {selectedIds.size > 0 ? (
              <BulkActionBar>
                <span className="text-sm font-semibold text-emerald-800">
                  {selectedIds.size} selected
                </span>
                <Button size="sm" disabled={busy} onClick={markComplete}>
                  <CheckSquare size={13} className="mr-1 inline" />
                  Mark Complete
                </Button>
                <Select
                  value={bulkForm.order_status}
                  onChange={(e) =>
                    setBulkForm((p) => ({ ...p, order_status: e.target.value }))
                  }
                >
                  <option value="">Order status...</option>
                  <option value="open">open</option>
                  <option value="closed">closed</option>
                  <option value="cancelled">cancelled</option>
                  <option value="on_hold">on_hold</option>
                </Select>
                <Select
                  value={bulkForm.payment_status}
                  onChange={(e) =>
                    setBulkForm((p) => ({ ...p, payment_status: e.target.value }))
                  }
                >
                  <option value="">Payment status...</option>
                  <option value="pending">pending</option>
                  <option value="authorized">authorized</option>
                  <option value="paid">paid</option>
                  <option value="failed">failed</option>
                </Select>
                <Select
                  value={bulkForm.fulfillment_status}
                  onChange={(e) =>
                    setBulkForm((p) => ({
                      ...p,
                      fulfillment_status: e.target.value,
                    }))
                  }
                >
                  <option value="">Fulfillment status...</option>
                  <option value="unfulfilled">unfulfilled</option>
                  <option value="partial">partial</option>
                  <option value="fulfilled">fulfilled</option>
                  <option value="restocked">restocked</option>
                </Select>
                <Button size="sm" disabled={busy} onClick={runBulkUpdate}>
                  Apply Bulk Update
                </Button>
              </BulkActionBar>
            ) : null}
          </div>

          <div className="overflow-auto">
            <table className="min-w-full border-t border-(--ui-border) text-sm">
              <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                <tr>
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={paged.length > 0 && paged.every((r) => selectedIds.has(r.id))}
                      onChange={toggleSelectPage}
                    />
                  </th>
                  <th className="px-3 py-2 text-left">Order</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">Order Status</th>
                  <th className="px-3 py-2 text-left">Payment</th>
                  <th className="px-3 py-2 text-left">Fulfillment</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-center">Age</th>
                  <th className="px-3 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {!loading &&
                  paged.map((r) => (
                    <tr key={r.id} className="border-t border-(--ui-border)">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleSelectRow(r.id)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-(--ui-text)">
                          #{r.external_order_number || r.external_order_id || r.id}
                        </p>
                        <p className="text-xs text-(--ui-text-muted)">{r.source || "-"}</p>
                      </td>
                      <td className="px-3 py-2 text-(--ui-text)">
                        {r.customer_name || "Walk-in"}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={pillTone(r.order_status)}>{r.order_status || "-"}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={pillTone(r.payment_status)}>
                          {r.payment_status || "-"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={pillTone(r.fulfillment_status)}>
                          {r.fulfillment_status || "-"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-(--ui-text)">
                        {fmt(r.grand_total)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <AgingDot days={r.aging_days} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Button
                          size="sm"
                          onClick={() => loadDetail(r.id)}
                          className="inline-flex items-center"
                        >
                          <Eye size={13} className="mr-1" />
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {loading ? (
              <div className="p-8 text-center text-sm text-(--ui-text-muted)">
                Loading orders...
              </div>
            ) : null}
            {!loading && rows.length === 0 ? (
              <EmptyState title="No orders found" body="Adjust filters or refresh data." />
            ) : null}
          </div>
          <div className="flex items-center justify-between border-t border-(--ui-border) p-3">
            <span className="text-xs text-(--ui-text-muted)">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-4 p-3">
          {!selectedOrder || !detail ? (
            <EmptyState
              title="Select an order"
              body="Use the View action in the table to inspect and update status."
            />
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-(--ui-text)">
                  Order #{selectedOrder.external_order_number || selectedOrder.external_order_id}
                </h3>
                <p className="text-xs text-(--ui-text-muted)">
                  {selectedOrder.customer_name || "Walk-in"}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <Select
                  value={selectedOrder.order_status || ""}
                  onChange={(e) =>
                    setSelectedOrder((p) => ({ ...p, order_status: e.target.value }))
                  }
                >
                  <option value="open">open</option>
                  <option value="closed">closed</option>
                  <option value="cancelled">cancelled</option>
                  <option value="on_hold">on_hold</option>
                </Select>
                <Select
                  value={selectedOrder.payment_status || ""}
                  onChange={(e) =>
                    setSelectedOrder((p) => ({ ...p, payment_status: e.target.value }))
                  }
                >
                  <option value="pending">pending</option>
                  <option value="authorized">authorized</option>
                  <option value="paid">paid</option>
                  <option value="failed">failed</option>
                </Select>
                <Select
                  value={selectedOrder.fulfillment_status || ""}
                  onChange={(e) =>
                    setSelectedOrder((p) => ({
                      ...p,
                      fulfillment_status: e.target.value,
                    }))
                  }
                >
                  <option value="unfulfilled">unfulfilled</option>
                  <option value="partial">partial</option>
                  <option value="fulfilled">fulfilled</option>
                  <option value="restocked">restocked</option>
                </Select>
                <Button tone="primary" disabled={busy} onClick={saveSelectedStatuses}>
                  <Save size={14} className="mr-1 inline" />
                  Save Statuses
                </Button>
                <Button
                  disabled={busy || couriers.length === 0}
                  onClick={() => setShipModalOrder(selectedOrder)}
                  title={couriers.length === 0 ? "No couriers enabled. Configure in Courier Settings." : "Book shipment with a courier"}
                >
                  <Send size={14} className="mr-1 inline" />
                  Book Shipment
                </Button>
              </div>

              {/* Active tracking banner */}
              {selectedOrder.tracking_number && (
                <div className="rounded-lg border border-(--ui-border) bg-(--ui-surface-subtle) p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-(--ui-text-muted)">
                      <Truck size={12} />
                      <span>Tracking</span>
                    </div>
                    <Badge tone={pillTone(selectedOrder.shipping_provider_status)}>
                      {selectedOrder.shipping_provider_status || "shipped"}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-(--ui-text)">{selectedOrder.tracking_number}</p>
                  {selectedOrder.shipped_at && (
                    <p className="mt-0.5 text-(--ui-text-muted)">
                      Shipped {fmtUtcDateTime(selectedOrder.shipped_at)}
                    </p>
                  )}
                </div>
              )}

              {/* Detail tabs */}
              <div>
                <div className="mb-2 flex gap-1 border-b border-(--ui-border)">
                  {[
                    { id: "items", label: "Items", icon: Package },
                    { id: "transactions", label: "Transactions", icon: RefreshCw },
                    { id: "fulfillments", label: "Fulfillments", icon: Truck },
                  ].map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => setDetailTab(id)}
                      className={`flex items-center gap-1 border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
                        detailTab === id
                          ? "border-(--ui-primary) text-(--ui-primary)"
                          : "border-transparent text-(--ui-text-muted) hover:text-(--ui-text)"
                      }`}
                    >
                      <Icon size={11} />
                      {label}
                    </button>
                  ))}
                </div>

                <div className="max-h-52 overflow-auto space-y-1.5">
                  {detailTab === "items" && (
                    <>
                      {(detail.items || []).length === 0 && (
                        <p className="py-4 text-center text-xs text-(--ui-text-muted)">No items</p>
                      )}
                      {(detail.items || []).map((i) => (
                        <div key={i.id} className="rounded border border-(--ui-border) p-2 text-xs">
                          <p className="font-medium text-(--ui-text)">{i.title || i.sku || i.barcode || "Item"}</p>
                          <p className="text-(--ui-text-muted)">Qty {i.qty} | Unit {fmt(i.unit_price)}</p>
                        </div>
                      ))}
                    </>
                  )}

                  {detailTab === "transactions" && (
                    <>
                      {(detail.transactions || []).length === 0 && (
                        <p className="py-4 text-center text-xs text-(--ui-text-muted)">No transactions</p>
                      )}
                      {(detail.transactions || []).length > 0 && (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-(--ui-border) text-left text-(--ui-text-muted)">
                              <th className="pb-1 pr-2">Amount</th>
                              <th className="pb-1 pr-2">Method</th>
                              <th className="pb-1">Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(detail.transactions || []).map((t) => (
                              <tr key={t.id} className="border-b border-(--ui-border)">
                                <td className="py-1 pr-2 font-semibold text-(--ui-text)">
                                  {fmt(t.amount)}
                                </td>
                                <td className="py-1 pr-2 text-(--ui-text-muted)">{t.method || t.gateway || "-"}</td>
                                <td className="py-1 text-(--ui-text-muted)">{fmtUtcDateTime(t.created_at || t.timestamp)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  )}

                  {detailTab === "fulfillments" && (
                    <>
                      {(detail.fulfillments || []).length === 0 && (
                        <p className="py-4 text-center text-xs text-(--ui-text-muted)">No fulfillments</p>
                      )}
                      {(detail.fulfillments || []).map((f) => (
                        <div key={f.id} className="rounded border border-(--ui-border) p-2 text-xs space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-(--ui-text)">{f.tracking_number || "No tracking"}</span>
                            <Badge tone={pillTone(f.status)}>{f.status || "-"}</Badge>
                          </div>
                          <p className="text-(--ui-text-muted)">Carrier: {f.carrier || "-"}</p>
                          <p className="text-(--ui-text-muted)">Shipped: {f.shipped_at ? fmtUtcDateTime(f.shipped_at) : "-"}</p>
                          {(f.items || []).length > 0 && (
                            <p className="text-(--ui-text-muted)">
                              Items: {(f.items || []).map((i) => `${i.title || i.sku} ×${i.qty}`).join(", ")}
                            </p>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      <BookShipmentModal
        open={!!shipModalOrder}
        order={shipModalOrder}
        couriers={couriers}
        busy={busy}
        onClose={() => setShipModalOrder(null)}
        onSubmit={bookShipment}
        fmt={fmt}
      />
    </PageShell>
  );
}

function BookShipmentModal({ open, order, couriers, busy, onClose, onSubmit, fmt }) {
  const [courierId, setCourierId] = useState(couriers[0]?.id ? String(couriers[0].id) : "");
  const [weight, setWeight] = useState("0.5");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!courierId) {
      setError("Select a courier");
      return;
    }
    onSubmit({ courier_id: courierId, weight });
  };

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title={order ? `Book Shipment — Order #${order.external_order_number || order.id}` : "Book Shipment"}
      size="sm"
    >
      {order ? (
        <>
          <p className="mb-4 text-xs text-(--ui-text-muted)">
            Customer: {order.customer_name || "Walk-in"} · Total: {fmt(order.grand_total)}
          </p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-(--ui-text)">Courier</label>
              <Select value={courierId} onChange={(e) => setCourierId(e.target.value)}>
                <option value="">Select a courier</option>
                {couriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.supports_booking ? "" : " (manual)"}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-(--ui-text)">Weight (kg)</label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="0.5"
              />
              <p className="mt-1 text-xs text-(--ui-text-muted)">
                Used by the courier API to calculate shipping fees. Defaults to 0.5kg.
              </p>
            </div>
            {error && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {error}
              </p>
            )}
            <ModalFooter>
              <Button type="button" tone="plain" onClick={onClose}>Cancel</Button>
              <Button type="submit" tone="primary" disabled={busy}>
                {busy ? "Booking..." : "Book Shipment"}
              </Button>
            </ModalFooter>
          </form>
        </>
      ) : null}
    </Modal>
  );
}
