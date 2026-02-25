import { useEffect, useMemo, useState } from "react";
import { Eye, Filter, RefreshCw, Save, Search, Download, CheckSquare, Edit3 } from "lucide-react";

const API = "http://localhost:5000/api";

function statusPill(value) {
  const v = String(value || "").toLowerCase();
  if (["paid", "fulfilled", "closed", "matched"].includes(v)) return "bg-emerald-100 text-emerald-700";
  if (["pending", "unfulfilled", "open", "on_hold", "authorized"].includes(v))
    return "bg-amber-100 text-amber-700";
  if (["failed", "cancelled", "voided", "mismatch"].includes(v))
    return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-700";
}

export default function Orders() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState({
    search: "",
    order_status: "",
    payment_status: "",
    fulfillment_status: "",
  });
  const [typeTab, setTypeTab] = useState("all");
  const [statusTab, setStatusTab] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    order_status: "",
    payment_status: "",
    fulfillment_status: "",
  });

  const loadOrders = async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (filters.search) qs.set("search", filters.search);
      if (filters.order_status) qs.set("order_status", filters.order_status);
      if (filters.payment_status) qs.set("payment_status", filters.payment_status);
      if (filters.fulfillment_status) qs.set("fulfillment_status", filters.fulfillment_status);
      const res = await fetch(`${API}/orders?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load orders");
      setRows(data.orders || []);
      setSelectedIds([]);
    } catch (e) {
      setError(e.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id) => {
    setError("");
    try {
      const res = await fetch(`${API}/orders/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load order details");
      setDetail(data);
      setSelected(data.order);
    } catch (e) {
      setError(e.message || "Failed to load order details");
    }
  };

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const total = rows.length;
    const open = rows.filter((r) => r.order_status === "open").length;
    const paid = rows.filter((r) => r.payment_status === "paid").length;
    return { total, open, paid };
  }, [rows]);

  const visibleRows = useMemo(() => {
    let out = [...rows];
    if (typeTab === "pickup") {
      out = out.filter((r) => Number(r.shipping_total || 0) === 0);
    } else if (typeTab === "delivery") {
      out = out.filter((r) => Number(r.shipping_total || 0) > 0);
    } else if (typeTab === "express") {
      out = out.filter((r) => String(r.shipping_method || "").toLowerCase().includes("express"));
    } else if (typeTab === "future") {
      out = out.filter((r) => {
        if (!r.delivery_date) return false;
        return new Date(r.delivery_date) > new Date();
      });
    }

    if (statusTab !== "all") {
      out = out.filter((r) => {
        const st = String(r.order_status || "").toLowerCase();
        if (statusTab === "pending") return st === "open" || st === "pending" || st === "on_hold";
        if (statusTab === "returned") return st === "returned" || String(r.fulfillment_status || "").toLowerCase() === "restocked";
        return st === statusTab;
      });
    }
    return out;
  }, [rows, typeTab, statusTab]);

  const exportCsv = () => {
    if (!visibleRows.length) return;
    const headers = ["order", "customer", "email", "order_status", "payment_status", "fulfillment_status", "shipping_total", "grand_total"];
    const csvRows = visibleRows.map((r) => [
      r.external_order_number || r.external_order_id || r.id,
      r.customer_name || "",
      r.customer_email || "",
      r.order_status || "",
      r.payment_status || "",
      r.fulfillment_status || "",
      r.shipping_total || 0,
      r.grand_total || 0,
    ]);
    const content = [headers.join(","), ...csvRows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([content], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `orders_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const toggleRow = (id, checked) => {
    setSelectedIds((prev) =>
      checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id),
    );
  };

  const toggleAllVisible = (checked) => {
    if (!checked) return setSelectedIds([]);
    setSelectedIds(visibleRows.map((r) => r.id));
  };

  const handleMarkOrdersComplete = async () => {
    const ids = selectedIds.length ? selectedIds : visibleRows.map((r) => r.id);
    if (!ids.length) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API}/orders/mark-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to mark orders complete");
      await loadOrders();
      if (selected?.id && ids.includes(selected.id)) {
        await loadDetail(selected.id);
      }
    } catch (e) {
      setError(e.message || "Failed to mark orders complete");
    } finally {
      setSaving(false);
    }
  };

  const handleBulkUpdate = async (e) => {
    e.preventDefault();
    const ids = selectedIds.length ? selectedIds : visibleRows.map((r) => r.id);
    if (!ids.length) {
      setError("Select at least one order or keep visible rows to update.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API}/orders/bulk-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids,
          order_status: bulkForm.order_status || null,
          payment_status: bulkForm.payment_status || null,
          fulfillment_status: bulkForm.fulfillment_status || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk update failed");
      setIsBulkModalOpen(false);
      setBulkForm({ order_status: "", payment_status: "", fulfillment_status: "" });
      await loadOrders();
      if (selected?.id && ids.includes(selected.id)) {
        await loadDetail(selected.id);
      }
    } catch (e) {
      setError(e.message || "Bulk update failed");
    } finally {
      setSaving(false);
    }
  };

  const saveStatuses = async () => {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API}/orders/${selected.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_status: selected.order_status,
          payment_status: selected.payment_status,
          fulfillment_status: selected.fulfillment_status,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update statuses");
      await loadOrders();
      await loadDetail(selected.id);
    } catch (e) {
      setError(e.message || "Failed to update statuses");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Orders</h2>
          <p className="text-sm text-slate-500">Website order staging and lifecycle management.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleMarkOrdersComplete}
            disabled={saving || (!selectedIds.length && !visibleRows.length)}
            className="inline-flex items-center gap-2 bg-[#7B61FF]/20 text-[#6a50e5] px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            <CheckSquare size={14} /> Mark Orders Complete
          </button>
          <button
            onClick={() => setIsBulkModalOpen(true)}
            className="inline-flex items-center gap-2 bg-[#7B61FF] hover:bg-[#6a50e5] text-white px-4 py-2 rounded-lg text-sm font-semibold"
          >
            <Edit3 size={14} /> Bulk Update
          </button>
          <button onClick={exportCsv} className="inline-flex items-center gap-2 bg-[#7B61FF] hover:bg-[#6a50e5] text-white px-4 py-2 rounded-lg text-sm font-semibold">
            <Download size={14} /> Export CSV
          </button>
          <button
            onClick={loadOrders}
            className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-semibold"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex items-center gap-6 text-sm border-b border-slate-200 pb-2">
        {[
          ["all", "All Order Types"],
          ["pickup", "Pickup Orders"],
          ["delivery", "Delivery Orders"],
          ["express", "Express Shipping"],
          ["future", "Future Delivery"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTypeTab(id)}
            className={`pb-2 font-semibold ${typeTab === id ? "text-[#7B61FF] border-b-2 border-[#7B61FF]" : "text-slate-500 hover:text-slate-700"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 uppercase">Total Orders</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{totals.total}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 uppercase">Open</div>
          <div className="text-2xl font-bold text-amber-700 mt-1">{totals.open}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 uppercase">Paid</div>
          <div className="text-2xl font-bold text-emerald-700 mt-1">{totals.paid}</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={filters.search}
            onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
            placeholder="Search order number/customer"
            className="pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm w-64"
          />
        </div>
        <select
          value={filters.order_status}
          onChange={(e) => setFilters((p) => ({ ...p, order_status: e.target.value }))}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
        >
          <option value="">All Order Statuses</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="cancelled">Cancelled</option>
          <option value="on_hold">On Hold</option>
        </select>
        <select
          value={filters.payment_status}
          onChange={(e) => setFilters((p) => ({ ...p, payment_status: e.target.value }))}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
        >
          <option value="">All Payment Statuses</option>
          <option value="pending">Pending</option>
          <option value="authorized">Authorized</option>
          <option value="paid">Paid</option>
          <option value="partially_refunded">Partially Refunded</option>
          <option value="refunded">Refunded</option>
          <option value="voided">Voided</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={filters.fulfillment_status}
          onChange={(e) => setFilters((p) => ({ ...p, fulfillment_status: e.target.value }))}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
        >
          <option value="">All Fulfillment Statuses</option>
          <option value="unfulfilled">Unfulfilled</option>
          <option value="partial">Partial</option>
          <option value="fulfilled">Fulfilled</option>
          <option value="restocked">Restocked</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button
          onClick={loadOrders}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
        >
          <Filter size={14} />
          Apply
        </button>
      </div>

      <div className="flex items-center gap-6 text-sm -mt-2">
        {[
          ["all", "All Status"],
          ["closed", "Completed"],
          ["pending", "Pending"],
          ["returned", "Returned"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setStatusTab(id)}
            className={`pb-2 font-semibold ${statusTab === id ? "text-[#7B61FF] border-b-2 border-[#7B61FF]" : "text-slate-500 hover:text-slate-700"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-center p-3 w-10">
                  <input
                    type="checkbox"
                    checked={visibleRows.length > 0 && selectedIds.length === visibleRows.length}
                    onChange={(e) => toggleAllVisible(e.target.checked)}
                  />
                </th>
                <th className="text-left p-3">Order</th>
                <th className="text-left p-3">Customer</th>
                <th className="text-left p-3">Payment</th>
                <th className="text-left p-3">Fulfillment</th>
                <th className="text-right p-3">Total</th>
                <th className="text-center p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400">Loading orders...</td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400">No orders found.</td>
                </tr>
              ) : (
                visibleRows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(r.id)}
                        onChange={(e) => toggleRow(r.id, e.target.checked)}
                      />
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-slate-800">#{r.external_order_number || r.external_order_id}</div>
                      <div className="text-xs text-slate-500">{r.source}</div>
                    </td>
                    <td className="p-3 text-slate-700">{r.customer_name || "Walk-in"}</td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${statusPill(r.payment_status)}`}>
                        {r.payment_status}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${statusPill(r.fulfillment_status)}`}>
                        {r.fulfillment_status}
                      </span>
                    </td>
                    <td className="p-3 text-right font-semibold">{(r.grand_total || 0).toFixed(2)}</td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => loadDetail(r.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-slate-300 rounded hover:bg-slate-50"
                      >
                        <Eye size={12} />
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="col-span-5 bg-white border border-slate-200 rounded-xl p-4">
          {!selected || !detail ? (
            <div className="text-sm text-slate-500">Select an order to view details.</div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="font-bold text-slate-800">Order #{selected.external_order_number || selected.external_order_id}</h3>
                <p className="text-xs text-slate-500">{selected.source}</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <select
                  value={selected.order_status || ""}
                  onChange={(e) => setSelected((p) => ({ ...p, order_status: e.target.value }))}
                  className="px-2 py-2 border border-slate-200 rounded text-xs"
                >
                  <option value="open">open</option>
                  <option value="closed">closed</option>
                  <option value="cancelled">cancelled</option>
                  <option value="on_hold">on_hold</option>
                </select>
                <select
                  value={selected.payment_status || ""}
                  onChange={(e) => setSelected((p) => ({ ...p, payment_status: e.target.value }))}
                  className="px-2 py-2 border border-slate-200 rounded text-xs"
                >
                  <option value="pending">pending</option>
                  <option value="authorized">authorized</option>
                  <option value="paid">paid</option>
                  <option value="partially_refunded">partially_refunded</option>
                  <option value="refunded">refunded</option>
                  <option value="voided">voided</option>
                  <option value="failed">failed</option>
                </select>
                <select
                  value={selected.fulfillment_status || ""}
                  onChange={(e) => setSelected((p) => ({ ...p, fulfillment_status: e.target.value }))}
                  className="px-2 py-2 border border-slate-200 rounded text-xs"
                >
                  <option value="unfulfilled">unfulfilled</option>
                  <option value="partial">partial</option>
                  <option value="fulfilled">fulfilled</option>
                  <option value="restocked">restocked</option>
                  <option value="cancelled">cancelled</option>
                </select>
              </div>

              <button
                onClick={saveStatuses}
                disabled={saving}
                className="inline-flex items-center gap-2 px-3 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
              >
                <Save size={14} />
                {saving ? "Saving..." : "Save Statuses"}
              </button>

              <div>
                <h4 className="font-semibold text-sm mb-2">Items</h4>
                <div className="space-y-2 max-h-44 overflow-auto">
                  {(detail.items || []).map((i) => (
                    <div key={i.id} className="border border-slate-100 rounded p-2 text-xs">
                      <div className="font-medium text-slate-700">{i.title || i.sku || i.barcode || "Item"}</div>
                      <div className="text-slate-500">Qty: {i.qty} | Unit: {(i.unit_price || 0).toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-2">Transactions</h4>
                <div className="space-y-2 max-h-28 overflow-auto">
                  {(detail.transactions || []).length === 0 ? (
                    <div className="text-xs text-slate-400">No transactions yet.</div>
                  ) : (
                    detail.transactions.map((t) => (
                      <div key={t.id} className="text-xs border border-slate-100 rounded p-2">
                        {t.kind || "txn"} | {t.status || "-"} | {(t.amount || 0).toFixed(2)}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-2">Fulfillments</h4>
                <div className="space-y-2 max-h-28 overflow-auto">
                  {(detail.fulfillments || []).length === 0 ? (
                    <div className="text-xs text-slate-400">No fulfillments yet.</div>
                  ) : (
                    detail.fulfillments.map((f) => (
                      <div key={f.id} className="text-xs border border-slate-100 rounded p-2">
                        {f.status || "-"} | {f.carrier || "-"} | {f.tracking_number || "-"}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {isBulkModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-800">Bulk Update Orders</h3>
              <p className="text-xs text-slate-500 mt-1">
                Applying to {selectedIds.length ? `${selectedIds.length} selected` : `${visibleRows.length} visible`} orders.
              </p>
            </div>
            <form onSubmit={handleBulkUpdate} className="p-5 space-y-3">
              <select
                value={bulkForm.order_status}
                onChange={(e) => setBulkForm((p) => ({ ...p, order_status: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              >
                <option value="">Order Status (no change)</option>
                <option value="open">open</option>
                <option value="closed">closed</option>
                <option value="cancelled">cancelled</option>
                <option value="on_hold">on_hold</option>
                <option value="returned">returned</option>
              </select>
              <select
                value={bulkForm.payment_status}
                onChange={(e) => setBulkForm((p) => ({ ...p, payment_status: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              >
                <option value="">Payment Status (no change)</option>
                <option value="pending">pending</option>
                <option value="authorized">authorized</option>
                <option value="paid">paid</option>
                <option value="partially_refunded">partially_refunded</option>
                <option value="refunded">refunded</option>
                <option value="voided">voided</option>
                <option value="failed">failed</option>
              </select>
              <select
                value={bulkForm.fulfillment_status}
                onChange={(e) => setBulkForm((p) => ({ ...p, fulfillment_status: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              >
                <option value="">Fulfillment Status (no change)</option>
                <option value="unfulfilled">unfulfilled</option>
                <option value="partial">partial</option>
                <option value="fulfilled">fulfilled</option>
                <option value="restocked">restocked</option>
                <option value="cancelled">cancelled</option>
              </select>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsBulkModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-[#7B61FF] hover:bg-[#6a50e5] text-white rounded-lg text-sm font-semibold disabled:opacity-60"
                >
                  {saving ? "Updating..." : "Apply Updates"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
