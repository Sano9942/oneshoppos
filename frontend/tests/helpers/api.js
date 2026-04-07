import { readFileSync } from "fs";
import { resolve } from "path";
import { BACKEND } from "./auth.js";

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
