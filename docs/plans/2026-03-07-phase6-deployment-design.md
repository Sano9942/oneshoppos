# Phase 6: Deployment + Backups — Design Document

**Date:** 2026-03-07
**Status:** Approved
**Depends on:** Phases 1-5 (all complete)

## Decisions Made

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Backend hosting | Railway ($5/mo hobby) | Git-push deploy, persistent volumes, no DevOps needed |
| Frontend hosting | Vercel (free tier) | Auto-detects Vite, CDN, SPA routing |
| Backup target | Cloudflare R2 (10GB free) | S3-compatible, no egress fees, cheapest |
| Backup frequency | Daily (3 AM UTC) | Good balance of safety vs storage for pilot |
| Domain | Default subdomains | `sanopos.vercel.app` + `sanopos-api.up.railway.app` |
| App rename | OneShopPOS → SanoPOS | Done before deployment so names are clean from day one |

## Prerequisite: App Rename (OneShopPOS → SanoPOS)

### Scope

**Change** (active code + branding):
- `backend/index.js` — DB path `oneshop.db` → `sanopos.db`
- `backend/db.js` — DB path
- `backend/schema-full.js` — DB path
- `backend/tenant-provisioner.js` — DB filename in tenant dirs
- `backend/routes/admin.js` — DB filename reference
- `backend/package.json` — `name` field
- `frontend/package.json` — `name` field
- UI branding in: `AdminLayout.jsx`, `AppLayoutRedesign.jsx`, `PlaceholderPage.jsx`, `receipt.js`, `receiptEmail.js`, `printer.js`, `PrinterSettingsRedesign.jsx`
- `frontend/public/sw.js` — cache name
- Docs: `CLAUDE.md`, `User_Manual.md`
- `.gitignore` — update DB filename patterns

**DO NOT change:**
- Old migrations (`migrate4.js` through `migrate66.js`) — historical, already executed
- Archived docs (`docs/archive/`) — historical record
- Test files referencing `oneshop.db` in schema setup — update only `seedSchema.js`
- `SAAS_CONVERSION_PLAN.md`, `REFACTOR_NOTES.md` — historical documents
- `ONESHOPPOS_TESTING_STRATEGY.md` — historical

### Local DB migration
Existing developers must rename their local DB file:
```
mv backend/oneshop.db backend/sanopos.db
```

## Architecture

```
Browser ──► Vercel (sanopos.vercel.app) ──► Static React SPA
                │
                │ fetch /api/*
                ▼
        Railway (sanopos-api.up.railway.app) ──► Express API
                │
                │ Persistent Volume (/data)
                ├── master.db
                ├── tenants/<slug>/sanopos.db
                ├── tenants/<slug>/uploads/
                └── backups/
                        │
                        │ Daily cron
                        ▼
                Cloudflare R2 (.tar.gz backups)
```

- Single Railway instance (SQLite constraint)
- Frontend and backend on different origins (cross-origin)
- All data on Railway persistent volume at `/data`

## Cross-Origin Cookie Fix

**Problem:** `sameSite: "Strict"` blocks cookies across different origins.
Frontend (Vercel) and backend (Railway) are on different domains.

**Fix in `backend/routes/auth.js`:**
```js
res.cookie("refreshToken", refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: "None",       // Was "Strict" — required for cross-origin
  path: "/api/auth",
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
```

Also update `clearCookie` calls to match.

## Production Hardening (backend/index.js)

1. **Trust proxy** — Railway terminates TLS at proxy layer:
   ```js
   if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
   ```

2. **CORS origin lock** — Whitelist Vercel origin only:
   ```js
   app.use(cors({
     origin: process.env.CORS_ORIGIN || "http://localhost:5173",
     credentials: true,
   }));
   ```

3. **DATA_DIR env var** — All DB/upload paths respect volume mount:
   ```js
   const DATA_DIR = process.env.DATA_DIR || __dirname;
   ```
   Files affected: `index.js`, `master-db.js`, `tenant-provisioner.js`, `tenant-db-manager.js`

## Dockerfile (Multi-Stage)

```dockerfile
FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --production

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production PORT=5000
EXPOSE 5000
CMD ["node", "index.js"]
```

Rationale: `sqlite3` native addon needs build tools; multi-stage keeps image small.

## .dockerignore

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
```

## railway.toml

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

[[volumes]]
mount = "/data"
```

## Frontend: vercel.json

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

## Health Check Endpoint

Add `GET /api/health` in `backend/index.js`:
```js
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
```

## Backup Script

`backend/scripts/backup-all-tenants.js`:
- Read tenant list from master.db
- For each tenant: SQLite `.backup` command → `.tar.gz`
- Upload to R2 via `@aws-sdk/client-s3`
- Delete R2 objects older than 30 days
- Exit with code 0/1 for Railway cron monitoring

## Environment Variables (Production)

```env
NODE_ENV=production
PORT=5000
DATA_DIR=/data
MULTI_TENANT=1
CORS_ORIGIN=https://sanopos.vercel.app
JWT_SECRET=<64-char-random>
JWT_REFRESH_SECRET=<64-char-random>
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key>
R2_SECRET_ACCESS_KEY=<r2-secret-key>
R2_BUCKET=sanopos-backups
```

## New Files Summary

| File | Purpose |
|------|---------|
| `backend/Dockerfile` | Multi-stage build for Railway |
| `backend/.dockerignore` | Exclude local data from image |
| `backend/railway.toml` | Railway platform config |
| `frontend/vercel.json` | SPA rewrite rules |
| `backend/scripts/backup-all-tenants.js` | Daily R2 backup |

## Modified Files Summary

| File | Change |
|------|--------|
| `backend/index.js` | DB rename, trust proxy, CORS lock, DATA_DIR, health endpoint |
| `backend/db.js` | DB filename rename |
| `backend/schema-full.js` | DB filename rename |
| `backend/routes/auth.js` | Cookie sameSite fix, clearCookie fix |
| `backend/routes/admin.js` | DB filename rename |
| `backend/master-db.js` | DATA_DIR support |
| `backend/tenant-provisioner.js` | DB filename rename, DATA_DIR |
| `backend/tenant-db-manager.js` | DATA_DIR support |
| `backend/package.json` | Name + @aws-sdk/client-s3 |
| `backend/.env.example` | New vars documented |
| `frontend/package.json` | Name field |
| `frontend/.env.production` | Vercel URL |
| UI files (7) | "OneShopPOS" → "SanoPOS" branding |
| `.gitignore` | sanopos.db patterns |
| `CLAUDE.md` | Updated references |
