// Customer portal session storage — slug-scoped so one browser can be logged
// into multiple tenants simultaneously (key = `customerPortalSession:${slug}`).
// Mirrors the shape of adminAuthStore.js for consistency.

function keyFor(slug) {
  return `customerPortalSession:${slug}`;
}

function safeParse(raw) {
  try {
    return JSON.parse(raw || "null");
  } catch {
    return null;
  }
}

export function readPortalSession(slug) {
  if (!slug) return null;
  return safeParse(localStorage.getItem(keyFor(slug)));
}

export function writePortalSession(slug, session) {
  if (!slug) return;
  localStorage.setItem(keyFor(slug), JSON.stringify(session));
}

export function clearPortalSession(slug) {
  if (!slug) return;
  localStorage.removeItem(keyFor(slug));
}

export function getPortalToken(slug) {
  return readPortalSession(slug)?.access_token || null;
}

export function getPortalCustomer(slug) {
  return readPortalSession(slug)?.customer || null;
}
