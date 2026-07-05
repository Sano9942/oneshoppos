import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  Lock,
  Store,
  User,
  WifiOff,
  Zap,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { api } from "../api";
import { IS_MULTI_TENANT } from "../config";
import { useCurrency } from "../contexts/CurrencyContext";

const LOGIN_IMAGE =
  "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1600&q=80";

function ForgotPasswordModal({ storeCode, onClose }) {
  const [username, setUsername] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!username.trim()) return;

    setLoading(true);
    try {
      await api.raw("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          store_code: IS_MULTI_TENANT ? storeCode : undefined,
        }),
      });
    } catch {
      // Always show the same response so account lookup cannot be guessed.
    }
    setSubmitted(true);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-sm rounded-lg border border-(--ui-border) bg-(--ui-surface) p-6 shadow-xl">
        <h2 className="text-xl font-extrabold text-(--ui-text)">Reset Password</h2>
        {submitted ? (
          <>
            <p className="mt-3 text-sm leading-6 text-(--ui-text-muted)">
              If that username exists and has an email address, a reset link has been sent.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 w-full rounded-lg bg-(--ui-primary) px-4 py-3 text-sm font-bold text-(--ui-on-primary) hover:bg-(--ui-primary-strong)"
            >
              Back To Login
            </button>
          </>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <p className="text-sm leading-6 text-(--ui-text-muted)">
              Enter your username and we will send a reset link to your email.
            </p>
            <label className="block">
              <span className="text-sm font-semibold text-(--ui-text)">Username</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-2 w-full rounded-lg border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-3 text-sm text-(--ui-text) outline-none focus:border-(--ui-focus) focus:ring-2 focus:ring-(--ui-focus)/20"
                placeholder="Employee username"
                autoFocus
              />
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-(--ui-border-strong) px-4 py-3 text-sm font-bold text-(--ui-text) hover:bg-(--ui-muted-surface)"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !username.trim()}
                className="flex-1 rounded-lg bg-(--ui-primary) px-4 py-3 text-sm font-bold text-(--ui-on-primary) hover:bg-(--ui-primary-strong) disabled:opacity-50"
              >
                {loading ? "Sending..." : "Send Link"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function LoginForm() {
  const { login } = useAuth();
  const { refresh: refreshCurrency } = useCurrency();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [storeCode, setStoreCode] = useState(searchParams.get("store") || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  const canSubmit =
    username.trim() && password.trim() && (!IS_MULTI_TENANT || storeCode.trim());

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError("");
    try {
      await login(
        username.trim(),
        password.trim(),
        IS_MULTI_TENANT ? storeCode.trim() : undefined,
      );
      refreshCurrency();
      navigate("/context-select", { replace: true });
    } catch (err) {
      setError(err.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-4">
        {IS_MULTI_TENANT && (
          <label className="block">
            <span className="text-sm font-semibold text-(--ui-text)">Store Code</span>
            <div className="relative mt-2">
              <Store
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text-muted)"
              />
              <input
                value={storeCode}
                onChange={(event) => setStoreCode(event.target.value)}
                className="w-full rounded-lg border border-(--ui-border-strong) bg-(--ui-surface) py-3 pl-10 pr-3 text-sm text-(--ui-text) outline-none focus:border-(--ui-focus) focus:ring-2 focus:ring-(--ui-focus)/20"
                placeholder="e.g. aceshardware"
                autoComplete="organization"
                autoFocus
              />
            </div>
          </label>
        )}

        <label className="block">
          <span className="text-sm font-semibold text-(--ui-text)">Username</span>
          <div className="relative mt-2">
            <User
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text-muted)"
            />
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-lg border border-(--ui-border-strong) bg-(--ui-surface) py-3 pl-10 pr-3 text-sm text-(--ui-text) outline-none focus:border-(--ui-focus) focus:ring-2 focus:ring-(--ui-focus)/20"
              placeholder="Employee username"
              autoComplete="username"
              autoFocus={!IS_MULTI_TENANT}
            />
          </div>
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-(--ui-text)">Password</span>
          <div className="relative mt-2">
            <Lock
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text-muted)"
            />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-(--ui-border-strong) bg-(--ui-surface) py-3 pl-10 pr-3 text-sm text-(--ui-text) outline-none focus:border-(--ui-focus) focus:ring-2 focus:ring-(--ui-focus)/20"
              placeholder="Enter your password"
              autoComplete="current-password"
            />
          </div>
        </label>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-(--ui-text-muted)">You will choose your branch after sign in.</p>
          <button
            type="button"
            onClick={() => setShowForgot(true)}
            className="shrink-0 text-sm font-semibold text-(--ui-text) hover:text-(--ui-link)"
          >
            Forgot password?
          </button>
        </div>

        {error && (
          <p className="rounded-lg border border-(--ui-danger-bg) bg-(--ui-danger-bg) px-3 py-2 text-sm font-semibold text-(--ui-danger-fg)">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !canSubmit}
          className="inline-flex w-full items-center justify-center rounded-lg bg-(--ui-primary) px-4 py-3 text-sm font-bold text-(--ui-on-primary) hover:bg-(--ui-primary-strong) disabled:opacity-50"
        >
          {loading ? "Signing In..." : "Sign In"}
          {!loading && <ArrowRight className="ml-2" size={17} />}
        </button>
      </form>

      {showForgot && (
        <ForgotPasswordModal storeCode={storeCode} onClose={() => setShowForgot(false)} />
      )}
    </>
  );
}

export default function LoginPage() {
  const { isAuthenticated, isBootstrapping } = useAuth();

  if (isBootstrapping) {
    return <div className="min-h-screen bg-(--ui-primary)" />;
  }

  if (isAuthenticated) {
    return <Navigate to="/context-select" replace />;
  }

  return (
    <div className="min-h-screen bg-(--ui-muted-surface) text-(--ui-text)">
      <nav className="border-b border-(--ui-border) bg-(--ui-surface)">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
          <a href="/" className="flex items-center gap-2 text-lg font-bold text-(--ui-text)">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-(--ui-primary) text-(--ui-on-primary)">
              <Zap size={17} />
            </span>
            SanoPOS
          </a>
          <a
            href="/"
            className="inline-flex items-center rounded-lg border border-(--ui-border-strong) px-4 py-2 text-sm font-bold text-(--ui-text) hover:bg-(--ui-muted-surface)"
          >
            <ArrowLeft className="mr-2" size={16} />
            Home
          </a>
        </div>
      </nav>

      <main className="mx-auto grid min-h-[calc(100vh-65px)] max-w-7xl items-stretch gap-0 px-5 py-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-10">
        <section className="relative hidden overflow-hidden rounded-lg lg:block">
          <img
            src={LOGIN_IMAGE}
            alt="Business team reviewing sales and operations"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-(--ui-primary)/58" />
          <div className="relative flex h-full flex-col justify-end p-10 text-(--ui-on-primary)">
            <p className="mb-4 inline-flex w-fit rounded-lg border border-white/30 bg-(--ui-surface)/10 px-3 py-2 text-sm font-bold backdrop-blur">
              One login for sales, stock, staff, branches, and reports
            </p>
            <h1 className="max-w-2xl text-5xl font-extrabold leading-tight">
              Open the right branch and get back to work.
            </h1>
            <div className="mt-8 grid max-w-3xl gap-3 md:grid-cols-3">
              {[
                { icon: Building2, text: "Outlet selection after login" },
                { icon: WifiOff, text: "Offline sales stay protected" },
                { icon: BadgeCheck, text: "Admin permissions respected" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2 text-sm font-semibold text-(--ui-on-primary)/86">
                  <Icon size={17} className="text-(--ui-text)" />
                  {text}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center bg-(--ui-surface) px-0 py-8 sm:px-6 lg:rounded-r-lg lg:border-y lg:border-r lg:border-(--ui-border) lg:px-10">
          <div className="w-full max-w-md">
            <div className="mb-7">
              <p className="mb-3 text-sm font-bold text-(--ui-text)">Secure Store Login</p>
              <h2 className="text-3xl font-extrabold leading-tight text-(--ui-text)">
                Sign in to SanoPOS
              </h2>
              <p className="mt-3 text-sm leading-6 text-(--ui-text-muted)">
                {IS_MULTI_TENANT
                  ? "Enter your store code, username, and password."
                  : "Enter your username and password."}
              </p>
            </div>

            <LoginForm />

            <p className="mt-6 text-center text-sm text-(--ui-text-muted)">
              New to SanoPOS?{" "}
              <a href="/signup?plan=free" className="font-bold text-(--ui-text) hover:text-(--ui-link)">
                Start free
              </a>
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
