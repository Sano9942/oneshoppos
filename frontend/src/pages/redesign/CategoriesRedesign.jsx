import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";

const EMPTY = { id: null, name: "", description: "" };

export default function CategoriesRedesign() {
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
      const res = await fetch(`${API}/api/categories`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load categories");
      setRows(data.categories || []);
    } catch (e) {
      setError(e.message || "Failed to load categories");
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
      const url = form.id ? `${API}/api/categories/${form.id}` : `${API}/api/categories`;
      const method = form.id ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, description: form.description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save category");
      setModalOpen(false);
      setForm(EMPTY);
      await load();
    } catch (e2) {
      setError(e2.message || "Failed to save category");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete category "${row.name}"?`)) return;
    setError("");
    try {
      const res = await fetch(`${API}/api/categories/${row.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete category");
      await load();
    } catch (e) {
      setError(e.message || "Failed to delete category");
    }
  };

  return (
    <PageShell
      title="Categories"
      subtitle="Wave B redesign: canonical list-management pattern for taxonomy modules."
      right={
        <Button tone="primary" onClick={openCreate}>
          <Plus size={14} className="mr-1 inline" />
          Add Category
        </Button>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <SectionCard className="p-3"><p className="text-xs text-[var(--ui-text-muted)]">Total Categories</p><p className="text-2xl font-semibold text-[var(--ui-text)]">{rows.length}</p></SectionCard>
        <SectionCard className="p-3"><p className="text-xs text-[var(--ui-text-muted)]">Visible</p><p className="text-2xl font-semibold text-[var(--ui-text)]">{visibleRows.length}</p></SectionCard>
        <SectionCard className="p-3"><p className="text-xs text-[var(--ui-text-muted)]">With Description</p><p className="text-2xl font-semibold text-[var(--ui-text)]">{rows.filter((r) => r.description).length}</p></SectionCard>
      </div>

      <SectionCard>
        <TableToolbar
          left={
            <div className="relative min-w-[240px]">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--ui-text-muted)]" />
              <Input
                className="pl-8"
                placeholder="Search categories"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
          right={<span className="text-xs text-[var(--ui-text-muted)]">{visibleRows.length} rows</span>}
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-[var(--ui-border)] text-sm">
            <thead className="bg-[var(--ui-muted-surface)] text-xs uppercase text-[var(--ui-text-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                visibleRows.map((row) => (
                  <tr key={row.id} className="border-t border-[var(--ui-border)]">
                    <td className="px-3 py-2 font-medium text-[var(--ui-text)]">{row.name}</td>
                    <td className="px-3 py-2 text-[var(--ui-text-muted)]">{row.description || "-"}</td>
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
          {loading ? <div className="p-8 text-center text-sm text-[var(--ui-text-muted)]">Loading categories...</div> : null}
          {!loading && visibleRows.length === 0 ? (
            <EmptyState title="No categories" body="Create a category to organize inventory." />
          ) : null}
        </div>
      </SectionCard>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-md p-4">
            <h3 className="text-lg font-semibold text-[var(--ui-text)]">
              {form.id ? "Edit Category" : "Create Category"}
            </h3>
            <form className="mt-3 space-y-2" onSubmit={save}>
              <Input
                required
                placeholder="Category name"
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
