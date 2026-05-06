export const AUTH_KEY = "authSession";

export function isSessionStructValid(session) {
  return Boolean(
    session &&
      session.employee &&
      session.employee.id &&
      session.employee.role_id,
  );
}

export function readSession() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isSessionStructValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSession(session) {
  if (!isSessionStructValid(session)) return;
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  // Keep backward compatibility with existing pages still reading currentEmployee.
  localStorage.setItem("currentEmployee", JSON.stringify(session.employee));
}

export function clearSession() {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem("currentEmployee");
  // W3 — clear the feature-flags warm cache too so the next tenant logged
  // into this browser does not see the previous tenant's flag set on first
  // paint. Cheap; the next mount of useFeatureFlags refetches anyway.
  localStorage.removeItem("sanopos_feature_flags_cache_v1");
}

// --- Context helpers (used by ContextSelect + RequireContext) ---

export function readContext() {
  const session = readSession();
  return session?.context || null;
}

export function writeContext(context) {
  const session = readSession();
  if (!session) return;
  writeSession({ ...session, context });
}

export function clearContext() {
  const session = readSession();
  if (!session) return;
  const { context: _, ...rest } = session;
  writeSession(rest);
}

// --- Token helpers (used in multi-tenant JWT mode) ---

export function readToken() {
  const session = readSession();
  return session?.token || null;
}

export function writeToken(token) {
  const session = readSession();
  if (!session) return;
  writeSession({ ...session, token });
}

export function readTenantSlug() {
  const session = readSession();
  return session?.tenant_slug || null;
}
