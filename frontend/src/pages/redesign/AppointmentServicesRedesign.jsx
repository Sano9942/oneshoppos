import { useState, useEffect, useCallback, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge, Input } from "../../ui/primitives";
import { Plus, Pencil, Clock, Users, X, Copy, ExternalLink, Link2, Armchair } from "lucide-react";
import { api } from "../../api";
import { readTenantSlug } from "../../auth/authStore";
import { API_BASE } from "../../config";

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
  const [form, setForm] = useState({ name: "", description: "", duration_minutes: 30, padding_minutes: 0, price: 0, requires_confirmation: false, max_advance_days: 30, staff_ids: [], resource_ids: [] });

  // F06 resources (chairs / beds / bays) — flag-gated section state
  const [resources, setResources] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [resourceForm, setResourceForm] = useState({ name: "", outlet_id: "", resource_type: "chair" });

  const loadServices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/booking-services");
      setServices(data.services || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, []);

  const loadEmployees = useCallback(async () => {
    try {
      const data = await api.get("/api/employees");
      setEmployees(data.employees || data || []);
    } catch {}
  }, []);

  const loadResources = useCallback(async () => {
    try {
      const data = await api.get("/api/booking-resources");
      setResources(data.resources || []);
    } catch { /* flag off or feature unavailable — section hides itself */ }
  }, []);

  const loadOutlets = useCallback(async () => {
    try {
      const data = await api.get("/api/outlets");
      setOutlets(data.outlets || data || []);
    } catch {}
  }, []);

  useEffect(() => { loadServices(); loadEmployees(); }, [loadServices, loadEmployees]);

  const resourcesEnabled = !!flags.phase4_appointments_resources;
  useEffect(() => {
    if (resourcesEnabled) { loadResources(); loadOutlets(); }
  }, [resourcesEnabled, loadResources, loadOutlets]);

  const tenantSlug = useMemo(() => readTenantSlug(), []);
  const publicBookingUrl = useMemo(() => {
    if (!tenantSlug) return null;
    const origin = typeof window !== "undefined" && window.location ? window.location.origin : "";
    return `${origin}/book/${tenantSlug}`;
  }, [tenantSlug]);
  const qrSrc = publicBookingUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(publicBookingUrl)}`
    : null;

  const copyBookingLink = async () => {
    if (!publicBookingUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(publicBookingUrl);
      } else {
        // Fallback for non-secure contexts
        const ta = document.createElement("textarea");
        ta.value = publicBookingUrl;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast.success("Booking link copied");
    } catch {
      toast.error("Could not copy link");
    }
  };

  if (flagsLoading) return null;
  if (!flags.phase4_appointments) return <Navigate to="/dashboard" replace />;

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", description: "", duration_minutes: 30, padding_minutes: 0, price: 0, requires_confirmation: false, max_advance_days: 30, staff_ids: [], resource_ids: [] });
    setShowModal(true);
  };

  const openEdit = (svc) => {
    setEditing(svc);
    setForm({
      name: svc.name, description: svc.description || "", duration_minutes: svc.duration_minutes,
      padding_minutes: svc.padding_minutes || 0, price: Number(svc.price) || 0,
      requires_confirmation: svc.requires_confirmation, max_advance_days: svc.max_advance_days || 30,
      staff_ids: (svc.staff || []).map(s => s.id),
      resource_ids: (svc.resources || []).map(r => r.id),
    });
    setShowModal(true);
  };

  const toggleStaff = (id) => {
    setForm(prev => ({
      ...prev,
      staff_ids: prev.staff_ids.includes(id) ? prev.staff_ids.filter(x => x !== id) : [...prev.staff_ids, id],
    }));
  };

  const toggleResource = (id) => {
    setForm(prev => ({
      ...prev,
      resource_ids: prev.resource_ids.includes(id) ? prev.resource_ids.filter(x => x !== id) : [...prev.resource_ids, id],
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
      let serviceId = editing?.id;
      if (editing) {
        await api.put(`/api/booking-services/${editing.id}`, payload);
        toast.success("Service updated");
      } else {
        const created = await api.post("/api/booking-services", payload);
        serviceId = created?.id;
        toast.success("Service created");
      }
      if (resourcesEnabled && serviceId) {
        await api.put(`/api/booking-services/${serviceId}/resources`, { resource_ids: form.resource_ids });
      }
      setShowModal(false);
      loadServices();
    } catch (err) { toast.error(err.message); }
  };

  const createResource = async () => {
    try {
      await api.post("/api/booking-resources", {
        name: resourceForm.name,
        outlet_id: Number(resourceForm.outlet_id),
        resource_type: resourceForm.resource_type || "chair",
      });
      toast.success("Resource added");
      setResourceForm({ name: "", outlet_id: resourceForm.outlet_id, resource_type: resourceForm.resource_type });
      loadResources();
    } catch (err) { toast.error(err.message); }
  };

  const toggleResourceActive = async (r) => {
    try {
      await api.put(`/api/booking-resources/${r.id}`, { is_active: !r.is_active });
      loadResources();
    } catch (err) { toast.error(err.message); }
  };

  // F06 — mint (or fetch existing) a per-employee ICS feed and copy the URL.
  const copyStaffFeed = async (emp) => {
    try {
      const data = await api.post(`/api/booking-staff/${emp.id}/ics-feed`, {});
      const url = `${API_BASE}${data.feed_path}`;
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      toast.success(`Calendar feed link for ${emp.name} copied — paste into Google/Apple Calendar as a URL subscription`);
    } catch (err) { toast.error(err.message); }
  };

  const toggleActive = async (svc) => {
    try {
      await api.put(`/api/booking-services/${svc.id}`, { is_active: !svc.is_active });
      toast.success(svc.is_active ? "Service deactivated" : "Service activated");
      loadServices();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <PageShell title="Booking Services" subtitle="Manage your service catalog" right={
      <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> New Service</Button>
    }>
      {publicBookingUrl && (
        <SectionCard className="mb-4">
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
            <div className="shrink-0">
              {qrSrc ? (
                <img
                  src={qrSrc}
                  alt="Public booking QR code"
                  width={120}
                  height={120}
                  className="rounded border border-(--ui-border) bg-(--ui-surface)"
                />
              ) : null}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-(--ui-text)">
                <Link2 className="w-4 h-4" />
                Public booking link
              </div>
              <p className="text-xs text-(--ui-text-muted) mt-1 mb-2">
                Share this URL on WhatsApp, Instagram, or your website so customers can book themselves.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <code className="block sm:flex-1 truncate rounded border border-(--ui-border) bg-(--ui-surface) px-3 py-1.5 text-xs text-(--ui-text)">
                  {publicBookingUrl}
                </code>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={copyBookingLink}>
                    <Copy className="w-3.5 h-3.5 mr-1" /> Copy
                  </Button>
                  <a
                    href={publicBookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-(--ui-border) text-(--ui-text-muted) hover:text-(--ui-text) hover:border-(--ui-accent)"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Test booking page
                  </a>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>
      )}
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

      {/* F06 — per-staff ICS calendar feeds */}
      {employees.length > 0 && (
        <SectionCard className="mt-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-(--ui-text) mb-1">
            <ExternalLink className="w-4 h-4" /> Staff calendar feeds
          </div>
          <p className="text-xs text-(--ui-text-muted) mb-3">
            Each staff member can subscribe to their appointments from Google or Apple Calendar. Copy their feed link and add it as a calendar-by-URL subscription.
          </p>
          <div className="flex flex-wrap gap-2">
            {employees.map(emp => (
              <Button key={emp.id} size="xs" variant="ghost" onClick={() => copyStaffFeed(emp)}>
                <Copy className="w-3 h-3 mr-1" /> {emp.name}
              </Button>
            ))}
          </div>
        </SectionCard>
      )}

      {/* F06 — Bookable resources (chairs / beds / bays) */}
      {resourcesEnabled && (
        <SectionCard className="mt-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-(--ui-text) mb-1">
            <Armchair className="w-4 h-4" /> Resources
          </div>
          <p className="text-xs text-(--ui-text-muted) mb-3">
            Chairs, beds, or bays a service occupies. A service linked to resources is only bookable when one is free — assigned automatically at booking.
          </p>
          {resources.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {resources.map(r => (
                <span key={r.id} className={`inline-flex items-center gap-2 px-3 py-1 text-xs rounded-full border ${r.is_active ? "border-(--ui-border) text-(--ui-text)" : "border-(--ui-border) text-(--ui-text-muted) line-through"}`}>
                  {r.name}
                  <span className="text-(--ui-text-muted)">{r.resource_type}{r.outlet_name ? ` · ${r.outlet_name}` : ""}</span>
                  <button type="button" onClick={() => toggleResourceActive(r)} className="text-(--ui-text-muted) hover:text-(--ui-text)" title={r.is_active ? "Deactivate" : "Activate"}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <Input value={resourceForm.name} onChange={e => setResourceForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Chair 1" className="sm:max-w-40" />
            <Input value={resourceForm.resource_type} onChange={e => setResourceForm(p => ({ ...p, resource_type: e.target.value }))} placeholder="Type (chair, bed, bay)" className="sm:max-w-40" />
            <select
              value={resourceForm.outlet_id}
              onChange={e => setResourceForm(p => ({ ...p, outlet_id: e.target.value }))}
              className="px-3 py-2 text-sm rounded-md border border-(--ui-border) bg-(--ui-surface) text-(--ui-text)"
            >
              <option value="">Outlet…</option>
              {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <Button size="sm" onClick={createResource} disabled={!resourceForm.name || !resourceForm.outlet_id}>
              <Plus className="w-4 h-4 mr-1" /> Add Resource
            </Button>
          </div>
        </SectionCard>
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

              {resourcesEnabled && resources.filter(r => r.is_active).length > 0 && (
                <div>
                  <label className="text-sm font-medium text-(--ui-text) mb-1 block">Required Resources</label>
                  <p className="text-xs text-(--ui-text-muted) mb-1">Bookings need any ONE of the selected resources free.</p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {resources.filter(r => r.is_active).map(r => (
                      <button key={r.id} type="button" onClick={() => toggleResource(r.id)}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${form.resource_ids.includes(r.id) ? "bg-(--ui-accent) text-white border-(--ui-accent)" : "border-(--ui-border) text-(--ui-text-muted) hover:border-(--ui-accent)"}`}>
                        {r.name}
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
