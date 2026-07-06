// Pure, presentation-only renderer for a form's fields. Given a frozen
// fields array + current answers + onChange, renders the appropriate input per
// field type. Shared by the public fill page, portal fill, staff fill, and the
// builder preview so the render path can't diverge across surfaces (F03).
//
// No API calls, no auth — safe to import from any auth context.

export default function FormFieldRenderer({ fields = [], values = {}, onChange, disabled = false }) {
  const set = (key, val) => onChange && onChange({ ...values, [key]: val });

  return (
    <div className="space-y-4">
      {fields.map((f) => {
        const val = values[f.key];
        const labelEl = (
          <label className="block text-sm font-medium text-(--ui-text) mb-1">
            {f.label}
            {f.required ? <span className="text-red-500"> *</span> : null}
          </label>
        );
        const help = f.help ? (
          <p className="text-xs text-(--ui-text-muted) mt-1">{f.help}</p>
        ) : null;

        switch (f.type) {
          case "textarea":
            return (
              <div key={f.key}>
                {labelEl}
                <textarea
                  className="w-full rounded border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-(--ui-text)"
                  rows={3}
                  disabled={disabled}
                  value={val || ""}
                  onChange={(e) => set(f.key, e.target.value)}
                />
                {help}
              </div>
            );
          case "select":
            return (
              <div key={f.key}>
                {labelEl}
                <select
                  className="w-full rounded border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-(--ui-text)"
                  disabled={disabled}
                  value={val || ""}
                  onChange={(e) => set(f.key, e.target.value)}
                >
                  <option value="">Select…</option>
                  {(f.options || []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                {help}
              </div>
            );
          case "checkbox":
          case "signature_ack":
            return (
              <div key={f.key} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  disabled={disabled}
                  checked={val === true || val === "true"}
                  onChange={(e) => set(f.key, e.target.checked)}
                />
                <div>
                  <span className="text-sm text-(--ui-text)">
                    {f.label}
                    {f.required ? <span className="text-red-500"> *</span> : null}
                  </span>
                  {help}
                </div>
              </div>
            );
          case "date":
            return (
              <div key={f.key}>
                {labelEl}
                <input
                  type="date"
                  className="w-full rounded border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-(--ui-text)"
                  disabled={disabled}
                  value={val || ""}
                  onChange={(e) => set(f.key, e.target.value)}
                />
                {help}
              </div>
            );
          case "number":
            return (
              <div key={f.key}>
                {labelEl}
                <input
                  type="number"
                  className="w-full rounded border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-(--ui-text)"
                  disabled={disabled}
                  value={val ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                />
                {help}
              </div>
            );
          default:
            return (
              <div key={f.key}>
                {labelEl}
                <input
                  type="text"
                  className="w-full rounded border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-(--ui-text)"
                  disabled={disabled}
                  value={val || ""}
                  onChange={(e) => set(f.key, e.target.value)}
                />
                {help}
              </div>
            );
        }
      })}
    </div>
  );
}

// Read-only render of a submitted response (label → answer). Shared by the
// entity panel + portal detail view.
export function FormAnswersView({ fields = [], answers = {} }) {
  return (
    <dl className="space-y-2">
      {fields.map((f) => {
        let v = answers[f.key];
        if (f.type === "checkbox" || f.type === "signature_ack") {
          v = v === true || v === "true" ? "Yes" : "No";
        }
        return (
          <div key={f.key} className="grid grid-cols-3 gap-2">
            <dt className="text-sm text-(--ui-text-muted) col-span-1">{f.label}</dt>
            <dd className="text-sm text-(--ui-text) col-span-2 break-words">
              {v === undefined || v === null || v === "" ? "—" : String(v)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
