import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { useToast } from "../../contexts/ToastContext";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import {
  PageShell,
  SectionCard,
  Button,
  Input,
  Select,
  Modal,
  ModalBody,
  ModalFooter,
  Badge,
  TabBar,
  ConfirmDialog,
} from "../../ui/primitives";
import FormFieldRenderer, { FormAnswersView } from "../../components/forms/FormFieldRenderer";
import { fmtUtcDateTime } from "../../utils/dates";

const FIELD_TYPES = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "select", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "number", label: "Number" },
  { value: "signature_ack", label: "Acknowledgement" },
];
const ENTITY_SCOPES = [
  { value: "customer", label: "Customer" },
  { value: "appointment", label: "Appointment" },
  { value: "service_ticket", label: "Service ticket" },
  { value: "project", label: "Project" },
  { value: "membership", label: "Membership" },
  { value: "patient_subject", label: "Patient" },
];

const slug = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || `field_${Date.now().toString(36)}`;

function blankField() {
  return { key: "", label: "", type: "text", required: false, options: [] };
}

function TemplateEditor({ initial, onSaved, onClose }) {
  const { error, success } = useToast();
  const [name, setName] = useState(initial?.name || "");
  const [entityScope, setEntityScope] = useState(initial?.entity_scope || "customer");
  const [requireSig, setRequireSig] = useState(!!initial?.require_signature);
  const [autoAttach, setAutoAttach] = useState(initial?.auto_attach || "");
  const [fields, setFields] = useState(
    initial?.fields?.length ? initial.fields.map((f) => ({ ...f, options: f.options || [] })) : [blankField()]
  );
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState({});

  const updateField = (i, patch) =>
    setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const removeField = (i) => setFields((fs) => fs.filter((_, idx) => idx !== i));
  const addField = () => setFields((fs) => [...fs, blankField()]);
  const move = (i, dir) =>
    setFields((fs) => {
      const j = i + dir;
      if (j < 0 || j >= fs.length) return fs;
      const copy = [...fs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const cleanFields = useMemo(
    () =>
      fields
        .filter((f) => f.label.trim())
        .map((f) => ({
          key: f.key?.trim() || slug(f.label),
          label: f.label.trim(),
          type: f.type,
          required: !!f.required,
          ...(f.type === "select" ? { options: (f.options || []).filter(Boolean) } : {}),
        })),
    [fields]
  );

  const save = async () => {
    if (!name.trim()) return error("Give the form a name");
    if (cleanFields.length === 0) return error("Add at least one field");
    const bad = cleanFields.find((f) => f.type === "select" && (!f.options || !f.options.length));
    if (bad) return error(`Dropdown "${bad.label}" needs at least one option`);
    // enforce unique keys
    const keys = new Set();
    for (const f of cleanFields) {
      if (keys.has(f.key)) return error(`Duplicate field key: ${f.key}`);
      keys.add(f.key);
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        entity_scope: entityScope,
        require_signature: requireSig,
        auto_attach: autoAttach.trim() || null,
        fields: cleanFields,
      };
      const saved = initial?.id
        ? await api.put(`/api/forms/templates/${initial.id}`, payload)
        : await api.post("/api/forms/templates", payload);
      success(initial?.id ? "Form updated" : "Form created");
      onSaved(saved);
    } catch (e) {
      error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial?.id ? "Edit form" : "New form"} size="xl">
      <ModalBody>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Editor */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Form name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New Patient Intake" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Attach to</label>
                <Select value={entityScope} onChange={(e) => setEntityScope(e.target.value)}>
                  {ENTITY_SCOPES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Auto-attach trigger</label>
                <Input
                  value={autoAttach}
                  onChange={(e) => setAutoAttach(e.target.value)}
                  placeholder="e.g. first_appointment"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={requireSig} onChange={(e) => setRequireSig(e.target.checked)} />
              Require a drawn signature
            </label>

            <div className="border-t border-(--ui-border) pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold">Fields</h4>
                <Button size="sm" onClick={addField}>
                  + Add field
                </Button>
              </div>
              <div className="space-y-3">
                {fields.map((f, i) => (
                  <div key={i} className="rounded border border-(--ui-border) p-3 space-y-2">
                    <div className="flex gap-2">
                      <Input
                        className="flex-1"
                        placeholder="Field label"
                        value={f.label}
                        onChange={(e) => updateField(i, { label: e.target.value, key: f.key || slug(e.target.value) })}
                      />
                      <Select
                        value={f.type}
                        onChange={(e) => updateField(i, { type: e.target.value })}
                        className="w-40"
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    {f.type === "select" && (
                      <Input
                        placeholder="Options (comma-separated)"
                        value={(f.options || []).join(", ")}
                        onChange={(e) =>
                          updateField(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })
                        }
                      />
                    )}
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!!f.required}
                          onChange={(e) => updateField(i, { required: e.target.checked })}
                        />
                        Required
                      </label>
                      <div className="flex gap-1">
                        <Button size="sm" tone="plain" onClick={() => move(i, -1)}>
                          ↑
                        </Button>
                        <Button size="sm" tone="plain" onClick={() => move(i, 1)}>
                          ↓
                        </Button>
                        <Button size="sm" tone="danger" onClick={() => removeField(i)}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Live preview */}
          <div>
            <h4 className="font-semibold mb-2">Preview</h4>
            <SectionCard className="p-4">
              <div className="font-semibold mb-3">{name || "Untitled form"}</div>
              <FormFieldRenderer fields={cleanFields} values={preview} onChange={setPreview} />
              {requireSig && (
                <p className="text-xs text-(--ui-text-muted) mt-3">A signature will be required to submit.</p>
              )}
            </SectionCard>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button tone="plain" onClick={onClose}>
          Cancel
        </Button>
        <Button tone="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save form"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function ResponseDetail({ id, onClose }) {
  const { error } = useToast();
  const [resp, setResp] = useState(null);
  useEffect(() => {
    api.get(`/api/forms/responses/${id}`).then(setResp).catch((e) => error(e.message));
  }, [id]);
  if (!resp) return null;
  return (
    <Modal open onClose={onClose} title={resp.form_name} size="lg">
      <ModalBody>
        <div className="mb-3 flex gap-2 text-sm">
          <Badge>{resp.status}</Badge>
          {resp.submitted_via && <Badge>via {resp.submitted_via}</Badge>}
          {resp.submitted_at && <span className="text-(--ui-text-muted)">{fmtUtcDateTime(resp.submitted_at)}</span>}
        </div>
        <FormAnswersView fields={resp.fields_snapshot || []} answers={resp.answers || {}} />
        {resp.signature_url && (
          <div className="mt-4">
            <div className="text-sm font-medium mb-1">Signature</div>
            <img src={resp.signature_url} alt="signature" className="max-h-32 border border-(--ui-border) rounded" />
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button tone="plain" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default function FormsRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const { success, error } = useToast();
  const [tab, setTab] = useState("templates");
  const [templates, setTemplates] = useState([]);
  const [responses, setResponses] = useState([]);
  const [editing, setEditing] = useState(null); // template obj or {} for new
  const [detailId, setDetailId] = useState(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadTemplates = useCallback(async () => {
    try {
      const { templates } = await api.get("/api/forms/templates", { include_inactive: "1" });
      setTemplates(templates || []);
    } catch (e) {
      error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadResponses = useCallback(async () => {
    try {
      const { responses } = await api.get("/api/forms/responses");
      setResponses(responses || []);
    } catch (e) {
      error(e.message);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);
  useEffect(() => {
    if (tab === "responses") loadResponses();
  }, [tab, loadResponses]);

  if (flagsLoading) return null;
  if (!flags.custom_forms) return <Navigate to="/" replace />;

  const copyLink = async (templateId) => {
    try {
      const { fill_url } = await api.post(`/api/forms/templates/${templateId}/send`, { channel: "none" });
      await navigator.clipboard.writeText(fill_url).catch(() => {});
      success("Fill link created & copied to clipboard");
    } catch (e) {
      error(e.message);
    }
  };

  return (
    <PageShell
      title="Forms"
      subtitle="Intake forms, waivers & questionnaires"
      right={
        tab === "templates" ? (
          <Button tone="primary" onClick={() => setEditing({})}>
            + New form
          </Button>
        ) : null
      }
    >
      <TabBar
        tabs={[
          { value: "templates", label: "Templates" },
          { value: "responses", label: "Responses" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "templates" && (
        <SectionCard className="mt-4 p-0 overflow-hidden">
          {loading ? (
            <div className="p-6 text-(--ui-text-muted)">Loading…</div>
          ) : templates.length === 0 ? (
            <div className="p-6 text-(--ui-text-muted)">No forms yet. Create your first intake form or waiver.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-(--ui-surface-2) text-left text-(--ui-text-muted)">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Attach to</th>
                  <th className="px-4 py-2">Fields</th>
                  <th className="px-4 py-2">Responses</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-t border-(--ui-border)">
                    <td className="px-4 py-2 font-medium">
                      {t.name}
                      {t.require_signature ? <> <Badge>signature</Badge></> : null}
                    </td>
                    <td className="px-4 py-2">{t.entity_scope}</td>
                    <td className="px-4 py-2">{(t.fields || []).length}</td>
                    <td className="px-4 py-2">{t.response_count}</td>
                    <td className="px-4 py-2">
                      {t.is_active ? <Badge tone="success">active</Badge> : <Badge>inactive</Badge>}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {t.is_active && (
                        <Button size="sm" tone="plain" onClick={() => copyLink(t.id)}>
                          Copy link
                        </Button>
                      )}
                      <Button size="sm" tone="plain" onClick={() => setEditing(t)}>
                        Edit
                      </Button>
                      {t.is_active && (
                        <Button size="sm" tone="danger" onClick={() => setConfirmDeactivate(t)}>
                          Deactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      )}

      {tab === "responses" && (
        <SectionCard className="mt-4 p-0 overflow-hidden">
          {responses.length === 0 ? (
            <div className="p-6 text-(--ui-text-muted)">No form responses yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-(--ui-surface-2) text-left text-(--ui-text-muted)">
                <tr>
                  <th className="px-4 py-2">Form</th>
                  <th className="px-4 py-2">Customer</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Submitted</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {responses.map((r) => (
                  <tr key={r.id} className="border-t border-(--ui-border)">
                    <td className="px-4 py-2 font-medium">{r.form_name}</td>
                    <td className="px-4 py-2">{r.customer_name || "—"}</td>
                    <td className="px-4 py-2">
                      <Badge tone={r.status === "submitted" ? "success" : r.status === "void" ? "muted" : "warning"}>
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">{r.submitted_at ? fmtUtcDateTime(r.submitted_at) : "—"}</td>
                    <td className="px-4 py-2 text-right">
                      {r.status === "submitted" && (
                        <Button size="sm" tone="plain" onClick={() => setDetailId(r.id)}>
                          View
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      )}

      {editing && (
        <TemplateEditor
          initial={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadTemplates();
          }}
        />
      )}
      {detailId && <ResponseDetail id={detailId} onClose={() => setDetailId(null)} />}
      {confirmDeactivate && (
        <ConfirmDialog
          open
          title="Deactivate form?"
          body={`"${confirmDeactivate.name}" will be hidden and can no longer be sent. Existing responses are kept.`}
          confirmLabel="Deactivate"
          destructive
          onConfirm={async () => {
            try {
              await api.del(`/api/forms/templates/${confirmDeactivate.id}`);
              success("Form deactivated");
              setConfirmDeactivate(null);
              loadTemplates();
            } catch (e) {
              error(e.message);
            }
          }}
          onCancel={() => setConfirmDeactivate(null)}
        />
      )}
    </PageShell>
  );
}
