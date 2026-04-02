import { API_BASE } from "./config";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  return res;
}

// Convenience: fetch + parse JSON + throw on error
async function json(path, options = {}) {
  const res = await request(path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

function get(path, query) {
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  return json(`${path}${qs}`);
}

function post(path, data) {
  return json(path, { method: "POST", body: JSON.stringify(data) });
}

function put(path, data) {
  return json(path, { method: "PUT", body: JSON.stringify(data) });
}

function del(path) {
  return json(path, { method: "DELETE" });
}

// Multipart (file uploads) — no Content-Type header, let browser set boundary
function upload(path, formData) {
  return request(path, { method: "POST", body: formData, headers: {} });
}

// Raw fetch — for callers that check res.ok/res.status themselves, or need .blob()/.text()
function raw(path, options = {}) {
  return request(path, options);
}

export const api = { get, post, put, del, upload, raw };
