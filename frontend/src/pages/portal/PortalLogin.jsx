import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";
import { usePortalAuth } from "./PortalAuthProvider";

// W34: tab-key → human label mapping for the login subtitle. Source of truth
// for which tabs exist is `enabled_tabs` from `/api/portal/config`, which the
// backend gates per industry preset (`PORTAL_ENABLED_TABS_BY_PRESET`).
const TAB_LABELS = {
  invoices: "invoices",
  orders: "orders",
  appointments: "appointments",
  subscriptions: "subscriptions",
  contracts: "contracts",
  tickets: "tickets",
  loyalty: "loyalty",
  wallet: "wallet",
  profile: "account",
  stays: "stays",
  treatments: "treatments",
};
const DEFAULT_SUBTITLE = "Access your invoices, bookings, and account.";

function buildSubtitle(enabledTabs) {
  if (!Array.isArray(enabledTabs) || enabledTabs.length === 0) {
    return DEFAULT_SUBTITLE;
  }
  // Always anchor on "account" to match the original UX.
  const labels = enabledTabs
    .map((key) => TAB_LABELS[key])
    .filter(Boolean);
  if (!labels.includes("account")) labels.push("account");
  if (labels.length === 1) return `Access your ${labels[0]}.`;
  if (labels.length === 2) return `Access your ${labels[0]} and ${labels[1]}.`;
  const last = labels.pop();
  return `Access your ${labels.join(", ")}, and ${last}.`;
}

export default function PortalLogin() {
  const { tenantSlug } = useParams();
  const navigate = useNavigate();
  const auth = usePortalAuth();
  const [mode, setMode] = useState("password"); // "password" | "otp"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [subtitle, setSubtitle] = useState(DEFAULT_SUBTITLE);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .get(tenantSlug, "/api/portal/config")
      .then((cfg) => {
        if (cancelled) return;
        setSubtitle(buildSubtitle(cfg?.enabled_tabs));
      })
      .catch(() => {
        // Fail open — subtitle stays the default. Login form still works.
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  async function submitPassword(e) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await portalApi.post(tenantSlug, "/api/portal/auth/login", { email, password });
      auth.setSession(res);
      navigate(`/portal/${tenantSlug}`, { replace: true });
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setSending(false);
    }
  }

  async function requestOtp() {
    setSending(true);
    setError(null);
    setInfo(null);
    try {
      await portalApi.post(tenantSlug, "/api/portal/auth/request-otp", {
        email,
        purpose: "login",
      });
      setInfo("If the email is registered, a code has been sent.");
      navigate(`/portal/${tenantSlug}/verify-otp?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(err.message || "Could not send code");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <h1 className="text-xl font-semibold mb-1">Sign in</h1>
      <p className="text-sm text-slate-500 mb-6">{subtitle}</p>

      <form onSubmit={mode === "password" ? submitPassword : (e) => { e.preventDefault(); requestOtp(); }}>
        <label className="block text-sm font-medium mb-1">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-slate-300 rounded px-3 py-2 mb-4"
          autoComplete="email"
        />

        {mode === "password" && (
          <>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 mb-4"
              autoComplete="current-password"
            />
          </>
        )}

        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
        {info && <div className="text-sm text-emerald-700 mb-3">{info}</div>}

        <button
          type="submit"
          disabled={sending}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded font-medium disabled:opacity-50"
        >
          {sending ? "Please wait…" : mode === "password" ? "Sign in" : "Email me a code"}
        </button>
      </form>

      <div className="flex items-center justify-between mt-4 text-sm">
        <button
          type="button"
          className="text-slate-600 hover:text-slate-900"
          onClick={() => {
            setMode(mode === "password" ? "otp" : "password");
            setError(null);
          }}
        >
          {mode === "password" ? "Email me a code instead" : "Use my password"}
        </button>
        {mode === "password" && (
          <Link to={`/portal/${tenantSlug}/forgot`} className="text-emerald-700 hover:underline">
            Forgot password?
          </Link>
        )}
      </div>

      <div className="border-t border-slate-200 mt-6 pt-4 text-sm text-slate-600 text-center">
        New here?{" "}
        <Link to={`/portal/${tenantSlug}/signup`} className="text-emerald-700 font-medium hover:underline">
          Create an account
        </Link>
      </div>
    </div>
  );
}
