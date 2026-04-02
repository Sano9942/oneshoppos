# Fix 24: Frontend API Service Layer

## Goal
Replace ~164 scattered `fetch()` calls across frontend components with a centralized `api.js` module.

## Branch
Create: `fix/frontend-api-service-layer` (from `main` after audit branch is merged)

## Implementation

### Step 1: Create `frontend/src/api.js`

```js
import { API_BASE as API } from "./config";

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
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
  return request(`${path}${qs}`);
}

function post(path, data) {
  return request(path, { method: "POST", body: JSON.stringify(data) });
}

function put(path, data) {
  return request(path, { method: "PUT", body: JSON.stringify(data) });
}

function del(path) {
  return request(path, { method: "DELETE" });
}

// Multipart (file uploads) — no Content-Type header, let browser set boundary
function upload(path, formData) {
  return fetch(`${API}${path}`, { method: "POST", body: formData }).then(async (res) => {
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return res.json();
  });
}

export const api = { get, post, put, del, upload, request };
```

**Note:** AuthProvider.jsx patches `window.fetch` globally — auth headers are injected automatically. The service layer does NOT need to handle tokens.

### Step 2: Migrate by directory (one commit per directory)

Priority order (most fetch calls first):
1. `pages/redesign/` — ~80 files, biggest win
2. `pages/admin/` — ~11 files  
3. `pages/dashboard/` — ~15 files
4. `pages/reports/` — report modules
5. `pages/shopify/` — shopify tabs
6. `auth/` — AuthProvider (careful — this patches fetch itself)
7. `ui/` — SupportWidget, AnnouncementBanner
8. `contexts/` — CurrencyContext
9. `hooks/` — useFeatureFlags

### Step 3: Migration pattern

Before:
```js
const res = await fetch(`${API}/api/products`);
if (!res.ok) throw new Error("Failed");
const data = await res.json();
```

After:
```js
const data = await api.get("/api/products");
```

For POST:
```js
// Before
const res = await fetch(`${API}/api/sales`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ cartItems, ... }),
});

// After
const data = await api.post("/api/sales", { cartItems, ... });
```

### Rules
- Do NOT touch `AuthProvider.jsx` fetch patching — it must stay as raw `window.fetch`
- Do NOT touch `window._nativeFetch` calls (token refresh internals)
- File uploads use `api.upload()` — no JSON content-type header
- Keep error handling in components — `api.get()` throws on non-ok, `catch` in component
- One directory per commit, test build after each

### Verification
- `cd frontend && npm run build` after each commit
- Manual smoke: login, POS sale, admin panel, reports — all still work
- No new runtime errors in browser console
