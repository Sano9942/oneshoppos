import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Lock, User } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";

export default function Login() {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !pin.trim()) return;
    setLoading(true);
    setError("");
    try {
      await login(username.trim(), pin.trim());
      const next = location.state?.from?.pathname || "/dashboard";
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message || "Invalid username or PIN");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-lg p-8">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-800">Sign In</h1>
          <p className="text-sm text-slate-500 mt-1">
            Enter your username and PIN
          </p>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Username
            </span>
            <div className="mt-1 relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7B61FF]/30 focus:border-[#7B61FF]"
                placeholder="Employee name"
                autoFocus
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
              PIN
            </span>
            <div className="mt-1 relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7B61FF]/30 focus:border-[#7B61FF]"
                placeholder="PIN code"
                maxLength={10}
              />
            </div>
          </label>

          {error && (
            <p className="text-sm text-red-600 font-medium">Invalid username or PIN</p>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim() || !pin.trim()}
            className="w-full bg-[#7B61FF] hover:bg-[#6A50E5] text-white rounded-lg py-2.5 font-semibold disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
