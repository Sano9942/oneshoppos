/**
 * Error-state logger (2-G.15).
 *
 * Thin wrapper that POSTs a row to /api/action-history so every recovery
 * path in the POS (receipt retry, shift recovery, refund collision, cart
 * resume, barcode miss, insufficient stock) leaves a trail for the
 * merchant to review.
 *
 * Best-effort: failures here must never break the recovery flow itself.
 * We swallow errors silently.
 */

import { api } from "../api";

export async function logErrorState(actionType, description, context = {}) {
  try {
    await api.post("/api/action-history", {
      action_type: actionType,
      description,
      context,
    });
  } catch {
    // best-effort only — never block recovery on logging failure
  }
}
