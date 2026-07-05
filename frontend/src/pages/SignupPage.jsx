import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Store, CheckCircle, XCircle } from "lucide-react";
import { api } from "../api";
import { TURNSTILE_SITE_KEY } from "../config";

// Lightweight Turnstile loader — no npm dep needed. Loads the official
// challenges.cloudflare.com script once per page lifetime, renders the
// widget into a div ref, and calls onChange(token) when the user solves it.
// If TURNSTILE_SITE_KEY is empty, the component renders nothing (CAPTCHA off).
function TurnstileWidget({ siteKey, onChange }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;

    function render() {
      if (!window.turnstile || !containerRef.current) return;
      // Avoid double-render on hot reload / strict mode
      if (widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => onChange(token),
        "error-callback": () => onChange(""),
        "expired-callback": () => onChange(""),
        theme: "light",
      });
    }

    if (window.turnstile) {
      render();
      return;
    }
    // Inject the loader script once
    const existing = document.querySelector('script[data-turnstile]');
    if (existing) {
      existing.addEventListener("load", render, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = "1";
    script.onload = render;
    document.head.appendChild(script);

    return () => {
      try {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
        }
      } catch { /* widget already removed */ }
      widgetIdRef.current = null;
    };
  }, [siteKey, onChange]);

  if (!siteKey) return null;
  return <div ref={containerRef} className="flex justify-center" />;
}

export default function SignupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    store_name: "",
    owner_name: "",
    email: "",
    password: "",
  });
  const [tosAccepted, setTosAccepted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const captchaRequired = !!TURNSTILE_SITE_KEY;
  const valid =
    form.store_name.trim().length >= 3 &&
    form.owner_name.trim() &&
    form.email.trim() &&
    form.password.length >= 8 &&
    tosAccepted &&
    (!captchaRequired || !!turnstileToken);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    try {
      const consent = { tos_accepted: true, tos_version: "1.0", privacy_version: "1.0" };
      const payload = captchaRequired
        ? { ...form, ...consent, turnstile_token: turnstileToken }
        : { ...form, ...consent };
      const data = await api.post("/api/auth/signup", payload);
      // PR 8 flow: backend no longer hands out setupToken until email is
      // verified. Show "Check your email" confirmation. Legacy fallback (if
      // setupToken is somehow returned) still redirects directly.
      if (data.setupToken && data.slug) {
        window.location.href = `/setup?token=${data.setupToken}&tenant=${data.slug}`;
        return;
      }
      setResult({
        success: true,
        slug: data.slug,
        email: data.email || form.email,
        verificationRequired: data.verification_required === true,
        message: data.message,
      });
    } catch (err) {
      setResult({ success: false, message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  if (result?.success) {
    if (result.verificationRequired) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface) p-4">
          <div className="bg-(--ui-surface) rounded-xl shadow-lg w-full max-w-sm p-6 text-center">
            <CheckCircle size={40} className="mx-auto text-(--ui-text) mb-3" />
            <h2 className="text-lg font-semibold text-(--ui-text) mb-2">Check your email</h2>
            <p className="text-sm text-(--ui-text-muted) mb-2">
              We sent a confirmation link to{" "}
              <span className="font-semibold text-(--ui-text)">{result.email}</span>.
              Click the link to verify your email and finish setup.
            </p>
            <p className="text-xs text-(--ui-text-muted) mb-4">
              Your store code is: <span className="font-mono font-bold text-(--ui-text)">{result.slug}</span>
            </p>
            <p className="text-xs text-(--ui-text-muted) mb-4">
              Didn&apos;t get it? Check spam or contact support.
            </p>
            <button
              onClick={() => navigate("/login")}
              className="w-full bg-(--ui-muted-surface) hover:bg-(--ui-muted-surface) text-(--ui-text) rounded-lg py-2 font-semibold transition-colors cursor-pointer text-sm"
            >
              Back to login
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface) p-4">
        <div className="bg-(--ui-surface) rounded-xl shadow-lg w-full max-w-sm p-6 text-center">
          <CheckCircle size={40} className="mx-auto text-(--ui-text) mb-3" />
          <h2 className="text-lg font-semibold text-(--ui-text) mb-2">Store Created!</h2>
          <p className="text-sm text-(--ui-text-muted) mb-2">{result.message}</p>
          <p className="text-xs text-(--ui-text-muted) mb-4">
            Your store code is: <span className="font-mono font-bold text-(--ui-text)">{result.slug}</span>
          </p>
          <button
            onClick={() => navigate("/login")}
            className="w-full bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-(--ui-on-primary) rounded-lg py-2.5 font-semibold transition-colors cursor-pointer"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  if (result && !result.success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface) p-4">
        <div className="bg-(--ui-surface) rounded-xl shadow-lg w-full max-w-sm p-6 text-center">
          <XCircle size={40} className="mx-auto text-(--ui-danger-fg) mb-3" />
          <h2 className="text-lg font-semibold text-(--ui-text) mb-2">Signup Failed</h2>
          <p className="text-sm text-(--ui-text-muted) mb-4">{result.message}</p>
          <button
            onClick={() => setResult(null)}
            className="w-full bg-(--ui-muted-surface) hover:bg-(--ui-primary-strong) text-(--ui-on-primary) rounded-lg py-2.5 font-semibold transition-colors cursor-pointer"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface) p-4">
      <div className="bg-(--ui-surface) rounded-xl shadow-lg w-full max-w-md p-6">
        <div className="text-center mb-6">
          <Store size={36} className="mx-auto text-(--ui-text) mb-2" />
          <h1 className="text-xl font-bold text-(--ui-text)">Create your store</h1>
          <p className="text-sm text-(--ui-text-muted) mt-1">Get started with SanoPOS in minutes</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-(--ui-text) mb-1">Store Name</label>
            <input
              type="text"
              value={form.store_name}
              onChange={set("store_name")}
              placeholder="My Awesome Store"
              className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-(--ui-focus)/20 focus:border-(--ui-focus)"
              required
              minLength={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-(--ui-text) mb-1">Your Name</label>
            <input
              type="text"
              value={form.owner_name}
              onChange={set("owner_name")}
              placeholder="John Doe"
              className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-(--ui-focus)/20 focus:border-(--ui-focus)"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-(--ui-text) mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={set("email")}
              placeholder="you@example.com"
              className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-(--ui-focus)/20 focus:border-(--ui-focus)"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-(--ui-text) mb-1">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={set("password")}
              placeholder="Min 8 characters"
              className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-(--ui-focus)/20 focus:border-(--ui-focus)"
              required
              minLength={8}
            />
          </div>

          <p className="text-xs text-(--ui-text-muted) text-center">
            You'll start on our <span className="font-semibold text-(--ui-text)">Free plan</span> — 1 outlet, 3 employees, 100 products. Upgrade to Pro anytime from your dashboard.
          </p>

          <label className="flex items-start gap-2 text-xs text-(--ui-text-muted) cursor-pointer">
            <input
              type="checkbox"
              checked={tosAccepted}
              onChange={(e) => setTosAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-(--ui-border-strong) text-(--ui-text) focus:ring-(--ui-focus)"
            />
            <span>
              I agree to the{" "}
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-(--ui-text) hover:underline"
              >
                Terms of Service
              </a>{" "}
              and{" "}
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-(--ui-text) hover:underline"
              >
                Privacy Policy
              </a>
              .
            </span>
          </label>

          <TurnstileWidget siteKey={TURNSTILE_SITE_KEY} onChange={setTurnstileToken} />

          <button
            type="submit"
            disabled={!valid || loading}
            className="w-full bg-(--ui-primary) hover:bg-(--ui-primary-strong) disabled:opacity-50 text-(--ui-on-primary) rounded-lg py-2.5 font-semibold transition-colors cursor-pointer"
          >
            {loading ? "Creating store..." : "Create Store"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-(--ui-text-muted)">
          Already have an account?{" "}
          <button
            onClick={() => navigate("/login")}
            className="font-medium text-(--ui-text) hover:text-(--ui-link) cursor-pointer"
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
