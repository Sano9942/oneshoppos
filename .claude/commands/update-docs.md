---
name: update-docs
description: Scan the codebase and update all documentation files (DOMAIN-MAP, DB-RELATIONSHIPS, all 38 CLAUDE.md files) to reflect current state
user_invocable: true
---

# Update Documentation

You are updating the SanoPOS documentation suite to reflect the current state of the codebase. This command scans all source files, compares against existing docs, and updates them.

## Files to Update (38 CLAUDE.md + 2 reference docs = 40 total)

### Tier 1 — Core Reference Docs (always scan)
| File | What to scan |
|------|-------------|
| `DOMAIN-MAP.md` | Every domain's backend route, schema, permissions, flags, frontend page, tables, workers |
| `DB-RELATIONSHIPS.md` | FK relationships from `backend/schema-pg.sql` |
| `CLAUDE.md` (root) | Project structure tree, file counts, integration list, migration version |
| `backend/CLAUDE.md` | Env vars (grep `process.env`), feature flags, middleware chain, common patterns, error conventions |
| `frontend/CLAUDE.md` | Provider hierarchy, hooks, API patterns, common patterns, error conventions |

### Tier 2 — Backend Directory Guides (16 files)
| File | What to scan |
|------|-------------|
| `backend/routes/admin/CLAUDE.md` | Admin route modules, auth pattern, logging |
| `backend/routes/reports/CLAUDE.md` | Report files, feature flag gates, governance tables |
| `backend/routes/shopify/CLAUDE.md` | Shopify route files, tables, worker config |
| `backend/routes/tier4/CLAUDE.md` | Tier 4 modules, feature flags, permissions |
| `backend/services/CLAUDE.md` | Service files, exports, patterns |
| `backend/services/couriers/CLAUDE.md` | Adapter pattern, known adapters |
| `backend/middleware/CLAUDE.md` | Middleware files, init patterns, cache durations |
| `backend/schemas/CLAUDE.md` | Schema files, key exports, validation gotchas |
| `backend/workers/CLAUDE.md` | Worker files, pg-boss jobs, heartbeat globals |
| `backend/utils/CLAUDE.md` | Utility files, exports |
| `backend/boot/CLAUDE.md` | Boot sequence, worker startup |
| `backend/jobs/CLAUDE.md` | Job files, schedules |
| `backend/scripts/CLAUDE.md` | Script files, usage |
| `backend/shopify/CLAUDE.md` | Client, crypto, order-service, utils |
| `backend/types/CLAUDE.md` | TypeScript declarations |
| `backend/tests/CLAUDE.md` | Test frameworks, run commands |
| `backend/tests/helpers/CLAUDE.md` | Test helper files |
| `backend/tests/integration/CLAUDE.md` | Integration test files, batch coverage |
| `backend/tests/unit/CLAUDE.md` | Unit test files |

### Tier 3 — Frontend Directory Guides (15 files)
| File | What to scan |
|------|-------------|
| `frontend/src/pages/redesign/CLAUDE.md` | Conventions, primitives API, required patterns |
| `frontend/src/pages/redesign/pos/CLAUDE.md` | POS module files, context exports, modal list |
| `frontend/src/pages/reports/CLAUDE.md` | Report tab files, shared utilities, feature gates |
| `frontend/src/pages/dashboard/CLAUDE.md` | Dashboard widget files |
| `frontend/src/pages/shopify/CLAUDE.md` | Shopify tab files, context |
| `frontend/src/pages/admin/CLAUDE.md` | Admin page files, auth pattern |
| `frontend/src/pages/CLAUDE.md` | Route wrappers, special pages |
| `frontend/src/ui/CLAUDE.md` | Primitives exports, nav-config, banners |
| `frontend/src/components/CLAUDE.md` | Layout shell, auth guards |
| `frontend/src/auth/CLAUDE.md` | AuthProvider, stores, fetch interceptor |
| `frontend/src/utils/CLAUDE.md` | Utility files, gotchas |
| `frontend/src/contexts/CLAUDE.md` | Context providers |
| `frontend/src/hooks/CLAUDE.md` | Custom hooks |
| `frontend/src/types/CLAUDE.md` | TypeScript declarations |
| `frontend/src/routes/CLAUDE.md` | Route config files |
| `frontend/tests/CLAUDE.md` | Test suites, frameworks, run commands |

## Step 1 — Scan the Codebase

Run these scans in PARALLEL using subagents:

### Scan A: Backend structure
- List all files in `backend/routes/` (including subdirs: admin/, shopify/, tier4/, reports/)
- For each route file: identify URL prefix, permissions (grep `requirePerm`/`requireAnyPerm`/`requireFeature`), DB tables touched
- List all files in `backend/schemas/`, `backend/services/` (incl. couriers/), `backend/workers/`, `backend/middleware/`, `backend/utils/`, `backend/boot/`, `backend/jobs/`, `backend/scripts/`, `backend/shopify/`, `backend/types/`
- Count files per directory for comparison with docs

### Scan B: Frontend structure
- List all files in `frontend/src/pages/redesign/` (incl. `pos/` subdir)
- List all files in `frontend/src/pages/admin/`, `pages/reports/`, `pages/shopify/`, `pages/dashboard/`
- List all files in `frontend/src/ui/`, `components/`, `auth/`, `utils/`, `contexts/`, `hooks/`, `types/`, `routes/`
- Read `frontend/src/routes/appRoutes.jsx` for route path ↔ component mapping
- Read `frontend/src/ui/nav-config.js` for sidebar entries
- Count files per directory for comparison with docs

### Scan C: Database & config
- Read `backend/schema-pg.sql` — extract all CREATE TABLE + REFERENCES relationships
- Grep `process.env.` across all backend files for env vars
- Read `backend/middleware/feature-flags.js` for feature flag list
- Read `backend/middleware/plan-limits.js` for plan limit definitions
- Read `backend/middleware/permissions.js` for permission rules

### Scan D: Read current docs
- Read ALL 40 documentation files listed above
- Note their current content for comparison (file counts, module lists, exports)

## Step 2 — Compare & Report Changes

Before writing any files, output a change summary:

```
━━━ Documentation Update Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━
  Tier 1 (core):
    DOMAIN-MAP.md: [changes or "No changes"]
    DB-RELATIONSHIPS.md: [changes or "No changes"]
    CLAUDE.md (root): [changes or "No changes"]
    backend/CLAUDE.md: [changes or "No changes"]
    frontend/CLAUDE.md: [changes or "No changes"]

  Tier 2 (backend dirs):
    [file]: [changes or "No changes"] (for each of 16 files)

  Tier 3 (frontend dirs):
    [file]: [changes or "No changes"] (for each of 15 files)

  Overall: X files need updates, Y files unchanged
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If NOTHING changed, say "All documentation is up to date. No changes needed." and stop.

## Step 3 — Update Files

For each file that needs changes:
- Use **Edit** (not Write) for existing files — preserve unchanged sections
- Only modify sections where the codebase diverged from docs
- Keep the same formatting, structure, and style as the existing docs
- Do NOT rewrite sections that are still accurate

### Important rules:

**DOMAIN-MAP.md:**
- One section per domain (same format as existing entries)
- Every domain must have: backend route, permissions, frontend page, route path, nav entry, DB tables
- Remove domains whose route files no longer exist; add new domains for new route files

**DB-RELATIONSHIPS.md:**
- Parse `backend/schema-pg.sql` for REFERENCES clauses
- Group by domain (same grouping as existing). Add new tables, remove deleted tables

**Root CLAUDE.md:**
- "Project Structure" tree — add new files/directories, fix file counts
- "Integrations" section — add new integrations
- "Migrations" — update version number if changed
- Do NOT touch: "Efficiency Rules", "UX Features", "Authentication System" unless actually changed

**backend/CLAUDE.md (specific sections only):**
- "Feature Flags Registry" — add/remove flags
- "Environment Variables" — add new `process.env.*` vars found in codebase
- "Middleware Chain" — only if new middleware added
- Do NOT touch: "Database is Postgres", "Test Suites", "Common Gotchas", "Production Environment"

**frontend/CLAUDE.md (specific sections only):**
- "Provider Hierarchy & Hooks" — update if new providers/hooks added
- "Common Patterns" — only if conventions changed
- Do NOT touch: "Key Conventions", "Test Suites", "Architecture Quick Reference"

**Tier 2 & 3 directory CLAUDE.md files:**
- Update file counts, module lists, export names, flag references if they changed
- These are small (5-15 lines) — review and update the full content
- Check: did files get added/removed/renamed in the directory?
- Check: did key exports or patterns change?

## Step 4 — Final Output

After all updates, output:

```
━━━ Documentation Updated ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Updated: [list of files that were modified]
  Unchanged: [list of files that needed no updates]
  
  Total: X/40 files updated
  Review the changes with: git diff
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Important

- Use **parallel subagents** for the 4 scans in Step 1 — this is the most time-consuming part
- Do NOT modify any source code files — this is a documentation-only command
- Do NOT add commentary or explanations to the doc files — keep them reference-style
- Do NOT read files unnecessarily — grep first, read only if grep is insufficient
- Keep existing formatting and style — consistency matters more than personal preference
- If a section is ambiguous or you're unsure whether something changed, keep the existing content
- The goal is accuracy, not creativity — these docs must reflect what the code actually does
