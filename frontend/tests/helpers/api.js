import { readFileSync } from "fs";
import { resolve } from "path";
import { BACKEND, STORE_CODE, PIN } from "./auth.js";

const TOKEN_FILE = resolve(import.meta.dirname, "../token.json");

function getToken() {
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf8")).token || null;
  } catch {
    return null;
  }
}

export async function api(method, path, body = null) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
    "x-outlet-id": "1",
    "x-scope-mode": "outlet",
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const r = await fetch(`${BACKEND}${path}`, opts);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { status: r.status, ok: r.ok, data };
}

export const get = (path) => api("GET", path);
export const post = (path, body) => api("POST", path, body);
export const put = (path, body) => api("PUT", path, body);
export const del = (path) => api("DELETE", path);

/**
 * Ensure POS is ready: open shift if needed, clock in if needed.
 * Call this before navigating to /pos to bypass the gate modal entirely.
 */
export async function ensurePOSReady(outletId = 1) {
  // 1. Check for active shift
  const shiftRes = await get(`/api/shifts/active?outlet_id=${outletId}`);
  if (!shiftRes.data?.shift) {
    // Open a shift with a minimal opening float
    await post("/api/shifts/open", {
      outlet_id: outletId,
      opening_float: 1000,
      denominations: [{ denomination: 1000, count: 1 }],
    });
  }

  // 2. Check attendance status — clock in if not already
  const statusRes = await get(`/api/attendance/my-status?outlet_id=${outletId}`);
  const code = statusRes.data?.status || statusRes.data?.attendance_code;
  if (code !== "clocked_in") {
    await post(`/api/attendance/pin-checkin?tenant=${STORE_CODE}`, {
      pin_code: PIN,
      outlet_id: outletId,
    });
  }
}
