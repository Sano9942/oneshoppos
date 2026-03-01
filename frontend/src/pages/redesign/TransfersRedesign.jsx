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

function fmtDate(ts) {
  return new Date(ts).toLocaleString();
}

export default function TransfersRedesign() {
  const { employee } = useAuth();
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    product_id: "",
    from_outlet_id: "",
    to_outlet_id: "",
    quantity: "",
    note: "",
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [trRes, pRes, oRes] = await Promise.all([
        fetch(`${API}/api/transfers`),
        fetch(`${API}/api/products`),
        fetch(`${API}/api/outlets`),
      ]);
      const [trData, pData, oData] = await Promise.all([trRes.json(), pRes.json(), oRes.json()]);
      if (!trRes.ok) throw new Error(trData.error || "Failed to load transfers");
      setRows(trData.transfers || []);
      setProducts(pData.products || []);
      setOutlets(oData.outlets || []);
    } catch (e) {
      setError(e.message || "Failed to load transfers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const visibleRows = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      String(r.product_name || "").toLowerCase().includes(q) ||
      String(r.barcode || "").toLowerCase().includes(q) ||
      String(r.from_outlet_name || "").toLowerCase().includes(q) ||
      String(r.to_outlet_name || "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const openCreate = () => {
    setForm({
      product_id: "",
      from_outlet_id: "",
      to_outlet_id: "",
      quantity: "",
      note: "",
    });
    setModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (form.from_outlet_id === form.to_outlet_id) {
      setError("Source and destination outlets must be different.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: Number(form.product_id),
          from_outlet_id: Number(form.from_outlet_id),
          to_outlet_id: Number(form.to_outlet_id),
          quantity: Number(form.quantity),
          note: form.note || null,
          employee_id: employee?.id || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create transfer");
      setModalOpen(false);
      await load();
    } catch (e2) {
      setError(e2.message || "Failed to create transfer");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title="Transfers"
      subtitle="Wave B redesign: stock movement between outlets with full traceability."
      right={<Button tone="primary" onClick={openCreate}><Plus size={14} className="mr-1 inline" />New Transfer</Button>}
    >
      {error ? <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</SectionCard> : null}

      <SectionCard>
        <TableToolbar
          left={<div className="relative min-w-60"><Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" /><Input className="pl-8" placeholder="Search product, barcode, outlet" value={search} onChange={(e) => setSearch(e.target.value)} /></div>}
          right={<span className="text-xs text-(--ui-text-muted)">{visibleRows.length} transfers</span>}
        />

        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">From</th>
                <th className="px-3 py-2 text-left">To</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-left">Note</th>
                <th className="px-3 py-2 text-left">Employee</th>
              </tr>
            </thead>
            <tbody>
              {!loading && visibleRows.map((r) => (
                <tr key={r.id} className="border-t border-(--ui-border)">
                  <td className="px-3 py-2 text-(--ui-text-muted)">{fmtDate(r.timestamp)}</td>
                  <td className="px-3 py-2"><p className="font-medium text-(--ui-text)">{r.product_name}</p><p className="text-xs text-(--ui-text-muted)">{r.barcode || "-"}</p></td>
                  <td className="px-3 py-2 text-(--ui-text-muted)">{r.from_outlet_name}</td>
                  <td className="px-3 py-2 text-(--ui-text-muted)">{r.to_outlet_name}</td>
                  <td className="px-3 py-2 text-right"><Badge>{r.quantity}</Badge></td>
                  <td className="px-3 py-2 text-(--ui-text-muted)">{r.note || "-"}</td>
                  <td className="px-3 py-2 text-(--ui-text-muted)">{r.employee_name || "Admin"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading ? <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading transfers...</div> : null}
          {!loading && visibleRows.length === 0 ? <EmptyState title="No transfers" body="Create a transfer to move stock between outlets." /> : null}
        </div>
      </SectionCard>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-md p-4">
            <h3 className="text-lg font-semibold text-(--ui-text)">New Transfer</h3>
            <form className="mt-3 space-y-2" onSubmit={save}>
              <Select required value={form.product_id} onChange={(e) => setForm((p) => ({ ...p, product_id: e.target.value }))}>
                <option value="">Select product</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.barcode || p.sku || "-"})</option>)}
              </Select>
              <Select required value={form.from_outlet_id} onChange={(e) => setForm((p) => ({ ...p, from_outlet_id: e.target.value, to_outlet_id: p.to_outlet_id === e.target.value ? "" : p.to_outlet_id }))}>
                <option value="">From outlet</option>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
              <Select required value={form.to_outlet_id} onChange={(e) => setForm((p) => ({ ...p, to_outlet_id: e.target.value }))}>
                <option value="">To outlet</option>
                {outlets.filter((o) => String(o.id) !== String(form.from_outlet_id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
              <Input required type="number" min="1" placeholder="Quantity" value={form.quantity} onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))} />
              <Input placeholder="Note" value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} />
              <div className="flex gap-2 pt-2">
                <Button type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button tone="primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Create"}</Button>
              </div>
            </form>
          </SectionCard>
        </div>
      ) : null}
    </PageShell>
  );
}
