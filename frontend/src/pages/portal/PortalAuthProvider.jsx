import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  readPortalSession,
  writePortalSession,
  clearPortalSession,
} from "../../auth/customerPortalStore";
import { portalApi } from "../../api/portalApi";

const PortalAuthCtx = createContext(null);

export function PortalAuthProvider({ tenantSlug, children }) {
  const [session, setSession] = useState(() => readPortalSession(tenantSlug));
  const [bootstrapping, setBootstrapping] = useState(true);

  // On mount, if we have a session try a silent refresh to prove it's valid.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (readPortalSession(tenantSlug)?.access_token) {
          // best-effort refresh to rotate the refresh cookie + confirm tenant still active
          try {
            const refreshed = await portalApi.post(tenantSlug, "/api/portal/auth/refresh", {});
            if (refreshed && !cancelled) {
              writePortalSession(tenantSlug, refreshed);
              setSession(refreshed);
            }
          } catch {
            clearPortalSession(tenantSlug);
            if (!cancelled) setSession(null);
          }
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  const applySession = useCallback(
    (next) => {
      writePortalSession(tenantSlug, next);
      setSession(next);
    },
    [tenantSlug]
  );

  const logout = useCallback(async () => {
    await portalApi.logout(tenantSlug);
    setSession(null);
  }, [tenantSlug]);

  const value = useMemo(
    () => ({
      tenantSlug,
      session,
      customer: session?.customer || null,
      accessToken: session?.access_token || null,
      isAuthenticated: !!session?.access_token,
      bootstrapping,
      setSession: applySession,
      logout,
    }),
    [tenantSlug, session, bootstrapping, applySession, logout]
  );

  return <PortalAuthCtx.Provider value={value}>{children}</PortalAuthCtx.Provider>;
}

export function usePortalAuth() {
  const ctx = useContext(PortalAuthCtx);
  if (!ctx) throw new Error("usePortalAuth must be used inside PortalAuthProvider");
  return ctx;
}
