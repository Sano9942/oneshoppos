import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { manufacturerPortalApi } from "../../api/manufacturerPortalApi";

// Tier 1.4 polish — manufacturer-portal forgot-password.
// Posts to /api/manufacturer-portal/auth/forgot-password. The backend
// always returns 200 (enumeration guard), so on submit we always show
// the same "check your email" confirmation regardless of match.
export default function ManufacturerPortalForgotPassword() {
  const { tenantSlug } = useParams();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await manufacturerPortalApi.post(
        tenantSlug,
        "/api/manufacturer-portal/auth/forgot-password",
        { email }
      );
      setSent(true);
    } catch (e2) {
      setErr(e2.message || "Could not send reset email");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="max-w-sm mx-auto bg-white border border-slate-200 rounded-lg p-6 mt-4">
        <h1 className="text-xl font-semibold mb-2">Check your email</h1>
        <p className="text-sm text-slate-600 mb-4">
          If an account with that email exists, a reset link has been sent.
          The link expires in 1 hour.
        </p>
        <p className="text-sm text-slate-500 mb-6">
          Didn't receive it? Check your spam folder, or contact your
          distributor admin to re-issue the invitation.
        </p>
        <Link
          to={`/manufacturer-portal/${tenantSlug}/login`}
          className="text-sm text-indigo-600 hover:text-indigo-700"
        >
          ← Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto bg-white border border-slate-200 rounded-lg p-6 mt-4">
      <h1 className="text-xl font-semibold mb-1">Reset your password</h1>
      <p className="text-sm text-slate-500 mb-6">
        Enter the email you use to sign in to the <strong>{tenantSlug}</strong>{" "}
        manufacturer portal.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="you@brand.com"
          />
        </div>
        {err && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {err}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !email}
          className="w-full bg-indigo-600 text-white py-2 rounded font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="text-sm text-slate-500 mt-6">
        <Link
          to={`/manufacturer-portal/${tenantSlug}/login`}
          className="text-indigo-600 hover:text-indigo-700"
        >
          ← Back to sign in
        </Link>
      </p>
    </div>
  );
}
