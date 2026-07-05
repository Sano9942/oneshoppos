import React from "react";
import { Lock } from "lucide-react";
import { usePOS } from "./POSContext";

export default function POSLockScreen() {
  const {
    lockPin,
    setLockPin,
    lockError,
    setLockError,
    handleUnlock,
    logout,
    navigate,
  } = usePOS();

  return (
    <div className="flex h-screen w-full items-center justify-center bg-(--ui-muted-surface)">
      <div className="w-full max-w-sm rounded-2xl bg-(--ui-surface) p-8 shadow-(--ui-shadow-lg) flex flex-col items-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-(--ui-muted-surface) text-(--ui-text)">
          <Lock size={32} />
        </div>
        <h1 className="mb-1 text-2xl font-bold text-(--ui-text)">POS Terminal</h1>
        <p className="mb-6 text-center text-sm text-(--ui-text-muted)">
          Enter your PIN to unlock
        </p>
        <form onSubmit={handleUnlock} className="flex w-full flex-col gap-4">
          <input
            type="password"
            autoFocus
            maxLength="10"
            value={lockPin}
            onChange={(e) => {
              setLockPin(e.target.value);
              setLockError("");
            }}
            className="w-full rounded-xl border border-(--ui-border-strong) py-3 px-4 text-center font-mono text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
            placeholder="••••"
          />
          {lockError && (
            <p className="text-center text-sm font-medium text-(--ui-danger)">
              {lockError}
            </p>
          )}
          <button
            type="submit"
            disabled={!lockPin}
            className="w-full rounded-xl bg-(--ui-primary) py-3 font-bold text-white hover:bg-(--ui-primary-strong) disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Unlock Register
          </button>
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
            className="text-center text-sm text-(--ui-text-muted) hover:text-(--ui-text)"
          >
            Sign out completely
          </button>
        </form>
      </div>
    </div>
  );
}
