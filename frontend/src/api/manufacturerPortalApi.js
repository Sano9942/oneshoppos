// Manufacturer portal API client (Tier 1.4).
//
// - Always appends ?tenant=<slug> to /api/manufacturer-portal/* URLs.
// - Includes credentials (refresh cookie is httpOnly; needed for /auth/refresh
//   + /auth/logout).
// - On 401 during a data call, attempts one silent refresh using the httpOnly
//   cookie and retries the original request.
//
// Mirrors api/portalApi.js exactly. Separate file because the refresh-cookie
// path is /api/manufacturer-portal/auth (different from /api/portal/auth) and
// the session storage key is different.
import { API_BASE } from "../config";
import {
  readMfgPortalSession,
  writeMfgPortalSession,
  clearMfgPortalSession,
} from "../auth/manufacturerPortalStore";

function appendTenant(path, slug) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}tenant=${encodeURIComponent(slug)}`;
}

async function doFetch(slug, path, options = {}) {
  const session = readMfgPortalSession(slug);
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
    `${API_BASE}${appendTenant("/api/manufacturer-portal/auth/refresh", slug)}`,
    {
      method: "POST",
      credentials: "include",
    }
  );
  if (!res.ok) return null;
  const body = await res.json();
  writeMfgPortalSession(slug, body);
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
    clearMfgPortalSession(slug);
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

// CSV / non-JSON helper used by /sales.csv. Returns the raw Response so the
// caller can read the blob + filename header. Auth-aware (same refresh path).
async function requestRaw(slug, path, options = {}) {
  let res = await doFetch(slug, path, options);
  if (res.status === 401) {
    const refreshed = await refreshSession(slug);
    if (refreshed) {
      res = await doFetch(slug, path, options);
    }
  }
  return res;
}

export function mfgPortalGet(slug, path, query) {
  let p = path;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) p = `${path}${path.includes("?") ? "&" : "?"}${qs}`;
  }
  return requestJson(slug, p);
}

export function mfgPortalPost(slug, path, data) {
  return requestJson(slug, path, {
    method: "POST",
    body: JSON.stringify(data || {}),
  });
}

export async function mfgPortalLogout(slug) {
  try {
    await doFetch(slug, "/api/manufacturer-portal/auth/logout", {
      method: "POST",
    });
  } catch {
    // best effort
  }
  clearMfgPortalSession(slug);
}

export function mfgPortalGetRaw(slug, path) {
  return requestRaw(slug, path);
}

export const manufacturerPortalApi = {
  get: mfgPortalGet,
  post: mfgPortalPost,
  logout: mfgPortalLogout,
  raw: mfgPortalGetRaw,
};
