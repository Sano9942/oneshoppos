import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

export default function PortalForgotPassword() {
  const { tenantSlug } = useParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await portalApi.post(tenantSlug, "/api/portal/auth/request-password-reset", { email });
      setSent(true);
    } catch (err) {
      setError(err.message || "Could not request reset");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-md mx-auto bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6">
      <h1 className="text-xl font-semibold mb-1">Reset your password</h1>
      <p className="text-sm text-(--ui-text-muted) mb-6">
        Enter your email — if it's registered, we'll send a reset link.
      </p>
      {sent ? (
        <div className="text-(--ui-success-fg) text-sm">
          Check your inbox for the password reset link. You can close this page.
        </div>
      ) : (
        <form onSubmit={submit}>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-(--ui-border-strong) rounded px-3 py-2 mb-4"
            autoComplete="email"
          />
          {error && <div className="text-sm text-(--ui-danger-fg) mb-3">{error}</div>}
          <button
            type="submit"
            disabled={sending}
            className="w-full bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-(--ui-on-primary) py-2 rounded font-medium disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <div className="mt-4 text-sm text-center">
        <Link to={`/portal/${tenantSlug}/login`} className="text-(--ui-link) hover:underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
