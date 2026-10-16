import { API_BASE } from "../../../config";

/** A kept bill file: an R2 URL (signed by the API) or, on a PC without R2, a path on the API. */
export function billFileHref(storageKey) {
  const k = String(storageKey || "");
  if (!k) return null;
  return /^https?:\/\//.test(k) ? k : `${API_BASE.replace(/\/$/, "")}/${k.replace(/^\//, "")}`;
}
