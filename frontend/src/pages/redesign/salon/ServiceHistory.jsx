/**
 * ServiceHistory.jsx — V04 salon depth.
 *
 * Client service history / colorist formula notes UI. Three exports:
 *   - LastVisitPanel: the booking-view "show me her last formula" panel.
 *   - ServiceRecordEditor: notes + structured formula ([{label,value}]) +
 *     before/after photo capture; the stylist enrichment surface.
 *   - ServiceHistoryList: the timeline for the customer profile's History tab.
 *
 * All built on ui/primitives + --ui-* tokens (Square design system).
 */
import { useEffect, useState, useCallback } from "react";
import { Button, Input, SectionCard, Badge } from "../../../ui/primitives";
import { api } from "../../../api";
import { useToast } from "../../../contexts/ToastContext";
import { fmtUtcDate } from "../../../utils/dates";

function formatFormula(formula) {
  if (!Array.isArray(formula) || !formula.length) return null;
  return formula.map((f) => `${f.label}: ${f.value}`).join("  ·  ");
}

/** Compact last-visit panel for the booking / appointment drawer. */
export function LastVisitPanel({ customerId }) {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!customerId) { setLoading(false); return; }
    setLoading(true);
    api.get(`/api/customers/${customerId}/service-records/last-visit`)
      .then((d) => { if (alive) setRecord(d.record || null); })
      .catch(() => { if (alive) setRecord(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [customerId]);

  if (loading) return null;
  if (!record) {
    return (
      <div className="rounded-lg border border-(--ui-border) bg-(--ui-surface) p-3 text-sm text-(--ui-text-muted)">
        First visit — no service history yet.
      </div>
    );
  }
  const formula = formatFormula(record.formula);
  return (
    <div className="rounded-lg border border-(--ui-border) bg-(--ui-surface) p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Last visit</span>
        <span className="text-xs text-(--ui-text-muted)">{fmtUtcDate(record.created_at)}</span>
      </div>
      <div className="text-sm font-medium text-(--ui-text)">{record.service_name || "Service"}</div>
      {record.employee_name && (
        <div className="text-xs text-(--ui-text-muted)">with {record.employee_name}</div>
      )}
      {formula && (
        <div className="mt-2 rounded bg-(--ui-bg) border border-(--ui-border) p-2 text-xs text-(--ui-text)">
          <span className="font-medium">Formula:</span> {formula}
        </div>
      )}
      {record.notes && <div className="mt-2 text-xs text-(--ui-text-muted)">{record.notes}</div>}
    </div>
  );
}

/** Editable record card — notes, formula rows, photos. onSaved(updated) callback. */
export function ServiceRecordEditor({ record, onSaved }) {
  const { success, error } = useToast();
  const [notes, setNotes] = useState(record.notes || "");
  const [formula, setFormula] = useState(
    Array.isArray(record.formula) && record.formula.length ? record.formula : [{ label: "", value: "" }]
  );
  const [photos, setPhotos] = useState(Array.isArray(record.photos) ? record.photos : []);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const setRow = (i, key, val) =>
    setFormula((rows) => rows.map((r, j) => (j === i ? { ...r, [key]: val } : r)));
  const addRow = () => setFormula((rows) => [...rows, { label: "", value: "" }]);
  const removeRow = (i) => setFormula((rows) => rows.filter((_, j) => j !== i));

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const cleanFormula = formula.filter((r) => r.label.trim() || r.value.trim());
      const d = await api.put(`/api/service-records/${record.id}`, { notes, formula: cleanFormula });
      success("Service record saved");
      onSaved?.(d.record);
    } catch (err) {
      error(err.message || "Could not save");
    } finally {
      setSaving(false);
    }
  }, [record.id, notes, formula, onSaved, success, error]);

  const uploadPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const d = await api.upload(`/api/service-records/${record.id}/photo`, fd);
      setPhotos(Array.isArray(d.record?.photos) ? d.record.photos : photos);
      success("Photo added");
      onSaved?.(d.record);
    } catch (err) {
      error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted) mb-1 block">Formula</label>
        <div className="space-y-2">
          {formula.map((row, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input className="w-1/3" placeholder="Label (e.g. Base)" value={row.label}
                onChange={(e) => setRow(i, "label", e.target.value)} />
              <Input className="flex-1" placeholder="Value (e.g. 6N 40ml)" value={row.value}
                onChange={(e) => setRow(i, "value", e.target.value)} />
              <button type="button" onClick={() => removeRow(i)}
                className="text-(--ui-text-muted) hover:text-(--ui-danger-fg) px-1">×</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addRow} className="mt-1 text-xs text-(--ui-link) hover:underline">+ Add row</button>
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted) mb-1 block">Notes</label>
        <textarea className="w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm text-(--ui-text)"
          rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Toned down brassiness, client prefers cooler tones…" />
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted) mb-1 block">Before / after photos</label>
        <div className="flex flex-wrap gap-2 mb-2">
          {photos.map((p, i) => (
            <a key={i} href={p.url || p} target="_blank" rel="noreferrer"
              className="block w-16 h-16 rounded-lg overflow-hidden border border-(--ui-border)">
              <img src={p.url || p} alt="" className="w-full h-full object-cover" />
            </a>
          ))}
        </div>
        <label className="inline-block">
          <span className="text-xs text-(--ui-link) hover:underline cursor-pointer">
            {uploading ? "Uploading…" : "+ Add photo"}
          </span>
          <input type="file" accept="image/*" className="hidden" onChange={uploadPhoto} disabled={uploading} />
        </label>
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save record"}</Button>
      </div>
    </div>
  );
}

/**
 * Booking/appointment-drawer history: the previous-visit formula panel plus,
 * once this appointment has been checked out, an editor per service record so
 * the stylist fills notes/formula/photos right where the work happened.
 */
export function AppointmentServiceRecords({ appointmentId, customerId }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!customerId) { setLoading(false); return; }
    setLoading(true);
    api.get(`/api/customers/${customerId}/service-records`)
      .then((d) => setRecords(d.records || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [customerId]);
  useEffect(() => { load(); }, [load]);

  const onSaved = (updated) => {
    if (!updated) return;
    setRecords((rs) => rs.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  };

  if (!customerId) return null;
  const thisVisit = records.filter((r) => r.appointment_id === appointmentId);
  // "Last visit" = most recent record NOT from this appointment.
  const prior = records.find((r) => r.appointment_id !== appointmentId);

  return (
    <div className="space-y-3">
      {prior && (() => {
        const formula = formatFormula(prior.formula);
        return (
          <div className="rounded-lg border border-(--ui-border) bg-(--ui-surface) p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Last visit</span>
              <span className="text-xs text-(--ui-text-muted)">{fmtUtcDate(prior.created_at)}</span>
            </div>
            <div className="text-sm font-medium text-(--ui-text)">{prior.service_name || "Service"}</div>
            {prior.employee_name && <div className="text-xs text-(--ui-text-muted)">with {prior.employee_name}</div>}
            {formula && (
              <div className="mt-2 rounded bg-(--ui-bg) border border-(--ui-border) p-2 text-xs text-(--ui-text)">
                <span className="font-medium">Formula:</span> {formula}
              </div>
            )}
          </div>
        );
      })()}
      {!loading && !prior && !thisVisit.length && (
        <div className="rounded-lg border border-(--ui-border) bg-(--ui-surface) p-3 text-sm text-(--ui-text-muted)">
          First visit — no service history yet.
        </div>
      )}
      {thisVisit.map((r) => (
        <div key={r.id} className="rounded-lg border border-(--ui-border) p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted) mb-2">
            This visit — {r.service_name || "Service"}{r.employee_name ? ` · ${r.employee_name}` : ""}
          </div>
          <ServiceRecordEditor record={r} onSaved={onSaved} />
        </div>
      ))}
    </div>
  );
}

/** Timeline list for the customer profile Service History tab. */
export function ServiceHistoryList({ customerId }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => {
    if (!customerId) return;
    setLoading(true);
    api.get(`/api/customers/${customerId}/service-records`)
      .then((d) => setRecords(d.records || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  const onSaved = (updated) => {
    if (!updated) return;
    setRecords((rs) => rs.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  };

  if (loading) return <div className="text-sm text-(--ui-text-muted) p-4">Loading…</div>;
  if (!records.length) {
    return <div className="text-sm text-(--ui-text-muted) p-4">No service history yet.</div>;
  }

  return (
    <div className="space-y-2">
      {records.map((r) => {
        const formula = formatFormula(r.formula);
        const open = openId === r.id;
        return (
          <SectionCard key={r.id} className="p-3">
            <button type="button" className="w-full text-left" onClick={() => setOpenId(open ? null : r.id)}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-(--ui-text)">{r.service_name || "Service"}</span>
                  {r.employee_name && <span className="text-xs text-(--ui-text-muted)"> · {r.employee_name}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {!r.appointment_id && <Badge tone="default">Walk-in</Badge>}
                  <span className="text-xs text-(--ui-text-muted)">{fmtUtcDate(r.created_at)}</span>
                </div>
              </div>
              {!open && formula && (
                <div className="mt-1 text-xs text-(--ui-text-muted) truncate">{formula}</div>
              )}
            </button>
            {open && (
              <div className="mt-3 pt-3 border-t border-(--ui-border)">
                <ServiceRecordEditor record={r} onSaved={onSaved} />
              </div>
            )}
          </SectionCard>
        );
      })}
    </div>
  );
}
