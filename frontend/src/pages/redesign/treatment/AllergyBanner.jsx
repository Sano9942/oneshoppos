import { AlertTriangle } from "lucide-react";

/**
 * V05 — red patient-safety banner. Renders ONLY when the subject actually
 * carries structured safety data (an empty red bar would train staff to
 * ignore it). Shown at: plan detail / session start, prescription entry,
 * and the booking drawer.
 *
 * The prescribe-time check this pairs with is a NAME-MATCH aid only — the
 * label says so explicitly (clinical-safety framing: an aid, never a
 * trusted drug-interaction guard).
 */
export default function AllergyBanner({ subject, compact = false }) {
  if (!subject) return null;
  const allergies = Array.isArray(subject.allergies) ? subject.allergies : [];
  const alerts = Array.isArray(subject.medical_alerts) ? subject.medical_alerts : [];
  const meds = Array.isArray(subject.current_medications) ? subject.current_medications : [];
  if (!allergies.length && !alerts.length && !meds.length) return null;

  return (
    <div
      className="rounded-md border border-(--ui-danger) bg-(--ui-danger-bg) px-3 py-2 text-sm"
      role="alert"
      data-testid="allergy-banner"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-(--ui-danger)" />
        <div className="min-w-0">
          <div className="font-semibold text-(--ui-danger)">
            Patient safety — {subject.name}
          </div>
          <div className="mt-0.5 space-y-0.5 text-(--ui-text)">
            {allergies.length > 0 && (
              <div><span className="font-medium">Allergies:</span> {allergies.join(", ")}</div>
            )}
            {alerts.length > 0 && (
              <div><span className="font-medium">Alerts:</span> {alerts.join(", ")}</div>
            )}
            {!compact && meds.length > 0 && (
              <div><span className="font-medium">Medications:</span> {meds.join(", ")}</div>
            )}
          </div>
          <div className="mt-1 text-[11px] text-(--ui-text-muted)">
            Prescription checks match by name only — not a drug-interaction check.
          </div>
        </div>
      </div>
    </div>
  );
}

/** Name-match helper shared by prescription entry UIs (mirror of the server check). */
export function matchAllergies(subject, medicationName) {
  const med = String(medicationName || "").trim().toLowerCase();
  if (!med || !subject) return [];
  const allergies = Array.isArray(subject.allergies) ? subject.allergies : [];
  return allergies.filter((a) => {
    const al = String(a || "").trim().toLowerCase();
    return al && (med.includes(al) || al.includes(med));
  });
}
