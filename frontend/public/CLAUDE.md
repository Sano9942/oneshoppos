# frontend/public — Claude Guide

Static files served at the root URL. Vite copies these as-is to `dist/` — they are not processed or bundled.

## Files

- **`manifest.webmanifest`** — PWA manifest. App name: `SanoPOS`, theme color: `#10b981`, background: `#0f172a`. Lists `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` as install icons.
- **`favicon.ico`** — Multi-resolution ICO container (16/32/48 px) — emerald rounded square with white "S". Generated 2026-04-30 (Phase 7.12) via `sharp` from a single SVG source; regenerate by re-running the helper if brand changes.
- **`icon.svg`** — High-DPI tab favicon (vector, same brand mark).
- **`icon-192.png` / `icon-512.png`** — PWA install icons referenced from the manifest.
- **`apple-touch-icon.png`** — 180×180, used by iOS Safari for home-screen icons.
- **`og-default.png`** — 1200×630 share preview card for Open Graph and Twitter Card. Referenced from `index.html` as `og:image` and `twitter:image`. Crawlers (WhatsApp/Facebook/LinkedIn) don't run JS, so this is the static image they show on share — keep it brand-correct.
- **`sw.js`** — Service worker (registered in `src/main.jsx` on prod only).
- **No `vite.svg`** — removed Phase 7.12. The Vite scaffold favicon is gone; references in `index.html` and the manifest were swapped to the brand favicon set above.

## Service Worker (`sw.js`)

Two named caches:
- `sanopos-static-v2` — static assets (JS, CSS, SVG, PNG, `/`). v2 added the favicon set + OG image to the precache list (Phase 7.12).
- `sanopos-api-v1` — reserved for API responses (currently unused by fetch handler, but purged on logout)

**Fetch strategy:**
- Navigation requests (page loads): network-first, falls back to cached `/` on failure (offline shell)
- Same-origin static assets (`/assets/`, `.js`, `.css`, `.svg`, `.png`): cache-first via `cacheFirst()`
- All other requests (cross-origin, API calls): falls through — no interception

**`AUTH_LOGOUT` message handler** — `main.jsx` does NOT send this message; it is a hook for future use. If you change the logout flow in `AuthProvider.jsx`, send `{ type: "AUTH_LOGOUT" }` to the service worker via `navigator.serviceWorker.controller?.postMessage(...)` to purge `sanopos-api-v1`. Without this, cached API responses may persist after logout.

**Cache versioning gotcha:** Cache names are hardcoded strings (`sanopos-static-v1`). If you change cached assets significantly, bump the version suffix (e.g. `v2`) in `sw.js` — the `activate` handler deletes all caches whose name is not in the current list, which forces a clean slate on next install.
