import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge, Input } from "../../ui/primitives";
import { Plus, Pencil, Clock, Users, X } from "lucide-react";
import { api } from "../../api";

export default function AppointmentServicesRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { fmt } = useCurrency();

  const [services, setServices] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", duration_minutes: 30, padding_minutes: 0, price: 0, requires_confirmation: false, max_advance_days: 30, staff_ids: [] });

  if (!flagsLoading && !flags.phase4_appointments) return <Navigate to="/dashboard" replace />;

  const loadServices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/booking-services");
      setServices(data.services || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, []);

  const loadEmployees = useCallback(async () => {
    try {
      const data = await api.get("/employees");
      setEmployees(data.employees || data || []);
    } catch {}
  }, []);

  useEffect(() => { loadServices(); loadEmployees(); }, [loadServices, loadEmployees]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", description: "", duration_minutes: 30, padding_minutes: 0, price: 0, requires_confirmation: false, max_advance_days: 30, staff_ids: [] });
    setShowModal(true);
  };

  const openEdit = (svc) => {
    setEditing(svc);
    setForm({
      name: svc.name, description: svc.description || "", duration_minutes: svc.duration_minutes,
      padding_minutes: svc.padding_minutes || 0, price: Number(svc.price) || 0,
      requires_confirmation: svc.requires_confirmation, max_advance_days: svc.max_advance_days || 30,
      staff_ids: (svc.staff || []).map(s => s.id),
    });
    setShowModal(true);
  };

  const toggleStaff = (id) => {
    setForm(prev => ({
      ...prev,
      staff_ids: prev.staff_ids.includes(id) ? prev.staff_ids.filter(x => x !== id) : [...prev.staff_ids, id],
    }));
  };

  const save = async () => {
    try {
      const payload = {
        name: form.name, description: form.description || undefined,
        duration_minutes: Number(form.duration_minutes), padding_minutes: Number(form.padding_minutes),
        price: Number(form.price), requires_confirmation: form.requires_confirmation,
        max_advance_days: Number(form.max_advance_days), staff_ids: form.staff_ids,
      };
      if (editing) {
        await api.put(`/booking-services/${editing.id}`, payload);
        toast.success("Service updated");
      } else {
        await api.post("/booking-services", payload);
        toast.success("Service created");
      }
      setShowModal(false);
      loadServices();
    } catch (err) { toast.error(err.message); }
  };

  const toggleActive = async (svc) => {
    try {
      await api.put(`/booking-services/${svc.id}`, { is_active: !svc.is_active });
      toast.success(svc.is_active ? "Service deactivated" : "Service activated");
      loadServices();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <PageShell title="Booking Services" subtitle="Manage your service catalog" right={
      <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> New Service</Button>
    }>
      {loading ? (
        <div className="text-center py-12 text-(--ui-text-muted)">Loading...</div>
      ) : services.length === 0 ? (
        <SectionCard>
          <div className="text-center py-8 text-(--ui-text-muted)">
            <p className="text-lg font-medium mb-1">No services yet</p>
            <p className="text-sm">Create your first booking service to get started.</p>
          </div>
        </SectionCard>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {services.map(svc => (
            <SectionCard key={svc.id}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-(--ui-text)">{svc.name}</h3>
                  {svc.description && <p className="text-xs text-(--ui-text-muted) mt-0.5">{svc.description}</p>}
                </div>
                <Badge tone={svc.is_active !== false ? "success" : "default"}>{svc.is_active !== false ? "Active" : "Inactive"}</Badge>
              </div>
              <div className="flex items-center gap-4 text-sm text-(--ui-text-muted) mb-3">
                <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {svc.duration_minutes}min</span>
                <span className="font-medium text-(--ui-text)">{fmt(svc.price)}</span>
              </div>
              {svc.staff?.length > 0 && (
                <div className="flex items-center gap-1 text-xs text-(--ui-text-muted) mb-3">
                  <Users className="w-3.5 h-3.5" />
                  {svc.staff.map(s => s.name).join(", ")}
                </div>
              )}
              <div className="flex gap-2 pt-2 border-t border-(--ui-border)">
                <Button size="xs" variant="ghost" onClick={() => openEdit(svc)}><Pencil className="w-3.5 h-3.5 mr-1" /> Edit</Button>
                <Button size="xs" variant="ghost" onClick={() => toggleActive(svc)}>
                  {svc.is_active !== false ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </SectionCard>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-(--ui-bg) border border-(--ui-border) rounded-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-(--ui-text)">{editing ? "Edit Service" : "New Service"}</h2>
              <button onClick={() => setShowModal(false)} className="text-(--ui-text-muted) hover:text-(--ui-text)"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-(--ui-text) mb-1 block">Name *</label>
                <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Haircut" />
              </div>
              <div>
                <label className="text-sm font-medium text-(--ui-text) mb-1 block">Description</label>
                <Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Optional description" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-(--ui-text) mb-1 block">Duration (min) *</label>
                  <Input type="number" value={form.duration_minutes} onChange={e => setForm(p => ({ ...p, duration_minutes: e.target.value }))} min={5} />
                </div>
                <div>
                  <label className="text-sm font-medium text-(--ui-text) mb-1 block">Buffer (min)</label>
                  <Input type="number" value={form.padding_minutes} onChange={e => setForm(p => ({ ...p, padding_minutes: e.target.value }))} min={0} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-(--ui-text) mb-1 block">Price</label>
                  <Input type="number" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} min={0} step="0.01" />
                </div>
                <div>
                  <label className="text-sm font-medium text-(--ui-text) mb-1 block">Max Advance Days</label>
                  <Input type="number" value={form.max_advance_days} onChange={e => setForm(p => ({ ...p, max_advance_days: e.target.value }))} min={1} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="reqConfirm" checked={form.requires_confirmation} onChange={e => setForm(p => ({ ...p, requires_confirmation: e.target.checked }))} className="rounded" />
                <label htmlFor="reqConfirm" className="text-sm text-(--ui-text)">Requires confirmation</label>
              </div>

              {employees.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-(--ui-text) mb-1 block">Assigned Staff</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {employees.map(emp => (
                      <button key={emp.id} type="button" onClick={() => toggleStaff(emp.id)}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${form.staff_ids.includes(emp.id) ? "bg-(--ui-accent) text-white border-(--ui-accent)" : "border-(--ui-border) text-(--ui-text-muted) hover:border-(--ui-accent)"}`}>
                        {emp.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button onClick={save} disabled={!form.name || !form.duration_minutes}>{editing ? "Update" : "Create"}</Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
