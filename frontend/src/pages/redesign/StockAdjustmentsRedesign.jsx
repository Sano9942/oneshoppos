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

const REASONS = ["Damaged", "Expired", "Lost/Stolen", "Found", "Counting Error", "Other"];

function fmtDate(ts) {
  return new Date(ts).toLocaleString();
}

export default function StockAdjustmentsRedesign() {
  const { employee } = useAuth();
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    product_id: "",
    outlet_id: "",
    quantity_change: "",
    reason: "Damaged",
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [adjRes, prodRes, outRes] = await Promise.all([
        fetch(`${API}/api/adjustments`),
        fetch(`${API}/api/products`),
        fetch(`${API}/api/outlets`),
      ]);
      const [adjData, prodData, outData] = await Promise.all([
        adjRes.json(),
        prodRes.json(),
        outRes.json(),
      ]);
      if (!adjRes.ok) throw new Error(adjData.error || "Failed to load adjustments");
      setRows(Array.isArray(adjData) ? adjData : []);
      setProducts(prodData.products || []);
      const outList = outData.outlets || [];
      setOutlets(outList);
      if (!form.outlet_id && outList.length) {
        setForm((p) => ({ ...p, outlet_id: String(outList[0].id) }));
      }
    } catch (e) {
      setError(e.message || "Failed to load stock adjustments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleRows = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r) => {
      const matchText =
        !q ||
        String(r.product_name || "").toLowerCase().includes(q) ||
        String(r.barcode || "").toLowerCase().includes(q);
      const matchReason = !reasonFilter || String(r.reason || "") === reasonFilter;
      return matchText && matchReason;
    });
  }, [rows, search, reasonFilter]);

  const openCreate = () => {
    setForm({
      product_id: "",
      outlet_id: outlets[0] ? String(outlets[0].id) : "",
      quantity_change: "",
      reason: "Damaged",
    });
    setModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: Number(form.product_id),
          outlet_id: Number(form.outlet_id),
          employee_id: employee?.id || null,
          quantity_change: Number(form.quantity_change),
          reason: form.reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create adjustment");
      setModalOpen(false);
      await load();
    } catch (e2) {
      setError(e2.message || "Failed to create adjustment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title="Stock Adjustments"
      subtitle="Wave B redesign: auditable shrink/gain adjustments per outlet."
      right={
        <Button tone="primary" onClick={openCreate}>
          <Plus size={14} className="mr-1 inline" />
          New Adjustment
        </Button>
      }
    >
      {error ? <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</SectionCard> : null}

      <SectionCard>
        <TableToolbar
          left={
            <>
              <div className="relative min-w-[240px]">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--ui-text-muted)]" />
                <Input className="pl-8" placeholder="Search product or barcode" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)}>
                <option value="">All reasons</option>
                {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </>
          }
          right={<span className="text-xs text-[var(--ui-text-muted)]">{visibleRows.length} entries</span>}
        />

        <div className="overflow-auto">
          <table className="min-w-full border-t border-[var(--ui-border)] text-sm">
            <thead className="bg-[var(--ui-muted-surface)] text-xs uppercase text-[var(--ui-text-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">Outlet</th>
                <th className="px-3 py-2 text-left">Reason</th>
                <th className="px-3 py-2 text-right">Adjustment</th>
                <th className="px-3 py-2 text-left">Employee</th>
              </tr>
            </thead>
            <tbody>
              {!loading && visibleRows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--ui-border)]">
                  <td className="px-3 py-2 text-[var(--ui-text-muted)]">{fmtDate(r.timestamp)}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-[var(--ui-text)]">{r.product_name}</p>
                    <p className="text-xs text-[var(--ui-text-muted)]">{r.barcode || "-"}</p>
                  </td>
                  <td className="px-3 py-2 text-[var(--ui-text-muted)]">{r.outlet_name}</td>
                  <td className="px-3 py-2"><Badge>{r.reason}</Badge></td>
                  <td className={`px-3 py-2 text-right font-semibold ${Number(r.quantity_change || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {Number(r.quantity_change || 0) > 0 ? "+" : ""}{r.quantity_change}
                  </td>
                  <td className="px-3 py-2 text-[var(--ui-text-muted)]">{r.employee_name || "Admin"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading ? <div className="p-8 text-center text-sm text-[var(--ui-text-muted)]">Loading adjustments...</div> : null}
          {!loading && visibleRows.length === 0 ? <EmptyState title="No adjustments" body="Create an adjustment to update outlet stock." /> : null}
        </div>
      </SectionCard>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-md p-4">
            <h3 className="text-lg font-semibold text-[var(--ui-text)]">New Stock Adjustment</h3>
            <form className="mt-3 space-y-2" onSubmit={save}>
              <Select required value={form.product_id} onChange={(e) => setForm((p) => ({ ...p, product_id: e.target.value }))}>
                <option value="">Select product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.barcode || p.sku || "-"})</option>
                ))}
              </Select>
              <Select required value={form.outlet_id} onChange={(e) => setForm((p) => ({ ...p, outlet_id: e.target.value }))}>
                <option value="">Select outlet</option>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
              <Input required type="number" placeholder="Quantity change, e.g. -5 or 3" value={form.quantity_change} onChange={(e) => setForm((p) => ({ ...p, quantity_change: e.target.value }))} />
              <Select value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}>
                {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
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
