import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge, Input, Select, EmptyState, Modal, ModalFooter } from "../../ui/primitives";
import { BellRing, CalendarPlus, Check, X, Send } from "lucide-react";
import { api } from "../../api";

/**
 * V05 — Recall / continuing-care: the overdue-patients screen.
 * Filter by type/age/status, one-click contact (fires SMS/email outreach via
 * the notification engine), book (creates/links an appointment — booking from
 * a recall completes it and re-arms the interval on visit completion), dismiss.
 */

const STATUS_TONES = {
  due: "warning",
  contacted: "default",
  booked: "success",
  completed: "success",
  dismissed: "default",
};

const VIEWS = [
  ["overdue", "Overdue"],
  ["open", "All open"],
  ["all", "Everything"],
];

function typeLabel(t) {
  const s = String(t || "");
  if (s.startsWith("vaccination")) {
    const name = s.includes(":") ? s.split(":")[1].replace(/_/g, " ") : "";
    return name ? `Vaccine — ${name}` : "Vaccination";
  }
  return s.replace(/_/g, " ");
}

export default function RecallsRedesign() {
  const { isAuthenticated, hasPerm } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags();
  const toast = useToast();

  const [recalls, setRecalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("overdue");
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [booking, setBooking] = useState(null); // recall being booked
  const [busyId, setBusyId] = useState(null);

  const canWrite = hasPerm("manage_treatment_plans");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (view === "overdue") params.overdue = "1";
      if (view === "open") params.open = "1";
      if (typeFilter) params.type = typeFilter;
      if (search) params.q = search;
      const res = await api.get("/api/recalls", params);
      setRecalls(res.recalls || []);
    } catch (err) {
      toast.error(err.message || "Failed to load recalls");
    } finally {
      setLoading(false);
    }
  }, [view, typeFilter, search, toast]);

  useEffect(() => { load(); }, [load]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!hasPerm("manage_treatment_plans") && !hasPerm("view_customer_reports")) return <Navigate to="/access-denied" replace />;
  if (flagsLoading) return null;
  if (!flags.clinical_recalls) return <Navigate to="/dashboard" replace />;

  const contact = async (r) => {
    setBusyId(r.id);
    try {
      const res = await api.put(`/api/recalls/${r.id}/contact`, {});
      const sent = (res.dispatched || []).filter((d) => ["sent", "queued"].includes(d.status));
      if (sent.length) {
        toast.success(`Outreach sent via ${sent.map((d) => d.channel).join(" + ")}`);
      } else if (res.reason === "disabled") {
        toast.warning("Contact logged — customer notifications are disabled, nothing was sent");
      } else {
        toast.warning("Contact logged — no channel could deliver (check customer email/mobile)");
      }
      load();
    } catch (err) {
      toast.error(err.message || "Contact failed");
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (r) => {
    if (!window.confirm(`Dismiss this recall for ${r.customer_name}?`)) return;
    setBusyId(r.id);
    try {
      await api.put(`/api/recalls/${r.id}/dismiss`, {});
      toast.success("Recall dismissed");
      load();
    } catch (err) {
      toast.error(err.message || "Dismiss failed");
    } finally {
      setBusyId(null);
    }
  };

  const complete = async (r) => {
    setBusyId(r.id);
    try {
      const res = await api.put(`/api/recalls/${r.id}/complete`, {});
      toast.success(res.next ? "Completed — next cycle armed" : "Recall completed");
      load();
    } catch (err) {
      toast.error(err.message || "Complete failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageShell
      title="Recalls"
      subtitle="Continuing care — patients due back for checkups, hygiene visits and vaccinations"
    >
      <div className="space-y-4">
        <SectionCard>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-(--ui-text-muted) mb-1">View</label>
              <Select value={view} onChange={(e) => setView(e.target.value)}>
                {VIEWS.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs text-(--ui-text-muted) mb-1">Type</label>
              <Input
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                placeholder="checkup, hygiene…"
                className="w-40"
              />
            </div>
            <div className="grow">
              <label className="block text-xs text-(--ui-text-muted) mb-1">Search patient</label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or mobile…"
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard>
          {loading ? (
            <div className="py-6 text-center text-(--ui-text-muted)">Loading…</div>
          ) : recalls.length === 0 ? (
            <EmptyState
              icon={BellRing}
              title={view === "overdue" ? "No overdue patients" : "No recalls"}
              body="Recalls arm automatically when a treatment plan with a recall interval completes, or when a vaccination has a next-due date."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-(--ui-text-muted) border-b">
                    <th className="py-2">Patient</th>
                    <th>Subject</th>
                    <th>Recall</th>
                    <th>Due</th>
                    <th>Overdue</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recalls.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-(--ui-muted-surface)">
                      <td className="py-2">
                        <div>{r.customer_name}</div>
                        <div className="text-xs text-(--ui-text-muted)">{r.customer_mobile || r.customer_email || "no contact info"}</div>
                      </td>
                      <td>{r.subject_name || "—"}</td>
                      <td className="capitalize">{typeLabel(r.recall_type)}</td>
                      <td className="text-xs">{r.due_date}</td>
                      <td>
                        {Number(r.days_overdue) > 0 && ["due", "contacted"].includes(r.status) ? (
                          <Badge tone="danger">{r.days_overdue}d</Badge>
                        ) : (
                          <span className="text-(--ui-text-muted)">—</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={STATUS_TONES[r.status] || "default"}>{r.status}</Badge>
                      </td>
                      <td className="text-xs text-(--ui-text-muted)">{r.contact_attempts || 0}</td>
                      <td>
                        {canWrite && (
                          <div className="flex gap-1 justify-end">
                            {["due", "contacted"].includes(r.status) && (
                              <>
                                <Button size="sm" disabled={busyId === r.id} onClick={() => contact(r)}>
                                  <Send className="w-3.5 h-3.5 mr-1 inline" /> Contact
                                </Button>
                                <Button size="sm" disabled={busyId === r.id} onClick={() => setBooking(r)}>
                                  <CalendarPlus className="w-3.5 h-3.5 mr-1 inline" /> Book
                                </Button>
                                <Button size="sm" tone="plain" disabled={busyId === r.id} onClick={() => dismiss(r)}>
                                  <X className="w-3.5 h-3.5" />
                                </Button>
                              </>
                            )}
                            {r.status === "booked" && (
                              <Button size="sm" disabled={busyId === r.id} onClick={() => complete(r)}>
                                <Check className="w-3.5 h-3.5 mr-1 inline" /> Complete
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      {booking && (
        <BookRecallModal
          recall={booking}
          onClose={() => setBooking(null)}
          onBooked={() => { setBooking(null); load(); }}
        />
      )}
    </PageShell>
  );
}

function BookRecallModal({ recall, onClose, onBooked }) {
  const toast = useToast();
  const [scheduledAt, setScheduledAt] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = appointmentId
        ? { appointment_id: Number(appointmentId) }
        : { scheduled_at: scheduledAt };
      await api.post(`/api/recalls/${recall.id}/book`, body);
      toast.success("Recall booked — it completes and re-arms when the visit happens");
      onBooked();
    } catch (err) {
      toast.error(err.message || "Booking failed — create the appointment in Appointments first, then link its number here");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={saving ? undefined : onClose} title={`Book — ${recall.customer_name}`} size="sm">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-xs text-(--ui-text-muted) mb-1">Date & time</label>
          <Input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            disabled={!!appointmentId}
          />
        </div>
        <div className="text-center text-xs text-(--ui-text-muted)">— or link an existing appointment —</div>
        <div>
          <label className="block text-xs text-(--ui-text-muted) mb-1">Appointment #</label>
          <Input
            type="number"
            min="1"
            value={appointmentId}
            onChange={(e) => setAppointmentId(e.target.value)}
            placeholder="Created via the Appointments page"
          />
        </div>
        <ModalFooter>
          <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button tone="primary" type="submit" disabled={saving || (!scheduledAt && !appointmentId)}>
            Book
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
