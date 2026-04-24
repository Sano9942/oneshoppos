import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, XCircle, Mail } from "lucide-react";
import { api } from "../api";

/**
 * VerifyEmail
 *
 * Lands here from /verify-email?token=...&tenant=... — the link emailed from
 * /api/auth/signup. POSTs the token to /api/auth/verify-email; on success we
 * receive a fresh setupToken and forward to /setup. On failure (invalid /
 * expired / already used) we show a friendly error with a "back to signup"
 * fallback. PR 9 will add a "resend setup link" CTA here.
 */
function readParams() {
  const params = new URLSearchParams(window.location.search);
  return { token: params.get("token"), tenant: params.get("tenant") };
}

export default function VerifyEmail() {
  const navigate = useNavigate();
  // Derive initial state from the URL synchronously so we don't trip
  // react-hooks/set-state-in-effect on the early-return path.
  const [state, setState] = useState(() => {
    const { token, tenant } = readParams();
    if (!token || !tenant) {
      return { status: "error", message: "This verification link is missing required information." };
    }
    return { status: "loading", message: "" };
  });

  useEffect(() => {
    if (state.status !== "loading") return;
    const { token, tenant } = readParams();
    let cancelled = false;
    api.post("/api/auth/verify-email", { token, tenant })
      .then((data) => {
        if (cancelled) return;
        if (data.setup_complete) {
          setState({ status: "already_set_up", message: "Your store is already set up." });
          setTimeout(() => navigate("/login", { replace: true }), 2000);
          return;
        }
        if (data.setupToken && data.slug) {
          setState({ status: "success", message: "Email verified. Redirecting to setup..." });
          setTimeout(() => {
            window.location.href = `/setup?token=${data.setupToken}&tenant=${data.slug}`;
          }, 1500);
          return;
        }
        setState({ status: "error", message: "Verification succeeded but no setup link was returned." });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err.body?.error || err.message || "Verification failed.",
        });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  if (state.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6 text-center">
          <Mail size={40} className="mx-auto text-emerald-500 mb-3" />
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Verifying your email…</h2>
          <p className="text-sm text-slate-600">Hang tight while we confirm your address.</p>
        </div>
      </div>
    );
  }

  if (state.status === "success" || state.status === "already_set_up") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6 text-center">
          <CheckCircle size={40} className="mx-auto text-emerald-500 mb-3" />
          <h2 className="text-lg font-semibold text-slate-900 mb-2">
            {state.status === "already_set_up" ? "Already set up" : "Email verified"}
          </h2>
          <p className="text-sm text-slate-600">{state.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6 text-center">
        <XCircle size={40} className="mx-auto text-red-500 mb-3" />
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Verification failed</h2>
        <p className="text-sm text-slate-600 mb-4">{state.message}</p>
        <button
          onClick={() => navigate("/signup")}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2.5 font-semibold transition-colors cursor-pointer"
        >
          Back to signup
        </button>
      </div>
    </div>
  );
}
