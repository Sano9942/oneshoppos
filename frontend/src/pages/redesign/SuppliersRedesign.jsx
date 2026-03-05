import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2, Truck } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";

const EMPTY = {
  id: null,
  name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
};

export default function SuppliersRedesign() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/suppliers`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load suppliers");
      setRows(data.suppliers || []);
    } catch (e) {
      setError(e.message || "Failed to load suppliers");
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
        String(r.contact_person || "").toLowerCase().includes(q) ||
        String(r.phone || "").toLowerCase().includes(q) ||
        String(r.email || "").toLowerCase().includes(q),
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
      contact_person: row.contact_person || "",
      phone: row.phone || "",
      email: row.email || "",
      address: row.address || "",
    });
    setModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const isEdit = Boolean(form.id);
      const url = isEdit ? `${API}/api/suppliers/${form.id}` : `${API}/api/suppliers`;
      const method = isEdit ? "PUT" : "POST";
      const payload = {
        name: form.name,
        contact_person: form.contact_person,
        phone: form.phone,
        email: form.email,
        address: form.address,
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save supplier");

      setModalOpen(false);
      setForm(EMPTY);
      await load();
    } catch (e2) {
      setError(e2.message || "Failed to save supplier");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete supplier "${row.name}"?`)) return;
    setError("");
    try {
      const res = await fetch(`${API}/api/suppliers/${row.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete supplier");
      await load();
    } catch (e) {
      setError(e.message || "Failed to delete supplier");
    }
  };

  return (
    <PageShell
      title="Suppliers"
      subtitle="supplier master data with fast search and inline CRUD controls."
      right={
        <Button tone="primary" onClick={openCreate}>
          <Plus size={14} className="mr-1 inline" />
          Add Supplier
        </Button>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Total Suppliers</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{rows.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Visible</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{visibleRows.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">With Contact Person</p>
          <p className="text-2xl font-semibold text-(--ui-text)">
            {rows.filter((r) => r.contact_person).length}
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
                placeholder="Search supplier, contact, phone, or email"
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
                <th className="px-3 py-2 text-left">Supplier</th>
                <th className="px-3 py-2 text-left">Contact Person</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                visibleRows.map((row) => (
                  <tr key={row.id} className="border-t border-(--ui-border)">
                    <td className="px-3 py-2 font-medium text-(--ui-text)">
                      <span className="inline-flex items-center gap-1">
                        <Truck size={12} />
                        {row.name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">{row.contact_person || "-"}</td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">{row.phone || "-"}</td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">{row.email || "-"}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
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
          {loading ? (
            <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading suppliers...</div>
          ) : null}
          {!loading && visibleRows.length === 0 ? (
            <EmptyState title="No suppliers" body="Add a supplier to manage procurement workflows." />
          ) : null}
        </div>
      </SectionCard>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-xl p-4">
            <h3 className="text-lg font-semibold text-(--ui-text)">
              {form.id ? "Edit Supplier" : "Create Supplier"}
            </h3>
            <form className="mt-3 space-y-3" onSubmit={save}>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Company Name</label>
                <Input
                  required
                  placeholder="Supplier name"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Contact Person</label>
                  <Input
                    placeholder="Primary contact"
                    value={form.contact_person}
                    onChange={(e) => setForm((p) => ({ ...p, contact_person: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Phone</label>
                  <Input
                    placeholder="Phone number"
                    value={form.phone}
                    onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Email</label>
                <Input
                  type="email"
                  placeholder="Email address"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Address</label>
                <textarea
                  rows={3}
                  className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border) bg-white px-3 py-2 text-sm text-(--ui-text) placeholder:text-(--ui-text-muted)"
                  placeholder="Address"
                  value={form.address}
                  onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="button" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
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
