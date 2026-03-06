import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Lock, Mail, Shield } from "lucide-react";
import { API_BASE } from "../../config";

function readAdminSession() {
  try {
    return JSON.parse(localStorage.getItem("adminSession") || "null");
  } catch {
    return null;
  }
}

export function writeAdminSession(session) {
  localStorage.setItem("adminSession", JSON.stringify(session));
}

export function clearAdminSession() {
  localStorage.removeItem("adminSession");
}

export function getAdminToken() {
  return readAdminSession()?.token || null;
}

export function getAdminSession() {
  return readAdminSession();
}

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
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-violet-600">
            <Shield size={24} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">Super Admin</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to manage tenants</p>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Email
            </span>
            <div className="relative mt-1">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-700 py-2.5 pl-9 pr-3 text-white placeholder-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                placeholder="admin@example.com"
                autoFocus
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Password
            </span>
            <div className="relative mt-1">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-700 py-2.5 pl-9 pr-3 text-white placeholder-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                placeholder="Password"
              />
            </div>
          </label>

          {error && (
            <p className="text-sm font-medium text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="w-full rounded-lg bg-violet-600 py-2.5 font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
