import { readFileSync } from "fs";
import { resolve } from "path";
import { BACKEND } from "./auth.js";

const TOKEN_FILE = resolve(import.meta.dirname, "../live-token.json");

function getToken() {
  try {
    const data = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
    return data.token || null;
  } catch {
    return null;
  }
}

/**
 * Makes an authenticated API call to the Railway backend.
 * Reads the JWT token from live-token.json (written by global-setup).
 * Uses Node.js native fetch — no page.evaluate, no browser context required.
 */
export async function api(page, method, path, body = null) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "x-outlet-id": "1",
    "x-scope-mode": "outlet",
  };

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const r = await fetch(`${BACKEND}${path}`, opts);
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text };
  }
  return { status: r.status, ok: r.ok, data };
}

export const get = (page, path) => api(page, "GET", path);
export const post = (page, path, body) => api(page, "POST", path, body);
export const put = (page, path, body) => api(page, "PUT", path, body);
export const del = (page, path) => api(page, "DELETE", path);
