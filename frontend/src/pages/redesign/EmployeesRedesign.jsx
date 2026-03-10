import { useEffect, useMemo, useState } from "react";
import { Lock, MapPin, Plus, Search, Shield, Star, Trash2, User } from "lucide-react";
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

const EMPTY_FORM = { name: "", role_id: 3, pin_code: "", salary_type: "monthly", monthly_salary: "", hourly_rate: "", daily_rate: "" };
const EMPTY_ATT = { work_hours_per_day: 8, monthly_leave_allowance: 2 };

export default function EmployeesRedesign() {
  const [employees, setEmployees] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [attConfig, setAttConfig] = useState(EMPTY_ATT);
  const [saving, setSaving] = useState(false);
  const [allOutlets, setAllOutlets] = useState([]);
  const [assignedOutletIds, setAssignedOutletIds] = useState([]);
  const [primaryOutletId, setPrimaryOutletId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [empRes, rolesRes, outletsRes] = await Promise.all([
        fetch(`${API}/api/employees`),
        fetch(`${API}/api/roles`),
        fetch(`${API}/api/outlets`),
      ]);
      const [empData, rolesData, outletsData] = await Promise.all([empRes.json(), rolesRes.json(), outletsRes.json()]);
      if (!empRes.ok) throw new Error(empData.error || "Failed to load employees");
      setEmployees(empData.employees || []);
      setRoles(rolesData.roles || []);
      setAllOutlets((outletsData.outlets || []).filter((o) => o.is_active !== 0));
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
    setAttConfig(EMPTY_ATT);
    setAssignedOutletIds([]);
    setPrimaryOutletId(null);
    setModalOpen(true);
  };

  const openEdit = async (emp) => {
    setEditing(emp);
    setForm({ name: emp.name, role_id: emp.role_id, pin_code: "", salary_type: emp.salary_type || "monthly", monthly_salary: emp.monthly_salary || "", hourly_rate: emp.hourly_rate || "", daily_rate: emp.daily_rate || "" });
    setAttConfig(EMPTY_ATT);
    setAssignedOutletIds([]);
    setPrimaryOutletId(null);
    setModalOpen(true);
    // Fetch attendance config + outlet assignments (non-blocking)
    try {
      const [attRes, outRes] = await Promise.all([
        fetch(`${API}/api/employees/${emp.id}/attendance-config`),
        fetch(`${API}/api/employees/${emp.id}/outlets`),
      ]);
      const [attData, outData] = await Promise.all([attRes.json(), outRes.json()]);
      if (attRes.ok) {
        setAttConfig({
          work_hours_per_day: attData.work_hours_per_day ?? 8,
          monthly_leave_allowance: attData.monthly_leave_allowance ?? 2,
        });
      }
      if (outRes.ok && outData.outlets) {
        setAssignedOutletIds(outData.outlets.map((o) => o.outlet_id));
        const primary = outData.outlets.find((o) => o.is_primary);
        setPrimaryOutletId(primary ? primary.outlet_id : null);
      }
    } catch {}
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
      const body = {
        name: form.name,
        role_id: Number(form.role_id),
        salary_type: form.salary_type || "monthly",
        monthly_salary: Number(form.monthly_salary || 0),
        hourly_rate: Number(form.hourly_rate || 0),
        daily_rate: Number(form.daily_rate || 0),
      };
      if (form.pin_code) body.pin_code = form.pin_code;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save employee");
      // Save attendance config + outlet assignments
      const empId = editing ? editing.id : (data.employee?.id || data.id || null);
      if (editing) {
        await fetch(`${API}/api/employees/${editing.id}/attendance-config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            work_hours_per_day: Number(attConfig.work_hours_per_day),
            monthly_leave_allowance: Number(attConfig.monthly_leave_allowance),
          }),
        });
      }
      if (empId && assignedOutletIds.length > 0) {
        await fetch(`${API}/api/employees/${empId}/outlets`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outlet_ids: assignedOutletIds,
            primary_outlet_id: primaryOutletId || assignedOutletIds[0],
          }),
        });
      }
      setModalOpen(false);
      await load();
    } catch (e2) {
      setError(e2.message || "Failed to save employee");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (emp) => {
    if (!window.confirm(`Archive employee "${emp.name}"? They will be hidden from listings but preserved in history.`)) return;
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
          <p className="text-xs text-(--ui-text-muted)">Total</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{employees.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Visible</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{visible.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Roles</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{roles.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Active</p>
          <p className="text-2xl font-semibold text-(--ui-text)">
            {employees.filter((e) => e.active !== false).length}
          </p>
        </SectionCard>
      </div>

      <SectionCard>
        <TableToolbar
          left={
            <div className="relative min-w-60">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" />
              <Input
                className="pl-8"
                placeholder="Search employees"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
          right={<span className="text-xs text-(--ui-text-muted)">{visible.length} employees</span>}
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
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
                  <tr key={emp.id} className="border-t border-(--ui-border) hover:bg-(--ui-muted-surface)">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--ui-accent)/10 text-(--ui-accent)">
                          <User size={13} />
                        </div>
                        <span className="font-medium text-(--ui-text)">{emp.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={emp.role_id === 1 ? "danger" : emp.role_id === 2 ? "warning" : "default"}>
                        <Shield size={10} className="mr-1 inline" />
                        {emp.role_name || roleLabel(emp.role_id)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      <Lock size={12} className="mr-1 inline" />
                      ••••
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" onClick={() => openEdit(emp)}>Edit</Button>
                        <Button size="sm" tone="danger" onClick={() => remove(emp)}>
                          <Trash2 size={12} className="mr-1 inline" />Archive
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {loading && (
            <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading employees...</div>
          )}
          {!loading && visible.length === 0 && (
            <EmptyState title="No employees found" body="Add your first employee to get started." />
          )}
        </div>
      </SectionCard>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
            <h3 className="mb-3 text-lg font-semibold text-(--ui-text)">
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
              {/* Salary Config */}
              <div className="border-t border-(--ui-border) pt-3 mt-1 space-y-2">
                <p className="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wide">
                  Salary Config
                </p>
                <Select
                  value={form.salary_type}
                  onChange={(e) => setForm((p) => ({ ...p, salary_type: e.target.value }))}
                >
                  <option value="monthly">Monthly Salary</option>
                  <option value="hourly">Hourly Rate</option>
                  <option value="daily">Daily Rate</option>
                </Select>
                {form.salary_type === "monthly" && (
                  <div>
                    <label className="block text-xs text-(--ui-text-muted) mb-1">Monthly Salary</label>
                    <Input
                      type="number"
                      min="0"
                      step="100"
                      placeholder="e.g. 30000"
                      value={form.monthly_salary}
                      onChange={(e) => setForm((p) => ({ ...p, monthly_salary: e.target.value }))}
                    />
                  </div>
                )}
                {form.salary_type === "hourly" && (
                  <div>
                    <label className="block text-xs text-(--ui-text-muted) mb-1">Hourly Rate</label>
                    <Input
                      type="number"
                      min="0"
                      step="10"
                      placeholder="e.g. 200"
                      value={form.hourly_rate}
                      onChange={(e) => setForm((p) => ({ ...p, hourly_rate: e.target.value }))}
                    />
                    <p className="text-xs text-(--ui-text-muted) mt-1">Overtime (beyond daily hours) paid at 1.5x</p>
                  </div>
                )}
                {form.salary_type === "daily" && (
                  <div>
                    <label className="block text-xs text-(--ui-text-muted) mb-1">Daily Rate</label>
                    <Input
                      type="number"
                      min="0"
                      step="100"
                      placeholder="e.g. 1500"
                      value={form.daily_rate}
                      onChange={(e) => setForm((p) => ({ ...p, daily_rate: e.target.value }))}
                    />
                  </div>
                )}
              </div>
              {/* Attendance Config — shown when editing */}
              {editing && (
                <div className="border-t border-(--ui-border) pt-3 mt-1 space-y-2">
                  <p className="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wide">
                    Attendance Config
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-(--ui-text-muted) mb-1">Hours / Day</label>
                      <Input
                        type="number"
                        min="1"
                        max="24"
                        step="0.5"
                        value={attConfig.work_hours_per_day}
                        onChange={(e) => setAttConfig((p) => ({ ...p, work_hours_per_day: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-(--ui-text-muted) mb-1">Leave Days / Month</label>
                      <Input
                        type="number"
                        min="0"
                        max="31"
                        step="1"
                        value={attConfig.monthly_leave_allowance}
                        onChange={(e) => setAttConfig((p) => ({ ...p, monthly_leave_allowance: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
              )}
              {/* Outlet Assignments */}
              {allOutlets.length > 0 && (
                <div className="border-t border-(--ui-border) pt-3 mt-1 space-y-2">
                  <p className="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wide">
                    Outlet Assignments
                  </p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {allOutlets.map((o) => {
                      const checked = assignedOutletIds.includes(o.id);
                      const isPrimary = primaryOutletId === o.id;
                      return (
                        <label key={o.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-(--ui-muted-surface) cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              if (checked) {
                                setAssignedOutletIds((prev) => prev.filter((id) => id !== o.id));
                                if (isPrimary) setPrimaryOutletId(null);
                              } else {
                                setAssignedOutletIds((prev) => [...prev, o.id]);
                              }
                            }}
                            className="accent-(--ui-accent)"
                          />
                          <MapPin size={12} className="text-(--ui-text-muted) shrink-0" />
                          <span className="flex-1 text-(--ui-text)">{o.name}</span>
                          {checked && (
                            <button
                              type="button"
                              title={isPrimary ? "Primary outlet" : "Set as primary"}
                              onClick={(e) => { e.preventDefault(); setPrimaryOutletId(o.id); }}
                              className={`p-0.5 rounded ${isPrimary ? "text-amber-500" : "text-(--ui-text-muted) hover:text-amber-400"}`}
                            >
                              <Star size={13} fill={isPrimary ? "currentColor" : "none"} />
                            </button>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  {assignedOutletIds.length === 0 && (
                    <p className="text-xs text-(--ui-text-muted)">No outlets assigned — employee will have no branch access.</p>
                  )}
                </div>
              )}
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
