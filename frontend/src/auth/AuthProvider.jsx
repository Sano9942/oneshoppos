/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clearSession,
  readContext,
  readSession,
  readToken,
  writeSession,
  writeToken,
} from "./authStore";

import { API_BASE as API, IS_MULTI_TENANT } from "../config";
const AuthContext = createContext(null);
const EMPTY_PERMISSIONS = [];

// Refresh lock: prevents multiple simultaneous refresh calls when
// several API requests fail with TOKEN_EXPIRED at the same time.
let _refreshPromise = null;

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [impersonationTenantName, setImpersonationTenantName] = useState(null);
  const [impersonationSessionId, setImpersonationSessionId] = useState(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState(null); // null | 'trial' | 'grace' | 'expired' | 'active'
  const [subscriptionDaysLeft, setSubscriptionDaysLeft] = useState(null);
  const [tenantPlan, setTenantPlan] = useState(null); // null | 'free' | 'pro'

  const employee = session?.employee || null;
  const permissions = session?.permissions || EMPTY_PERMISSIONS;
  const isAuthenticated = Boolean(employee?.id);
  const token = session?.token || null;

  // Step 14 (D2b): overlay the context-aware bootstrap's effective identity
  // onto the live session. The boot contract is unchanged — boot still loads
  // base-role perms via refreshPermissions — but whenever
  // /api/context/bootstrap responds (boot, outlet switch, C8 refresh),
  // PresetContext feeds its employee payload here so hasPerm()/nav reflect
  // the per-outlet role override for the current outlet context.
  const applyEffectiveSession = useCallback((emp) => {
    if (!emp || !Array.isArray(emp.permissions)) return;
    const stored = readSession();
    if (!stored?.employee?.id || Number(stored.employee.id) !== Number(emp.id)) return;
    const next = {
      ...stored,
      permissions: emp.permissions,
      employee: {
        ...stored.employee,
        base_role_id: emp.base_role_id ?? stored.employee.role_id,
        effective_role_id:
          emp.effective_role_id ?? emp.base_role_id ?? stored.employee.role_id,
        effective_role_name: emp.effective_role_name ?? null,
      },
    };
    writeSession(next);
    setSession(next);
  }, []);

  const refreshPermissions = async (roleId, employeeId = null) => {
    const headers = employeeId ? { "x-employee-id": String(employeeId) } : {};
    if (IS_MULTI_TENANT) {
      const t = readToken();
      if (t) headers["Authorization"] = `Bearer ${t}`;
    }
    const res = await fetch(`${API}/api/roles/${roleId}/permissions`, { headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to load permissions");
    }
    return data.permissions || [];
  };

  /**
   * Attempt to refresh the access token using the httpOnly refresh cookie.
   * Returns the new token string, or null if refresh failed.
   */
  const refreshAccessToken = async () => {
    if (_refreshPromise) return _refreshPromise;

    _refreshPromise = (async () => {
      try {
        const nf = window._nativeFetch || window.fetch;
        const res = await nf(`${API}/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.token) {
          writeToken(data.token);
          setSession((prev) => (prev ? { ...prev, token: data.token } : prev));
          return data.token;
        }
        return null;
      } catch {
        return null;
      }
    })();

    // Clear the lock only after all awaiting callers have received the result
    const result = await _refreshPromise;
    _refreshPromise = null;
    return result;
  };

  const login = async (username, password, tenantSlug) => {
    if (IS_MULTI_TENANT && tenantSlug) {
      // Multi-tenant login
      const res = await fetch(`${API}/api/auth/mt-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // receive httpOnly refresh cookie
        body: JSON.stringify({ tenant_slug: tenantSlug, username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Invalid credentials");
      }
      const next = {
        employee: data.employee,
        permissions: data.permissions || [],
        token: data.token,
        tenant_slug: tenantSlug,
        tenant: data.tenant,
        loadedAt: Date.now(),
      };
      writeSession(next);
      setSession(next);
      return next;
    }

    // Single-tenant login (existing flow)
    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Invalid credentials");
    }
    const next = {
      employee: data.employee,
      permissions: data.permissions || [],
      loadedAt: Date.now(),
    };
    writeSession(next);
    setSession(next);
    return next;
  };

  const logout = async () => {
    try {
      const headers = {};
      if (IS_MULTI_TENANT && token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      await fetch(`${API}/api/auth/logout`, {
        method: "POST",
        headers,
        credentials: "include",
      });
    } catch {
      // frontend-only clear is enough
    }
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "AUTH_LOGOUT" });
    }
    clearSession();
    setSession(null);
  };

  // Accepts a single permission string or an array (any-of) — the array form
  // backs surfaces gated by requireAnyPerm server-side (S3 field split:
  // execute_field_sales OR manage_field_sales).
  const hasPerm = useCallback(
    (perm) => {
      if (permissions.includes("all_access")) return true;
      if (Array.isArray(perm)) return perm.some((p) => permissions.includes(p));
      return permissions.includes(perm);
    },
    [permissions],
  );

  const authHeaders = useCallback(
    (extra = {}) => {
      if (!employee?.id) return { ...extra };
      const h = { ...extra, "x-employee-id": String(employee.id) };
      if (IS_MULTI_TENANT && token) {
        h["Authorization"] = `Bearer ${token}`;
      }
      return h;
    },
    [employee, token],
  );

  useEffect(() => {
    let isMounted = true;
    const boot = async () => {
      // ── Impersonation detection ──────────────────────────────────
      const params = new URLSearchParams(window.location.search);
      const impToken = params.get("impersonate_token");
      const impSession = params.get("impersonate_session");

      if (impToken && impSession) {
        try {
          const tenantSlug = params.get("tenant_slug") || "";

          // Verify token server-side and get real employee + permissions
          const meRes = await fetch(`${API}/api/auth/me`, {
            headers: { Authorization: `Bearer ${impToken}` },
          });
          if (!meRes.ok) throw new Error("Impersonation token rejected");
          const meData = await meRes.json();

          const impSessionData = {
            employee: meData.employee,
            permissions: meData.permissions || [],
            token: impToken,
            tenant_slug: tenantSlug,
            loadedAt: Date.now(),
            isImpersonation: true,
          };
          writeSession(impSessionData);

          if (isMounted) {
            setSession(impSessionData);
            setIsImpersonating(true);
            setImpersonationTenantName(params.get("tenant_name") || "Tenant");
            setImpersonationSessionId(impSession);
          }

          // Clean URL params
          const url = new URL(window.location.href);
          url.searchParams.delete("impersonate_token");
          url.searchParams.delete("impersonate_session");
          url.searchParams.delete("tenant_slug");
          url.searchParams.delete("tenant_name");
          window.history.replaceState({}, "", url.pathname + url.search + url.hash);
        } catch {
          // Bad or expired token — fall through to normal boot
        }
        if (isMounted) setIsBootstrapping(false);
        return;
      }

      // Check if existing session is an impersonation
      const existing = readSession();
      if (existing?.isImpersonation) {
        if (isMounted) {
          setSession(existing);
          setIsImpersonating(true);
          setIsBootstrapping(false);
        }
        return;
      }

      if (!existing) {
        if (isMounted) {
          setSession(null);
          setIsBootstrapping(false);
        }
        return;
      }

      try {
        const freshPerms = await refreshPermissions(
          existing.employee.role_id,
          existing.employee.id,
        );

        // P8 (3.14) — also surface company.tax_mode so POS toggle defaults
        // and visibility match the tenant's stance. Best-effort: a missing
        // /api/auth/me must not break boot.
        let companyFromMe = existing.company || null;
        try {
          const meHeaders = { "x-employee-id": String(existing.employee.id) };
          if (IS_MULTI_TENANT && existing.token) {
            meHeaders.Authorization = `Bearer ${existing.token}`;
          }
          const nf = window._nativeFetch || window.fetch;
          const meRes = await nf(`${API}/api/auth/me`, { headers: meHeaders });
          if (meRes.ok) {
            const meData = await meRes.json();
            if (meData.company) companyFromMe = meData.company;
          }
        } catch { /* non-critical */ }

        const refreshed = {
          employee: existing.employee,
          permissions: freshPerms,
          loadedAt: Date.now(),
          ...(existing.context ? { context: existing.context } : {}),
          ...(existing.token ? { token: existing.token } : {}),
          ...(existing.tenant_slug ? { tenant_slug: existing.tenant_slug } : {}),
          ...(existing.tenant ? { tenant: existing.tenant } : {}),
          ...(companyFromMe ? { company: companyFromMe } : {}),
        };
        writeSession(refreshed);
        if (isMounted) setSession(refreshed);

        // Check subscription status for banner
        if (IS_MULTI_TENANT && refreshed?.token) {
          try {
            const nf = window._nativeFetch || window.fetch;
            const billingRes = await nf(`${API}/api/billing/status`, {
              headers: { Authorization: `Bearer ${refreshed.token}` },
            });
            if (billingRes.ok) {
              const billingData = await billingRes.json();
              if (isMounted) {
                setSubscriptionStatus(billingData.payment_status || "active");
                setSubscriptionDaysLeft(billingData.trial_days_left ?? billingData.grace_days_left ?? null);
                setTenantPlan(billingData.plan || null);
              }
            }
          } catch {
            // non-critical
          }
        }
      } catch {
        clearSession();
        if (isMounted) setSession(null);
      } finally {
        if (isMounted) setIsBootstrapping(false);
      }
    };

    boot();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    // Expose native fetch for the refresh function (avoids interceptor recursion)
    window._nativeFetch = nativeFetch;

    window.fetch = async (input, init = {}) => {
      const rawUrl = typeof input === "string" ? input : input?.url || "";
      const method =
        String(
          init.method || (typeof input !== "string" && input?.method) || "GET",
        ).toUpperCase();
      const isApiCall =
        rawUrl.includes(`${API}/api/`) || rawUrl.startsWith("/api/");

      if (
        isApiCall &&
        !navigator.onLine &&
        !["GET", "HEAD", "OPTIONS"].includes(method)
      ) {
        return new Response(
          JSON.stringify({
            error:
              "Offline mode: write actions require an internet or local network connection.",
          }),
          {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "X-Offline-Mode": "1",
            },
          },
        );
      }

      // Public auth endpoints must never receive employee credentials
      const urlStr = typeof input === "string" ? input : input.url;
      const isPublicAuth = ["/api/auth/signup", "/api/auth/forgot-password", "/api/auth/reset-password"]
        .some(p => urlStr.includes(p));

      if (!isApiCall || !employee?.id || isPublicAuth) {
        return nativeFetch(input, init);
      }

      const headers = new Headers(init.headers || {});
      if (!headers.has("x-employee-id")) {
        headers.set("x-employee-id", String(employee.id));
      }

      // In multi-tenant mode, inject Bearer token
      if (IS_MULTI_TENANT) {
        const currentToken = readToken();
        if (currentToken && !headers.has("Authorization")) {
          headers.set("Authorization", `Bearer ${currentToken}`);
        }
      }

      // Inject context headers from session storage
      const ctx = readContext();
      if (ctx) {
        if (ctx.active_company_id && !headers.has("x-company-id")) {
          headers.set("x-company-id", String(ctx.active_company_id));
        }
        if (ctx.active_outlet_id && !headers.has("x-outlet-id")) {
          headers.set("x-outlet-id", String(ctx.active_outlet_id));
        }
        if (ctx.scope_mode && !headers.has("x-scope-mode")) {
          headers.set("x-scope-mode", ctx.scope_mode);
        }
      }

      const fetchOpts = {
        ...init,
        headers,
        ...(IS_MULTI_TENANT ? { credentials: "include" } : {}),
      };

      let response = await nativeFetch(input, fetchOpts);

      // Silent token refresh on 401 TOKEN_EXPIRED in multi-tenant mode
      if (IS_MULTI_TENANT && response.status === 401) {
        const cloned = response.clone();
        try {
          const body = await cloned.json();
          if (body.code === "TOKEN_EXPIRED") {
            const newToken = await refreshAccessToken();
            if (newToken) {
              const retryHeaders = new Headers(headers);
              retryHeaders.set("Authorization", `Bearer ${newToken}`);
              response = await nativeFetch(input, {
                ...fetchOpts,
                headers: retryHeaders,
              });
            }
          }
        } catch {
          // Can't parse body — return original response
        }
      }

      // Track last failed request ID for support ticket context
      if (!response.ok) {
        const rid = response.headers.get("X-Request-Id");
        if (rid) window.__lastFailedReqId = rid;
      }

      // Detect subscription expiry
      if (response.status === 403) {
        try {
          const cloned2 = response.clone();
          const body2 = await cloned2.json();
          if (body2.code === "SUBSCRIPTION_EXPIRED") {
            setSubscriptionStatus("expired");
          }
        } catch {
          // ignore parse errors
        }
      }

      return response;
    };

    return () => {
      window.fetch = nativeFetch;
      delete window._nativeFetch;
    };
  }, [employee?.id]); // token read live via readToken() — no dep needed

  const company = session?.company || null;

  const value = useMemo(
    () => ({
      session,
      employee,
      permissions,
      isAuthenticated,
      isBootstrapping,
      login,
      logout,
      refreshPermissions,
      refreshAccessToken,
      applyEffectiveSession,
      hasPerm,
      authHeaders,
      token,
      isImpersonating,
      impersonationTenantName,
      impersonationSessionId,
      subscriptionStatus,
      subscriptionDaysLeft,
      tenantPlan,
      // P8 (3.14): exposes { tax_mode } loaded from /api/auth/me. POS uses
      // it to default the inclusive toggle and hide it for unregistered
      // tenants ('none').
      company,
    }),
    [
      session,
      employee,
      permissions,
      isAuthenticated,
      isBootstrapping,
      hasPerm,
      authHeaders,
      applyEffectiveSession,
      token,
      isImpersonating,
      impersonationTenantName,
      impersonationSessionId,
      subscriptionStatus,
      subscriptionDaysLeft,
      tenantPlan,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
