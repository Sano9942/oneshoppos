/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { clearSession, readSession, writeSession } from "./authStore";

const API = "http://localhost:5000";
const AuthContext = createContext(null);
const EMPTY_PERMISSIONS = [];

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const employee = session?.employee || null;
  const permissions = session?.permissions || EMPTY_PERMISSIONS;
  const isAuthenticated = Boolean(employee?.id);

  const refreshPermissions = async (roleId) => {
    const res = await fetch(`${API}/api/roles/${roleId}/permissions`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to load permissions");
    }
    return data.permissions || [];
  };

  const login = async (username, pin) => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, pin }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Invalid username or PIN");
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
      await fetch(`${API}/api/auth/logout`, { method: "POST" });
    } catch {
      // frontend-only clear is enough
    }
    clearSession();
    setSession(null);
  };

  const hasPerm = useCallback(
    (perm) =>
      permissions.includes("all_access") || permissions.includes(perm),
    [permissions],
  );

  const authHeaders = useCallback((extra = {}) => {
    if (!employee?.id) return { ...extra };
    return { ...extra, "x-employee-id": String(employee.id) };
  }, [employee]);

  useEffect(() => {
    let isMounted = true;
    const boot = async () => {
      const existing = readSession();
      if (!existing) {
        if (isMounted) {
          setSession(null);
          setIsBootstrapping(false);
        }
        return;
      }

      try {
        const freshPerms = await refreshPermissions(existing.employee.role_id);
        const refreshed = {
          employee: existing.employee,
          permissions: freshPerms,
          loadedAt: Date.now(),
        };
        writeSession(refreshed);
        if (isMounted) setSession(refreshed);
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
    window.fetch = (input, init = {}) => {
      const rawUrl = typeof input === "string" ? input : input?.url || "";
      const isApiCall =
        rawUrl.includes("http://localhost:5000/api/") ||
        rawUrl.startsWith("/api/");

      if (!isApiCall || !employee?.id) {
        return nativeFetch(input, init);
      }

      const headers = new Headers(init.headers || {});
      if (!headers.has("x-employee-id")) {
        headers.set("x-employee-id", String(employee.id));
      }

      return nativeFetch(input, { ...init, headers });
    };

    return () => {
      window.fetch = nativeFetch;
    };
  }, [employee?.id]);

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
      hasPerm,
      authHeaders,
    }),
    [
      session,
      employee,
      permissions,
      isAuthenticated,
      isBootstrapping,
      hasPerm,
      authHeaders,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
