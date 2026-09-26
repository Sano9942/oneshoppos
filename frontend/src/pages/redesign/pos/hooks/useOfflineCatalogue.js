import { useState, useEffect, useCallback } from "react";
import { readTenantSlug } from "../../../../auth/authStore";
import { loadCatalogue, refreshCatalogue } from "../../../../utils/offlineCatalogue";

// Keeps the counter's offline catalogue copy fresh (One Toy Store blocker 3a):
// load the saved copy at once (works with the internet down), then download
// changes when the POS opens, every CATALOGUE_REFRESH_MS, and when the browser
// comes back online. An unchanged catalogue costs a 304.
export const CATALOGUE_REFRESH_MS = 10 * 60 * 1000;

export function useOfflineCatalogue() {
  const [state, setState] = useState({ productCount: 0, fetchedAt: null, lastStatus: null });

  const refresh = useCallback(async () => {
    const res = await refreshCatalogue(readTenantSlug());
    setState((prev) => ({
      productCount: res.productCount ?? prev.productCount,
      fetchedAt: res.status === "updated" || res.status === "current" ? new Date().toISOString() : prev.fetchedAt,
      lastStatus: res.status,
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadCatalogue(readTenantSlug());
        if (saved && !cancelled) {
          setState((prev) => ({ ...prev, productCount: saved.productCount, fetchedAt: saved.fetchedAt }));
        }
      } catch { /* IndexedDB unavailable: online lookups still work */ }
      if (!cancelled) refresh().catch(() => {});
    })();
    const timer = setInterval(() => { refresh().catch(() => {}); }, CATALOGUE_REFRESH_MS);
    const onOnline = () => { refresh().catch(() => {}); };
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [refresh]);

  return { ...state, refresh };
}
