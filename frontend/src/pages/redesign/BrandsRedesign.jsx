import { useEffect, useMemo, useState } from "react";
import { Download, Plus, Search, Tag, Trash2 } from "lucide-react";
import { api } from "../../api";
import {
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";
import { downloadCsv } from "../../utils/csvExport";

const EMPTY = { id: null, name: "", description: "" };

export default function BrandsRedesign() {
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
      const data = await api.get("/api/brands");
      setRows(data.brands || []);
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to load brands");
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
    return rows.filter(
      (r) =>
        String(r.name || "").toLowerCase().includes(q) ||
        String(r.description || "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const openCreate = () => {
    setForm(EMPTY);
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setForm({
      id: row.id,
      name: row.name || "",
      description: row.description || "",
    });
    setModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = { name: form.name, description: form.description };
      if (form.id) {
        await api.put(`/api/brands/${form.id}`, payload);
      } else {
        await api.post("/api/brands", payload);
      }
      setModalOpen(false);
      setForm(EMPTY);
      await load();
    } catch (e2) {
      setError(e2.body?.error || e2.message || "Failed to save brand");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete brand "${row.name}"?`)) return;
    setError("");
    try {
      await api.del(`/api/brands/${row.id}`);
      await load();
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to delete brand");
    }
  };

  return (
    <PageShell
      title="Brands"
      subtitle="brand taxonomy with consistent CRUD and search behavior."
      right={
        <div className="flex items-center gap-2">
          <Button onClick={() => downloadCsv(["id","name","description"], visibleRows.map(r => [r.id, r.name||"", r.description||""]), "brands")}><Download size={14} className="mr-1 inline" />Export CSV</Button>
          <Button tone="primary" onClick={openCreate}>
            <Plus size={14} className="mr-1 inline" />
            Add Brand
          </Button>
        </div>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <SectionCard className="p-3"><p className="text-xs text-(--ui-text-muted)">Total Brands</p><p className="text-2xl font-semibold text-(--ui-text)">{rows.length}</p></SectionCard>
        <SectionCard className="p-3"><p className="text-xs text-(--ui-text-muted)">Visible</p><p className="text-2xl font-semibold text-(--ui-text)">{visibleRows.length}</p></SectionCard>
        <SectionCard className="p-3"><p className="text-xs text-(--ui-text-muted)">With Description</p><p className="text-2xl font-semibold text-(--ui-text)">{rows.filter((r) => r.description).length}</p></SectionCard>
      </div>

      <SectionCard>
        <TableToolbar
          left={
            <div className="relative min-w-60">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" />
              <Input
                className="pl-8"
                placeholder="Search brands"
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
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                visibleRows.map((row) => (
                  <tr key={row.id} className="border-t border-(--ui-border)">
                    <td className="px-3 py-2 font-medium text-(--ui-text)">
                      <span className="inline-flex items-center gap-1"><Tag size={12} /> {row.name}</span>
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">{row.description || "-"}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" onClick={() => openEdit(row)}>Edit</Button>
                        <Button size="sm" tone="danger" onClick={() => remove(row)}>
                          <Trash2 size={12} className="mr-1 inline" />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {loading ? <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading brands...</div> : null}
          {!loading && visibleRows.length === 0 ? (
            <EmptyState title="No brands" body="Create a brand to improve product labeling." />
          ) : null}
        </div>
      </SectionCard>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-md p-4">
            <h3 className="text-lg font-semibold text-(--ui-text)">
              {form.id ? "Edit Brand" : "Create Brand"}
            </h3>
            <form className="mt-3 space-y-2" onSubmit={save}>
              <Input
                required
                placeholder="Brand name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
              <Input
                placeholder="Description"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
              <div className="flex gap-2 pt-2">
                <Button type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button tone="primary" type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </SectionCard>
        </div>
      ) : null}
    </PageShell>
  );
}
