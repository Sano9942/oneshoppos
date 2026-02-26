import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Download, Eye, RefreshCw, Save, Search } from "lucide-react";
import { API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import {
  Badge,
  BulkActionBar,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  Select,
  TableToolbar,
} from "../../ui/primitives";

const PAGE_SIZE = 25;

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
  const { authHeaders } = useAuth();
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
  const [page, setPage] = useState(1);

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
      const res = await fetch(`${API}/orders?${qs.toString()}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load orders");
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
      const res = await fetch(`${API}/orders/${id}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load order details");
      setDetail(data);
      setSelectedOrder(data.order);
    } catch (e) {
      setError(e.message || "Failed to load order details");
    }
  };

  useEffect(() => {
    loadOrders();
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

  const totals = useMemo(() => {
    const total = rows.length;
    const open = rows.filter((r) => r.order_status === "open").length;
    const paid = rows.filter((r) => r.payment_status === "paid").length;
    return { total, open, paid };
  }, [rows]);

  const paged = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, rows],
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

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
      const res = await fetch(`${API}/orders/bulk-update`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          ids,
          order_status: bulkForm.order_status || null,
          payment_status: bulkForm.payment_status || null,
          fulfillment_status: bulkForm.fulfillment_status || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk update failed");
      setBulkForm({ order_status: "", payment_status: "", fulfillment_status: "" });
      await loadOrders();
      if (selectedOrder?.id && ids.includes(selectedOrder.id)) {
        await loadDetail(selectedOrder.id);
      }
    } catch (e) {
      setError(e.message || "Bulk update failed");
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
      const res = await fetch(`${API}/orders/mark-complete`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to mark complete");
      await loadOrders();
      if (selectedOrder?.id && ids.includes(selectedOrder.id)) {
        await loadDetail(selectedOrder.id);
      }
    } catch (e) {
      setError(e.message || "Failed to mark complete");
    } finally {
      setBusy(false);
    }
  };

  const saveSelectedStatuses = async () => {
    if (!selectedOrder) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/orders/${selectedOrder.id}/status`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          order_status: selectedOrder.order_status,
          payment_status: selectedOrder.payment_status,
          fulfillment_status: selectedOrder.fulfillment_status,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      await loadOrders();
      await loadDetail(selectedOrder.id);
    } catch (e) {
      setError(e.message || "Failed to update status");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      title="Orders"
      subtitle="Shopify-style order operations, filtering, and lifecycle controls."
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
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <SectionCard className="p-3">
          <p className="text-xs uppercase text-[var(--ui-text-muted)]">Total Orders</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--ui-text)]">{totals.total}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs uppercase text-[var(--ui-text-muted)]">Open</p>
          <p className="mt-1 text-2xl font-semibold text-amber-700">{totals.open}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs uppercase text-[var(--ui-text-muted)]">Paid</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">{totals.paid}</p>
        </SectionCard>
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
                <div className="relative min-w-[220px]">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--ui-text-muted)]"
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
              <span className="text-xs text-[var(--ui-text-muted)]">
                {rows.length} orders
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
            <table className="min-w-full border-t border-[var(--ui-border)] text-sm">
              <thead className="bg-[var(--ui-muted-surface)] text-xs uppercase text-[var(--ui-text-muted)]">
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
                  <th className="px-3 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {!loading &&
                  paged.map((r) => (
                    <tr key={r.id} className="border-t border-[var(--ui-border)]">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleSelectRow(r.id)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-[var(--ui-text)]">
                          #{r.external_order_number || r.external_order_id || r.id}
                        </p>
                        <p className="text-xs text-[var(--ui-text-muted)]">{r.source || "-"}</p>
                      </td>
                      <td className="px-3 py-2 text-[var(--ui-text)]">
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
                      <td className="px-3 py-2 text-right font-semibold text-[var(--ui-text)]">
                        PKRs {Number(r.grand_total || 0).toFixed(2)}
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
              <div className="p-8 text-center text-sm text-[var(--ui-text-muted)]">
                Loading orders...
              </div>
            ) : null}
            {!loading && rows.length === 0 ? (
              <EmptyState title="No orders found" body="Adjust filters or refresh data." />
            ) : null}
          </div>
          <div className="flex items-center justify-between border-t border-[var(--ui-border)] p-3">
            <span className="text-xs text-[var(--ui-text-muted)]">
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
                <h3 className="text-lg font-semibold text-[var(--ui-text)]">
                  Order #{selectedOrder.external_order_number || selectedOrder.external_order_id}
                </h3>
                <p className="text-xs text-[var(--ui-text-muted)]">
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
              </div>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-[var(--ui-text)]">Items</h4>
                <div className="max-h-44 space-y-2 overflow-auto">
                  {(detail.items || []).map((i) => (
                    <div
                      key={i.id}
                      className="rounded border border-[var(--ui-border)] p-2 text-xs"
                    >
                      <p className="font-medium text-[var(--ui-text)]">
                        {i.title || i.sku || i.barcode || "Item"}
                      </p>
                      <p className="text-[var(--ui-text-muted)]">
                        Qty {i.qty} | Unit PKRs {Number(i.unit_price || 0).toFixed(2)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </PageShell>
  );
}
