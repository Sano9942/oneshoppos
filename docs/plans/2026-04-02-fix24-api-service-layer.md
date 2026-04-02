# Fix 24: Frontend API Service Layer

## Goal
Replace ~200 scattered `fetch()` calls across 89 frontend files with a centralized `api.js` module.

## Branch
Create: `fix/frontend-api-service-layer` (from `main` after audit branch is merged)

## Scope — what's real
- 89 files import `API_BASE as API` or `API` from config.js
- ~200 uses of `res.ok` / `res.status` across 69 page files
- config.js exports TWO things: `API_BASE` (bare host like `http://localhost:5000`) and `API` (host + `/api` suffix)
- Most files import `API_BASE as API` — but `AnnouncementBanner.jsx` imports the named `API` export (already includes `/api`). **Check each file's import before migrating.**

## Implementation

### Step 1: Create `frontend/src/api.js`

```js
import { API_BASE } from "./config";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  // Return raw response for callers that need res.status, res.ok, res.blob(), etc.
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
```

**Note:** AuthProvider.jsx patches `window.fetch` globally — auth headers are injected automatically. The service layer does NOT need to handle tokens.

### Step 2: Migrate by directory (one commit per directory)

Priority order (most fetch calls first):
1. `pages/redesign/` — ~45 files, biggest win
2. `pages/redesign/pos/` — 6 files (POSContext has 10 fetch uses alone)
3. `pages/reports/` — ~12 files
4. `pages/shopify/` — 6 files
5. `pages/dashboard/` — 5 files
6. `pages/admin/` — 11 files (**these use `adminFetch` NOT regular fetch — skip or handle separately**)
7. `pages/` root — SetupWizard, SignupPage, ResetPassword, LandingPage, etc.
8. `ui/` — SupportWidget, AnnouncementBanner, ImpersonationBanner
9. `contexts/` — CurrencyContext
10. `hooks/` — useFeatureFlags
11. `components/` — NotificationBell, ContextSwitcher

**DO NOT TOUCH:**
- `auth/AuthProvider.jsx` — patches `window.fetch` itself, uses `window._nativeFetch`
- `pages/admin/AdminLogin.jsx` — defines `adminFetch` which other admin pages import

### Step 3: Migration patterns

**Simple GET (most common):**
```js
// Before
const res = await fetch(`${API}/api/products`);
if (!res.ok) throw new Error("Failed");
const data = await res.json();

// After
import { api } from "../api"; // adjust path
const data = await api.get("/api/products");
```

**POST with JSON:**
```js
// Before
const res = await fetch(`${API}/api/sales`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ cartItems }),
});

// After
const data = await api.post("/api/sales", { cartItems });
```

**Caller that checks res.status (e.g. 409 conflict):**
```js
// Before
const res = await fetch(`${API}/api/billing/request-upgrade`, { ... });
if (res.status === 409) { showWarning("Already pending"); return; }
if (!res.ok) throw new Error("Failed");
const data = await res.json();

// After — use api.raw() to get the Response object
const res = await api.raw("/api/billing/request-upgrade", { method: "POST", body: JSON.stringify(data) });
if (res.status === 409) { showWarning("Already pending"); return; }
if (!res.ok) throw new Error("Failed");
const data = await res.json();
```

**Blob download (BackupRestoreRedesign.jsx):**
```js
// Before
const res = await fetch(`${API}/api/backup/download`);
const blob = await res.blob();

// After
const res = await api.raw("/api/backup/download");
const blob = await res.blob();
```

**File upload (FormData):**
```js
// Before
const fd = new FormData(); fd.append("file", file);
const res = await fetch(`${API}/api/support/upload`, { method: "POST", body: fd });

// After
const fd = new FormData(); fd.append("file", file);
const res = await api.upload("/api/support/upload", fd);
```

### Rules
- Do NOT touch `AuthProvider.jsx` or `AdminLogin.jsx` — they have their own fetch logic
- Admin pages use `adminFetch` from `AdminLogin.jsx` — leave those as-is (separate auth system)
- File uploads use `api.upload()` — no JSON content-type header
- Callers that check `res.status` or use `.blob()`/`.text()` → use `api.raw()`
- Callers that just want parsed JSON → use `api.get()`/`api.post()`/etc.
- All paths must start with `/api/` — the `API_BASE` is just the host
- **Check the import**: files using `{ API }` (with `/api` suffix) need paths like `"/products"` not `"/api/products"`. Files using `{ API_BASE as API }` need `"/api/products"`. Standardize all to `API_BASE` + full path.
- One directory per commit, `npm run build` after each

### Verification
- `cd frontend && npm run build` after each commit — must succeed
- Manual smoke: login, POS sale, admin panel, reports
- Check browser DevTools Network tab — all API calls still have auth headers
