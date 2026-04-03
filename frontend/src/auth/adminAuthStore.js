// Admin session storage helpers — mirrors the structure of authStore.js for employee auth.
// All reads/writes of "adminSession" must go through these helpers so logout and
// impersonation teardown are always atomic and in one place.

const ADMIN_AUTH_KEY = "adminSession";

function _read() {
  try {
    return JSON.parse(localStorage.getItem(ADMIN_AUTH_KEY) || "null");
  } catch {
    return null;
  }
}

export function readAdminSession() {
  return _read();
}

export function writeAdminSession(session) {
  localStorage.setItem(ADMIN_AUTH_KEY, JSON.stringify(session));
}

export function clearAdminSession() {
  localStorage.removeItem(ADMIN_AUTH_KEY);
}

export function getAdminToken() {
  return _read()?.token || null;
}

export function getAdminSession() {
  return _read();
}
