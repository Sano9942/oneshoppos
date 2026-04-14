// Customer portal API client.
//
// - Always appends ?tenant=<slug> to /api/portal/* URLs.
// - Includes credentials (refresh cookie is httpOnly; needed for /auth/refresh + /auth/logout).
// - On 401 during a data call, attempts one silent refresh using the httpOnly
//   cookie and retries the original request.
import { API_BASE } from "../config";
import {
  readPortalSession,
  writePortalSession,
  clearPortalSession,
} from "../auth/customerPortalStore";

function appendTenant(path, slug) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}tenant=${encodeURIComponent(slug)}`;
}

async function doFetch(slug, path, options = {}) {
  const session = readPortalSession(slug);
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const url = `${API_BASE}${appendTenant(path, slug)}`;
  return fetch(url, { ...options, headers, credentials: "include" });
}

async function refreshSession(slug) {
  const res = await fetch(
    `${API_BASE}${appendTenant("/api/portal/auth/refresh", slug)}`,
    {
      method: "POST",
      credentials: "include",
    }
  );
  if (!res.ok) return null;
  const body = await res.json();
  writePortalSession(slug, body);
  return body;
}

async function requestJson(slug, path, options = {}) {
  let res = await doFetch(slug, path, options);
  if (res.status === 401) {
    const refreshed = await refreshSession(slug);
    if (refreshed) {
      res = await doFetch(slug, path, options);
    }
  }
  if (res.status === 401) {
    clearPortalSession(slug);
    const err = new Error("Session expired");
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export function portalGet(slug, path, query) {
  const qs = query ? "&" + new URLSearchParams(query).toString() : "";
  return requestJson(slug, `${path}${qs ? (path.includes("?") ? qs : "?" + qs.slice(1)) : ""}`);
}

export function portalPost(slug, path, data) {
  return requestJson(slug, path, {
    method: "POST",
    body: JSON.stringify(data || {}),
  });
}

export function portalPut(slug, path, data) {
  return requestJson(slug, path, {
    method: "PUT",
    body: JSON.stringify(data || {}),
  });
}

export function portalDelete(slug, path) {
  return requestJson(slug, path, { method: "DELETE" });
}

export async function portalLogout(slug) {
  try {
    await doFetch(slug, "/api/portal/auth/logout", { method: "POST" });
  } catch {
    // best effort
  }
  clearPortalSession(slug);
}

export const portalApi = {
  get: portalGet,
  post: portalPost,
  put: portalPut,
  del: portalDelete,
  logout: portalLogout,
};
