import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  readMfgPortalSession,
  writeMfgPortalSession,
  clearMfgPortalSession,
} from "../../auth/manufacturerPortalStore";
import { manufacturerPortalApi } from "../../api/manufacturerPortalApi";

// Mirrors pages/portal/PortalAuthProvider.jsx exactly. Separate provider so
// one browser can hold a customer portal session AND a manufacturer portal
// session for the same tenant simultaneously (different localStorage keys).
const MfgPortalAuthCtx = createContext(null);

export function ManufacturerPortalAuthProvider({ tenantSlug, children }) {
  const [session, setSession] = useState(() => readMfgPortalSession(tenantSlug));
  const [bootstrapping, setBootstrapping] = useState(true);

  // On mount, try a silent refresh to prove the session is still valid.
  // /auth/refresh rotates the refresh cookie + reissues access token.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (readMfgPortalSession(tenantSlug)?.access_token) {
          try {
            const refreshed = await manufacturerPortalApi.post(
              tenantSlug,
              "/api/manufacturer-portal/auth/refresh",
              {}
            );
            if (refreshed && !cancelled) {
              writeMfgPortalSession(tenantSlug, refreshed);
              setSession(refreshed);
            }
          } catch {
            clearMfgPortalSession(tenantSlug);
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
      writeMfgPortalSession(tenantSlug, next);
      setSession(next);
    },
    [tenantSlug]
  );

  const logout = useCallback(async () => {
    await manufacturerPortalApi.logout(tenantSlug);
    setSession(null);
  }, [tenantSlug]);

  const value = useMemo(
    () => ({
      tenantSlug,
      session,
      partner: session?.partner || null,
      accessToken: session?.access_token || null,
      isAuthenticated: !!session?.access_token,
      bootstrapping,
      setSession: applySession,
      logout,
    }),
    [tenantSlug, session, bootstrapping, applySession, logout]
  );

  return (
    <MfgPortalAuthCtx.Provider value={value}>{children}</MfgPortalAuthCtx.Provider>
  );
}

export function useMfgPortalAuth() {
  const ctx = useContext(MfgPortalAuthCtx);
  if (!ctx)
    throw new Error("useMfgPortalAuth must be used inside ManufacturerPortalAuthProvider");
  return ctx;
}
