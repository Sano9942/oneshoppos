---
name: audit-docs
description: Full deep-scan docs audit — reads every source file, rebuilds all 40 CLAUDE.md files from scratch. Run monthly or when docs feel stale. (~$5/run on Sonnet)
user_invocable: true
---

# Audit Documentation (Full Deep Scan)

Comprehensive documentation audit. Reads every source file to rebuild all 40 CLAUDE.md files. Use this monthly or when you suspect docs have drifted significantly.

**Cost warning**: This reads ~115K lines of code (~1.4M tokens). ~$5 on Sonnet, ~$25 on Opus.

For routine updates after feature work, use `/update-docs` instead (~$0.20).

## Step 1 — Get Ground-Truth File Counts

Run these shell commands FIRST. These numbers are the **only source of truth** for file counts — never trust subagent counts.

```bash
# Backend counts
echo "backend (top-level loose files):" $(ls backend/*.js 2>/dev/null | grep -v "\.test\.js" | wc -l)
echo "routes (top-level):" $(ls backend/routes/*.js 2>/dev/null | wc -l)
echo "routes/admin:" $(ls backend/routes/admin/*.js 2>/dev/null | wc -l)
echo "routes/reports:" $(ls backend/routes/reports/*.js 2>/dev/null | wc -l)
echo "routes/shopify:" $(ls backend/routes/shopify/*.js 2>/dev/null | wc -l)
echo "routes/tier4:" $(ls backend/routes/tier4/*.js 2>/dev/null | wc -l)
echo "routes/integrations:" $(ls backend/routes/integrations/*.js 2>/dev/null | wc -l)
echo "schemas:" $(ls backend/schemas/*.js 2>/dev/null | wc -l)
echo "services:" $(ls backend/services/*.js 2>/dev/null | wc -l)
echo "services/couriers:" $(ls backend/services/couriers/*.js 2>/dev/null | wc -l)
echo "services/marketplace:" $(ls backend/services/marketplace/*.js 2>/dev/null | wc -l)
echo "workers:" $(ls backend/workers/*.js 2>/dev/null | wc -l)
echo "middleware:" $(ls backend/middleware/*.js 2>/dev/null | wc -l)
echo "utils:" $(ls backend/utils/*.js 2>/dev/null | wc -l)
echo "boot:" $(ls backend/boot/*.js 2>/dev/null | wc -l)
echo "jobs:" $(ls backend/jobs/*.js 2>/dev/null | wc -l)
echo "scripts:" $(ls backend/scripts/*.js 2>/dev/null | wc -l)
echo "shopify:" $(ls backend/shopify/*.js 2>/dev/null | wc -l)
echo "types:" $(ls backend/types/*.d.ts 2>/dev/null | wc -l)
echo "tests/integration:" $(ls backend/tests/integration/*.test.js 2>/dev/null | wc -l)
echo "tests/unit:" $(ls backend/tests/unit/*.test.js 2>/dev/null | wc -l)
echo "tests/helpers:" $(ls backend/tests/helpers/*.js 2>/dev/null | wc -l)
```

```bash
# Frontend counts
echo "pages (top-level wrappers + special pages):" $(ls frontend/src/pages/*.jsx 2>/dev/null | wc -l)
echo "redesign:" $(ls frontend/src/pages/redesign/*.jsx 2>/dev/null | wc -l)
echo "pos:" $(ls frontend/src/pages/redesign/pos/*.jsx frontend/src/pages/redesign/pos/*.js 2>/dev/null | wc -l)
echo "admin:" $(ls frontend/src/pages/admin/*.jsx 2>/dev/null | wc -l)
echo "reports:" $(ls frontend/src/pages/reports/*.jsx 2>/dev/null | wc -l)
echo "shopify:" $(ls frontend/src/pages/shopify/*.jsx 2>/dev/null | wc -l)
echo "dashboard:" $(ls frontend/src/pages/dashboard/*.jsx 2>/dev/null | wc -l)
echo "ui:" $(ls frontend/src/ui/*.jsx frontend/src/ui/*.js frontend/src/ui/*.css 2>/dev/null | wc -l)
echo "components:" $(ls frontend/src/components/*.jsx 2>/dev/null | wc -l)
echo "auth:" $(ls frontend/src/auth/*.jsx frontend/src/auth/*.js 2>/dev/null | wc -l)
echo "utils:" $(ls frontend/src/utils/*.js 2>/dev/null | wc -l)
echo "contexts:" $(ls frontend/src/contexts/*.jsx 2>/dev/null | wc -l)
echo "hooks:" $(ls frontend/src/hooks/*.js 2>/dev/null | wc -l)
echo "types:" $(ls frontend/src/types/*.ts 2>/dev/null | wc -l)
echo "routes:" $(ls frontend/src/routes/*.jsx 2>/dev/null | wc -l)
echo "tests specs:" $(ls frontend/tests/*.spec.js 2>/dev/null | wc -l)
echo "tests helpers:" $(ls frontend/tests/helpers/*.js 2>/dev/null | wc -l)
```

Also list all filenames in key directories (`ls backend/routes/*.js | sort`, etc.) to catch new/removed files.

Save these results — you will use them when editing docs in later steps.

## Step 2 — Deep Scan (7 Combined Agents, 2 Waves)

Launch **7 combined agents** in **2 waves** (4 in Wave 1, 3 in Wave 2). Use `model: "sonnet"` for all agents. At most 4 agents run concurrently, matching the original API-overload safety budget.

**Resilience rule**: If **2+ agents fail** (529, timeout, etc.) in Wave 1, **abandon the agent strategy entirely** and switch to manual scanning in the main thread (read each CLAUDE.md, compare against Step 1 file lists, apply changes directly). Manual scanning is fast enough and avoids wasted retries.

### Wave 1 — Backend (launch 4 agents in parallel):

**Agent 1a: Backend Route Subdirectories (admin/reports/shopify/tier4/integrations)**
> Read every .js file in these directories: `backend/routes/admin/`, `backend/routes/reports/`, `backend/routes/shopify/`, `backend/routes/tier4/`, `backend/routes/integrations/`.
> For each file, note exports, key routes, permissions (requirePerm/requireAnyPerm/requireFeature), tables touched.
> Then read the CLAUDE.md in each directory and compare.
> VERIFIED file counts: admin=10, reports=14, shopify=9, tier4=7, integrations=7 (~47 files total; update from Step 1 output).
> Report ONLY what needs to change per CLAUDE.md. Do NOT edit files.

**Agent 1b: Backend Top-Level Routes**
> Read every .js file in `backend/routes/*.js` (TOP-LEVEL ONLY, ~68 files — NOT the subdirectories, which Agent 1a owns). Examples: `sales.js`, `products.js`, `customers.js`, `employees.js`, `draft-orders.js`, `smart-collections.js`, `subscriptions.js`, `couriers.js`, `fulfillment.js`, `auth.js`, `orders.js`, `returns.js`, `inventory.js`, `purchase-orders.js`, `grn.js`, etc.
> For each file, note exports, key routes (method + path), permissions (requirePerm/requireAnyPerm/requireFeature), tables touched, and any Zod schema references.
> Read `backend/routes/CLAUDE.md` and compare — this doc covers the top-level routes as a navigation index, NOT line-by-line exports.
> Report ONLY what needs to change in `backend/routes/CLAUDE.md`. Do NOT edit files.
> **Note**: if changed exports or new feature flags are discovered, also flag them for Tier 2 update of `backend/CLAUDE.md` (feature flag registry + "Where to Look Instead" table).

**Agent 2: Backend Services + Middleware + Workers**
> Read every .js file in: `backend/services/` (top-level ~31 files; update from Step 1), `backend/services/couriers/` (16 files), `backend/services/marketplace/` (5 files), `backend/middleware/` (8 files), `backend/workers/` (~7 files).
> Note exports, key functions, env vars, external services used.
> Read the CLAUDE.md in each directory and compare. **Marketplace note**: `backend/services/marketplace/CLAUDE.md` exists as its own file (not just a section inside `services/CLAUDE.md`).
> Report ONLY what needs to change per CLAUDE.md. Do NOT edit files.

**Agent 3: Backend Tests + Utils + Misc**
> For tests: just LIST filenames and counts (don't read test logic).
> - `backend/tests/integration/` (VERIFIED: [N] files), `backend/tests/unit/` (VERIFIED: [N] files), `backend/tests/helpers/` (VERIFIED: [N] files)
> Read every .js file in: `backend/utils/` ([N] files), `backend/boot/` ([N] files), `backend/jobs/` ([N] files), `backend/scripts/` ([N] files), `backend/shopify/` ([N] files), `backend/types/` ([N] .d.ts files), `backend/schemas/` ([N] files).
> Read the CLAUDE.md in each directory and compare.
> Report ONLY what needs to change per CLAUDE.md. Do NOT edit files.

### Wave 2 — Frontend + Config (launch 3 agents after Wave 1 succeeds):

**Agent 4: Frontend Pages (all subdirs)**
> Read all .jsx files in: `frontend/src/pages/redesign/` (VERIFIED: [N] files), `frontend/src/pages/redesign/pos/` ([N] files), `frontend/src/pages/admin/` ([N] files), `frontend/src/pages/reports/` ([N] files), `frontend/src/pages/dashboard/` ([N] files), `frontend/src/pages/shopify/` ([N] files).
> Also list top-level `frontend/src/pages/*.jsx` files (wrappers + special pages — VERIFIED from Step 1 count).
> Note component names, API endpoints called, feature flags checked, permissions checked.
> Read the CLAUDE.md in each directory and compare.
> Report ONLY what needs to change per CLAUDE.md. Do NOT edit files.

**Agent 5: Frontend UI + Auth + Utils + Config**
> Read all files in: `frontend/src/ui/` ([N] files), `frontend/src/components/` ([N] files), `frontend/src/auth/` ([N] files), `frontend/src/utils/` ([N] files), `frontend/src/contexts/` ([N] files), `frontend/src/hooks/` ([N] files), `frontend/src/types/` ([N] files), `frontend/src/routes/` ([N] files).
> Also list `frontend/tests/*.spec.js` filenames (don't read test logic).
> Read the CLAUDE.md in each directory and compare.
> Report ONLY what needs to change per CLAUDE.md. Do NOT edit files.

**Agent 6: Schema + Config + Backend Top-Level Loose Files**
> Read `backend/schema-pg.sql` — extract all CREATE TABLE + REFERENCES. Compare with `DB-RELATIONSHIPS.md`.
> Grep `process.env` across backend (exclude node_modules/tests). List every unique env var.
> Read `backend/middleware/feature-flags.js` — list all flag names + defaults.
> Read `backend/middleware/permissions.js` — list all permission names + role defaults.
> Read `backend/middleware/plan-limits.js` — list all plan limits.
> **Top-level loose files**: read every `backend/*.js` at the backend root (~13-14 files: `index.js`, `db-pg.js`, `master-db-pg.js`, `tenant-db-manager-pg.js`, `tenant-db-proxy-pg.js`, `tenant-db-pg.js`, `tenant-multer.js`, `tenant-provisioner-pg.js`, `jwt-auth.js`, `category-tree.js`, `migrate-pg.js`, `seed-admin-pg.js`, `swagger.js`). Note each file's exports, purpose, and key env vars. Compare against `backend/CLAUDE.md`'s "Where to Look Instead" table and project structure tree — report any file that's missing, misdocumented, or whose purpose has drifted.
> Compare with `backend/CLAUDE.md` env vars / flags / permissions sections.
> Report ONLY what needs to change. Do NOT edit files.

### Manual Fallback (if 2+ agents fail)

If the agent strategy fails, scan manually in the main thread:
1. Read each CLAUDE.md file
2. Compare file counts against Step 1 ground truth
3. Check for new/removed files by comparing `ls` output against documented file lists
4. Apply changes directly using Edit tool
5. Focus on: file count mismatches, missing new files, stale route/endpoint references, wrong test counts

## Step 3 — Collect Reports & Apply (Phase B: Tier 2 + Tier 1)

Wait for ALL agents to complete (or use manual fallback). Then:

### 3a. Apply Tier 3 changes
For each agent that reported changes (not "NO CHANGES"):
- Edit the relevant CLAUDE.md using the Edit tool
- Use the VERIFIED file counts from Step 1 (never the agent's count)
- Preserve existing format and style

### 3b. Update Tier 2 (if any Tier 3 docs changed)
Read the freshly-updated Tier 3 docs and check:

**`backend/CLAUDE.md`**:
- Feature Flags Registry — matches `middleware/feature-flags.js`?
- Environment Variables — any new `process.env.*`?
- Middleware Chain — any new middleware files?
- Test Suites section — file counts match?
- Do NOT touch: "Database is Postgres", "Common Gotchas", "Production Environment"

**`frontend/CLAUDE.md`**:
- Provider Hierarchy & Hooks — any new providers/hooks?
- "Where to Look Instead" table — any new entries needed?
- Do NOT touch: "Key Conventions", "Architecture Quick Reference"

### 3c. Update Tier 1 (if Tier 2 changed OR schema/migrations changed)
- Root `CLAUDE.md` — project structure tree, migration version, integration list
- `DOMAIN-MAP.md` — add/remove domains matching route files
- `DB-RELATIONSHIPS.md` — update from schema-pg.sql scan

## Step 4 — Final Output

```
━━━ Documentation Audit Complete ━━━━━━━━━━━━━━━━━━━━━━━━━━
  Scanned: [X] directories, [Y] source files

  Updated:
    [list of modified CLAUDE.md files with one-line change summary]

  Verified correct (no changes needed):
    [list of unchanged files]

  Total: X/40 docs updated
  Review: git diff -- "*.md"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Rules

- **Shell counts from Step 1 are the ONLY truth for file counts** — never use agent counts
- **Use `model: "sonnet"` for all subagents** — Opus is unnecessary for this work
- **Max 7 agents total** — Wave 1 has 4 (backend route subdirs, backend top-level routes, services+middleware+workers, tests+utils+misc); Wave 2 has 3 (frontend pages, frontend UI/auth/utils, schema+config+top-level loose files). At most 4 agents run concurrently to match the original API-overload safety budget
- **Fail fast**: If 2+ agents fail in Wave 1, skip Wave 2 and switch to manual scanning
- **Do NOT modify source code** — documentation only
- **Do NOT rewrite docs from scratch** — use Edit to change specific lines
- **Agents report changes, YOU apply them** — agents should not edit files directly
- Keep existing formatting and style — consistency over preference
- If uncertain whether something changed, keep the existing content
