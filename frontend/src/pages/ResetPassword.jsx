import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Lock, CheckCircle, XCircle } from "lucide-react";
import { api } from "../api";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") || "";
  const tenant = searchParams.get("tenant") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const valid = password.length >= 8 && password === confirm && token;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    try {
      const data = await api.post("/api/auth/reset-password", {
        token,
        new_password: password,
        store_code: tenant || undefined,
      });
      setResult({ success: true, message: data.message });
    } catch (err) {
      setResult({ success: false, message: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface) p-4">
        <div className="bg-(--ui-surface) rounded-xl shadow-lg w-full max-w-sm p-6 text-center">
          <XCircle size={40} className="mx-auto text-(--ui-danger-fg) mb-3" />
          <h2 className="text-lg font-semibold text-(--ui-text) mb-2">Invalid Link</h2>
          <p className="text-sm text-(--ui-text-muted) mb-4">This password reset link is invalid or has expired.</p>
          <button
            onClick={() => navigate("/login")}
            className="w-full bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-(--ui-on-primary) rounded-lg py-2.5 font-semibold transition-colors cursor-pointer"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface) p-4">
        <div className="bg-(--ui-surface) rounded-xl shadow-lg w-full max-w-sm p-6 text-center">
          {result.success ? (
            <CheckCircle size={40} className="mx-auto text-(--ui-text) mb-3" />
          ) : (
            <XCircle size={40} className="mx-auto text-(--ui-danger-fg) mb-3" />
          )}
          <h2 className="text-lg font-semibold text-(--ui-text) mb-2">
            {result.success ? "Password Reset" : "Reset Failed"}
          </h2>
          <p className="text-sm text-(--ui-text-muted) mb-4">{result.message}</p>
          <button
            onClick={() => navigate("/login")}
            className="w-full bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-(--ui-on-primary) rounded-lg py-2.5 font-semibold transition-colors cursor-pointer"
          >
            {result.success ? "Sign In" : "Back to Login"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface) p-4">
      <div className="bg-(--ui-surface) rounded-xl shadow-lg w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold text-(--ui-text) mb-1">Set New Password</h2>
        <p className="text-sm text-(--ui-text-muted) mb-4">Choose a new password for your account.</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">New Password</span>
            <div className="mt-1.5 relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text-muted)" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 border border-(--ui-border) rounded-lg bg-(--ui-surface) focus:outline-none focus:ring-2 focus:ring-(--ui-focus)/30 focus:border-(--ui-focus) transition"
                placeholder="Minimum 8 characters"
                autoFocus
              />
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">Confirm Password</span>
            <div className="mt-1.5 relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text-muted)" />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 border border-(--ui-border) rounded-lg bg-(--ui-surface) focus:outline-none focus:ring-2 focus:ring-(--ui-focus)/30 focus:border-(--ui-focus) transition"
                placeholder="Repeat your password"
              />
            </div>
          </label>
          {password && confirm && password !== confirm && (
            <p className="text-xs text-(--ui-danger-fg)">Passwords do not match</p>
          )}
          {password && password.length < 8 && (
            <p className="text-xs text-(--ui-danger-fg)">Password must be at least 8 characters</p>
          )}
          <button
            type="submit"
            disabled={loading || !valid}
            className="w-full bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-(--ui-on-primary) rounded-lg py-2.5 font-semibold disabled:opacity-50 transition-colors cursor-pointer"
          >
            {loading ? "Resetting..." : "Reset Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
