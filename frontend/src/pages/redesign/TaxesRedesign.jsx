import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";

const EMPTY = { id: null, name: "", rate: "", is_default: false };

export default function TaxesRedesign() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/taxes`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load taxes");
      setRows(data.taxes || []);
    } catch (e) {
      setError(e.message || "Failed to load taxes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const visibleRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => String(r.name || "").toLowerCase().includes(q));
  }, [rows, search]);

  const openCreate = () => {
    setForm(EMPTY);
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setForm({
      id: row.id,
      name: row.name || "",
      rate: String(row.rate ?? ""),
      is_default: Number(row.is_default || 0) === 1,
    });
    setModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const url = form.id ? `${API}/api/taxes/${form.id}` : `${API}/api/taxes`;
      const method = form.id ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          rate: Number(form.rate || 0),
          is_default: Boolean(form.is_default),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save tax");
      setModalOpen(false);
      setForm(EMPTY);
      await load();
    } catch (e2) {
      setError(e2.message || "Failed to save tax");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete tax \"${row.name}\"?`)) return;
    setError("");
    try {
      const res = await fetch(`${API}/api/taxes/${row.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete tax");
      await load();
    } catch (e) {
      setError(e.message || "Failed to delete tax");
    }
  };

  return (
    <PageShell
      title="Taxes"
      subtitle="Wave B redesign: tax profiles with default control and fast editing."
      right={
        <Button tone="primary" onClick={openCreate}>
          <Plus size={14} className="mr-1 inline" />
          Add Tax Rule
        </Button>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <SectionCard className="p-3"><p className="text-xs text-[var(--ui-text-muted)]">Total Rules</p><p className="text-2xl font-semibold text-[var(--ui-text)]">{rows.length}</p></SectionCard>
        <SectionCard className="p-3"><p className="text-xs text-[var(--ui-text-muted)]">Default Rules</p><p className="text-2xl font-semibold text-[var(--ui-text)]">{rows.filter((r) => Number(r.is_default || 0) === 1).length}</p></SectionCard>
        <SectionCard className="p-3"><p className="text-xs text-[var(--ui-text-muted)]">Visible</p><p className="text-2xl font-semibold text-[var(--ui-text)]">{visibleRows.length}</p></SectionCard>
      </div>

      <SectionCard>
        <TableToolbar
          left={
            <div className="relative min-w-[240px]">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--ui-text-muted)]" />
              <Input className="pl-8" placeholder="Search tax rules" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          }
          right={<span className="text-xs text-[var(--ui-text-muted)]">{visibleRows.length} rows</span>}
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-[var(--ui-border)] text-sm">
            <thead className="bg-[var(--ui-muted-surface)] text-xs uppercase text-[var(--ui-text-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-right">Rate %</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && visibleRows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--ui-border)]">
                  <td className="px-3 py-2 font-medium text-[var(--ui-text)]">{row.name}</td>
                  <td className="px-3 py-2 text-right text-[var(--ui-text)]">{Number(row.rate || 0).toFixed(2)}%</td>
                  <td className="px-3 py-2">
                    {Number(row.is_default || 0) === 1 ? <Badge tone="success">default</Badge> : <Badge>optional</Badge>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-2">
                      <Button size="sm" onClick={() => openEdit(row)}>Edit</Button>
                      <Button size="sm" tone="danger" onClick={() => remove(row)}><Trash2 size={12} className="mr-1 inline" />Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading ? <div className="p-8 text-center text-sm text-[var(--ui-text-muted)]">Loading taxes...</div> : null}
          {!loading && visibleRows.length === 0 ? <EmptyState title="No tax rules" body="Create a tax rule to apply on products." /> : null}
        </div>
      </SectionCard>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-md p-4">
            <h3 className="text-lg font-semibold text-[var(--ui-text)]">{form.id ? "Edit Tax Rule" : "Create Tax Rule"}</h3>
            <form className="mt-3 space-y-2" onSubmit={save}>
              <Input required placeholder="Tax name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              <Input required type="number" min="0" max="100" step="0.01" placeholder="Rate" value={form.rate} onChange={(e) => setForm((p) => ({ ...p, rate: e.target.value }))} />
              <label className="flex items-center gap-2 rounded border border-[var(--ui-border)] p-2 text-sm text-[var(--ui-text)]">
                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm((p) => ({ ...p, is_default: e.target.checked }))} />
                Set as default tax
              </label>
              <div className="flex gap-2 pt-2">
                <Button type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button tone="primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
              </div>
            </form>
          </SectionCard>
        </div>
      ) : null}
    </PageShell>
  );
}
