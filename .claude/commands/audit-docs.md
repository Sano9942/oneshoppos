---
name: audit-docs
description: Full deep-scan docs audit — reads every source file, rebuilds all CLAUDE.md files from scratch. Run monthly or when docs feel stale. (~$5/run on Sonnet)
user_invocable: true
model: sonnet
---

# Audit Documentation (Full Deep Scan)

Comprehensive documentation audit. Reads every source file to rebuild all CLAUDE.md files from scratch using a 4-session parallel methodology.

**Cost warning**: ~$5 on Sonnet. For targeted post-feature updates, edit the relevant CLAUDE.md files directly.

## Methodology Overview

This audit runs in 4 parallel sessions:

- **Session 1 (Leaf — Backend)**: Rewrites all backend leaf CLAUDE.md files (subdirectories of routes/, services/, tests/, middleware/, schemas/, workers/, utils/, boot/, shopify/, types/)
- **Session 2 (Leaf — Frontend)**: Rewrites all frontend leaf CLAUDE.md files (src/auth/, src/contexts/, src/utils/, src/ui/, src/routes/, src/types/, src/pages/admin/, src/pages/portal/, src/pages/reports/, src/pages/redesign/pos/, tests/)
- **Session 3 (Mid + Top — Backend)**: After Sessions 1-2 complete, rewrites backend mid-level docs (routes/CLAUDE.md, services/CLAUDE.md, tests/CLAUDE.md) then backend/CLAUDE.md
- **Session 4 (Mid + Top — Frontend)**: After Sessions 1-2 complete, rewrites frontend mid-level docs (src/CLAUDE.md, src/pages/CLAUDE.md, src/pages/redesign/CLAUDE.md) then frontend/CLAUDE.md and root CLAUDE.md

Sessions 1 and 2 run in parallel. Sessions 3 and 4 run in parallel after Sessions 1 and 2 both complete.

## Step 1 — Get Ground-Truth File Counts

Run these shell commands FIRST. These numbers are the **only source of truth** for file counts — never trust subagent counts.

```bash
# Backend counts
echo "routes (top-level):" $(ls backend/routes/*.js 2>/dev/null | wc -l)
echo "routes/admin:" $(ls backend/routes/admin/*.js 2>/dev/null | wc -l)
echo "routes/reports:" $(ls backend/routes/reports/*.js 2>/dev/null | wc -l)
echo "routes/shopify:" $(ls backend/routes/shopify/*.js 2>/dev/null | wc -l)
echo "routes/tier4:" $(ls backend/routes/tier4/*.js 2>/dev/null | wc -l)
echo "routes/integrations:" $(ls backend/routes/integrations/*.js 2>/dev/null | wc -l)
echo "routes/customer-portal:" $(ls backend/routes/customer-portal/*.js 2>/dev/null | wc -l)
echo "routes/restaurant:" $(ls backend/routes/restaurant/*.js 2>/dev/null | wc -l)
echo "schemas:" $(ls backend/schemas/*.js 2>/dev/null | wc -l)
echo "services:" $(ls backend/services/*.js 2>/dev/null | wc -l)
echo "services/couriers:" $(ls backend/services/couriers/*.js 2>/dev/null | wc -l)
echo "services/marketplace:" $(ls backend/services/marketplace/*.js 2>/dev/null | wc -l)
echo "workers:" $(ls backend/workers/*.js 2>/dev/null | wc -l)
echo "middleware:" $(ls backend/middleware/*.js 2>/dev/null | wc -l)
echo "utils:" $(ls backend/utils/*.js 2>/dev/null | wc -l)
echo "boot:" $(ls backend/boot/*.js 2>/dev/null | wc -l)
echo "shopify:" $(ls backend/shopify/*.js 2>/dev/null | wc -l)
echo "tests/integration:" $(ls backend/tests/integration/*.test.js 2>/dev/null | wc -l)
echo "tests/unit:" $(ls backend/tests/unit/*.test.js 2>/dev/null | wc -l)
```

```bash
# Frontend counts
echo "pages (top-level):" $(ls frontend/src/pages/*.jsx 2>/dev/null | wc -l)
echo "redesign:" $(ls frontend/src/pages/redesign/*.jsx 2>/dev/null | wc -l)
echo "redesign/pos:" $(ls frontend/src/pages/redesign/pos/*.jsx frontend/src/pages/redesign/pos/*.js 2>/dev/null | wc -l)
echo "admin:" $(ls frontend/src/pages/admin/*.jsx 2>/dev/null | wc -l)
echo "reports:" $(ls frontend/src/pages/reports/*.jsx 2>/dev/null | wc -l)
echo "portal:" $(ls frontend/src/pages/portal/*.jsx 2>/dev/null | wc -l)
echo "ui:" $(ls frontend/src/ui/*.jsx frontend/src/ui/*.js 2>/dev/null | wc -l)
echo "auth:" $(ls frontend/src/auth/*.jsx frontend/src/auth/*.js 2>/dev/null | wc -l)
echo "utils:" $(ls frontend/src/utils/*.js 2>/dev/null | wc -l)
echo "contexts:" $(ls frontend/src/contexts/*.jsx 2>/dev/null | wc -l)
echo "types:" $(ls frontend/src/types/*.ts 2>/dev/null | wc -l)
echo "routes:" $(ls frontend/src/routes/*.jsx 2>/dev/null | wc -l)
echo "tests specs:" $(ls frontend/tests/*.spec.js 2>/dev/null | wc -l)
```

Also list all filenames in key directories to catch new/removed files:
```bash
ls backend/routes/*.js | sort
ls backend/services/*.js | sort
ls frontend/src/pages/redesign/*.jsx | sort
```

Save these results — agents will need the file lists.

## Step 2 — Session 1 + 2 in Parallel (Leaf Docs)

Launch Sessions 1 and 2 simultaneously. Each agent reads source files and **writes** (overwrites) the CLAUDE.md files directly.

### Session 1 — Backend Leaf Docs

Dispatch one agent per backend leaf directory, all in parallel within Session 1:

**Agent 1a: routes/admin/**
Read every .js file in `backend/routes/admin/`. Note: what each file exports, key routes (method + path), permission middleware used (requirePerm/requireAnyPerm), tables touched, and any special gotchas. Write `backend/routes/admin/CLAUDE.md` from scratch.

**Agent 1b: routes/reports/**
Read every .js file in `backend/routes/reports/`. Note exports, report endpoints (method + path + required params), feature flags required, output format (JSON/CSV). Write `backend/routes/reports/CLAUDE.md` from scratch.

**Agent 1c: routes/shopify/**
Read every .js file in `backend/routes/shopify/`. Note exports, routes, webhook handling, Shopify-specific gotchas. Write `backend/routes/shopify/CLAUDE.md` from scratch.

**Agent 1d: routes/tier4/**
Read every .js file in `backend/routes/tier4/`. Note exports, routes, permissions, feature flags. Write `backend/routes/tier4/CLAUDE.md` from scratch.

**Agent 1e: routes/integrations/**
Read every .js file in `backend/routes/integrations/`. Note exports, integration types, credential handling. Write `backend/routes/integrations/CLAUDE.md` from scratch.

**Agent 1f: services/couriers/**
Read every .js file in `backend/services/couriers/`. Note: adapter pattern, base class interface, each courier adapter's supported methods, shipment payload format. Write `backend/services/couriers/CLAUDE.md` from scratch.

**Agent 1g: services/marketplace/**
Read every .js file in `backend/services/marketplace/`. Note: base class, each marketplace client's methods, auth patterns, rate limits. Write `backend/services/marketplace/CLAUDE.md` from scratch.

**Agent 1h: middleware/**
Read every .js file in `backend/middleware/`. Note: what each exports, middleware signature, key env vars consumed. Write `backend/middleware/CLAUDE.md` from scratch.

**Agent 1i: schemas/**
Read every .js file in `backend/schemas/`. Note: Zod schemas exported per file, which routes import which schemas. Write `backend/schemas/CLAUDE.md` from scratch.

**Agent 1j: workers/**
Read every .js file in `backend/workers/`. Note: pg-boss job names, schedules, enabling env vars, what each worker does. Write `backend/workers/CLAUDE.md` from scratch.

**Agent 1k: tests/unit/**
Read every .test.js file in `backend/tests/unit/`. Note: what each tests (unit under test, mocking approach). Write `backend/tests/unit/CLAUDE.md` from scratch.

**Agent 1l: utils/ + boot/ + shopify/**
Read every .js file in `backend/utils/`, `backend/boot/`, `backend/shopify/`. Note exports and purpose per file. Write separate CLAUDE.md for each: `backend/utils/CLAUDE.md`, `backend/boot/CLAUDE.md`, `backend/shopify/CLAUDE.md`.

### Session 2 — Frontend Leaf Docs

Dispatch one agent per frontend leaf directory, all in parallel within Session 2:

**Agent 2a: src/auth/**
Read every file in `frontend/src/auth/`. Note: AuthProvider pattern, hooks exported, token storage, portal vs admin auth. Write `frontend/src/auth/CLAUDE.md` from scratch.

**Agent 2b: src/contexts/**
Read every file in `frontend/src/contexts/`. Note: each context's exported hook, what state it manages, provider requirements. Write `frontend/src/contexts/CLAUDE.md` from scratch.

**Agent 2c: src/utils/**
Read every file in `frontend/src/utils/`. Note: each file's exports and usage patterns. Write `frontend/src/utils/CLAUDE.md` from scratch.

**Agent 2d: src/ui/**
Read every file in `frontend/src/ui/`. Note: each component's props interface, design system primitives, gotchas. Write `frontend/src/ui/CLAUDE.md` from scratch.

**Agent 2e: src/routes/**
Read every file in `frontend/src/routes/`. Note: route split pattern, how routes are structured, auth guards. Write `frontend/src/routes/CLAUDE.md` from scratch.

**Agent 2f: src/types/**
Read every file in `frontend/src/types/`. Note: what types are declared, which are used where. Write `frontend/src/types/CLAUDE.md` from scratch.

**Agent 2g: pages/admin/**
Read every .jsx file in `frontend/src/pages/admin/`. Note: super-admin pages, API endpoints used, auth pattern. Write `frontend/src/pages/admin/CLAUDE.md` from scratch.

**Agent 2h: pages/portal/**
Read every .jsx file in `frontend/src/pages/portal/`. Note: customer portal pages, portal auth, API endpoints. Write `frontend/src/pages/portal/CLAUDE.md` from scratch.

**Agent 2i: pages/reports/**
Read every .jsx file in `frontend/src/pages/reports/`. Note: report components, tabs, export patterns. Write `frontend/src/pages/reports/CLAUDE.md` from scratch.

**Agent 2j: pages/redesign/pos/**
Read every file in `frontend/src/pages/redesign/pos/`. Note: POSContext exports (all 130+), keyboard shortcuts, hook names, modal structure. Write `frontend/src/pages/redesign/pos/CLAUDE.md` from scratch.

**Agent 2k: frontend/tests/**
List all .spec.js files in `frontend/tests/`. Read `playwright.config.js`, `global-setup.js`, and `helpers/`. Note test structure, auth setup, and what each spec covers. Write `frontend/tests/CLAUDE.md` from scratch.

## Step 3 — Sessions 3 + 4 in Parallel (Mid-Level + Domain Top-Level Docs)

After Sessions 1 and 2 both complete, launch Sessions 3 and 4 simultaneously.

**Root `CLAUDE.md` is NOT part of Session 4.** It depends on both `backend/CLAUDE.md` (written at the end of Session 3) and `frontend/CLAUDE.md` (written at the end of Session 4). Writing it as the last step of Session 4 would race Session 3 — if the frontend track finishes first, root would synthesize from a `backend/CLAUDE.md` that is still stale or not yet written. Root is handled separately in Step 4, after both sessions fully complete.

### Session 3 — Backend Mid-Level + Top-Level

One agent sequentially (reads depend on previous writes):

**Step 3a**: Read all backend leaf CLAUDE.md files (just written) + list of top-level backend/routes/*.js files. Write `backend/routes/CLAUDE.md` from scratch.

**Step 3b**: Read `backend/services/couriers/CLAUDE.md`, `backend/services/marketplace/CLAUDE.md`, and the list of `backend/services/*.js` files. Write `backend/services/CLAUDE.md` from scratch.

**Step 3c**: Read `backend/tests/unit/CLAUDE.md` and the list of `backend/tests/integration/*.test.js` filenames. Write `backend/tests/CLAUDE.md` from scratch.

**Step 3d**: Read all Phase 3a-3c backend docs + the three middleware files (feature-flags.js, permissions.js, tenant-auth.js lines 1-80 each) + index.js lines 1-100. Write `backend/CLAUDE.md` from scratch.

### Session 4 — Frontend Mid-Level + Top-Level

One agent sequentially (reads depend on previous writes):

**Step 4a**: Read all frontend src leaf CLAUDE.md files (auth, contexts, utils, ui, routes, types) + `src/api.js` + `src/config.js` + `src/main.jsx`. Write `frontend/src/CLAUDE.md` from scratch.

**Step 4b**: Read `pages/admin/CLAUDE.md`, `pages/portal/CLAUDE.md`, `pages/reports/CLAUDE.md`, `pages/redesign/CLAUDE.md` + list of `src/pages/*.jsx` files. Write `frontend/src/pages/CLAUDE.md` from scratch.

**Step 4c**: Read `pages/redesign/pos/CLAUDE.md` + list all `src/pages/redesign/*.jsx` files. Write `frontend/src/pages/redesign/CLAUDE.md` from scratch.

**Step 4d**: Read all Phase 4a-4c frontend docs + `src/App.jsx` lines 1-60 + `src/api.js` lines 1-60. Write `frontend/CLAUDE.md` from scratch.

## Step 4 — Root (After Sessions 3 AND 4 Both Complete)

Do not start this until both Session 3 (ending in `backend/CLAUDE.md`) and Session 4 (ending in `frontend/CLAUDE.md`) have finished writing. This step is intentionally sequential, not parallel — it is the top of the pyramid and must be verified against final, not in-flight, versions of both domain docs.

**Step 5**: Read `backend/CLAUDE.md` + `frontend/CLAUDE.md` + last 100 lines of `backend/migrate-pg.js` + grep for CREATE TABLE in `backend/schema-pg.sql`. Write root `CLAUDE.md` from scratch, preserving the full comprehensive structure (all sections: What This Is, Sub-Guides, Efficiency Rules, Project Structure, Key Architecture, UX Features, Integrations, Reliability, Running Tests, Auth, Permissions, Migrations, API Contracts, Production Deployment, CLI Tools, Infrastructure Capacity, Storage Map).

## Rules for All Agents

- **Write the full file from scratch** — use the Write tool to overwrite, not Edit
- **No file counts, no dates, no phase/wave labels** in written docs
- **Keep**: what things do, exports, gotchas, conventions, cross-file dependencies
- **Be concise** — docs orient an agent, not exhaustive API references
- After writing, return a one-line summary of what was written

## Final Output

```
━━━ Documentation Audit Complete ━━━━━━━━━━━━━━━━━━━━━━━━━━
  Sessions 1+2 (leaf docs): [N] files written
  Sessions 3+4 (mid + domain top): 8 files written
  Step 5 (root, after both sessions complete): 1 file written

  Summary:
    [one-line per doc written]

  Review: git diff -- "*.md"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
