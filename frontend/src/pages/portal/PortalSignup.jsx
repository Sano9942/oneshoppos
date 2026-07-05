import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

export default function PortalSignup() {
  const { tenantSlug } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", mobile: "", password: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  function update(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function submit(e) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await portalApi.post(tenantSlug, "/api/portal/auth/signup", form);
      navigate(`/portal/${tenantSlug}/verify-otp?email=${encodeURIComponent(form.email)}&purpose=email_verify`);
    } catch (err) {
      setError(err.message || "Signup failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-md mx-auto bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6">
      <h1 className="text-xl font-semibold mb-1">Create your account</h1>
      <p className="text-sm text-(--ui-text-muted) mb-6">We'll email you a code to verify your address.</p>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Full name</label>
          <input
            required
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className="w-full border border-(--ui-border-strong) rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            className="w-full border border-(--ui-border-strong) rounded px-3 py-2"
            autoComplete="email"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Mobile (optional)</label>
          <input
            value={form.mobile}
            onChange={(e) => update("mobile", e.target.value)}
            className="w-full border border-(--ui-border-strong) rounded px-3 py-2"
            autoComplete="tel"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Password</label>
          <input
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={(e) => update("password", e.target.value)}
            className="w-full border border-(--ui-border-strong) rounded px-3 py-2"
            autoComplete="new-password"
          />
          <p className="text-xs text-(--ui-text-muted) mt-1">At least 8 characters.</p>
        </div>

        {error && <div className="text-sm text-(--ui-danger-fg)">{error}</div>}

        <button
          type="submit"
          disabled={sending}
          className="w-full bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-(--ui-on-primary) py-2 rounded font-medium disabled:opacity-50"
        >
          {sending ? "Creating…" : "Create account"}
        </button>
      </form>

      <div className="border-t border-(--ui-border) mt-6 pt-4 text-sm text-(--ui-text-muted) text-center">
        Already have an account?{" "}
        <Link to={`/portal/${tenantSlug}/login`} className="text-(--ui-link) font-medium hover:underline">
          Sign in
        </Link>
      </div>
    </div>
  );
}
