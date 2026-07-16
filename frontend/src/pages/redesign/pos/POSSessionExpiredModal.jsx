import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { usePOS } from "./POSContext";
import { api } from "../../../api";

export default function POSSessionExpiredModal() {
  const {
    sessionExpired,
    setSessionExpired,
    retryPendingSale,
    parkSale,
    logout,
    navigate,
    employee,
    authHeaders,
  } = usePOS();

  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (!sessionExpired) return null;

  const handleReLogin = async (e) => {
    e.preventDefault();
    if (!pin) return;
    setError("");
    setLoading(true);
    try {
      // Use validate-pin (not /auth/login) — POS re-auth is always PIN-based,
      // even after employee has a password set for dashboard login.
      const data = await api.post("/api/employees/validate-pin", { pin_code: pin });
      if (!data.employee) {
        setError("Invalid PIN");
        setPin("");
        return;
      }
      setPin("");
      await retryPendingSale();
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Order matters. The park runs on the already-expired token, so it can fail;
  // if it does, the cart is still live and leaving would silently lose the
  // sale. So: park first, and only once it's confirmed safe do we tear the
  // session down. logout() before navigate() is what makes /login actually
  // render — while isAuthenticated is still true, LoginPage bounces straight
  // to /context-select, which strands the cashier on a dead token.
  const handleCancel = async () => {
    setError("");
    setCancelling(true);
    try {
      const parked = await parkSale();
      if (!parked) {
        setError(
          "Couldn't park the sale — it's still on this terminal. Try again, or enter your PIN above to complete it.",
        );
        return;
      }
      setSessionExpired(false);
      await logout();
      navigate("/login", { replace: true });
    } catch {
      setError("Couldn't park the sale — it's still on this terminal. Try again.");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-(--ui-surface) p-8 shadow-(--ui-shadow-lg) flex flex-col items-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-(--ui-warning-bg) text-(--ui-warning-fg)">
          <AlertTriangle size={32} />
        </div>
        <h1 className="mb-1 text-xl font-bold text-(--ui-text)">Session Expired</h1>
        <p className="mb-1 text-center text-sm text-(--ui-text-muted)">
          Your session expired during checkout.
        </p>
        <p className="mb-6 text-center text-sm font-medium text-(--ui-text)">
          {employee?.name}
        </p>
        <form onSubmit={handleReLogin} className="flex w-full flex-col gap-4">
          <input
            type="password"
            autoFocus
            maxLength="10"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setError("");
            }}
            className="w-full rounded-xl border border-(--ui-border-strong) py-3 px-4 text-center font-mono text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
            placeholder="••••"
          />
          {error && (
            <p className="text-center text-sm font-medium text-(--ui-danger)">{error}</p>
          )}
          <button
            type="submit"
            disabled={!pin || loading}
            className="w-full rounded-xl bg-(--ui-primary) py-3 font-bold text-white hover:bg-(--ui-primary-strong) disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loading ? "Verifying…" : "Re-login & Complete Sale"}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling || loading}
            className="text-center text-sm text-(--ui-text-muted) hover:text-(--ui-text) disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelling ? "Parking sale…" : "Park sale & go to login"}
          </button>
        </form>
      </div>
    </div>
  );
}
