import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Store, CheckCircle, XCircle } from "lucide-react";
import { API_BASE } from "../config";

const PLANS = [
  { value: "free", label: "Free", desc: "1 outlet, 1 employee" },
  { value: "starter", label: "Starter", desc: "Up to 3 outlets, 10 employees" },
  { value: "pro", label: "Pro", desc: "Unlimited outlets and employees" },
];

export default function SignupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    store_name: "",
    owner_name: "",
    email: "",
    password: "",
    plan: "free",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  // Pre-select plan from URL param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const planParam = params.get("plan");
    if (planParam && ["free", "starter", "pro"].includes(planParam)) {
      setForm((f) => ({ ...f, plan: planParam }));
    }
  }, []);

  const valid =
    form.store_name.trim().length >= 3 &&
    form.owner_name.trim() &&
    form.email.trim() &&
    form.password.length >= 8;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signup failed");
      // Redirect immediately to setup wizard
      if (data.setupToken && data.slug) {
        window.location.href = `/setup?token=${data.setupToken}&tenant=${data.slug}`;
        return;
      }
      // Fallback: show success screen (if token not returned)
      setResult({ success: true, slug: data.slug, message: data.message });
    } catch (err) {
      setResult({ success: false, message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  if (result?.success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6 text-center">
          <CheckCircle size={40} className="mx-auto text-emerald-500 mb-3" />
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Store Created!</h2>
          <p className="text-sm text-slate-600 mb-2">{result.message}</p>
          <p className="text-xs text-slate-500 mb-4">
            Your store code is: <span className="font-mono font-bold text-slate-800">{result.slug}</span>
          </p>
          <button
            onClick={() => navigate("/login")}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2.5 font-semibold transition-colors cursor-pointer"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  if (result && !result.success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6 text-center">
          <XCircle size={40} className="mx-auto text-red-500 mb-3" />
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Signup Failed</h2>
          <p className="text-sm text-slate-600 mb-4">{result.message}</p>
          <button
            onClick={() => setResult(null)}
            className="w-full bg-slate-600 hover:bg-slate-700 text-white rounded-lg py-2.5 font-semibold transition-colors cursor-pointer"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6">
        <div className="text-center mb-6">
          <Store size={36} className="mx-auto text-emerald-600 mb-2" />
          <h1 className="text-xl font-bold text-slate-900">Create your store</h1>
          <p className="text-sm text-slate-500 mt-1">Get started with SanoPOS in minutes</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Store Name</label>
            <input
              type="text"
              value={form.store_name}
              onChange={set("store_name")}
              placeholder="My Awesome Store"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              required
              minLength={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Your Name</label>
            <input
              type="text"
              value={form.owner_name}
              onChange={set("owner_name")}
              placeholder="John Doe"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={set("email")}
              placeholder="you@example.com"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={set("password")}
              placeholder="Min 8 characters"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              required
              minLength={8}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Plan</label>
            <div className="grid grid-cols-3 gap-2">
              {PLANS.map((p) => (
                <label
                  key={p.value}
                  className={`flex cursor-pointer flex-col items-center rounded-lg border-2 p-3 text-center transition-all ${
                    form.plan === p.value
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="plan"
                    value={p.value}
                    checked={form.plan === p.value}
                    onChange={set("plan")}
                    className="sr-only"
                  />
                  <span className="text-sm font-semibold text-slate-900">{p.label}</span>
                  <span className="mt-0.5 text-xs text-slate-500">{p.desc}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={!valid || loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg py-2.5 font-semibold transition-colors cursor-pointer"
          >
            {loading ? "Creating store..." : "Create Store"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          Already have an account?{" "}
          <button
            onClick={() => navigate("/login")}
            className="font-medium text-emerald-600 hover:text-emerald-700 cursor-pointer"
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
