import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMfgPortalAuth } from "./ManufacturerPortalAuthProvider";
import { manufacturerPortalApi } from "../../api/manufacturerPortalApi";

export default function ManufacturerPortalLogin() {
  const { tenantSlug } = useParams();
  const navigate = useNavigate();
  const auth = useMfgPortalAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await manufacturerPortalApi.post(
        tenantSlug,
        "/api/manufacturer-portal/auth/login",
        { email, password }
      );
      auth.setSession(res);
      navigate(`/manufacturer-portal/${tenantSlug}`, { replace: true });
    } catch (e2) {
      setErr(e2.message || "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto bg-(--ui-surface) border border-(--ui-border) rounded-lg p-6 mt-4">
      <h1 className="text-xl font-semibold mb-1">Sign in</h1>
      <p className="text-sm text-(--ui-text-muted) mb-6">
        Manufacturer portal access for <strong>{tenantSlug}</strong>.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-(--ui-text) mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-(--ui-border-strong) rounded focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
            placeholder="you@brand.com"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-(--ui-text) mb-1">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-(--ui-border-strong) rounded focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
            placeholder="Your password"
          />
        </div>
        {err && (
          <div className="text-sm text-(--ui-danger-fg) bg-(--ui-danger-bg) border border-(--ui-danger-bg) rounded px-3 py-2">
            {err}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-(--ui-primary) text-(--ui-on-primary) py-2 rounded font-medium hover:bg-(--ui-primary-strong) disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div className="text-sm text-(--ui-text-muted) mt-6 flex items-center justify-between">
        <Link
          to={`/manufacturer-portal/${tenantSlug}/forgot-password`}
          className="text-(--ui-link) hover:text-(--ui-link)"
        >
          Forgot password?
        </Link>
      </div>
      <p className="text-xs text-(--ui-text-muted) mt-4">
        First time here? Use the setup link from your invite email instead.
      </p>
    </div>
  );
}
