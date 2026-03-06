# Phase 6: App Rename + Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename OneShopPOS to SanoPOS, then deploy backend to Railway and frontend to Vercel with daily R2 backups.

**Architecture:** React SPA on Vercel (free) hits Express API on Railway ($5/mo) with persistent volume for SQLite DBs. Daily backup to Cloudflare R2 (free).

**Tech Stack:** Railway (Docker), Vercel (Vite auto-detect), Cloudflare R2 (@aws-sdk/client-s3), Node 22, Express v5, SQLite3.

**Design doc:** `docs/plans/2026-03-07-phase6-deployment-design.md`

---

## Task 1: Rename DB filename — backend core files

**Files:**
- Modify: `backend/index.js:51` — DB_PATH
- Modify: `backend/index.js:886,891` — backup filename prefix
- Modify: `backend/db.js:5` — dbPath
- Modify: `backend/schema-full.js:10,12` — dbPath and error message
- Modify: `backend/routes/admin.js:207` — comment reference
- Modify: `backend/tenant-provisioner.js:137` — comment reference
- Modify: `backend/routes/barcode-expenses.js:386,484,488` — backup/restore filenames
- Modify: `.gitignore` — update DB filename patterns

**Step 1: Apply DB filename renames**

In `backend/index.js:51`:
```js
// OLD: const DB_PATH = path.resolve(__dirname, "oneshop.db");
const DB_PATH = path.resolve(__dirname, "sanopos.db");
```

In `backend/index.js:886`:
```js
// OLD: const dest = path.join(BACKUP_DIR, `oneshop_backup_${ts}.db`);
const dest = path.join(BACKUP_DIR, `sanopos_backup_${ts}.db`);
```

In `backend/index.js:891`:
```js
// OLD: .filter((f) => f.startsWith("oneshop_backup_"))
.filter((f) => f.startsWith("sanopos_backup_"))
```

In `backend/db.js:5`:
```js
// OLD: const dbPath = path.resolve(__dirname, "oneshop.db");
const dbPath = path.resolve(__dirname, "sanopos.db");
```

In `backend/schema-full.js:10`:
```js
// OLD: const dbPath = path.join(__dirname, 'oneshop.db');
const dbPath = path.join(__dirname, 'sanopos.db');
```

In `backend/schema-full.js:12`:
```js
// OLD: Cannot open oneshop.db
Cannot open sanopos.db
```

In `backend/routes/admin.js:207` and `backend/tenant-provisioner.js:137` — update comment text from "oneshop.db" to "sanopos.db".

In `backend/routes/barcode-expenses.js:386`:
```js
// OLD: `oneshop_backup_${ts}.db`
`sanopos_backup_${ts}.db`
```

In `backend/routes/barcode-expenses.js:484`:
```js
// OLD: `oneshop_pre_restore_${ts}.db`
`sanopos_pre_restore_${ts}.db`
```

In `backend/routes/barcode-expenses.js:488`:
```js
// OLD: `oneshop_restore_staged_${Date.now()}.db`
`sanopos_restore_staged_${Date.now()}.db`
```

**Step 2: Update .gitignore**

Replace `backend/oneshop.db` patterns with `backend/sanopos.db` patterns.

**Step 3: Rename the actual local DB file**

Run: `mv backend/oneshop.db backend/sanopos.db` (if it exists on disk)

**Step 4: Verify backend starts**

Run: `cd backend && node index.js`
Expected: Server starts on port 5000, no "Cannot open" errors.
Kill server after confirming.

**Step 5: Run existing tests**

Run: `cd backend && npx jest tests/integration/saas-phase1.test.js --no-coverage`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add backend/index.js backend/db.js backend/schema-full.js backend/routes/admin.js \
  backend/tenant-provisioner.js backend/routes/barcode-expenses.js .gitignore
git commit -m "refactor: rename oneshop.db → sanopos.db (OneShopPOS → SanoPOS)"
```

---

## Task 2: Rename UI branding — frontend + backend display text

**Files:**
- Modify: `frontend/index.html:9` — page title
- Modify: `frontend/public/sw.js:1-2` — cache names
- Modify: `frontend/src/utils/receipt.js:27` — fallback store name
- Modify: `backend/utils/receiptEmail.js:14` — fallback store name
- Modify: `backend/services/printer.js:76` — fallback store name
- Modify: `frontend/src/pages/PlaceholderPage.jsx:32` — text
- Modify: `frontend/src/pages/ReceiptTemplates.jsx:9` — default header
- Modify: `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:37,80,432` — from_name defaults
- Modify: `frontend/src/pages/redesign/SalesHistoryRedesign.jsx:182` — receipt header
- Modify: `frontend/src/pages/redesign/ShopifyIntegrationRedesign.jsx:33` — description text
- Modify: `backend/package.json:2` — name field
- Modify: `frontend/package.json:2` — name field
- Modify: `backend/tests/helpers/seedSchema.js:2` — comment

**Step 1: Apply all branding renames**

All instances of `"OneShopPOS"` or `"OneShop POS"` become `"SanoPOS"`.
All instances of `"oneshop-"` cache prefix become `"sanopos-"`.

`frontend/index.html:9` → `<title>SanoPOS</title>`

`frontend/public/sw.js:1-2`:
```js
const STATIC_CACHE = "sanopos-static-v1";
const API_CACHE = "sanopos-api-v1";
```

`frontend/src/utils/receipt.js:27` → fallback `"SanoPOS"`
`backend/utils/receiptEmail.js:14` → fallback `"SanoPOS"`
`backend/services/printer.js:76` → fallback `"SanoPOS"`
`frontend/src/pages/ReceiptTemplates.jsx:9` → `header_text: "SanoPOS"`
`frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:37,80,432` → `"SanoPOS"`
`frontend/src/pages/redesign/SalesHistoryRedesign.jsx:182` → `SanoPOS`
`frontend/src/pages/redesign/ShopifyIntegrationRedesign.jsx:33` → `SanoPOS`
`frontend/src/pages/PlaceholderPage.jsx:32` → `SanoPOS`

`backend/package.json:2` → `"name": "sanopos-backend"`
`frontend/package.json:2` → `"name": "sanopos-frontend"`
`backend/tests/helpers/seedSchema.js:2` → "SanoPOS" in comment

**Step 2: Verify frontend builds**

Run: `cd frontend && npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add frontend/ backend/utils/receiptEmail.js backend/services/printer.js \
  backend/package.json backend/tests/helpers/seedSchema.js
git commit -m "refactor: rename UI branding OneShopPOS → SanoPOS"
```

---

## Task 3: Production hardening — CORS, trust proxy, cookies, health

**Files:**
- Modify: `backend/index.js` — trust proxy, CORS, health endpoint
- Modify: `backend/routes/auth.js:250-253,82` — cookie sameSite

**Step 1: Add trust proxy**

In `backend/index.js`, after `const app = express();`:
```js
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
```

**Step 2: Lock down CORS**

Replace `app.use(cors());` with:
```js
app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  credentials: true,
}));
```

**Step 3: Add health check endpoint**

Before `app.listen()`:
```js
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
```

**Step 4: Fix cookie sameSite for cross-origin**

In `backend/routes/auth.js` where refresh cookie is set:
```js
secure: process.env.NODE_ENV === "production",
sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
```

Same pattern for `clearCookie`.

**Step 5: Verify locally**

Run: `cd backend && node index.js`
Expected: Starts fine. CORS defaults to localhost:5173.

**Step 6: Commit**

```bash
git add backend/index.js backend/routes/auth.js
git commit -m "feat: production hardening — trust proxy, CORS lock, cookie fix, health endpoint"
```

---

## Task 4: DATA_DIR env var — volume mount for Railway

**Files:**
- Modify: `backend/index.js:51-54,72-76` — DB_PATH, UPLOADS_DIR, BACKUP_DIR
- Modify: `backend/master-db.js:8` — MASTER_DB_PATH
- Modify: `backend/tenant-provisioner.js:14` — TENANTS_DIR
- Modify: `backend/tenant-db-manager.js` — base path

**Step 1: Add DATA_DIR to index.js**

Near top, after PORT:
```js
const DATA_DIR = process.env.DATA_DIR || __dirname;
```

Update DB_PATH, UPLOADS_DIR, BACKUP_DIR to use DATA_DIR instead of __dirname.

**Step 2: Update master-db.js**

```js
const DATA_DIR = process.env.DATA_DIR || __dirname;
const MASTER_DB_PATH = path.join(DATA_DIR, 'master.db');
```

**Step 3: Update tenant-provisioner.js**

```js
const DATA_DIR = process.env.DATA_DIR || __dirname;
const TENANTS_DIR = path.join(DATA_DIR, 'tenants');
```

**Step 4: Update tenant-db-manager.js**

Ensure tenant DB paths use DATA_DIR as base.

**Step 5: Verify locally without DATA_DIR**

Run: `cd backend && node index.js`
Expected: Falls back to __dirname, works as before.

**Step 6: Run tests**

Run: `cd backend && npx jest tests/integration/saas-phase1.test.js --no-coverage`
Expected: All pass.

**Step 7: Commit**

```bash
git add backend/index.js backend/master-db.js backend/tenant-provisioner.js backend/tenant-db-manager.js
git commit -m "feat: DATA_DIR env var — all DB/upload paths respect volume mount"
```

---

## Task 5: Docker and Railway config files

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/.dockerignore`
- Create: `backend/railway.toml`

**Step 1: Create Dockerfile**

```dockerfile
# Stage 1: Build native dependencies (sqlite3 needs python3/make/g++)
FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Production image (no build tools)
FROM node:22-alpine
RUN apk add --no-cache sqlite
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production PORT=5000
EXPOSE 5000
CMD ["node", "index.js"]
```

**Step 2: Create .dockerignore**

```
node_modules
*.db
*.db-shm
*.db-wal
tenants/
backups/
uploads/
.env
.env.*
tests/
*.test.js
test_*.js
seed_e2e.js
setup_toy_store_defaults.js
```

**Step 3: Create railway.toml**

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "./Dockerfile"

[deploy]
numReplicas = 1
healthcheckPath = "/api/health"
healthcheckTimeout = 10
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

Note: Volume mount `/data` is configured via Railway dashboard.

**Step 4: Test Docker build locally (optional)**

Run: `cd backend && docker build -t sanopos-backend .`
Expected: Build succeeds (~150-180MB image).

**Step 5: Commit**

```bash
git add backend/Dockerfile backend/.dockerignore backend/railway.toml
git commit -m "feat: Dockerfile + Railway config for production deployment"
```

---

## Task 6: Vercel config + frontend env

**Files:**
- Create: `frontend/vercel.json`
- Modify: `frontend/.env.production`

**Step 1: Create vercel.json**

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**Step 2: Leave .env.production with placeholder**

Will be updated with real Railway URL after Task 10.

**Step 3: Verify frontend build**

Run: `cd frontend && npm run build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add frontend/vercel.json
git commit -m "feat: Vercel SPA rewrite config"
```

---

## Task 7: Update .env.example with production vars

**Files:**
- Modify: `backend/.env.example`

**Step 1: Append production vars**

```env
# --- Production Deployment ---
# DATA_DIR=/data
# CORS_ORIGIN=https://sanopos.vercel.app

# Cloudflare R2 Backup (optional)
# R2_ACCOUNT_ID=
# R2_ACCESS_KEY_ID=
# R2_SECRET_ACCESS_KEY=
# R2_BUCKET=sanopos-backups
```

**Step 2: Commit**

```bash
git add backend/.env.example
git commit -m "docs: add production deployment vars to .env.example"
```

---

## Task 8: Backup script — Cloudflare R2

**Files:**
- Create: `backend/scripts/backup-all-tenants.js`
- Modify: `backend/package.json` — add @aws-sdk/client-s3

**Step 1: Install R2 SDK**

Run: `cd backend && npm install @aws-sdk/client-s3`

**Step 2: Create backup script**

Create `backend/scripts/backup-all-tenants.js`.

The script must:
1. Read DATA_DIR env var (default `..` relative to scripts/)
2. Use `require("child_process").execFileSync("sqlite3", [dbPath, ".backup '" + tmpPath + "'"])` for safe backup (execFile, not exec — no shell injection)
3. Gzip the backup with `zlib.gzipSync()`
4. Upload to R2 via `@aws-sdk/client-s3` PutObjectCommand
5. List and delete objects older than 30 days
6. Exit 0 on success, 1 on failure

Key: Use `execFileSync` (not `execSync`) to avoid shell injection — the sqlite3 path and DB path are controlled by us, but execFile is safer by design.

**Step 3: Commit**

```bash
git add backend/scripts/backup-all-tenants.js backend/package.json backend/package-lock.json
git commit -m "feat: daily R2 backup script for master.db + tenant DBs"
```

---

## Task 9: Update CLAUDE.md and docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `User_Manual.md`

**Step 1: Update CLAUDE.md**

Replace all instances of:
- `OneShopPOS` → `SanoPOS`
- `oneshop.db` → `sanopos.db`
- `oneshop_backup_` → `sanopos_backup_`

Do NOT change: `SAAS_CONVERSION_PLAN.md`, `REFACTOR_NOTES.md`, `ONESHOPPOS_TESTING_STRATEGY.md`, `docs/archive/` — these are historical.

**Step 2: Update User_Manual.md**

Same branding replacements.

**Step 3: Commit**

```bash
git add CLAUDE.md User_Manual.md
git commit -m "docs: rename OneShopPOS → SanoPOS in project docs"
```

---

## Task 10: Deploy backend to Railway (manual)

1. Create Railway account → New project → Deploy from GitHub repo
2. Point to `/backend` directory
3. Add persistent volume at `/data`
4. Set env vars: NODE_ENV, PORT, DATA_DIR, MULTI_TENANT, CORS_ORIGIN, JWT_SECRET, JWT_REFRESH_SECRET
5. Deploy and verify: `GET /api/health` returns `{"status":"ok"}`
6. Note the Railway service URL

---

## Task 11: Deploy frontend to Vercel (manual)

1. Create Vercel account → Import GitHub repo
2. Set root directory to `frontend`
3. Set env vars: VITE_API_BASE (Railway URL), VITE_MULTI_TENANT=1
4. Deploy and verify: Login page loads, API calls hit Railway
5. Update CORS_ORIGIN on Railway if Vercel URL differs from expected

---

## Task 12: Set up Cloudflare R2 bucket (manual)

1. Create R2 bucket `sanopos-backups`
2. Create API token (Object Read & Write)
3. Add R2 vars to Railway env
4. Test: `node scripts/backup-all-tenants.js`
5. Set Railway cron: `0 3 * * *`

---

## Task 13: End-to-end smoke test (manual)

1. `GET /api/health` → `{"status":"ok"}`
2. Frontend loads at Vercel URL
3. No CORS errors in DevTools
4. Login flow works (if tenant provisioned)
5. Commit final .env.production with real Railway URL

---

## Summary

| Task | Type | Description |
|------|------|-------------|
| 1 | Code | Rename DB filename `oneshop.db` → `sanopos.db` |
| 2 | Code | Rename UI branding `OneShopPOS` → `SanoPOS` |
| 3 | Code | Production hardening (CORS, proxy, cookies, health) |
| 4 | Code | DATA_DIR env var for Railway volume mount |
| 5 | Code | Dockerfile + Railway config |
| 6 | Code | Vercel config |
| 7 | Code | Update .env.example |
| 8 | Code | R2 backup script |
| 9 | Code | Update CLAUDE.md and docs |
| 10 | Manual | Deploy backend to Railway |
| 11 | Manual | Deploy frontend to Vercel |
| 12 | Manual | Set up Cloudflare R2 |
| 13 | Manual | End-to-end smoke test |
