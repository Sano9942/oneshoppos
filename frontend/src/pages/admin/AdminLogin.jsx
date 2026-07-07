import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Lock, Mail, Shield, KeyRound } from "lucide-react";
import { API_BASE } from "../../config";
import {
  readAdminSession,
  writeAdminSession,
  getAdminToken,
} from "../../auth/adminAuthStore";

// Re-export from adminAuthStore so existing admin components keep their import paths working.
export { writeAdminSession, getAdminToken } from "../../auth/adminAuthStore";
export { clearAdminSession, getAdminSession } from "../../auth/adminAuthStore";

// Silent refresh: exchange the httpOnly refresh cookie for a new access token.
// Coalesced so concurrent 401s trigger only one refresh call.
let _adminRefreshPromise = null;
async function refreshAdminToken() {
  const res = await fetch(`${API_BASE}/api/admin/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data?.token) return null;
  const session = readAdminSession() || {};
  writeAdminSession({ ...session, token: data.token, loadedAt: Date.now() });
  return data.token;
}

export async function adminFetch(path, options = {}) {
  const doFetch = (tok) =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: "include",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}`, ...options.headers },
    });

  let res = await doFetch(getAdminToken());
  if (res.status === 401) {
    let body = null;
    try { body = await res.clone().json(); } catch { /* non-JSON 401 */ }
    if (body?.code === "TOKEN_EXPIRED") {
      if (!_adminRefreshPromise) {
        _adminRefreshPromise = refreshAdminToken().finally(() => { _adminRefreshPromise = null; });
      }
      const newToken = await _adminRefreshPromise;
      if (newToken) res = await doFetch(newToken);
    }
  }
  return res;
}

export default function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // 2FA second step
  const [stage, setStage] = useState("password"); // "password" | "totp"
  const [pendingToken, setPendingToken] = useState("");
  const [code, setCode] = useState("");

  const session = readAdminSession();
  if (session?.token && session?.admin?.id) {
    return <Navigate to="/admin" replace />;
  }

  const canSubmit = email.trim() && password.trim();

  const finishLogin = (data) => {
    writeAdminSession({ token: data.token, admin: data.admin, loadedAt: Date.now() });
    navigate("/admin", { replace: true });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/admin/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password: password.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      if (data.totp_required) {
        setPendingToken(data.pending_token);
        setStage("totp");
        return;
      }
      finishLogin(data);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const onSubmitTotp = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/admin/auth/totp`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pending_token: pendingToken, code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Expired/invalid pending token → send the admin back to the password step.
        if (data.code === "PENDING_EXPIRED" || data.code === "PENDING_INVALID") {
          setStage("password");
          setPendingToken("");
          setCode("");
        }
        throw new Error(data.error || "Verification failed");
      }
      finishLogin(data);
    } catch (err) {
      setError(err.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  if (stage === "totp") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-(--ui-bg) px-4">
        <div className="w-full max-w-md rounded-(--ui-radius-lg) border border-(--ui-border) bg-(--ui-surface) p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-(--ui-primary)">
              <KeyRound size={24} className="text-(--ui-on-primary)" />
            </div>
            <h1 className="text-xl font-bold text-(--ui-text)">Two-factor authentication</h1>
            <p className="mt-1 text-sm text-(--ui-text-muted)">
              Enter the 6-digit code from your authenticator app, or a recovery code.
            </p>
          </div>

          <form className="space-y-4" onSubmit={onSubmitTotp}>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wide text-(--ui-text-muted)">
                Authentication code
              </span>
              <div className="relative mt-1">
                <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text-muted)" />
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white py-2.5 pl-9 pr-3 tracking-widest text-(--ui-text) placeholder:text-(--ui-text-muted)"
                  placeholder="123456"
                  autoFocus
                />
              </div>
            </label>

            {error && <p className="text-sm font-medium text-(--ui-danger)">{error}</p>}

            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="ui-focus-ring w-full rounded-full bg-(--ui-primary) py-2.5 font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong) disabled:opacity-60"
            >
              {loading ? "Verifying..." : "Verify"}
            </button>
            <button
              type="button"
              onClick={() => { setStage("password"); setCode(""); setError(""); setPendingToken(""); }}
              className="ui-focus-ring w-full rounded-full py-2 text-sm font-medium text-(--ui-text-muted) hover:text-(--ui-text)"
            >
              Back to sign in
            </button>
          </form>
        </div>
      </div>
    );
  }

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
