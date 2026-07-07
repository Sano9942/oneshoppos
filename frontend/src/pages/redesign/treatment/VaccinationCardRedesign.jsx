import { useState, useEffect, useCallback } from "react";
import { Navigate, useParams, Link } from "react-router-dom";
import { useAuth } from "../../../auth/AuthProvider";
import useFeatureFlags from "../../../hooks/useFeatureFlags";
import { useToast } from "../../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge, Input, EmptyState, Modal, ModalFooter } from "../../../ui/primitives";
import { Syringe, Printer, Plus, ArrowLeft } from "lucide-react";
import { api } from "../../../api";

/**
 * V05 — per-pet vaccination card (vet). Records newest-first, upcoming
 * vaccination recalls, administer form (writes the record + arms the next-due
 * recall), and a printable card (self-contained print window, same approach
 * as receipts — the app shell never prints).
 */

function printCard(card, storeName) {
  const { subject, records } = card;
  const rows = records
    .map(
      (r) => `<tr>
        <td>${r.administered_at || ""}</td>
        <td>${escapeHtml(r.vaccine_name)}</td>
        <td>${r.batch_number ? escapeHtml(r.batch_number) : ""}</td>
        <td>${r.next_due || ""}</td>
        <td>${r.administered_by_name ? escapeHtml(r.administered_by_name) : ""}</td>
      </tr>`
    )
    .join("");
  const html = `<!doctype html><html><head><title>Vaccination card — ${escapeHtml(subject.name)}</title>
    <style>
      body { font-family: Inter, system-ui, sans-serif; color: #101010; padding: 24px; }
      h1 { font-size: 18px; margin: 0 0 2px; }
      .sub { color: #6b7280; font-size: 12px; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e3e3e3; }
      th { color: #6b7280; font-weight: 600; }
      .meta { font-size: 12px; margin-bottom: 12px; }
    </style></head><body>
    <h1>Vaccination Card — ${escapeHtml(subject.name)}</h1>
    <div class="sub">${escapeHtml(storeName || "")}</div>
    <div class="meta">
      ${subject.species ? `Species: ${escapeHtml(subject.species)} · ` : ""}
      ${subject.breed ? `Breed: ${escapeHtml(subject.breed)} · ` : ""}
      ${subject.dob ? `DOB: ${String(subject.dob).slice(0, 10)} · ` : ""}
      Owner: ${escapeHtml(subject.owner_name || "")}
    </div>
    <table><thead><tr><th>Date</th><th>Vaccine</th><th>Batch</th><th>Next due</th><th>By</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <script>window.onload = () => window.print();</script>
  </body></html>`;
  const w = window.open("", "_blank", "width=720,height=900");
  if (w) { w.document.write(html); w.document.close(); }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export default function VaccinationCardRedesign() {
  const { subjectId } = useParams();
  const { isAuthenticated, hasPerm, company } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags();
  const toast = useToast();
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [administering, setAdministering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/patient-subjects/${subjectId}/vaccination-card`);
      setCard(res);
    } catch (err) {
      toast.error(err.message || "Failed to load vaccination card");
    } finally {
      setLoading(false);
    }
  }, [subjectId, toast]);

  useEffect(() => { load(); }, [load]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!hasPerm("manage_treatment_plans") && !hasPerm("view_reports")) return <Navigate to="/access-denied" replace />;
  if (flagsLoading) return null;
  if (!flags.vet_vaccinations) return <Navigate to="/dashboard" replace />;

  const subject = card?.subject;

  return (
    <PageShell
      title={subject ? `Vaccination card — ${subject.name}` : "Vaccination card"}
      subtitle={subject ? [subject.species, subject.breed, subject.owner_name && `Owner: ${subject.owner_name}`].filter(Boolean).join(" · ") : ""}
      right={
        <div className="flex gap-2">
          <Link to="/recalls"><Button size="sm" tone="plain"><ArrowLeft className="w-4 h-4 mr-1 inline" /> Recalls</Button></Link>
          {hasPerm("manage_treatment_plans") && (
            <Button size="sm" onClick={() => setAdministering(true)}>
              <Plus className="w-4 h-4 mr-1 inline" /> Administer
            </Button>
          )}
          <Button size="sm" tone="primary" disabled={!card} onClick={() => printCard(card, company?.trading_name || company?.company_name)}>
            <Printer className="w-4 h-4 mr-1 inline" /> Print card
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {card?.upcoming?.length > 0 && (
          <SectionCard>
            <div className="text-sm font-semibold mb-2">Upcoming</div>
            <div className="flex flex-wrap gap-2">
              {card.upcoming.map((u) => (
                <Badge key={u.id} tone="warning">
                  {String(u.recall_type).replace("vaccination:", "").replace(/_/g, " ")} — due {u.due_date}
                </Badge>
              ))}
            </div>
          </SectionCard>
        )}

        <SectionCard>
          {loading ? (
            <div className="py-6 text-center text-(--ui-text-muted)">Loading…</div>
          ) : !card?.records?.length ? (
            <EmptyState
              icon={Syringe}
              title="No vaccinations on record"
              body="Administer the first vaccine — the card fills in and the next-due reminder arms automatically."
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-(--ui-text-muted) border-b">
                  <th className="py-2">Date</th>
                  <th>Vaccine</th>
                  <th>Batch</th>
                  <th>Next due</th>
                  <th>Administered by</th>
                </tr>
              </thead>
              <tbody>
                {card.records.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="py-2 text-xs">{r.administered_at}</td>
                    <td className="font-medium">{r.vaccine_name}</td>
                    <td className="text-xs text-(--ui-text-muted)">{r.batch_number || "—"}</td>
                    <td className="text-xs">{r.next_due || "—"}</td>
                    <td className="text-xs text-(--ui-text-muted)">{r.administered_by_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      {administering && (
        <AdministerModal
          subjectId={Number(subjectId)}
          onClose={() => setAdministering(false)}
          onDone={() => { setAdministering(false); load(); }}
        />
      )}
    </PageShell>
  );
}

function AdministerModal({ subjectId, onClose, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({
    vaccine_name: "",
    administered_at: new Date().toISOString().slice(0, 10),
    next_due: "",
    batch_number: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/api/vaccinations", {
        patient_subject_id: subjectId,
        vaccine_name: form.vaccine_name.trim(),
        administered_at: form.administered_at || undefined,
        next_due: form.next_due || null,
        batch_number: form.batch_number.trim() || null,
        notes: form.notes.trim() || null,
      });
      toast.success(form.next_due ? "Recorded — next-due reminder armed" : "Vaccination recorded");
      onDone();
    } catch (err) {
      toast.error(err.message || "Failed to record vaccination");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={saving ? undefined : onClose} title="Administer vaccine" size="sm">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-xs text-(--ui-text-muted) mb-1">Vaccine</label>
          <Input required value={form.vaccine_name} onChange={set("vaccine_name")} placeholder="Rabies, Distemper…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-(--ui-text-muted) mb-1">Administered</label>
            <Input type="date" value={form.administered_at} onChange={set("administered_at")} />
          </div>
          <div>
            <label className="block text-xs text-(--ui-text-muted) mb-1">Next due</label>
            <Input type="date" value={form.next_due} onChange={set("next_due")} />
          </div>
        </div>
        <div>
          <label className="block text-xs text-(--ui-text-muted) mb-1">Batch #</label>
          <Input value={form.batch_number} onChange={set("batch_number")} placeholder="Optional" />
        </div>
        <div>
          <label className="block text-xs text-(--ui-text-muted) mb-1">Notes</label>
          <Input value={form.notes} onChange={set("notes")} placeholder="Optional" />
        </div>
        <ModalFooter>
          <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button tone="primary" type="submit" disabled={saving || !form.vaccine_name.trim()}>Record</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
