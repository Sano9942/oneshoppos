# frontend/public — Claude Guide

Static files served at the root URL. Vite copies these as-is to `dist/` — they are not processed or bundled.

## Files

- **`manifest.webmanifest`** — PWA manifest. App name: `SanoPOS`, theme color: `#10b981`, background: `#0f172a`. References `icon-192.png` and `icon-512.png` (not in repo — must be added before submitting to app stores).
- **`vite.svg`** — Vite default icon, used as PWA icon fallback in manifest. Replace with real icon before production PWA submission.
- **`sw.js`** — Service worker (registered in `src/main.jsx` on prod only).

## Service Worker (`sw.js`)

Two named caches:
- `sanopos-static-v1` — static assets (JS, CSS, SVG, PNG, `/`)
- `sanopos-api-v1` — reserved for API responses (currently unused by fetch handler, but purged on logout)

**Fetch strategy:**
- Navigation requests (page loads): network-first, falls back to cached `/` on failure (offline shell)
- Same-origin static assets (`/assets/`, `.js`, `.css`, `.svg`, `.png`): cache-first via `cacheFirst()`
- All other requests (cross-origin, API calls): falls through — no interception

**`AUTH_LOGOUT` message handler** — `main.jsx` does NOT send this message; it is a hook for future use. If you change the logout flow in `AuthProvider.jsx`, send `{ type: "AUTH_LOGOUT" }` to the service worker via `navigator.serviceWorker.controller?.postMessage(...)` to purge `sanopos-api-v1`. Without this, cached API responses may persist after logout.

**Cache versioning gotcha:** Cache names are hardcoded strings (`sanopos-static-v1`). If you change cached assets significantly, bump the version suffix (e.g. `v2`) in `sw.js` — the `activate` handler deletes all caches whose name is not in the current list, which forces a clean slate on next install.
