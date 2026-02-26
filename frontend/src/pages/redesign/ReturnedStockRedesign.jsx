import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { API_BASE as API } from "../../config";
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
import { useAuth } from "../../auth/AuthProvider";

function money(v) {
  return `$${Number(v || 0).toFixed(2)}`;
}

function fmtDate(ts) {
  return ts ? new Date(ts).toLocaleString() : "-";
}

export default function ReturnedStockRedesign() {
  const { employee } = useAuth();
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    supplier_id: "",
    outlet_id: "",
    reason: "",
    reference_number: "",
  });
  const [draftItems, setDraftItems] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [retRes, supRes, outRes, prodRes] = await Promise.all([
        fetch(`${API}/api/supplier-returns`),
        fetch(`${API}/api/suppliers`),
        fetch(`${API}/api/outlets`),
        fetch(`${API}/api/products`),
      ]);
      const [retData, supData, outData, prodData] = await Promise.all([
        retRes.json(),
        supRes.json(),
        outRes.json(),
        prodRes.json(),
      ]);
      if (!retRes.ok) throw new Error(retData.error || "Failed to load supplier returns");
      setRows(retData.returns || []);
      setSuppliers(supData.suppliers || []);
      const outList = outData.outlets || [];
      setOutlets(outList);
      setProducts((prodData.products || []).filter((p) => Number(p.has_variants || 0) === 0));
      if (!form.outlet_id && outList.length) {
        setForm((p) => ({ ...p, outlet_id: String(outList[0].id) }));
      }
    } catch (e) {
      setError(e.message || "Failed to load supplier returns");
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id) => {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`${API}/api/supplier-returns/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load return detail");
      setDetail(data);
    } catch (e) {
      setError(e.message || "Failed to load return detail");
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleRows = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      String(r.supplier_name || "").toLowerCase().includes(q) ||
      String(r.reference_number || "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const addItemToDraft = (productId) => {
    if (!productId) return;
    const p = products.find((x) => String(x.id) === String(productId));
    if (!p) return;
    setDraftItems((prev) => {
      const found = prev.find((x) => x.product_id === p.id);
      if (found) {
        return prev.map((x) =>
          x.product_id === p.id ? { ...x, quantity: x.quantity + 1 } : x,
        );
      }
      return [
        ...prev,
        {
          product_id: p.id,
          name: p.name,
          barcode: p.barcode,
          quantity: 1,
          unit_price: Number(p.cost_price || 0),
          reason: "",
        },
      ];
    });
  };

  const openCreate = () => {
    setForm({
      supplier_id: "",
      outlet_id: outlets[0] ? String(outlets[0].id) : "",
      reason: "",
      reference_number: "",
    });
    setDraftItems([]);
    setModalOpen(true);
  };

  const draftTotal = useMemo(
    () => draftItems.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unit_price || 0), 0),
    [draftItems],
  );

  const save = async (e) => {
    e.preventDefault();
    if (!form.supplier_id || !form.outlet_id || draftItems.length === 0) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/supplier-returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: Number(form.supplier_id),
          employee_id: employee?.id || null,
          outlet_id: Number(form.outlet_id),
          reason: form.reason || null,
          reference_number: form.reference_number || null,
          items: draftItems.map((i) => ({
            product_id: i.product_id,
            quantity: Number(i.quantity),
            unit_price: Number(i.unit_price),
            reason: i.reason || null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create supplier return");
      setModalOpen(false);
      await load();
    } catch (e2) {
      setError(e2.message || "Failed to create supplier return");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title="Returned Stock"
      subtitle="Wave B redesign: supplier return (RMA) workflow and stock-out tracking."
      right={<Button tone="primary" onClick={openCreate}><Plus size={14} className="mr-1 inline" />New Supplier Return</Button>}
    >
      {error ? <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</SectionCard> : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <SectionCard className="xl:col-span-8">
          <TableToolbar
            left={<div className="relative min-w-[240px]"><Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--ui-text-muted)]" /><Input className="pl-8" placeholder="Search supplier or reference" value={search} onChange={(e) => setSearch(e.target.value)} /></div>}
            right={<span className="text-xs text-[var(--ui-text-muted)]">{visibleRows.length} returns</span>}
          />
          <div className="overflow-auto">
            <table className="min-w-full border-t border-[var(--ui-border)] text-sm">
              <thead className="bg-[var(--ui-muted-surface)] text-xs uppercase text-[var(--ui-text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">RMA</th>
                  <th className="px-3 py-2 text-left">Supplier</th>
                  <th className="px-3 py-2 text-left">Outlet</th>
                  <th className="px-3 py-2 text-center">Items</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {!loading && visibleRows.map((r) => (
                  <tr key={r.id} className={`cursor-pointer border-t border-[var(--ui-border)] hover:bg-[var(--ui-muted-surface)] ${selectedId === r.id ? "bg-emerald-50" : ""}`} onClick={() => loadDetail(r.id)}>
                    <td className="px-3 py-2 font-medium text-[var(--ui-text)]">#{r.id} {r.reference_number ? `(${r.reference_number})` : ""}</td>
                    <td className="px-3 py-2 text-[var(--ui-text-muted)]">{r.supplier_name || "-"}</td>
                    <td className="px-3 py-2 text-[var(--ui-text-muted)]">{r.outlet_name || "-"}</td>
                    <td className="px-3 py-2 text-center text-[var(--ui-text)]">{r.item_count || 0}</td>
                    <td className="px-3 py-2 text-right font-semibold text-[var(--ui-text)]">{money(r.total_value)}</td>
                    <td className="px-3 py-2 text-[var(--ui-text-muted)]">{fmtDate(r.return_date)}</td>
                    <td className="px-3 py-2"><Badge tone="success">{r.status || "completed"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading ? <div className="p-8 text-center text-sm text-[var(--ui-text-muted)]">Loading supplier returns...</div> : null}
            {!loading && visibleRows.length === 0 ? <EmptyState title="No supplier returns" body="Create an RMA to send stock back to a supplier." /> : null}
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-4 p-3">
          {!selectedId ? (
            <EmptyState title="Select an RMA" body="Click a row to inspect returned items." />
          ) : detailLoading ? (
            <div className="p-8 text-center text-sm text-[var(--ui-text-muted)]">Loading details...</div>
          ) : !detail ? (
            <EmptyState title="Details unavailable" body="Try selecting the RMA again." />
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-[var(--ui-text)]">RMA #{detail.returnData.id}</h3>
                <p className="text-xs text-[var(--ui-text-muted)]">{detail.returnData.supplier_name || "Unknown supplier"}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SectionCard className="p-2 text-center"><p className="text-xs text-[var(--ui-text-muted)]">Items</p><p className="font-semibold text-[var(--ui-text)]">{(detail.items || []).length}</p></SectionCard>
                <SectionCard className="p-2 text-center"><p className="text-xs text-[var(--ui-text-muted)]">Total</p><p className="font-semibold text-[var(--ui-text)]">{money(detail.returnData.total_value)}</p></SectionCard>
              </div>
              <div className="max-h-64 space-y-2 overflow-auto">
                {(detail.items || []).map((item) => (
                  <div key={item.id} className="rounded border border-[var(--ui-border)] p-2 text-xs">
                    <p className="font-medium text-[var(--ui-text)]">{item.product_name}</p>
                    <p className="text-[var(--ui-text-muted)]">Qty {item.quantity} | Unit {money(item.unit_price)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="max-h-[90vh] w-full max-w-4xl overflow-auto p-4">
            <h3 className="text-lg font-semibold text-[var(--ui-text)]">New Supplier Return</h3>
            <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-12">
              <div className="xl:col-span-7">
                <SectionCard className="p-3">
                  <p className="mb-2 text-sm font-semibold text-[var(--ui-text)]">Items</p>
                  <Select onChange={(e) => { addItemToDraft(e.target.value); e.target.value = ""; }}>
                    <option value="">Add product...</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.barcode || p.sku || "-"})</option>)}
                  </Select>
                  <div className="mt-2 max-h-72 overflow-auto">
                    {draftItems.length === 0 ? (
                      <p className="text-xs text-[var(--ui-text-muted)]">No items added.</p>
                    ) : (
                      draftItems.map((item, idx) => (
                        <div key={`${item.product_id}-${idx}`} className="mt-2 rounded border border-[var(--ui-border)] p-2">
                          <p className="text-sm font-medium text-[var(--ui-text)]">{item.name}</p>
                          <div className="mt-1 grid grid-cols-3 gap-2">
                            <Input type="number" min="1" value={item.quantity} onChange={(e) => setDraftItems((prev) => prev.map((x, i) => i === idx ? { ...x, quantity: Number(e.target.value || 1) } : x))} />
                            <Input type="number" min="0" step="0.01" value={item.unit_price} onChange={(e) => setDraftItems((prev) => prev.map((x, i) => i === idx ? { ...x, unit_price: Number(e.target.value || 0) } : x))} />
                            <Button tone="danger" onClick={() => setDraftItems((prev) => prev.filter((_, i) => i !== idx))}>Remove</Button>
                          </div>
                          <Input className="mt-2" placeholder="Item reason (optional)" value={item.reason || ""} onChange={(e) => setDraftItems((prev) => prev.map((x, i) => i === idx ? { ...x, reason: e.target.value } : x))} />
                        </div>
                      ))
                    )}
                  </div>
                </SectionCard>
              </div>

              <form className="xl:col-span-5" onSubmit={save}>
                <SectionCard className="p-3">
                  <p className="mb-2 text-sm font-semibold text-[var(--ui-text)]">Return Details</p>
                  <div className="space-y-2">
                    <Select required value={form.outlet_id} onChange={(e) => setForm((p) => ({ ...p, outlet_id: e.target.value }))}>
                      <option value="">Select outlet</option>
                      {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </Select>
                    <Select required value={form.supplier_id} onChange={(e) => setForm((p) => ({ ...p, supplier_id: e.target.value }))}>
                      <option value="">Select supplier</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                    <Input placeholder="Reference number" value={form.reference_number} onChange={(e) => setForm((p) => ({ ...p, reference_number: e.target.value }))} />
                    <Input placeholder="General reason" value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))} />
                  </div>
                  <div className="mt-3 rounded border border-[var(--ui-border)] p-2 text-sm">
                    <p className="text-[var(--ui-text-muted)]">Total Value</p>
                    <p className="text-lg font-semibold text-[var(--ui-text)]">{money(draftTotal)}</p>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
                    <Button tone="primary" type="submit" disabled={saving || !form.supplier_id || !form.outlet_id || draftItems.length === 0}>{saving ? "Saving..." : "Complete Return"}</Button>
                  </div>
                </SectionCard>
              </form>
            </div>
          </SectionCard>
        </div>
      ) : null}
    </PageShell>
  );
}
