import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { API_BASE } from "../../config";
import FormFieldRenderer from "../../components/forms/FormFieldRenderer";
import SignaturePad, { signatureToBase64 } from "../../components/forms/SignaturePad";

// Public tokenized form fill — no login. Reads ?tenant=<slug> from the link.
// 404/used/expired token → "not found" card, never a stack trace.
export default function FormFillPublic() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const tenant = params.get("tenant") || "";

  const [state, setState] = useState("loading"); // loading | ready | notfound | error | done
  const [form, setForm] = useState(null);
  const [values, setValues] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const sigRef = useRef(null);

  useEffect(() => {
    const url = `${API_BASE}/api/public/forms/${encodeURIComponent(token)}?tenant=${encodeURIComponent(tenant)}`;
    fetch(url)
      .then(async (r) => {
        if (r.status === 404) return setState("notfound");
        if (!r.ok) return setState("error");
        const data = await r.json();
        setForm(data);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [token, tenant]);

  const submit = async () => {
    setErrMsg("");
    setSubmitting(true);
    try {
      let signature_image_base64 = null;
      if (form.require_signature) {
        if (!sigRef.current || sigRef.current.isEmpty()) {
          setSubmitting(false);
          return setErrMsg("Please draw your signature to submit.");
        }
        signature_image_base64 = await signatureToBase64(sigRef.current.toDataURL());
      }
      const url = `${API_BASE}/api/public/forms/${encodeURIComponent(token)}?tenant=${encodeURIComponent(tenant)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: values, signature_image_base64 }),
      });
      if (res.status === 404) {
        setState("notfound");
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrMsg(body.error || "Submission failed. Please check the required fields.");
        return;
      }
      setState("done");
    } catch {
      setErrMsg("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const Shell = ({ children }) => (
    <div className="min-h-screen bg-(--ui-bg) flex items-start justify-center p-4">
      <div className="w-full max-w-lg mt-8">{children}</div>
    </div>
  );

  if (state === "loading")
    return (
      <Shell>
        <p className="text-(--ui-text-muted) text-center">Loading…</p>
      </Shell>
    );

  if (state === "notfound")
    return (
      <Shell>
        <div className="rounded-lg border border-(--ui-border) bg-(--ui-surface) p-8 text-center">
          <h1 className="text-lg font-semibold text-(--ui-text)">Form not available</h1>
          <p className="text-(--ui-text-muted) mt-2">
            This link is invalid or has already been completed. Please contact the business if you need a new one.
          </p>
        </div>
      </Shell>
    );

  if (state === "error")
    return (
      <Shell>
        <div className="rounded-lg border border-(--ui-border) bg-(--ui-surface) p-8 text-center">
          <h1 className="text-lg font-semibold text-(--ui-text)">Something went wrong</h1>
          <p className="text-(--ui-text-muted) mt-2">Please try again in a moment.</p>
        </div>
      </Shell>
    );

  if (state === "done")
    return (
      <Shell>
        <div className="rounded-lg border border-(--ui-border) bg-(--ui-surface) p-8 text-center">
          <div className="text-4xl mb-2">✓</div>
          <h1 className="text-lg font-semibold text-(--ui-text)">Thank you!</h1>
          <p className="text-(--ui-text-muted) mt-2">Your form has been submitted.</p>
        </div>
      </Shell>
    );

  return (
    <Shell>
      <div className="rounded-lg border border-(--ui-border) bg-(--ui-surface) p-6">
        <h1 className="text-xl font-semibold text-(--ui-text) mb-4">{form.form_name}</h1>
        <FormFieldRenderer fields={form.fields || []} values={values} onChange={setValues} />
        {form.require_signature && (
          <div className="mt-5">
            <div className="text-sm font-medium mb-1">
              Signature <span className="text-red-500">*</span>
            </div>
            <SignaturePad ref={sigRef} height={140} />
            <button
              type="button"
              className="text-xs text-(--ui-text-muted) mt-1"
              onClick={() => sigRef.current?.clear()}
            >
              Clear signature
            </button>
          </div>
        )}
        {errMsg && <p className="text-sm text-red-600 mt-3">{errMsg}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="mt-6 w-full rounded-lg bg-(--ui-primary) text-white py-3 font-semibold disabled:opacity-60"
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>
    </Shell>
  );
}
