import { API_BASE } from "./config";

// Plan-limit event: emitted whenever a 403 with code:"PLAN_LIMIT_REACHED"
// comes back from the API. PlanLimitModalInterceptor (mounted once inside
// AppLayoutRedesign) listens for this event and opens the upgrade modal.
// Callers still receive the rejected promise — per-form catch handlers keep
// working so they can show inline feedback in addition to the modal.
export const PLAN_LIMIT_EVENT = "sanopos:plan-limit-reached";

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
    if (res.status === 403 && body?.code === "PLAN_LIMIT_REACHED") {
      // Fan out to the global modal. Detail mirrors the backend response so
      // the modal can show "{used} of {limit} {dimension} used".
      try {
        window.dispatchEvent(
          new CustomEvent(PLAN_LIMIT_EVENT, {
            detail: {
              error: body.error,
              limit: body.limit,
              current: body.current,
            },
          })
        );
      } catch {
        // CustomEvent failed (extremely old browser) — fall through to throw
      }
    }
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
