// What the counter last saw online, per shop (One Toy Store pilot, blocker 3h).
// After a reload with the internet down, the POS falls back to these — the
// shop's currency, its branches, the open till and the cashier's clock-in — so
// it can keep selling. Offline sales are booked by the server at the time they
// were rung up, in the till open then (routes/sales.js), so a stale entry here
// can't put a sale in the wrong till.
import { readTenantSlug } from "../auth/authStore";

const PREFIX = "sanopos_last_known_v1";

function storageKey(name) {
  return `${PREFIX}:${readTenantSlug() || "default"}:${name}`;
}

export function saveLastKnown(name, value) {
  try {
    localStorage.setItem(storageKey(name), JSON.stringify({ value, savedAt: new Date().toISOString() }));
  } catch { /* storage full or blocked: nothing to fall back to later */ }
}

/** { value, savedAt } or null. */
export function readLastKnown(name) {
  try {
    const raw = localStorage.getItem(storageKey(name));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** True for a failure that means "couldn't reach the server", not a refusal. */
export function isUnreachable(err) {
  return err instanceof TypeError || err?.status >= 502;
}
