import { useEffect, useMemo, useState } from "react";
import { MapPin, Phone, Plus, Search, Trash2 } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";

const EMPTY = { name: "", address: "", phone: "" };

export default function OutletsRedesign() {
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // outlet being deleted
  const [reassignTo, setReassignTo] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/outlets`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load outlets");
      setOutlets(data.outlets || []);
    } catch (e) {
      setError(e.message || "Failed to load outlets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    if (!search.trim()) return outlets;
    const q = search.toLowerCase();
    return outlets.filter(
      (o) =>
        String(o.name || "").toLowerCase().includes(q) ||
        String(o.address || "").toLowerCase().includes(q),
    );
  }, [outlets, search]);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setModalOpen(true); };
  const openEdit = (o) => {
    setEditing(o);
    setForm({ name: o.name, address: o.address || "", phone: o.phone || "" });
    setModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const url = editing ? `${API}/api/outlets/${editing.id}` : `${API}/api/outlets`;
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save outlet");
      setModalOpen(false);
      await load();
    } catch (e2) {
      setError(e2.message || "Failed to save outlet");
    } finally {
      setSaving(false);
    }
  };

  const openDelete = (o) => {
    setDeleteTarget(o);
    setReassignTo("");
    setError("");
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setError("");
    try {
      const url = reassignTo
        ? `${API}/api/outlets/${deleteTarget.id}?reassign_to=${reassignTo}`
        : `${API}/api/outlets/${deleteTarget.id}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete outlet");
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e.message || "Failed to delete outlet");
    }
  };

  return (
    <PageShell
      title="Outlets"
      subtitle="Manage store locations and branches."
      right={
        <Button tone="primary" onClick={openCreate}>
          <Plus size={14} className="mr-1 inline" /> Add Outlet
        </Button>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</SectionCard>
      ) : null}

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-3">
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Total Outlets</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{outlets.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Visible</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{visible.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">With Address</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{outlets.filter((o) => o.address).length}</p>
        </SectionCard>
      </div>

      <SectionCard>
        <TableToolbar
          left={
            <div className="relative min-w-60">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" />
              <Input
                className="pl-8"
                placeholder="Search outlets"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
          right={<span className="text-xs text-(--ui-text-muted)">{visible.length} outlets</span>}
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left text-(--ui-text-muted) w-12">ID</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Address</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                visible.map((o) => (
                  <tr key={o.id} className="border-t border-(--ui-border) hover:bg-(--ui-muted-surface)">
                    <td className="px-3 py-2 font-mono text-xs text-(--ui-text-muted)">{o.id}</td>
                    <td className="px-3 py-2 font-medium text-(--ui-text)">{o.name}</td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {o.address ? (
                        <span><MapPin size={11} className="mr-1 inline" />{o.address}</span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {o.phone ? (
                        <span><Phone size={11} className="mr-1 inline" />{o.phone}</span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" onClick={() => openEdit(o)}>Edit</Button>
                        <Button size="sm" tone="danger" onClick={() => openDelete(o)}>
                          <Trash2 size={12} className="mr-1 inline" />Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {loading && <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading outlets...</div>}
          {!loading && visible.length === 0 && (
            <EmptyState title="No outlets" body="Add your first outlet location." />
          )}
        </div>
      </SectionCard>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-sm p-5">
            <h3 className="mb-3 text-lg font-semibold text-(--ui-text)">
              {editing ? "Edit Outlet" : "Add Outlet"}
            </h3>
            <form className="space-y-2" onSubmit={save}>
              <Input
                required
                placeholder="Outlet name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
              <Input
                placeholder="Address"
                value={form.address}
                onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
              />
              <Input
                placeholder="Phone"
                value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              />
              <div className="flex gap-2 pt-2">
                <Button type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button tone="primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
              </div>
            </form>
          </SectionCard>
        </div>
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-sm p-5">
            <h3 className="mb-1 text-lg font-semibold text-(--ui-text)">Delete Outlet</h3>
            <p className="mb-4 text-sm text-(--ui-text-muted)">
              You are about to delete <strong>{deleteTarget.name}</strong>. Any records linked to this outlet must be reassigned first.
            </p>
            <div className="mb-4">
              <label className="mb-1 block text-xs font-semibold text-(--ui-text-muted)">
                Reassign linked records to
              </label>
              <select
                className="w-full rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text)"
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
              >
                <option value="">— Delete without reassigning —</option>
                {outlets
                  .filter((o) => o.id !== deleteTarget.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
              </select>
            </div>
            {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}
            <div className="flex gap-2">
              <Button type="button" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button tone="danger" onClick={confirmDelete}>
                {reassignTo ? "Reassign & Delete" : "Delete Anyway"}
              </Button>
            </div>
          </SectionCard>
        </div>
      )}
    </PageShell>
  );
}
