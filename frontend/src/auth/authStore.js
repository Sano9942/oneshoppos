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
}
