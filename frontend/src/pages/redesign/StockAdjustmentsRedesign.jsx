import { useEffect, useMemo, useState } from "react";
import { Download, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../../api";
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
import { readContext } from "../../auth/authStore";

import { fmtUtcDateTime } from "../../utils/dates";
import { downloadCsv } from "../../utils/csvExport";

const REASONS = ["Damaged", "Expired", "Lost/Stolen", "Found", "Counting Error", "Other"];

const fmtDate = fmtUtcDateTime;

export default function StockAdjustmentsRedesign() {
  const { employee, hasPerm } = useAuth();
  const isAdmin = hasPerm("all_access");
  const _ctx = readContext();
  const ctxOutletId = _ctx?.active_outlet_id && _ctx?.scope_mode !== "all_branches"
    ? String(_ctx.active_outlet_id)
    : null;
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
      const [adjData, prodData, outData] = await Promise.all([
        api.get("/api/adjustments"),
        api.get("/api/products"),
        api.get("/api/outlets"),
      ]);
      setRows(Array.isArray(adjData) ? adjData : []);
      setProducts(prodData.products || []);
      const outList = outData.outlets || [];
      setOutlets(outList);
      if (!form.outlet_id && outList.length) {
        const preferred = ctxOutletId && outList.find((o) => String(o.id) === ctxOutletId);
        setForm((p) => ({ ...p, outlet_id: preferred ? ctxOutletId : String(outList[0].id) }));
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
    const preferred = ctxOutletId && outlets.find((o) => String(o.id) === ctxOutletId);
    setForm({
      product_id: "",
      outlet_id: preferred ? ctxOutletId : outlets[0] ? String(outlets[0].id) : "",
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
      await api.post("/api/adjustments", {
        product_id: Number(form.product_id),
        outlet_id: Number(form.outlet_id),
        employee_id: employee?.id || null,
        quantity_change: Number(form.quantity_change),
        reason: form.reason,
      });
      setModalOpen(false);
      await load();
    } catch (e2) {
      setError(e2.message || "Failed to create adjustment");
    } finally {
      setSaving(false);
    }
  };

  const deleteAdj = async (row) => {
    if (!window.confirm(`Delete adjustment for "${row.product_name}" (${Number(row.quantity_change) > 0 ? "+" : ""}${row.quantity_change})? This will reverse the stock effect.`)) return;
    setError("");
    try {
      await api.del(`/api/adjustments/${row.id}`);
      await load();
    } catch (e) {
      setError(e.message || "Failed to delete adjustment");
    }
  };

  return (
    <PageShell
      title="Stock Adjustments"
      subtitle="auditable shrink/gain adjustments per outlet."
      right={
        <div className="flex gap-2">
          <Button onClick={() => downloadCsv(["date","product","outlet","reason","quantity","employee"], visibleRows.map(r => [r.created_at, r.product_name||"", r.outlet_name||"", r.reason||"", r.quantity||0, r.employee_name||""]), "stock_adjustments")}><Download size={14} className="mr-1 inline" />Export CSV</Button>
          <Button tone="primary" onClick={openCreate}>
            <Plus size={14} className="mr-1 inline" />
            New Adjustment
          </Button>
        </div>
      }
    >
      {error ? <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</SectionCard> : null}

      <SectionCard>
        <TableToolbar
          left={
            <>
              <div className="relative min-w-60">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" />
                <Input className="pl-8" placeholder="Search product or barcode" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)}>
                <option value="">All reasons</option>
                {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </>
          }
          right={<span className="text-xs text-(--ui-text-muted)">{visibleRows.length} entries</span>}
        />

        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">Outlet</th>
                <th className="px-3 py-2 text-left">Reason</th>
                <th className="px-3 py-2 text-right">Adjustment</th>
                <th className="px-3 py-2 text-left">Employee</th>
                {isAdmin ? <th className="px-3 py-2 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {!loading && visibleRows.map((r) => (
                <tr key={r.id} className="border-t border-(--ui-border)">
                  <td className="px-3 py-2 text-(--ui-text-muted)">{fmtDate(r.timestamp)}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-(--ui-text)">{r.product_name}</p>
                    <p className="text-xs text-(--ui-text-muted)">{r.barcode || "-"}</p>
                  </td>
                  <td className="px-3 py-2 text-(--ui-text-muted)">{r.outlet_name}</td>
                  <td className="px-3 py-2"><Badge>{r.reason}</Badge></td>
                  <td className={`px-3 py-2 text-right font-semibold ${Number(r.quantity_change || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {Number(r.quantity_change || 0) > 0 ? "+" : ""}{r.quantity_change}
                  </td>
                  <td className="px-3 py-2 text-(--ui-text-muted)">{r.employee_name || "Admin"}</td>
                  {isAdmin ? (
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" tone="danger" onClick={() => deleteAdj(r)}>
                        <Trash2 size={12} className="mr-1 inline" />Delete
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {loading ? <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading adjustments...</div> : null}
          {!loading && visibleRows.length === 0 ? <EmptyState title="No adjustments" body="Create an adjustment to update outlet stock." /> : null}
        </div>
      </SectionCard>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-md p-4">
            <h3 className="text-lg font-semibold text-(--ui-text)">New Stock Adjustment</h3>
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
