import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge, Input, Select, EmptyState, Modal, ModalFooter } from "../../ui/primitives";
import { FileText, Upload, Send, Trash2 } from "lucide-react";
import { api } from "../../api";

/**
 * V05 — physio home-exercise / handout library. A reusable document library
 * (PDFs/images, title + tags) with attach-to-patient delivery: assigning a
 * handout makes it visible in the patient portal and emails them the link.
 * Deliberately NOT an exercise builder.
 */
export default function HandoutsRedesign() {
  const { isAuthenticated, hasPerm } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags();
  const toast = useToast();

  const [handouts, setHandouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [assigning, setAssigning] = useState(null);

  const canWrite = hasPerm("manage_treatment_plans");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/handouts", search ? { q: search } : {});
      setHandouts(res.handouts || []);
    } catch (err) {
      toast.error(err.message || "Failed to load handouts");
    } finally {
      setLoading(false);
    }
  }, [search, toast]);

  useEffect(() => { load(); }, [load]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!hasPerm("manage_treatment_plans") && !hasPerm("view_reports")) return <Navigate to="/access-denied" replace />;
  if (flagsLoading) return null;
  if (!flags.clinical_handouts) return <Navigate to="/dashboard" replace />;

  const remove = async (h) => {
    if (!window.confirm(`Remove "${h.title}" from the library?`)) return;
    try {
      await api.del(`/api/handouts/${h.id}`);
      toast.success("Handout removed");
      load();
    } catch (err) {
      toast.error(err.message || "Delete failed");
    }
  };

  return (
    <PageShell
      title="Handouts"
      subtitle="Home-exercise programs and patient documents — share to the portal with one click"
      right={canWrite && (
        <Button size="sm" tone="primary" onClick={() => setUploading(true)}>
          <Upload className="w-4 h-4 mr-1 inline" /> Upload
        </Button>
      )}
    >
      <div className="space-y-4">
        <SectionCard>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or tag…"
          />
        </SectionCard>

        <SectionCard>
          {loading ? (
            <div className="py-6 text-center text-(--ui-text-muted)">Loading…</div>
          ) : handouts.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No handouts yet"
              body="Upload exercise sheets or care instructions once — then deliver them to any patient's portal in one click."
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-(--ui-text-muted) border-b">
                  <th className="py-2">Title</th>
                  <th>Tags</th>
                  <th>Type</th>
                  <th>Shared</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {handouts.map((h) => (
                  <tr key={h.id} className="border-b hover:bg-(--ui-muted-surface)">
                    <td className="py-2">
                      <a href={h.file_url} target="_blank" rel="noreferrer" className="text-(--ui-link) hover:underline">
                        {h.title}
                      </a>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {(h.tags || []).map((t) => <Badge key={t}>{t}</Badge>)}
                      </div>
                    </td>
                    <td className="text-xs text-(--ui-text-muted)">{h.file_mime || "—"}</td>
                    <td className="text-xs text-(--ui-text-muted)">{h.assignment_count || 0}×</td>
                    <td>
                      {canWrite && (
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" onClick={() => setAssigning(h)}>
                            <Send className="w-3.5 h-3.5 mr-1 inline" /> Share
                          </Button>
                          <Button size="sm" tone="plain" onClick={() => remove(h)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      {uploading && <UploadModal onClose={() => setUploading(false)} onDone={() => { setUploading(false); load(); }} />}
      {assigning && <AssignModal handout={assigning} onClose={() => setAssigning(null)} onDone={() => { setAssigning(null); load(); }} />}
    </PageShell>
  );
}

function UploadModal({ onClose, onDone }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title.trim());
      fd.append("tags", tags);
      await api.upload("/api/handouts", fd);
      toast.success("Handout uploaded");
      onDone();
    } catch (err) {
      toast.error(err.message || "Upload failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={saving ? undefined : onClose} title="Upload handout" size="sm">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-xs text-(--ui-text-muted) mb-1">Title</label>
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Knee rehab — week 1" />
        </div>
        <div>
          <label className="block text-xs text-(--ui-text-muted) mb-1">Tags (comma-separated)</label>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="knee, post-op" />
        </div>
        <div>
          <label className="block text-xs text-(--ui-text-muted) mb-1">File (PDF or image, max 25MB)</label>
          <input
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-(--ui-text)"
          />
        </div>
        <ModalFooter>
          <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button tone="primary" type="submit" disabled={saving || !file || !title.trim()}>Upload</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function AssignModal({ handout, onClose, onDone }) {
  const toast = useToast();
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/api/customers").then((d) => setCustomers(d.customers || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!customerId) { setSubjects([]); setSubjectId(""); return; }
    api.get("/api/patient-subjects", { customer_id: customerId })
      .then((d) => setSubjects(d.subjects || []))
      .catch(() => setSubjects([]));
  }, [customerId]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/api/handouts/${handout.id}/assign`, {
        customer_id: Number(customerId),
        patient_subject_id: subjectId ? Number(subjectId) : null,
      });
      toast.success("Shared — visible in the patient portal, email on its way");
      onDone();
    } catch (err) {
      toast.error(err.message || "Share failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={saving ? undefined : onClose} title={`Share "${handout.title}"`} size="sm">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-xs text-(--ui-text-muted) mb-1">Patient</label>
          <Select required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select patient…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        {subjects.length > 0 && (
          <div>
            <label className="block text-xs text-(--ui-text-muted) mb-1">Subject (optional)</label>
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Whole account</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
        )}
        <ModalFooter>
          <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button tone="primary" type="submit" disabled={saving || !customerId}>Share</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
