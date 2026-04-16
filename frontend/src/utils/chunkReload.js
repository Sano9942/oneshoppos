// Stale-chunk recovery helpers — extracted from main.jsx for testability.
//
// After a deploy, clients holding an old index hash try to lazy-load a
// chunk filename that no longer exists on the server. The page silently
// breaks. Sentry SANOPOS-FRONTEND-7 (2026-04-12) was exactly this.

const RELOAD_KEY = "__sanopos_chunk_reload_at";
const RELOAD_GUARD_MS = 30_000;

// Returns true when the error message looks like a missing-chunk failure
// (after-deploy stale-hash bug), false for genuine network errors so we
// don't reload-loop during outages.
export function looksLikeChunkLoadFailure(err) {
  if (!err) return false;
  const msg = (err.message || String(err) || "").toLowerCase();
  return (
    msg.includes("dynamically imported module") ||
    msg.includes("failed to fetch") ||
    msg.includes("loading chunk") ||
    msg.includes("loading css chunk") ||
    msg.includes("importing a module script")
  );
}

// Reload the page at most once per RELOAD_GUARD_MS window, persisted in
// sessionStorage so navigation across the SPA also respects the guard.
// Returns true if a reload was triggered, false if suppressed by the guard.
export function reloadOnceForChunkFailure({
  storage = typeof sessionStorage !== "undefined" ? sessionStorage : null,
  reload = () => window.location.reload(),
  now = () => Date.now(),
} = {}) {
  if (!storage) return false;
  const last = Number(storage.getItem(RELOAD_KEY) || 0);
  if (now() - last < RELOAD_GUARD_MS) return false;
  storage.setItem(RELOAD_KEY, String(now()));
  reload();
  return true;
}

export const __test__ = { RELOAD_KEY, RELOAD_GUARD_MS };
