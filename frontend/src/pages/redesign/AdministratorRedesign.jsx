import { useEffect, useMemo, useState } from "react";
import { Check, Key, Plus, Search, Shield, Trash2, X } from "lucide-react";
import { API } from "../../config";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";

const AVAILABLE_PERMISSIONS = [
  { id: "all_access", label: "All Access", category: "System" },
  { id: "manage_inventory", label: "Manage Inventory", category: "Inventory" },
  { id: "manage_orders", label: "Manage Orders", category: "Orders" },
  { id: "view_reports", label: "View Reports", category: "Reporting" },
  { id: "manage_employees", label: "Manage Employees", category: "System" },
  { id: "pos_discount", label: "Apply Custom Discounts", category: "POS" },
  { id: "void_sales", label: "Void Sales", category: "POS" },
  { id: "pos_void", label: "Manager Override Void", category: "POS" },
  { id: "pos_park", label: "Park & Restore Sales", category: "POS" },
];

const PERM_GROUPS = [...new Set(AVAILABLE_PERMISSIONS.map((p) => p.category))];
const isDefault = (id) => ["1", "2", "3"].includes(String(id));

export default function AdministratorRedesign() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [rolePerms, setRolePerms] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/roles`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load roles");
      const withPerms = await Promise.all(
        data.roles.map(async (role) => {
          const pr = await fetch(`${API}/roles/${role.id}/permissions`);
          const pd = await pr.json();
          return { ...role, permissions: pd.permissions || [] };
        }),
      );
      setRoles(withPerms);
    } catch (e) {
      setError(e.message || "Failed to load roles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    if (!search.trim()) return roles;
    const q = search.toLowerCase();
    return roles.filter((r) => String(r.name || "").toLowerCase().includes(q));
  }, [roles, search]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", description: "" });
    setRolePerms([]);
    setModalOpen(true);
  };

  const openEdit = (role) => {
    setEditing(role);
    setForm({ name: role.name, description: role.description || "" });
    setRolePerms(role.permissions || []);
    setModalOpen(true);
  };

  const togglePerm = (permId) => {
    setRolePerms((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId],
    );
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      let roleId = editing?.id;
      if (!editing) {
        const res = await fetch(`${API}/roles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create role");
        roleId = data.role?.id || data.id;
      } else {
        const res = await fetch(`${API}/roles/${roleId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update role");
      }
      const pr = await fetch(`${API}/roles/${roleId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: rolePerms }),
      });
      const pd = await pr.json();
      if (!pr.ok) throw new Error(pd.error || "Failed to update permissions");
      setModalOpen(false);
      await load();
    } catch (e2) {
      setError(e2.message || "Failed to save role");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (role) => {
    if (isDefault(role.id)) return;
    if (!window.confirm(`Delete role "${role.name}"?`)) return;
    setError("");
    try {
      const res = await fetch(`${API}/roles/${role.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete role");
      await load();
    } catch (e) {
      setError(e.message || "Failed to delete role");
    }
  };

  return (
    <PageShell
      title="Administrator"
      subtitle="Manage roles and permission assignments."
      right={
        <Button tone="primary" onClick={openCreate}>
          <Plus size={14} className="mr-1 inline" /> Add Role
        </Button>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</SectionCard>
      ) : null}

      <SectionCard>
        <TableToolbar
          left={
            <div className="relative min-w-60">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" />
              <Input
                className="pl-8"
                placeholder="Search roles"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
          right={<span className="text-xs text-(--ui-text-muted)">{visible.length} roles</span>}
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Permissions</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                visible.map((role) => (
                  <tr key={role.id} className="border-t border-(--ui-border) hover:bg-(--ui-muted-surface)">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Shield size={14} className="text-(--ui-accent)" />
                        <span className="font-medium text-(--ui-text)">{role.name}</span>
                        {isDefault(role.id) && (
                          <Badge tone="info">System</Badge>
                        )}
                      </div>
                      {role.description && (
                        <p className="mt-0.5 text-xs text-(--ui-text-muted)">{role.description}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(role.permissions || []).slice(0, 4).map((p) => (
                          <Badge key={p} tone="default">
                            <Key size={9} className="mr-0.5 inline" />{p}
                          </Badge>
                        ))}
                        {(role.permissions || []).length > 4 && (
                          <Badge tone="default">+{role.permissions.length - 4} more</Badge>
                        )}
                        {(role.permissions || []).length === 0 && (
                          <span className="text-xs text-(--ui-text-muted)">No permissions</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" onClick={() => openEdit(role)}>Edit</Button>
                        {!isDefault(role.id) && (
                          <Button size="sm" tone="danger" onClick={() => remove(role)}>
                            <Trash2 size={12} className="mr-1 inline" />Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {loading && <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading roles...</div>}
          {!loading && visible.length === 0 && (
            <EmptyState title="No roles found" body="Create custom roles to control access." />
          )}
        </div>
      </SectionCard>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-lg p-5">
            <h3 className="mb-3 text-lg font-semibold text-(--ui-text)">
              {editing ? "Edit Role" : "Create Role"}
            </h3>
            <form className="space-y-3" onSubmit={save}>
              <Input
                required
                placeholder="Role name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
              <Input
                placeholder="Description (optional)"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />

              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-(--ui-text-muted)">Permissions</p>
                {PERM_GROUPS.map((cat) => (
                  <div key={cat} className="mb-2">
                    <p className="mb-1 text-xs text-(--ui-text-muted)">{cat}</p>
                    <div className="grid grid-cols-2 gap-1">
                      {AVAILABLE_PERMISSIONS.filter((p) => p.category === cat).map((perm) => {
                        const checked = rolePerms.includes(perm.id);
                        return (
                          <button
                            key={perm.id}
                            type="button"
                            onClick={() => togglePerm(perm.id)}
                            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                              checked
                                ? "border-(--ui-accent) bg-(--ui-accent)/5 text-(--ui-accent)"
                                : "border-(--ui-border) text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
                            }`}
                          >
                            {checked ? <Check size={11} /> : <X size={11} />}
                            {perm.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-1">
                <Button type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button tone="primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save Role"}</Button>
              </div>
            </form>
          </SectionCard>
        </div>
      )}
    </PageShell>
  );
}
