import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

export default function PortalResetPassword() {
  const { tenantSlug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await portalApi.post(tenantSlug, "/api/portal/auth/reset-password", {
        token,
        password,
      });
      setDone(true);
      setTimeout(() => navigate(`/portal/${tenantSlug}/login`, { replace: true }), 2500);
    } catch (err) {
      setError(err.message || "Reset failed");
    } finally {
      setSending(false);
    }
  }

  if (!token) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <p className="text-red-600">Reset link is missing a token.</p>
        <Link to={`/portal/${tenantSlug}/login`} className="text-emerald-700 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <h1 className="text-xl font-semibold mb-1">Choose a new password</h1>
      <p className="text-sm text-slate-500 mb-6">This will sign you out of other devices.</p>
      {done ? (
        <div className="text-emerald-700 text-sm">Password updated. Redirecting to sign-in…</div>
      ) : (
        <form onSubmit={submit}>
          <label className="block text-sm font-medium mb-1">New password</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 mb-4"
            autoComplete="new-password"
          />
          {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
          <button
            type="submit"
            disabled={sending}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded font-medium disabled:opacity-50"
          >
            {sending ? "Saving…" : "Save new password"}
          </button>
        </form>
      )}
    </div>
  );
}
