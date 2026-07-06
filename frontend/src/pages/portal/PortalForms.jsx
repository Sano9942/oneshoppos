import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";
import FormFieldRenderer from "../../components/forms/FormFieldRenderer";
import SignaturePad, { signatureToBase64 } from "../../components/forms/SignaturePad";

function fmtDateTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function PortalForms() {
  const { tenantSlug } = useParams();
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null); // form detail being filled
  const [values, setValues] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [fillError, setFillError] = useState("");
  const sigRef = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const res = await portalApi.get(tenantSlug, "/api/portal/me/forms");
      setForms(res.forms || []);
    } catch (err) {
      setError(err.message || "Failed to load forms");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    /* eslint-disable-next-line */
  }, [tenantSlug]);

  async function openForm(id) {
    setFillError("");
    setValues({});
    try {
      const d = await portalApi.get(tenantSlug, `/api/portal/me/forms/${id}`);
      setActive(d);
    } catch (err) {
      setError(err.message || "Failed to load form");
    }
  }

  async function submit() {
    setFillError("");
    setSubmitting(true);
    try {
      let signature_image_base64 = null;
      if (active.require_signature) {
        if (!sigRef.current || sigRef.current.isEmpty()) {
          setSubmitting(false);
          return setFillError("Please draw your signature to submit.");
        }
        signature_image_base64 = await signatureToBase64(sigRef.current.toDataURL());
      }
      await portalApi.post(tenantSlug, `/api/portal/me/forms/${active.id}/submit`, {
        answers: values,
        signature_image_base64,
      });
      setActive(null);
      load();
    } catch (err) {
      setFillError(err.message || "Submission failed. Check the required fields.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;

  if (active) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <button onClick={() => setActive(null)} className="text-sm text-blue-600 mb-4">
          ← Back to forms
        </button>
        <h1 className="text-xl font-bold mb-4">{active.form_name}</h1>
        {active.status === "submitted" ? (
          <p className="text-emerald-600">This form was already submitted on {fmtDateTime(active.submitted_at)}.</p>
        ) : (
          <>
            <FormFieldRenderer fields={active.fields_snapshot || []} values={values} onChange={setValues} />
            {active.require_signature && (
              <div className="mt-5">
                <div className="text-sm font-medium mb-1">
                  Signature <span className="text-red-500">*</span>
                </div>
                <SignaturePad ref={sigRef} height={140} />
                <button
                  type="button"
                  className="text-xs text-slate-500 mt-1"
                  onClick={() => sigRef.current?.clear()}
                >
                  Clear signature
                </button>
              </div>
            )}
            {fillError && <p className="text-sm text-red-600 mt-3">{fillError}</p>}
            <button
              onClick={submit}
              disabled={submitting}
              className="mt-6 w-full rounded-lg bg-emerald-600 text-white py-3 font-semibold disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Forms</h1>
      {forms.length === 0 ? (
        <p className="text-slate-500">You have no forms to complete.</p>
      ) : (
        <ul className="space-y-3">
          {forms.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4"
            >
              <div>
                <div className="font-medium">{f.form_name}</div>
                <div className="text-xs text-slate-500">
                  {f.status === "submitted"
                    ? `Submitted ${fmtDateTime(f.submitted_at)}`
                    : "Awaiting your completion"}
                </div>
              </div>
              <button
                onClick={() => openForm(f.id)}
                className={`text-sm font-semibold rounded px-3 py-1.5 ${
                  f.status === "pending" ? "bg-emerald-600 text-white" : "text-blue-600"
                }`}
              >
                {f.status === "pending" ? "Complete" : "View"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
