import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { api } from "../../api";
import { useToast } from "../../contexts/ToastContext";
import { useNavigate } from "react-router-dom";
import {
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
} from "../../ui/primitives";

export default function CustomerGroupsRedesign() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", discount_percent: "" });
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/customer-groups");
      setGroups(data.groups || []);
    } catch {
      toast.error("Failed to load customer groups");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchGroups(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", description: "", discount_percent: "" });
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (g) => {
    setEditing(g);
    setForm({
      name: g.name || "",
      description: g.description || "",
      discount_percent: g.discount_percent != null ? String(g.discount_percent) : "",
    });
    setFormError("");
    setModalOpen(true);
  };

  const submitForm = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setFormError("Group name is required"); return; }
    setBusy(true);
    setFormError("");
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        discount_percent: form.discount_percent ? Number(form.discount_percent) : 0,
      };
      if (editing) {
        await api.put(`/api/customer-groups/${editing.id}`, payload);
        toast.success("Group updated");
      } else {
        await api.post("/api/customer-groups", payload);
        toast.success("Group created");
      }
      setModalOpen(false);
      await fetchGroups();
    } catch (e2) {
      setFormError(e2.body?.error || e2.message || "Failed to save group");
    } finally {
      setBusy(false);
    }
  };

  const deleteGroup = async (g) => {
    if (!window.confirm(`Delete "${g.name}"? ${g.member_count || 0} customers will be unassigned.`)) return;
    try {
      await api.del(`/api/customer-groups/${g.id}`);
      toast.success("Group deleted");
      await fetchGroups();
    } catch (e) {
      toast.error(e.body?.error || "Failed to delete group");
    }
  };

  return (
    <PageShell
      title="Customer Groups"
      subtitle="Segment customers into groups with optional discounts."
      right={
        <Button tone="primary" onClick={openCreate}>
          <Plus size={14} className="mr-1 inline" />
          New Group
        </Button>
      }
    >
      <SectionCard>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-4 py-2.5 text-left">Name</th>
                <th className="px-4 py-2.5 text-left">Description</th>
                <th className="px-4 py-2.5 text-center">Members</th>
                <th className="px-4 py-2.5 text-right">Discount %</th>
                <th className="px-4 py-2.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && groups.map((g) => (
                <tr key={g.id} className="border-t border-(--ui-border)">
                  <td className="px-4 py-2.5 font-medium text-(--ui-text)">{g.name}</td>
                  <td className="px-4 py-2.5 text-(--ui-text-muted) truncate max-w-48">{g.description || "—"}</td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                      onClick={() => navigate(`/customers?group=${g.id}`)}
                    >
                      <Users size={12} />
                      {g.member_count || 0}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-(--ui-text)">
                    {Number(g.discount_percent) > 0 ? `${g.discount_percent}%` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center gap-1">
                      <Button size="sm" onClick={() => openEdit(g)}>
                        <Pencil size={12} className="mr-1 inline" />Edit
                      </Button>
                      <Button size="sm" tone="danger" onClick={() => deleteGroup(g)}>
                        <Trash2 size={12} className="mr-1 inline" />Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && (
            <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading groups...</div>
          )}
          {!loading && groups.length === 0 && (
            <EmptyState
              title="No customer groups"
              body="Create your first group to segment customers and apply group discounts."
            />
          )}
        </div>
      </SectionCard>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-md p-4">
            <h3 className="text-lg font-semibold text-(--ui-text)">
              {editing ? "Edit Group" : "New Customer Group"}
            </h3>
            <form className="mt-3 space-y-2" onSubmit={submitForm}>
              {formError && <p className="rounded bg-rose-50 p-2 text-sm text-rose-700">{formError}</p>}
              <Input
                required
                placeholder="Group name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                autoFocus
              />
              <Input
                placeholder="Description (optional)"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
              <div>
                <label className="text-[10px] font-medium text-(--ui-text-muted)">Discount %</label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="0"
                  value={form.discount_percent}
                  onChange={(e) => setForm((p) => ({ ...p, discount_percent: e.target.value }))}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button tone="primary" type="submit" disabled={busy}>{editing ? "Save" : "Create"}</Button>
              </div>
            </form>
          </SectionCard>
        </div>
      )}
    </PageShell>
  );
}
