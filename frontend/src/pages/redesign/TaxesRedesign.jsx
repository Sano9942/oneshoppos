import { useEffect, useMemo, useState } from "react";
import { Download, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../../api";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  ModalFooter,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";
import { downloadCsv } from "../../utils/csvExport";

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
      const data = await api.get("/api/taxes");
      setRows(data.taxes || []);
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to load taxes");
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
      const payload = {
        name: form.name,
        rate: Number(form.rate || 0),
        is_default: Boolean(form.is_default),
      };
      if (form.id) {
        await api.put(`/api/taxes/${form.id}`, payload);
      } else {
        await api.post("/api/taxes", payload);
      }
      setModalOpen(false);
      setForm(EMPTY);
      await load();
    } catch (e2) {
      setError(e2.body?.error || e2.message || "Failed to save tax");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete tax "${row.name}"?`)) return;
    setError("");
    try {
      await api.del(`/api/taxes/${row.id}`);
      await load();
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to delete tax");
    }
  };

  return (
    <PageShell
      title="Taxes"
      subtitle="tax profiles with default control and fast editing."
      right={
        <div className="flex items-center gap-2">
          <Button onClick={() => downloadCsv(["id","name","rate","is_default"], visibleRows.map(r => [r.id, r.name||"", r.rate||0, r.is_default?"Yes":"No"]), "taxes")}><Download size={14} className="mr-1 inline" />Export CSV</Button>
          <Button tone="primary" onClick={openCreate}>
            <Plus size={14} className="mr-1 inline" />
            Add Tax Rule
          </Button>
        </div>
      }
    >
      {error ? (
        <SectionCard className="mb-3 bg-(--ui-danger-bg) p-3 text-sm text-(--ui-danger-fg)">
          {error}
        </SectionCard>
      ) : null}

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <SectionCard className="p-3"><p className="text-xs text-(--ui-text-muted)">Total Rules</p><p className="text-2xl font-semibold text-(--ui-text)">{rows.length}</p></SectionCard>
        <SectionCard className="p-3"><p className="text-xs text-(--ui-text-muted)">Default Rules</p><p className="text-2xl font-semibold text-(--ui-text)">{rows.filter((r) => Number(r.is_default || 0) === 1).length}</p></SectionCard>
        <SectionCard className="p-3"><p className="text-xs text-(--ui-text-muted)">Visible</p><p className="text-2xl font-semibold text-(--ui-text)">{visibleRows.length}</p></SectionCard>
      </div>

      <SectionCard>
        <TableToolbar
          left={
            <div className="relative min-w-60">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" />
              <Input className="pl-8" placeholder="Search tax rules" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          }
          right={<span className="text-xs text-(--ui-text-muted)">{visibleRows.length} rows</span>}
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-right">Rate %</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && visibleRows.map((row) => (
                <tr key={row.id} className="border-t border-(--ui-border)">
                  <td className="px-3 py-2 font-medium text-(--ui-text)">{row.name}</td>
                  <td className="px-3 py-2 text-right text-(--ui-text)">{Number(row.rate || 0).toFixed(2)}%</td>
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
          {loading ? <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading taxes...</div> : null}
          {!loading && visibleRows.length === 0 ? <EmptyState title="No tax rules" body="Create a tax rule to apply on products." /> : null}
        </div>
      </SectionCard>

      <Modal
        open={modalOpen}
        onClose={saving ? undefined : () => setModalOpen(false)}
        title={form.id ? "Edit Tax Rule" : "Create Tax Rule"}
        size="sm"
      >
        <form className="space-y-2" onSubmit={save}>
          <Input required placeholder="Tax name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          <Input required type="number" min="0" max="100" step="0.01" placeholder="Rate" value={form.rate} onChange={(e) => setForm((p) => ({ ...p, rate: e.target.value }))} />
          <label className="flex items-center gap-2 rounded border border-(--ui-border) p-2 text-sm text-(--ui-text)">
            <input type="checkbox" checked={form.is_default} onChange={(e) => setForm((p) => ({ ...p, is_default: e.target.checked }))} />
            Set as default tax
          </label>
          <ModalFooter>
            <Button type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button tone="primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </ModalFooter>
        </form>
      </Modal>
    </PageShell>
  );
}
