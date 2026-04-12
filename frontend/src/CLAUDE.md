# frontend/src — Claude Guide

## Entry Points

- **`main.jsx`** — app bootstrap. Provider hierarchy (outermost→innermost): `ErrorBoundary` → `CurrencyProvider` → `ToastProvider` → `AuthProvider` → `App`. Sentry is initialized here from `SENTRY_DSN` (no-op if unset). Service worker registered in prod only (`IS_PROD && "serviceWorker" in navigator`).
- **`App.jsx`** — composition only. Spreads `publicRoutes`, `appRoutes`, `adminRoutes` into a single `<Routes>`. Renders `ImpersonationBanner` outside the router (checks `isImpersonating` from `useAuth()`). `SubscriptionBanner` is inside the router. Catch-all `path="*"` redirects to `/`. Do not add route logic here — add to `routes/*.jsx`.
- **`index.css`** — Tailwind v4 base + CSS variable token definitions (colors, spacing, radius). Source of `--bg-primary`, `--text-primary`, `--border`, `--accent`, etc. used throughout.

## `api.js` — Centralized API Client

**6 exports** (named export `api` object):

| Method | Signature | Notes |
|--------|-----------|-------|
| `api.get` | `(path, query?)` | Appends `?key=val` via `URLSearchParams` |
| `api.post` | `(path, data)` | JSON body |
| `api.put` | `(path, data)` | JSON body |
| `api.del` | `(path)` | No body |
| `api.upload` | `(path, formData)` | Multipart — sets NO `Content-Type` header (browser sets boundary) |
| `api.raw` | `(path, options?)` | Returns raw `Response` — use when you need `.ok`, `.status`, `.blob()`, `.text()` |

**Gotchas:**
- `api.js` does **not** inject auth headers — `AuthProvider.jsx` patches `window.fetch` globally. Every call through `api.js` automatically gets auth headers because it uses `fetch` internally.
- Paths must include `/api/` prefix (e.g. `api.get("/api/products")`) — the interceptor in `AuthProvider` matches on `/api/` to inject headers.
- `api.upload` passes `headers: {}` to clear the default `Content-Type: application/json` — do not add `Content-Type` manually for file uploads.
- On non-ok responses, `api.get/post/put/del` throw an `Error` with `.message = body.error || "HTTP N"`, `.status`, and `.body`. Catch with `err.message`.
- `api.raw` does **not** throw on non-ok — caller must check `res.ok`.
- Admin pages use `adminFetch` (from `pages/admin/AdminLogin.jsx`) — **not** `api.js`. Do not replace with `api.js` in admin files.

## `config.js` — Environment Exports

All `import.meta.env` reads are centralized here. Do not read `import.meta.env` directly anywhere else.

| Export | Value | Notes |
|--------|-------|-------|
| `API_BASE` | `VITE_API_BASE` or `http://localhost:5000` | No trailing slash, no `/api` suffix |
| `IS_MULTI_TENANT` | `VITE_MULTI_TENANT === "1"` | Controls store-code field on login |
| `SENTRY_DSN` | `VITE_SENTRY_DSN` or `""` | Empty string = Sentry disabled |
| `ENV_MODE` | `import.meta.env.MODE` | `"production"` / `"development"` |
| `IS_PROD` | `import.meta.env.PROD` | Boolean |
| `IS_DEV` | `import.meta.env.DEV` | Boolean |

**Gotcha:** There is no `API` export. `AuthProvider.jsx` imports `API_BASE as API` internally — that alias does not exist in `config.js` itself.
