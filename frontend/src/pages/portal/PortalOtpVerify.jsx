import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";
import { usePortalAuth } from "./PortalAuthProvider";

export default function PortalOtpVerify() {
  const { tenantSlug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const auth = usePortalAuth();
  const email = searchParams.get("email") || "";
  const purpose = searchParams.get("purpose") || "login";
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [resendNotice, setResendNotice] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const endpoint =
        purpose === "email_verify"
          ? "/api/portal/auth/verify-email"
          : "/api/portal/auth/verify-otp";
      const body =
        purpose === "email_verify"
          ? { email, code }
          : { email, code, purpose: "login" };
      const res = await portalApi.post(tenantSlug, endpoint, body);
      auth.setSession(res);
      navigate(`/portal/${tenantSlug}`, { replace: true });
    } catch (err) {
      setError(err.message || "Invalid code");
    } finally {
      setSending(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      await portalApi.post(tenantSlug, "/api/portal/auth/request-otp", {
        email,
        purpose: purpose === "email_verify" ? "email_verify" : "login",
      });
      setResendNotice("A new code has been sent (if the email is registered).");
    } catch (err) {
      setError(err.message || "Could not send code");
    }
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <h1 className="text-xl font-semibold mb-1">Enter your code</h1>
      <p className="text-sm text-slate-500 mb-6">
        We sent a 6-digit code to <strong>{email || "your email"}</strong>. It expires in 15 minutes.
      </p>
      <form onSubmit={submit}>
        <input
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="w-full border border-slate-300 rounded px-3 py-3 text-center text-2xl tracking-[0.5em] mb-4"
        />
        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
        {resendNotice && <div className="text-sm text-emerald-700 mb-3">{resendNotice}</div>}
        <button
          type="submit"
          disabled={sending || code.length !== 6}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded font-medium disabled:opacity-50"
        >
          {sending ? "Verifying…" : "Verify"}
        </button>
      </form>
      <button
        type="button"
        onClick={resend}
        className="w-full mt-4 text-sm text-slate-600 hover:text-slate-900"
      >
        Resend code
      </button>
    </div>
  );
}
