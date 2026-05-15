import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../api";
import { useToast } from "../../../contexts/ToastContext";
import { useCurrency } from "../../../contexts/CurrencyContext";
import {
  Badge,
  Button,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  Select,
  TableToolbar,
} from "../../../ui/primitives";
import { fmtUtcDateTime, localDateStr, todayLocalStr } from "../../../utils/dates";
import FilterCriteriaBuilder from "./FilterCriteriaBuilder";

function formatDate(v) {
  if (!v) return "—";
  if (v instanceof Date) return localDateStr(v);
  if (typeof v === "string") return v.slice(0, 10);
  return String(v);
}

function emptyForm() {
  return {
    name: "",
    recurrence: "weekly",
    next_due_date: todayLocalStr(),
    filter_criteria: {},
    is_active: true,
  };
}

export default function CycleCountsTab() {
  const navigate = useNavigate();
  const toast = useToast();
  const { fmt } = useCurrency();
  const [schedules, setSchedules] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [outlets, setOutlets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      api.get("/api/inventory-intelligence/cycle-schedules"),
      api.get("/api/inventory-intelligence/cycle-sessions"),
    ])
      .then(([s1, s2]) => {
        setSchedules(s1.schedules || []);
        setSessions(s2.sessions || []);
        setError(null);
      })
      .catch((err) => setError(err.message || "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // Load lookups for the filter builder — all optional, failures ignored.
    api.get("/api/outlets").then((r) => setOutlets(r.outlets || r || [])).catch(() => {});
    api
      .get("/api/categories")
      .then((r) => setCategories(r.categories || r || []))
      .catch(() => {});
    api.get("/api/brands").then((r) => setBrands(r.brands || r || [])).catch(() => {});
    api.get("/api/suppliers").then((r) => setSuppliers(r.suppliers || r || [])).catch(() => {});
    refresh();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (s) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      recurrence: s.recurrence,
      next_due_date: formatDate(s.next_due_date),
      filter_criteria: s.filter_criteria || {},
      is_active: s.is_active,
    });
    setModalOpen(true);
  };

  const saveSchedule = async () => {
    if (!form.name.trim()) {
      toast.warning("Name is required.");
      return;
    }
    if (!form.filter_criteria.outlet_id) {
      toast.warning("Pick an outlet for this schedule.");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/api/inventory-intelligence/cycle-schedules/${editingId}`, form);
        toast.success("Schedule updated.");
      } else {
        await api.post(`/api/inventory-intelligence/cycle-schedules`, form);
        toast.success("Schedule created.");
      }
      setModalOpen(false);
      refresh();
    } catch (err) {
      toast.error(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const disableSchedule = async (s) => {
    try {
      await api.put(`/api/inventory-intelligence/cycle-schedules/${s.id}`, {
        is_active: !s.is_active,
      });
      refresh();
    } catch (err) {
      toast.error(err.message || "Toggle failed");
    }
  };

  const deleteSchedule = async (s) => {
    if (!window.confirm(`Delete schedule "${s.name}"? Any open count keeps running.`)) return;
    try {
      await api.del(`/api/inventory-intelligence/cycle-schedules/${s.id}`);
      toast.success("Schedule deleted.");
      refresh();
    } catch (err) {
      toast.error(err.message || "Delete failed");
    }
  };

  const startNow = async (s) => {
    try {
      const res = await api.post(
        `/api/inventory-intelligence/cycle-schedules/${s.id}/start-session`,
        {}
      );
      toast.success("Count started.");
      navigate(`/stock-counts?id=${res.stock_count_id}`);
    } catch (err) {
      toast.error(err.message || "Start failed");
    }
  };

  const varianceTotal = sessions.reduce((sum, s) => sum + (Number(s.variance_value) || 0), 0);
  const completedCount = sessions.filter((s) => s.completed_at).length;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-(--ui-danger)">{error}</p>}

      {/* Schedules */}
      <section className="space-y-3">
        <TableToolbar
          left={<h3 className="text-sm font-semibold text-(--ui-text)">Schedules</h3>}
          right={
            <Button tone="primary" size="sm" onClick={openCreate}>
              New schedule
            </Button>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--ui-border) text-left text-xs font-semibold uppercase text-(--ui-text-muted)">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Recurrence</th>
                <th className="px-3 py-2">Next due</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-(--ui-text-muted)">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && schedules.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-(--ui-text-muted)">
                    No schedules yet. Click “New schedule” to plan a recurring cycle count.
                  </td>
                </tr>
              )}
              {!loading &&
                schedules.map((s) => (
                  <tr key={s.id} className="border-b border-(--ui-border)">
                    <td className="px-3 py-2">{s.name}</td>
                    <td className="px-3 py-2 capitalize">{s.recurrence}</td>
                    <td className="px-3 py-2">{formatDate(s.next_due_date)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={s.is_active ? "success" : "default"}>
                        {s.is_active ? "Active" : "Paused"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button tone="primary" size="sm" onClick={() => startNow(s)}>
                          Start now
                        </Button>
                        <Button tone="plain" size="sm" onClick={() => openEdit(s)}>
                          Edit
                        </Button>
                        <Button tone="plain" size="sm" onClick={() => disableSchedule(s)}>
                          {s.is_active ? "Pause" : "Resume"}
                        </Button>
                        <Button tone="danger" size="sm" onClick={() => deleteSchedule(s)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Sessions */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-(--ui-text)">Recent sessions</h3>
          <div className="text-xs text-(--ui-text-muted)">
            Completed: {completedCount} · Variance total: {fmt(varianceTotal)}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--ui-border) text-left text-xs font-semibold uppercase text-(--ui-text-muted)">
                <th className="px-3 py-2">Schedule</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Completed</th>
                <th className="px-3 py-2 text-right">Variance units</th>
                <th className="px-3 py-2 text-right">Variance value</th>
                <th className="px-3 py-2">Assigned</th>
              </tr>
            </thead>
            <tbody>
              {!loading && sessions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-(--ui-text-muted)">
                    No sessions yet.
                  </td>
                </tr>
              )}
              {!loading &&
                sessions.map((s) => (
                  <tr key={s.id} className="border-b border-(--ui-border)">
                    <td className="px-3 py-2">{s.schedule_name || "—"}</td>
                    <td className="px-3 py-2">{fmtUtcDateTime(s.started_at)}</td>
                    <td className="px-3 py-2">
                      {s.completed_at ? (
                        fmtUtcDateTime(s.completed_at)
                      ) : (
                        <Badge tone="warning">In progress</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{s.variance_units ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {s.variance_value != null ? fmt(s.variance_value) : "—"}
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {s.assigned_to_name || "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* New/Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Edit schedule" : "New cycle count schedule"}
        size="lg"
      >
        <ModalBody>
          <label className="block space-y-1 text-sm">
            <span className="text-(--ui-text-muted)">Name</span>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Weekly A-rank at Main Store"
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-(--ui-text-muted)">Recurrence</span>
              <Select
                value={form.recurrence}
                onChange={(e) => setForm({ ...form, recurrence: e.target.value })}
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-(--ui-text-muted)">Next due date</span>
              <Input
                type="date"
                value={form.next_due_date}
                onChange={(e) => setForm({ ...form, next_due_date: e.target.value })}
              />
            </label>
          </div>
          <div>
            <span className="block text-sm font-semibold text-(--ui-text)">Filter criteria</span>
            <p className="mb-2 text-xs text-(--ui-text-muted)">
              Outlet is required. Other fields narrow the product set further.
            </p>
            <FilterCriteriaBuilder
              value={form.filter_criteria}
              onChange={(v) => setForm({ ...form, filter_criteria: v })}
              outlets={outlets}
              categories={categories}
              brands={brands}
              suppliers={suppliers}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button tone="plain" onClick={() => setModalOpen(false)}>
            Cancel
          </Button>
          <Button tone="primary" onClick={saveSchedule} disabled={saving}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Create schedule"}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
