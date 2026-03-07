# SanoPOS SaaS Conversion & Distribution Plan

> **Created**: 2026-03-08
> **Status**: Planning — not yet started
> **Priority**: Future milestone

---

## Problem Statement

SanoPOS currently runs as a cloud-hosted app (Railway backend + Vercel frontend). This creates two issues for the Pakistani market:

1. **Internet dependency** — when internet goes out (common in Pakistan, can last hours), the entire app is unusable. Cashiers cannot ring up sales, clock in, or do anything.
2. **Code protection** — giving customers a local deployment exposes source code to potential copying and misuse.

---

## Distribution Options

### Option 1: Compiled `.exe` Binary (Recommended)

**How it works:**
- Use `pkg` or `nexe` to compile the Node.js backend into a single `.exe` file
- Frontend is pre-built (`npm run build`) — customer only gets minified JS
- Customer double-clicks an installer to set up
- App runs locally on their machine, accessed via browser at `localhost:5000`

**Pros:**
- Simplest for non-technical shopkeepers
- Source code is bundled and obfuscated inside the binary
- No Docker, no terminal, no Node.js installation needed
- Works completely offline for daily operations

**Cons:**
- Not 100% reverse-engineering proof (determined developer could decompile)
- Windows-only unless cross-compiled
- Native SQLite bindings (`sqlite3` npm package) need to be bundled correctly for the target platform

**Implementation steps:**
1. Add `pkg` to devDependencies
2. Configure `pkg` entry point and assets (migrations, static frontend build)
3. Handle `sqlite3` native addon bundling (may need `better-sqlite3` or pre-built binaries)
4. Create Windows installer (Inno Setup or NSIS)
5. Test on clean Windows machine without Node.js installed

---

### Option 2: Docker Container

**How it works:**
- Package everything in a Docker image
- Customer runs `docker run oneshoppos` or uses Docker Desktop
- Code is inside container layers

**Pros:**
- Consistent environment across machines
- Easy to version and distribute
- Works on Windows, Mac, Linux

**Cons:**
- Requires Docker knowledge or Docker Desktop installation
- Code is extractable via `docker export` (less protected than `.exe`)
- Heavier footprint than a compiled binary
- Not ideal for small store owners unfamiliar with Docker

**Implementation steps:**
1. Create `Dockerfile` (Node.js base, copy backend + built frontend)
2. Create `docker-compose.yml` with volume mount for DB persistence
3. Document installation steps for Docker Desktop on Windows
4. Set up Docker Hub or private registry for image distribution

---

### Option 3: Hybrid Cloud + Offline Cache (PWA)

**How it works:**
- Keep code on Railway/Vercel (nobody sees it)
- Add Service Worker that caches the app shell and product catalog
- Queue sales transactions locally in IndexedDB when offline
- Sync queued transactions when internet returns

**Pros:**
- Complete code protection — source stays on your servers
- No local installation needed
- Seamless online/offline transition

**Cons:**
- Most complex to implement
- Stock conflict resolution is hard (two offline registers selling the last item)
- Invoice numbering must work without a central server
- Card payments impossible offline (cash only)
- Shift/attendance sync needs careful handling
- Data integrity — merging queued transactions without duplicates

**Implementation steps:**
1. Add Vite PWA plugin + Service Worker for app shell caching
2. Implement IndexedDB store for offline product catalog + cart
3. Build transaction queue with retry logic
4. Build conflict resolution engine for stock
5. Implement offline invoice number generation (pre-allocated ranges)
6. Add sync status indicator in UI
7. Handle edge cases: partial sync, duplicate detection, failed merges

---

## Code Protection Strategy

Regardless of distribution method, implement these layers:

### 1. License Key System
- Generate unique license keys per customer (tied to machine hardware ID)
- App checks license key on startup — no valid key = app won't run
- License table in a separate encrypted SQLite DB
- Keys have expiry dates tied to subscription

### 2. Code Obfuscation
- Minify/obfuscate backend code before packaging (`javascript-obfuscator`)
- Frontend already minified by Vite build
- Remove all comments, debug logs, and source maps from production builds

### 3. Phone-Home Validation
- When internet IS available, app pings your license server to validate
- Checks: is this key active? Is it being used on multiple machines?
- Grace period (e.g., 30 days) for offline — after that, requires one online check
- If pirated (same key on multiple machines), flag it and optionally disable

### 4. Service-Based Moat
- Updates, bug fixes, new features — only available to paying customers
- Cloud backup sync — customer data backed up to your server
- Remote support and diagnostics
- Multi-tenant SaaS features (already built) as premium tier
- Shopify integration as premium add-on

---

## Auto-Update System

### How updates reach customers:

1. You push code to GitHub as usual
2. CI/CD (GitHub Actions) builds a new `.exe` / Docker image automatically
3. Customer's app checks your update server for new versions when internet is available
4. If update found: downloads in background, shows "Update available — restart to apply"
5. On restart, new binary replaces old one, migrations run automatically (`run_migrations.js`)
6. Customer never sees code, never touches a terminal

### Implementation:
- **For `.exe`**: Use `electron-updater` pattern (even without Electron) or custom update checker
  - `GET /api/updates/check?version=1.0.0&key=LICENSE_KEY` → returns `{ available: true, url: "...", version: "1.1.0" }`
  - Download new `.exe` to temp dir
  - On next startup, swap binaries
- **For Docker**: `docker pull` new image, restart container (can be scripted)
- **Update server**: Simple Express endpoint on your existing Railway backend or separate service
- **Migration safety**: `run_migrations.js` already handles incremental migrations — new version just adds new migrate files

---

## Recommended Approach

**Phase 1 (MVP):** Option 1 — compiled `.exe` with license key
- Solves the internet problem immediately
- Protects code sufficiently for the target market
- Simplest customer experience

**Phase 2:** Add phone-home license validation + auto-updater
- Validates licenses when online
- Pushes updates automatically

**Phase 3:** Consider Option 3 (PWA offline) as an add-on for cloud customers
- For customers who prefer cloud but want offline resilience
- Can coexist with Option 1 — different tiers

---

## Key Technical Challenges

| Challenge | Notes |
|-----------|-------|
| `sqlite3` native bindings in `pkg` | May need to switch to `better-sqlite3` (synchronous, easier to bundle) or ship pre-built `.node` files alongside the `.exe` |
| Frontend serving from `.exe` | Backend needs to serve the built frontend as static files (already supported via Express static middleware) |
| DB location | Must use a user-writable directory (e.g., `%APPDATA%/OneshopPOS/`) not the install directory |
| Windows firewall | First run may trigger firewall prompt for Node.js/the `.exe` to accept local connections |
| Multi-device in store | Other devices (tablets, kiosk) connect to the main machine's IP on local network — need to document network setup |
| Backup to cloud | When internet available, optionally sync DB backup to your server for disaster recovery |

---

*This plan will be executed in a future session. All three options can coexist as different product tiers.*
