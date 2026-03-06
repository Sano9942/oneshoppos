import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Download,
  PackageCheck,
  Plus,
  Search,
  Send,
  X,
} from "lucide-react";
import { API_BASE as API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
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

function money(value) {
  return `PKRs ${Number(value || 0).toFixed(2)}`;
}

function statusTone(status) {
  if (status === "Received") return "success";
  if (status === "Approved") return "warning";
  if (status === "pending_approval") return "warning";
  return "default";
}

function poNumber(id) {
  return `PO-${String(id || "").padStart(4, "0")}`;
}

function exportCSV(rows) {
  if (!rows.length) return;
  const headers = ["id", "supplier_name", "total_cost", "status", "due_date", "created_at"];
  const body = rows.map((r) =>
    [r.id, r.supplier_name, Number(r.total_cost || 0), r.status, r.due_date || "", r.created_at]
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[headers.join(","), ...body].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `purchase_orders_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function PurchaseOrdersRedesign() {
  const { authHeaders, employee } = useAuth();
  const [view, setView] = useState("list");
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warn, setWarn] = useState("");
  const [search, setSearch] = useState("");

  const [selectedPo, setSelectedPo] = useState(null); // { purchaseOrder, items }
  const [submittingApproval, setSubmittingApproval] = useState(false);

  const [form, setForm] = useState({ supplier_id: "", due_date: "" });
  const [productSearch, setProductSearch] = useState("");
  const [cart, setCart] = useState([]);

  const [grnOpen, setGrnOpen] = useState(false);
  const [grnOutletId, setGrnOutletId] = useState("");
  const [grnReceivedBy, setGrnReceivedBy] = useState("");
  const [grnNotes, setGrnNotes] = useState("");
  const [grnQtys, setGrnQtys] = useState({});

  const loadRows = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/purchase-orders`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load purchase orders");
      setRows(data.purchaseOrders || []);
    } catch (e) {
      setError(e.message || "Failed to load purchase orders");
    } finally {
      setLoading(false);
    }
  };

  const loadDropdowns = async () => {
    try {
      const [supRes, prRes, outRes, empRes] = await Promise.all([
        fetch(`${API}/api/suppliers`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/products`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/outlets`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/employees`, { headers: authHeaders() }).then((r) => r.json()),
      ]);
      setSuppliers(supRes.suppliers || []);
      setProducts(prRes.products || []);
      setOutlets(outRes.outlets || []);
      setEmployees(empRes.employees || []);
    } catch {
      // Keep existing behavior: dropdown fetch failures are non-fatal for list.
    }
  };

  const loadDetail = async (id) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/purchase-orders/${id}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load purchase order details");
      setSelectedPo(data);
      setView("view");
    } catch (e) {
      setError(e.message || "Failed to load purchase order details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
    loadDropdowns();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        String(r.id || "").includes(q) ||
        String(r.supplier_name || "").toLowerCase().includes(q) ||
        String(r.status || "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.cost_price || 0), 0),
    [cart],
  );

  const searchResults = useMemo(() => {
    if (productSearch.trim().length < 2) return [];
    const q = productSearch.toLowerCase();
    return products
      .filter(
        (p) =>
          String(p.name || "").toLowerCase().includes(q) ||
          String(p.barcode || "").toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [productSearch, products]);

  const openCreate = () => {
    setNotice("");
    setError("");
    setForm({ supplier_id: "", due_date: "" });
    setProductSearch("");
    setCart([]);
    setView("create");
  };

  const addToCart = (product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product_id === product.id ? { ...i, quantity: Number(i.quantity || 0) + 1 } : i,
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          name: product.name,
          barcode: product.barcode,
          quantity: 1,
          cost_price: Number(product.cost_price || 0),
        },
      ];
    });
  };

  const updateCart = (productId, field, value) => {
    setCart((prev) =>
      prev.map((i) =>
        i.product_id === productId
          ? {
              ...i,
              [field]: field === "cost_price" ? Number(value || 0) : Math.max(1, Number(value || 1)),
            }
          : i,
      ),
    );
  };

  const removeCartItem = (productId) => {
    setCart((prev) => prev.filter((i) => i.product_id !== productId));
  };

  const createPO = async () => {
    setError("");
    setNotice("");
    setWarn("");
    if (!form.supplier_id) {
      setError("Select a supplier first.");
      return;
    }
    if (!cart.length) {
      setError("Add at least one item to the purchase order.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        supplier_id: Number(form.supplier_id),
        total_cost: cartTotal,
        due_date: form.due_date || null,
        items: cart.map((i) => ({
          product_id: i.product_id,
          quantity: Number(i.quantity || 0),
          cost_price: Number(i.cost_price || 0),
        })),
      };
      const res = await fetch(`${API}/api/purchase-orders`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create purchase order");
      await loadRows();
      if (data.warning) {
        setWarn(`PO ${poNumber(data.id)} created. Warning: ${data.warning}`);
      } else {
        setNotice(`Purchase order ${poNumber(data.id)} created.`);
      }
      setView("list");
    } catch (e) {
      setError(e.message || "Failed to create purchase order");
    } finally {
      setSaving(false);
    }
  };

  const submitForApproval = async (poId) => {
    setSubmittingApproval(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`${API}/api/purchase-orders/${poId}/submit`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          requested_by: employee?.name || employee?.username || `Employee #${employee?.id || ""}`,
          notes: "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit purchase order");
      setNotice(data.message || "PO submitted for approval.");
      await loadRows();
      await loadDetail(poId);
    } catch (e) {
      setError(e.message || "Failed to submit purchase order");
    } finally {
      setSubmittingApproval(false);
    }
  };

  const openGrnModal = () => {
    if (!selectedPo?.purchaseOrder || !selectedPo?.items?.length) return;
    const initial = {};
    selectedPo.items.forEach((item) => {
      initial[item.product_id] = Number(item.quantity || 0);
    });
    setGrnQtys(initial);
    setGrnOutletId(String(outlets[0]?.id || ""));
    setGrnReceivedBy("");
    setGrnNotes("");
    setGrnOpen(true);
  };

  const receivePO = async () => {
    if (!selectedPo?.purchaseOrder) return;
    if (!grnOutletId) {
      setError("Select an outlet before receiving.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        outlet_id: Number(grnOutletId),
        received_by: grnReceivedBy ? Number(grnReceivedBy) : null,
        notes: grnNotes || null,
        items: (selectedPo.items || []).map((item) => ({
          product_id: item.product_id,
          qty_received: Number(grnQtys[item.product_id] ?? item.quantity ?? 0),
        })),
      };
      const res = await fetch(`${API}/api/purchase-orders/${selectedPo.purchaseOrder.id}/receive`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to receive purchase order");
      setGrnOpen(false);
      setNotice(`${data.message} (${data.grn_number})`);
      await loadRows();
      await loadDetail(selectedPo.purchaseOrder.id);
    } catch (e) {
      setError(e.message || "Failed to receive purchase order");
    } finally {
      setSaving(false);
    }
  };

  if (view === "create") {
    return (
      <PageShell
        title="Create Purchase Order"
        subtitle="Build a draft PO by selecting a supplier and adding line items."
        right={
          <Button onClick={() => setView("list")}>
            <ArrowLeft size={14} className="mr-1 inline" />
            Back to List
          </Button>
        }
      >
        {error ? (
          <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </SectionCard>
        ) : null}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
          <SectionCard>
            <TableToolbar
              left={
                <div className="relative min-w-70">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)"
                  />
                  <Input
                    className="pl-8"
                    placeholder="Search products by name or barcode"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                </div>
              }
              right={
                <span className="text-xs text-(--ui-text-muted)">
                  {searchResults.length} results
                </span>
              }
            />
            <div className="max-h-[58vh] overflow-auto p-3">
              {searchResults.length ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      className="rounded border border-(--ui-border) p-3 text-left hover:bg-(--ui-muted-surface)"
                      onClick={() => addToCart(p)}
                    >
                      <p className="font-medium text-(--ui-text)">{p.name}</p>
                      <p className="mt-0.5 text-xs text-(--ui-text-muted)">{p.barcode || "-"}</p>
                      <p className="mt-1 text-xs font-semibold text-(--ui-text)">
                        Cost: {money(p.cost_price)}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Search products"
                  body="Type at least 2 characters to find products for this purchase order."
                />
              )}
            </div>
          </SectionCard>

          <SectionCard className="p-3">
            <h3 className="text-base font-semibold text-(--ui-text)">PO Draft</h3>
            <div className="mt-3 space-y-2">
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Supplier</label>
                <Select
                  value={form.supplier_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, supplier_id: e.target.value }))}
                >
                  <option value="">Select supplier</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Due Date</label>
                <Input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, due_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-3 max-h-[38vh] space-y-2 overflow-auto">
              {cart.map((item) => (
                <div key={item.product_id} className="rounded border border-(--ui-border) p-2">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-(--ui-text)">{item.name}</p>
                      <p className="text-xs text-(--ui-text-muted)">{item.barcode || "-"}</p>
                    </div>
                    <button
                      className="text-(--ui-text-muted) hover:text-rose-600"
                      onClick={() => removeCartItem(item.product_id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateCart(item.product_id, "quantity", e.target.value)}
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.cost_price}
                      onChange={(e) => updateCart(item.product_id, "cost_price", e.target.value)}
                    />
                  </div>
                </div>
              ))}
              {!cart.length ? (
                <p className="py-6 text-center text-sm text-(--ui-text-muted)">Cart is empty.</p>
              ) : null}
            </div>

            <div className="mt-3 border-t border-(--ui-border) pt-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-(--ui-text-muted)">Draft Total</span>
                <span className="font-semibold text-(--ui-text)">{money(cartTotal)}</span>
              </div>
              <Button tone="primary" className="w-full" onClick={createPO} disabled={saving}>
                {saving ? "Submitting..." : "Submit Purchase Order"}
              </Button>
            </div>
          </SectionCard>
        </div>
      </PageShell>
    );
  }

  if (view === "view" && selectedPo?.purchaseOrder) {
    const po = selectedPo.purchaseOrder;
    const items = selectedPo.items || [];
    return (
      <PageShell
        title={poNumber(po.id)}
        subtitle={`Supplier: ${po.supplier_name} | Created: ${new Date(po.created_at).toLocaleString()}`}
        right={
          <Button onClick={() => setView("list")}>
            <ArrowLeft size={14} className="mr-1 inline" />
            Back to List
          </Button>
        }
      >
        {error ? (
          <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </SectionCard>
        ) : null}
        {notice ? (
          <SectionCard className="mb-3 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {notice}
          </SectionCard>
        ) : null}

        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-4">
          <SectionCard className="p-3">
            <p className="text-xs text-(--ui-text-muted)">Status</p>
            <div className="mt-1">
              <Badge tone={statusTone(po.status)}>{po.status}</Badge>
            </div>
          </SectionCard>
          <SectionCard className="p-3">
            <p className="text-xs text-(--ui-text-muted)">Supplier</p>
            <p className="mt-1 text-sm font-medium text-(--ui-text)">{po.supplier_name}</p>
          </SectionCard>
          <SectionCard className="p-3">
            <p className="text-xs text-(--ui-text-muted)">Due Date</p>
            <p className="mt-1 text-sm font-medium text-(--ui-text)">{po.due_date || "-"}</p>
          </SectionCard>
          <SectionCard className="p-3">
            <p className="text-xs text-(--ui-text-muted)">Total Cost</p>
            <p className="mt-1 text-sm font-semibold text-(--ui-text)">{money(po.total_cost)}</p>
          </SectionCard>
        </div>

        <SectionCard>
          <TableToolbar
            left={<span className="text-sm font-medium text-(--ui-text)">Line Items</span>}
            right={
              <div className="flex items-center gap-2">
                {po.status === "Draft" ? (
                  <Button
                    tone="primary"
                    onClick={() => submitForApproval(po.id)}
                    disabled={submittingApproval}
                  >
                    <Send size={13} className="mr-1 inline" />
                    {submittingApproval ? "Submitting..." : "Submit for Approval"}
                  </Button>
                ) : null}
                {po.status === "Approved" ? (
                  <Button tone="primary" onClick={openGrnModal}>
                    <PackageCheck size={13} className="mr-1 inline" />
                    Receive Items
                  </Button>
                ) : null}
              </div>
            }
          />
          <div className="overflow-auto">
            <table className="min-w-full border-t border-(--ui-border) text-sm">
              <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-left">Barcode</th>
                  <th className="px-3 py-2 text-right">Unit Cost</th>
                  <th className="px-3 py-2 text-right">Qty Ordered</th>
                  <th className="px-3 py-2 text-right">Row Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-(--ui-border)">
                    <td className="px-3 py-2 text-(--ui-text)">{item.name}</td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">{item.barcode || "-"}</td>
                    <td className="px-3 py-2 text-right text-(--ui-text)">{money(item.cost_price)}</td>
                    <td className="px-3 py-2 text-right text-(--ui-text)">{item.quantity}</td>
                    <td className="px-3 py-2 text-right font-medium text-(--ui-text)">
                      {money(Number(item.quantity || 0) * Number(item.cost_price || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {grnOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
            <SectionCard className="w-full max-w-2xl p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-(--ui-text)">Receive PO (Create GRN)</h3>
                <button className="text-(--ui-text-muted) hover:text-(--ui-text)" onClick={() => setGrnOpen(false)}>
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Receiving Outlet</label>
                  <Select value={grnOutletId} onChange={(e) => setGrnOutletId(e.target.value)}>
                    <option value="">Select outlet</option>
                    {outlets.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Received By</label>
                  <Select value={grnReceivedBy} onChange={(e) => setGrnReceivedBy(e.target.value)}>
                    <option value="">Select employee</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="mt-2">
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Notes</label>
                <Input value={grnNotes} onChange={(e) => setGrnNotes(e.target.value)} placeholder="Optional receiving notes" />
              </div>
              <div className="mt-3 max-h-[35vh] space-y-2 overflow-auto border-t border-(--ui-border) pt-3">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-[1fr_140px] items-center gap-2 rounded border border-(--ui-border) p-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-(--ui-text)">{item.name}</p>
                      <p className="text-xs text-(--ui-text-muted)">
                        Ordered: {item.quantity} | {item.barcode || "-"}
                      </p>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      max={item.quantity}
                      value={grnQtys[item.product_id] ?? item.quantity}
                      onChange={(e) =>
                        setGrnQtys((prev) => ({
                          ...prev,
                          [item.product_id]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button onClick={() => setGrnOpen(false)}>Cancel</Button>
                <Button tone="primary" onClick={receivePO} disabled={saving}>
                  <CheckCircle2 size={13} className="mr-1 inline" />
                  {saving ? "Processing..." : "Confirm & Create GRN"}
                </Button>
              </div>
            </SectionCard>
          </div>
        ) : null}
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Purchase Orders"
      subtitle="manage supplier ordering lifecycle from draft to GRN."
      right={
        <div className="flex items-center gap-2">
          <Button onClick={() => exportCSV(visibleRows)}>
            <Download size={13} className="mr-1 inline" />
            Export
          </Button>
          <Button tone="primary" onClick={openCreate}>
            <Plus size={13} className="mr-1 inline" />
            Create PO
          </Button>
        </div>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}
      {notice ? (
        <SectionCard className="mb-3 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </SectionCard>
      ) : null}
      {warn && <SectionCard className="mb-3 border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">{warn}</SectionCard>}

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Total POs</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{rows.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Pending Approval</p>
          <p className="text-2xl font-semibold text-(--ui-text)">
            {rows.filter((r) => r.status === "pending_approval").length}
          </p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Received</p>
          <p className="text-2xl font-semibold text-(--ui-text)">
            {rows.filter((r) => r.status === "Received").length}
          </p>
        </SectionCard>
      </div>

      <SectionCard>
        <TableToolbar
          left={
            <div className="relative min-w-65">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)"
              />
              <Input
                className="pl-8"
                placeholder="Search by PO, supplier, or status"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
          right={<span className="text-xs text-(--ui-text-muted)">{visibleRows.length} rows</span>}
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left">PO</th>
                <th className="px-3 py-2 text-left">Supplier</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                visibleRows.map((po) => (
                  <tr key={po.id} className="border-t border-(--ui-border)">
                    <td className="px-3 py-2 font-medium text-(--ui-text)">{poNumber(po.id)}</td>
                    <td className="px-3 py-2 text-(--ui-text)">{po.supplier_name}</td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {new Date(po.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={statusTone(po.status)}>{po.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right text-(--ui-text)">{money(po.total_cost)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" onClick={() => loadDetail(po.id)}>
                        View
                        <ChevronRight size={12} className="ml-1 inline" />
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {loading ? (
            <div className="p-8 text-center text-sm text-(--ui-text-muted)">
              Loading purchase orders...
            </div>
          ) : null}
          {!loading && visibleRows.length === 0 ? (
            <EmptyState title="No purchase orders" body="Create a PO to start procurement workflow." />
          ) : null}
        </div>
      </SectionCard>
    </PageShell>
  );
}
