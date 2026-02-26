import { useEffect, useMemo, useState } from "react";
import { Lock, Plus, Search, Shield, Trash2, User } from "lucide-react";
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

const EMPTY_FORM = { name: "", role_id: 3, pin_code: "" };

export default function EmployeesRedesign() {
  const [employees, setEmployees] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [empRes, rolesRes] = await Promise.all([
        fetch(`${API}/api/employees`),
        fetch(`${API}/api/roles`),
      ]);
      const [empData, rolesData] = await Promise.all([empRes.json(), rolesRes.json()]);
      if (!empRes.ok) throw new Error(empData.error || "Failed to load employees");
      setEmployees(empData.employees || []);
      setRoles(rolesData.roles || []);
    } catch (e) {
      setError(e.message || "Failed to load employees");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    if (!search.trim()) return employees;
    const q = search.toLowerCase();
    return employees.filter(
      (e) =>
        String(e.name || "").toLowerCase().includes(q) ||
        String(e.role_name || "").toLowerCase().includes(q),
    );
  }, [employees, search]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (emp) => {
    setEditing(emp);
    setForm({ name: emp.name, role_id: emp.role_id, pin_code: "" });
    setModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const url = editing
        ? `${API}/api/employees/${editing.id}`
        : `${API}/api/employees`;
      const method = editing ? "PUT" : "POST";
      const body = { name: form.name, role_id: Number(form.role_id) };
      if (form.pin_code) body.pin_code = form.pin_code;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save employee");
      setModalOpen(false);
      await load();
    } catch (e2) {
      setError(e2.message || "Failed to save employee");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (emp) => {
    if (!window.confirm(`Delete employee "${emp.name}"?`)) return;
    setError("");
    try {
      const res = await fetch(`${API}/api/employees/${emp.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete employee");
      await load();
    } catch (e) {
      setError(e.message || "Failed to delete employee");
    }
  };

  const roleLabel = (id) => roles.find((r) => r.id === id)?.name || `Role ${id}`;

  return (
    <PageShell
      title="Employees"
      subtitle="Manage staff accounts, roles and PIN codes."
      right={
        <Button tone="primary" onClick={openCreate}>
          <Plus size={14} className="mr-1 inline" /> Add Employee
        </Button>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <SectionCard className="p-3">
          <p className="text-xs text-[var(--ui-text-muted)]">Total</p>
          <p className="text-2xl font-semibold text-[var(--ui-text)]">{employees.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-[var(--ui-text-muted)]">Visible</p>
          <p className="text-2xl font-semibold text-[var(--ui-text)]">{visible.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-[var(--ui-text-muted)]">Roles</p>
          <p className="text-2xl font-semibold text-[var(--ui-text)]">{roles.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-[var(--ui-text-muted)]">Active</p>
          <p className="text-2xl font-semibold text-[var(--ui-text)]">
            {employees.filter((e) => e.active !== false).length}
          </p>
        </SectionCard>
      </div>

      <SectionCard>
        <TableToolbar
          left={
            <div className="relative min-w-[240px]">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--ui-text-muted)]" />
              <Input
                className="pl-8"
                placeholder="Search employees"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
          right={<span className="text-xs text-[var(--ui-text-muted)]">{visible.length} employees</span>}
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-[var(--ui-border)] text-sm">
            <thead className="bg-[var(--ui-muted-surface)] text-xs uppercase text-[var(--ui-text-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">PIN</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                visible.map((emp) => (
                  <tr key={emp.id} className="border-t border-[var(--ui-border)] hover:bg-[var(--ui-muted-surface)]">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ui-accent)]/10 text-[var(--ui-accent)]">
                          <User size={13} />
                        </div>
                        <span className="font-medium text-[var(--ui-text)]">{emp.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={emp.role_id === 1 ? "danger" : emp.role_id === 2 ? "warning" : "default"}>
                        <Shield size={10} className="mr-1 inline" />
                        {emp.role_name || roleLabel(emp.role_id)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-[var(--ui-text-muted)]">
                      <Lock size={12} className="mr-1 inline" />
                      ••••
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" onClick={() => openEdit(emp)}>Edit</Button>
                        <Button size="sm" tone="danger" onClick={() => remove(emp)}>
                          <Trash2 size={12} className="mr-1 inline" />Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {loading && (
            <div className="p-8 text-center text-sm text-[var(--ui-text-muted)]">Loading employees...</div>
          )}
          {!loading && visible.length === 0 && (
            <EmptyState title="No employees found" body="Add your first employee to get started." />
          )}
        </div>
      </SectionCard>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-sm p-5">
            <h3 className="mb-3 text-lg font-semibold text-[var(--ui-text)]">
              {editing ? "Edit Employee" : "Add Employee"}
            </h3>
            <form className="space-y-2" onSubmit={save}>
              <Input
                required
                placeholder="Full name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
              <Select
                value={form.role_id}
                onChange={(e) => setForm((p) => ({ ...p, role_id: Number(e.target.value) }))}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
              <Input
                type="password"
                placeholder={editing ? "New PIN (leave blank to keep)" : "PIN code"}
                value={form.pin_code}
                onChange={(e) => setForm((p) => ({ ...p, pin_code: e.target.value }))}
                required={!editing}
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
      )}
    </PageShell>
  );
}
