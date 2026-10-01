import { useEffect, useMemo, useState } from "react";
import { Download, KeyRound, Lock, Mail, MapPin, Plus, Search, Shield, Star, Trash2, User } from "lucide-react";
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
  Select,
  TableToolbar,
} from "../../ui/primitives";
import { downloadCsv } from "../../utils/csvExport";
import { usePreset } from "../../contexts/PresetContext";
import { buildOutletRolesMap, overridesFromAssignments } from "./employeeOutletRoles";

const EMPTY_FORM = { name: "", role_id: 3, pin_code: "", email: "", salary_type: "monthly", monthly_salary: "", hourly_rate: "", daily_rate: "", home_staff: false };
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
  // Step 14 (D2b): per-outlet role overrides — { [outlet_id]: role_id },
  // explicit overrides only; an absent key means "Inherit (<base role>)".
  const [outletRoles, setOutletRoles] = useState({});
  const { refreshPreset } = usePreset();

  // Revoke sessions modal
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revoking, setRevoking] = useState(false);

  // Password management
  const [passwordTarget, setPasswordTarget] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [empData, rolesData, outletsData] = await Promise.all([
        api.get("/api/employees"),
        api.get("/api/roles"),
        api.get("/api/outlets"),
      ]);
      setEmployees(empData.employees || []);
      setRoles(rolesData.roles || []);
      setAllOutlets((outletsData.outlets || []).filter((o) => o.is_active !== 0));
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to load employees");
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
    setOutletRoles({});
    setModalOpen(true);
  };

  const openEdit = async (emp) => {
    setEditing(emp);
    setForm({ name: emp.name, role_id: emp.role_id, pin_code: "", email: emp.email || "", salary_type: emp.salary_type || "monthly", monthly_salary: emp.monthly_salary || "", hourly_rate: emp.hourly_rate || "", daily_rate: emp.daily_rate || "", home_staff: emp.home_staff === true });
    setAttConfig(EMPTY_ATT);
    setAssignedOutletIds([]);
    setPrimaryOutletId(null);
    setOutletRoles({});
    setModalOpen(true);
    // Fetch attendance config + outlet assignments (non-blocking)
    try {
      const [attData, outData] = await Promise.all([
        api.get(`/api/employees/${emp.id}/attendance-config`),
        api.get(`/api/employees/${emp.id}/outlets`),
      ]);
      setAttConfig({
        work_hours_per_day: attData.work_hours_per_day ?? 8,
        monthly_leave_allowance: attData.monthly_leave_allowance ?? 2,
      });
      if (outData.outlets) {
        setAssignedOutletIds(outData.outlets.map((o) => o.outlet_id));
        const primary = outData.outlets.find((o) => o.is_primary);
        setPrimaryOutletId(primary ? primary.outlet_id : null);
        setOutletRoles(overridesFromAssignments(outData.outlets));
      }
    } catch {}
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = {
        name: form.name,
        role_id: Number(form.role_id),
        salary_type: form.salary_type || "monthly",
        monthly_salary: Number(form.monthly_salary || 0),
        hourly_rate: Number(form.hourly_rate || 0),
        daily_rate: Number(form.daily_rate || 0),
        home_staff: form.home_staff === true,
      };
      if (form.pin_code) body.pin_code = form.pin_code;
      if (form.email !== undefined) body.email = form.email;
      let data;
      if (editing) {
        data = await api.put(`/api/employees/${editing.id}`, body);
      } else {
        data = await api.post("/api/employees", body);
      }
      // Save attendance config + outlet assignments
      const empId = editing ? editing.id : (data.employee?.id || data.id || null);
      if (editing) {
        await api.put(`/api/employees/${editing.id}/attendance-config`, {
          work_hours_per_day: Number(attConfig.work_hours_per_day),
          monthly_leave_allowance: Number(attConfig.monthly_leave_allowance),
        });
      }
      if (empId && assignedOutletIds.length > 0) {
        await api.put(`/api/employees/${empId}/outlets`, {
          outlet_ids: assignedOutletIds,
          primary_outlet_id: primaryOutletId || assignedOutletIds[0],
          // Always round-trip the full map — the PUT is bulk-replace and an
          // omitted outlet_roles clears every existing override (Step 13).
          outlet_roles: buildOutletRolesMap(assignedOutletIds, outletRoles),
        });
      }
      setModalOpen(false);
      // C8: if the editor changed their own assignment/override, their
      // effective perms refresh in place; other employees converge at their
      // next bootstrap or context switch.
      refreshPreset?.();
      await load();
    } catch (e2) {
      setError(e2.body?.error || e2.message || "Failed to save employee");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (emp) => {
    if (!window.confirm(`Archive employee "${emp.name}"? They will be hidden from listings but preserved in history.`)) return;
    setError("");
    try {
      await api.del(`/api/employees/${emp.id}`);
      await load();
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to delete employee");
    }
  };

  const revokeAllSessions = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    setError("");
    try {
      await api.post(`/api/employees/${revokeTarget.id}/revoke-all-tokens`, { reason: revokeReason || undefined });
      setRevokeTarget(null);
      setRevokeReason("");
      setError(""); // clear any old error
      alert(`All sessions revoked for ${revokeTarget.name}`);
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to revoke sessions");
    } finally {
      setRevoking(false);
    }
  };

  const setPasswordForEmployee = async () => {
    if (!passwordTarget || newPassword.length < 8 || newPassword !== confirmPassword) return;
    setSettingPassword(true);
    setError("");
    try {
      await api.put(`/api/employees/${passwordTarget.id}/set-password`, { password: newPassword });
      setPasswordTarget(null);
      setNewPassword("");
      setConfirmPassword("");
      await load();
      alert(`Password set for ${passwordTarget.name}`);
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to set password");
    } finally {
      setSettingPassword(false);
    }
  };

  const sendPasswordReset = async (emp) => {
    if (!emp.email) {
      alert("This employee has no email address set. Edit the employee to add one first.");
      return;
    }
    if (!window.confirm(`Send password reset email to ${emp.email}?`)) return;
    setError("");
    try {
      const data = await api.post(`/api/employees/${emp.id}/send-reset`, {});
      alert(data.message || "Reset email sent");
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to send reset email");
    }
  };

  const roleLabel = (id) => roles.find((r) => r.id === id)?.name || `Role ${id}`;

  return (
    <PageShell
      title="Employees"
      subtitle="Manage staff accounts, roles and PIN codes."
      right={
        <div className="flex gap-2">
          <Button onClick={() => downloadCsv(["id","name","role","salary_type","monthly_salary","hourly_rate"], visible.map(e => [e.id, e.name||"", roles.find(r=>r.id===e.role_id)?.name||"", e.salary_type||"", e.monthly_salary||"", e.hourly_rate||""]), "employees")}><Download size={14} className="mr-1 inline" />Export CSV</Button>
          <Button tone="primary" onClick={openCreate}>
            <Plus size={14} className="mr-1 inline" /> Add Employee
          </Button>
        </div>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-(--ui-danger-bg) bg-(--ui-danger-bg) p-3 text-sm text-(--ui-danger-fg)">
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
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Auth</th>
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
                    <td className="px-3 py-2 text-(--ui-text-muted) text-sm">
                      {emp.email || <span className="text-xs italic">No email</span>}
                    </td>
                    <td className="px-3 py-2">
                      {emp.has_password ? (
                        <Badge tone="default"><Lock size={10} className="mr-1 inline" />Password</Badge>
                      ) : (
                        <Badge tone="warning"><Lock size={10} className="mr-1 inline" />PIN only</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" onClick={() => openEdit(emp)}>Edit</Button>
                        <Button size="sm" onClick={() => { setPasswordTarget(emp); setNewPassword(""); setConfirmPassword(""); }}>
                          <Lock size={12} className="mr-1 inline" />Password
                        </Button>
                        <Button size="sm" onClick={() => sendPasswordReset(emp)}
                          title={emp.email ? `Send reset to ${emp.email}` : "No email set"}>
                          <Mail size={12} className="mr-1 inline" />Reset
                        </Button>
                        <Button size="sm" tone="danger" onClick={() => { setRevokeTarget(emp); setRevokeReason(""); }}>
                          <KeyRound size={12} className="mr-1 inline" />Revoke
                        </Button>
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

      <Modal
        open={modalOpen}
        onClose={saving ? undefined : () => setModalOpen(false)}
        title={editing ? "Edit Employee" : "Add Employee"}
        size="lg"
      >
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
              <Input
                type="email"
                placeholder="Email address (for password resets)"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
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
                <label className="flex items-start gap-2 text-sm text-(--ui-text) cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={form.home_staff === true}
                    onChange={(e) => setForm((p) => ({ ...p, home_staff: e.target.checked }))}
                  />
                  <span>
                    Home staff
                    <span className="block text-xs text-(--ui-text-muted)">Works for the home (driver, maid): salary paid from the till is booked as Owner / home, not a shop cost. Not counted as present in the shop.</span>
                  </span>
                </label>
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
                      const baseRoleName = roles.find((r) => r.id === Number(form.role_id))?.name || "base role";
                      return (
                        <label key={o.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-(--ui-muted-surface) cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              if (checked) {
                                setAssignedOutletIds((prev) => prev.filter((id) => id !== o.id));
                                if (isPrimary) setPrimaryOutletId(null);
                                setOutletRoles((prev) => {
                                  if (!(o.id in prev)) return prev;
                                  const next = { ...prev };
                                  delete next[o.id];
                                  return next;
                                });
                              } else {
                                setAssignedOutletIds((prev) => [...prev, o.id]);
                              }
                            }}
                            className="accent-(--ui-accent)"
                          />
                          <MapPin size={12} className="text-(--ui-text-muted) shrink-0" />
                          <span className="flex-1 text-(--ui-text)">{o.name}</span>
                          {checked && (
                            /* Step 14 (D2b): per-outlet role override — default inherits the base role. */
                            <Select
                              value={outletRoles[o.id] ?? ""}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                const v = e.target.value;
                                setOutletRoles((prev) => {
                                  const next = { ...prev };
                                  if (v === "") delete next[o.id];
                                  else next[o.id] = Number(v);
                                  return next;
                                });
                              }}
                              className="w-44 shrink-0 text-xs"
                            >
                              <option value="">Inherit ({baseRoleName})</option>
                              {roles.map((r) => (
                                <option key={r.id} value={r.id}>{r.name}</option>
                              ))}
                            </Select>
                          )}
                          {checked && (
                            /* Primary-outlet star toggle — intentional tiny favorite icon; <Button> would add padding/border. */
                            <button
                              type="button"
                              title={isPrimary ? "Primary outlet" : "Set as primary"}
                              onClick={(e) => { e.preventDefault(); setPrimaryOutletId(o.id); }}
                              className={`p-0.5 rounded ${isPrimary ? "text-(--ui-warning-fg)" : "text-(--ui-text-muted) hover:text-(--ui-warning-fg)"}`}
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
                  {Object.keys(outletRoles).length > 0 && (
                    <p className="text-xs text-(--ui-text-muted)">
                      A role override applies only while working at that outlet; everywhere else the base role applies.
                    </p>
                  )}
                  {Object.values(outletRoles).some((rid) => Number(rid) === 1) && (
                    /* Step 13 verifier finding #11: an all_access override at ANY assigned outlet ≡ tenant admin. */
                    <p className="text-xs text-(--ui-warning-fg)">
                      An Administrator override at any outlet grants full admin access across the whole business — treat it the same as making this employee an Administrator.
                    </p>
                  )}
                </div>
              )}
          <ModalFooter>
            <Button type="button" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
            <Button tone="primary" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
      <Modal
        open={!!revokeTarget}
        onClose={revoking ? undefined : () => setRevokeTarget(null)}
        title="Revoke All Sessions"
        size="sm"
      >
        {revokeTarget ? (
          <>
            <p className="mb-3 text-sm text-(--ui-text-muted)">
              This will force <strong>{revokeTarget.name}</strong> to log in again on all devices. Are you sure?
            </p>
            <Input
              placeholder="Reason (optional)"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              className="mb-3"
            />
            <ModalFooter>
              <Button type="button" onClick={() => setRevokeTarget(null)} disabled={revoking}>Cancel</Button>
              <Button tone="danger" onClick={revokeAllSessions} disabled={revoking}>
                {revoking ? "Revoking..." : "Revoke All Sessions"}
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </Modal>
      <Modal
        open={!!passwordTarget}
        onClose={settingPassword ? undefined : () => setPasswordTarget(null)}
        title="Set Password"
        size="sm"
      >
        {passwordTarget ? (
          <>
            <p className="mb-3 text-sm text-(--ui-text-muted)">
              Set a dashboard login password for <strong>{passwordTarget.name}</strong>.
            </p>
            <div className="space-y-2 mb-3">
              <Input
                type="password"
                placeholder="New password (min 8 chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <Input
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {newPassword && confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-(--ui-danger-fg)">Passwords do not match</p>
              )}
              {newPassword && newPassword.length < 8 && (
                <p className="text-xs text-(--ui-danger-fg)">Min 8 characters</p>
              )}
            </div>
            <ModalFooter>
              <Button type="button" onClick={() => setPasswordTarget(null)} disabled={settingPassword}>Cancel</Button>
              <Button
                tone="primary"
                onClick={setPasswordForEmployee}
                disabled={settingPassword || newPassword.length < 8 || newPassword !== confirmPassword}
              >
                {settingPassword ? "Setting..." : "Set Password"}
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </Modal>
    </PageShell>
  );
}
