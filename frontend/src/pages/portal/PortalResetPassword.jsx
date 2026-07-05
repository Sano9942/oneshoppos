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
      <div className="max-w-md mx-auto bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6">
        <p className="text-(--ui-danger-fg)">Reset link is missing a token.</p>
        <Link to={`/portal/${tenantSlug}/login`} className="text-(--ui-link) hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6">
      <h1 className="text-xl font-semibold mb-1">Choose a new password</h1>
      <p className="text-sm text-(--ui-text-muted) mb-6">This will sign you out of other devices.</p>
      {done ? (
        <div className="text-(--ui-success-fg) text-sm">Password updated. Redirecting to sign-in…</div>
      ) : (
        <form onSubmit={submit}>
          <label className="block text-sm font-medium mb-1">New password</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-(--ui-border-strong) rounded px-3 py-2 mb-4"
            autoComplete="new-password"
          />
          {error && <div className="text-sm text-(--ui-danger-fg) mb-3">{error}</div>}
          <button
            type="submit"
            disabled={sending}
            className="w-full bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-(--ui-on-primary) py-2 rounded font-medium disabled:opacity-50"
          >
            {sending ? "Saving…" : "Save new password"}
          </button>
        </form>
      )}
    </div>
  );
}
