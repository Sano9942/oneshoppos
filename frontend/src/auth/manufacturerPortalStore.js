// Manufacturer portal session storage (Tier 1.4).
// Slug-scoped so one browser can be logged into multiple tenants
// simultaneously (key = `manufacturerPortalSession:${slug}`).
// Mirrors customerPortalStore.js for consistency.

function keyFor(slug) {
  return `manufacturerPortalSession:${slug}`;
}

function safeParse(raw) {
  try {
    return JSON.parse(raw || "null");
  } catch {
    return null;
  }
}

export function readMfgPortalSession(slug) {
  if (!slug) return null;
  return safeParse(localStorage.getItem(keyFor(slug)));
}

export function writeMfgPortalSession(slug, session) {
  if (!slug) return;
  localStorage.setItem(keyFor(slug), JSON.stringify(session));
}

export function clearMfgPortalSession(slug) {
  if (!slug) return;
  localStorage.removeItem(keyFor(slug));
}

export function getMfgPortalToken(slug) {
  return readMfgPortalSession(slug)?.access_token || null;
}

export function getMfgPortalPartner(slug) {
  return readMfgPortalSession(slug)?.partner || null;
}
