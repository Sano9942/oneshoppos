import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import {
  SectionCard,
  Button,
  Select,
  Badge,
  Modal,
  ModalBody,
  ModalFooter,
} from "../ui/primitives";
import FormFieldRenderer, { FormAnswersView } from "./forms/FormFieldRenderer";
import SignaturePad, { signatureToBase64 } from "./forms/SignaturePad";
import { fmtUtcDateTime } from "../utils/dates";

/**
 * Shared entity-scoped forms panel. Drop onto any entity page (ticket drawer,
 * project page, patient chart) to list, attach, fill, view and void forms tied
 * to that entity. All three fill contexts converge on the same backend submit
 * path; staff-assisted fill uses POST /api/forms/responses/:id/submit.
 */
export default function FormResponsesPanel({ entityType, entityId, customerId, patientSubjectId }) {
  const { success, error } = useToast();
  const [responses, setResponses] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [picking, setPicking] = useState("");
  const [fill, setFill] = useState(null); // { id, form_name, fields, require_signature }
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!entityType || !entityId) return;
    try {
      const { responses } = await api.get("/api/forms/responses", {
        entity_type: entityType,
        entity_id: entityId,
      });
      setResponses(responses || []);
    } catch (e) {
      error(e.message);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    load();
    api
      .get("/api/forms/templates")
      .then(({ templates }) => setTemplates(templates || []))
      .catch(() => {});
  }, [load]);

  const attach = async () => {
    if (!picking) return;
    try {
      const { response, fill_url } = await api.post(`/api/forms/templates/${picking}/send`, {
        entity_type: entityType,
        entity_id: entityId,
        customer_id: customerId || null,
        patient_subject_id: patientSubjectId || null,
        channel: "none",
      });
      await navigator.clipboard.writeText(fill_url).catch(() => {});
      success("Form attached — fill link copied");
      setPicking("");
      load();
      return response;
    } catch (e) {
      error(e.message);
    }
  };

  const openStaffFill = async (responseId) => {
    try {
      const resp = await api.get(`/api/forms/responses/${responseId}`);
      setFill({
        id: resp.id,
        form_name: resp.form_name,
        fields: resp.fields_snapshot || [],
        require_signature: false, // resolved from template server-side; sig optional in UI
      });
    } catch (e) {
      error(e.message);
    }
  };

  const voidResp = async (id) => {
    try {
      await api.post(`/api/forms/responses/${id}/void`, {});
      success("Form voided");
      load();
    } catch (e) {
      error(e.message);
    }
  };

  if (!entityType || !entityId) return null;

  return (
    <SectionCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Forms</h3>
        <div className="flex gap-2">
          <Select value={picking} onChange={(e) => setPicking(e.target.value)} className="w-48">
            <option value="">Attach a form…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Button size="sm" tone="primary" onClick={attach} disabled={!picking}>
            Attach
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-(--ui-text-muted)">Loading…</p>
      ) : responses.length === 0 ? (
        <p className="text-sm text-(--ui-text-muted)">No forms attached.</p>
      ) : (
        <ul className="divide-y divide-(--ui-border)">
          {responses.map((r) => (
            <li key={r.id} className="py-2 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{r.form_name}</div>
                <div className="text-xs text-(--ui-text-muted)">
                  {r.submitted_at ? `Submitted ${fmtUtcDateTime(r.submitted_at)}` : "Awaiting completion"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={r.status === "submitted" ? "success" : r.status === "void" ? "default" : "warning"}>
                  {r.status}
                </Badge>
                {r.status === "pending" && (
                  <Button size="sm" tone="plain" onClick={() => openStaffFill(r.id)}>
                    Fill
                  </Button>
                )}
                {r.status === "submitted" && (
                  <Button
                    size="sm"
                    tone="plain"
                    onClick={() => api.get(`/api/forms/responses/${r.id}`).then(setDetail).catch((e) => error(e.message))}
                  >
                    View
                  </Button>
                )}
                {r.status !== "void" && (
                  <Button size="sm" tone="danger" onClick={() => voidResp(r.id)}>
                    Void
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {fill && (
        <StaffFillModal
          fill={fill}
          onClose={() => setFill(null)}
          onDone={() => {
            setFill(null);
            load();
          }}
        />
      )}
      {detail && (
        <Modal open onClose={() => setDetail(null)} title={detail.form_name} size="lg">
          <ModalBody>
            <FormAnswersView fields={detail.fields_snapshot || []} answers={detail.answers || {}} />
            {detail.signature_url && (
              <img src={detail.signature_url} alt="signature" className="mt-3 max-h-28 border border-(--ui-border) rounded" />
            )}
          </ModalBody>
          <ModalFooter>
            <Button tone="plain" onClick={() => setDetail(null)}>
              Close
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </SectionCard>
  );
}

function StaffFillModal({ fill, onClose, onDone }) {
  const { success, error } = useToast();
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const sigRef = useRef(null);
  const hasSig = (fill.fields || []).some((f) => f.type === "signature_ack") || fill.require_signature;

  const submit = async () => {
    setSaving(true);
    try {
      let signature_image_base64 = null;
      if (sigRef.current && !sigRef.current.isEmpty()) {
        signature_image_base64 = await signatureToBase64(sigRef.current.toDataURL());
      }
      await api.post(`/api/forms/responses/${fill.id}/submit`, {
        answers: values,
        signature_image_base64,
      });
      success("Form submitted");
      onDone();
    } catch (e) {
      error(e.message || "Submit failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={fill.form_name} size="lg">
      <ModalBody>
        <FormFieldRenderer fields={fill.fields} values={values} onChange={setValues} />
        {hasSig && (
          <div className="mt-4">
            <div className="text-sm font-medium mb-1">Signature</div>
            <SignaturePad ref={sigRef} height={130} />
            <button
              type="button"
              className="text-xs text-(--ui-text-muted) mt-1"
              onClick={() => sigRef.current?.clear()}
            >
              Clear
            </button>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button tone="plain" onClick={onClose}>
          Cancel
        </Button>
        <Button tone="primary" onClick={submit} disabled={saving}>
          {saving ? "Submitting…" : "Submit"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
