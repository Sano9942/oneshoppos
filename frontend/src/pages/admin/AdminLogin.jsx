import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Lock, Mail, Shield } from "lucide-react";
import { API_BASE } from "../../config";
import {
  readAdminSession,
  writeAdminSession,
  getAdminToken,
} from "../../auth/adminAuthStore";

// Re-export from adminAuthStore so existing admin components keep their import paths working.
export { writeAdminSession, getAdminToken } from "../../auth/adminAuthStore";
export { clearAdminSession, getAdminSession } from "../../auth/adminAuthStore";

export function adminFetch(path, options = {}) {
  const token = getAdminToken();
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers },
  });
}

export default function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const session = readAdminSession();
  if (session?.token && session?.admin?.id) {
    return <Navigate to="/admin" replace />;
  }

  const canSubmit = email.trim() && password.trim();

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/admin/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password: password.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      writeAdminSession({ token: data.token, admin: data.admin, loadedAt: Date.now() });
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-(--ui-bg) px-4">
      <div className="w-full max-w-md rounded-(--ui-radius-lg) border border-(--ui-border) bg-(--ui-surface) p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-(--ui-primary)">
            <Shield size={24} className="text-(--ui-on-primary)" />
          </div>
          <h1 className="text-xl font-bold text-(--ui-text)">Super Admin</h1>
          <p className="mt-1 text-sm text-(--ui-text-muted)">Sign in to manage tenants</p>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-(--ui-text-muted)">
              Email
            </span>
            <div className="relative mt-1">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text-muted)" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white py-2.5 pl-9 pr-3 text-(--ui-text) placeholder:text-(--ui-text-muted)"
                placeholder="admin@example.com"
                autoFocus
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-(--ui-text-muted)">
              Password
            </span>
            <div className="relative mt-1">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text-muted)" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white py-2.5 pl-9 pr-3 text-(--ui-text) placeholder:text-(--ui-text-muted)"
                placeholder="Password"
              />
            </div>
          </label>

          {error && (
            <p className="text-sm font-medium text-(--ui-danger)">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="ui-focus-ring w-full rounded-full bg-(--ui-primary) py-2.5 font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong) disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
