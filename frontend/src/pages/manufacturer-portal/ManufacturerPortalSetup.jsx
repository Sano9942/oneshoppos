import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMfgPortalAuth } from "./ManufacturerPortalAuthProvider";
import { manufacturerPortalApi } from "../../api/manufacturerPortalApi";

// First-time account claim AND password reset. Lands here via the magic link
// in either the invite email or the forgot-password email:
//   /manufacturer-portal/:slug/setup?token=<signup_token>
// Form sets the password, calls /auth/setup, and lands the user on dashboard.
// The backend treats both flows identically (invite ⇄ reset is just a
// difference in token TTL and which email template was sent).
export default function ManufacturerPortalSetup() {
  const { tenantSlug } = useParams();
  const navigate = useNavigate();
  const auth = useMfgPortalAuth();
  const [params] = useSearchParams();
  const tokenFromUrl = params.get("token") || "";
  const [token, setToken] = useState(tokenFromUrl);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (tokenFromUrl) setToken(tokenFromUrl);
  }, [tokenFromUrl]);

  async function onSubmit(e) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await manufacturerPortalApi.post(
        tenantSlug,
        "/api/manufacturer-portal/auth/setup",
        { token, password }
      );
      auth.setSession(res);
      navigate(`/manufacturer-portal/${tenantSlug}`, { replace: true });
    } catch (e2) {
      setErr(e2.message || "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto bg-(--ui-surface) border border-(--ui-border) rounded-lg p-6 mt-4">
      <h1 className="text-xl font-semibold mb-1">Set your password</h1>
      <p className="text-sm text-(--ui-text-muted) mb-6">
        Choose a new password to access your manufacturer portal account.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        {!tokenFromUrl && (
          <div>
            <label className="block text-sm font-medium text-(--ui-text) mb-1">
              Invite token
            </label>
            <input
              type="text"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full px-3 py-2 border border-(--ui-border-strong) rounded focus:outline-none focus:ring-2 focus:ring-(--ui-focus) font-mono text-sm"
              placeholder="Paste the token from your invite email"
            />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-(--ui-text) mb-1">
            New password
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-(--ui-border-strong) rounded focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
            placeholder="At least 8 characters"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-(--ui-text) mb-1">
            Confirm password
          </label>
          <input
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full px-3 py-2 border border-(--ui-border-strong) rounded focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
          />
        </div>
        {err && (
          <div className="text-sm text-(--ui-danger-fg) bg-(--ui-danger-bg) border border-(--ui-danger-bg) rounded px-3 py-2">
            {err}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !token}
          className="w-full bg-(--ui-primary) text-(--ui-on-primary) py-2 rounded font-medium hover:bg-(--ui-primary-strong) disabled:opacity-50"
        >
          {busy ? "Setting up…" : "Activate account"}
        </button>
      </form>
    </div>
  );
}
