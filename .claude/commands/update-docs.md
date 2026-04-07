---
name: update-docs
description: Scan the codebase and update all documentation files (DOMAIN-MAP, DB-RELATIONSHIPS, CLAUDE.md files) to reflect current state
user_invocable: true
---

# Update Documentation

You are updating the SanoPOS documentation suite to reflect the current state of the codebase. This command scans all source files, compares against existing docs, and updates them.

## Files to Update (all 9)

| File | What to scan |
|------|-------------|
| `DOMAIN-MAP.md` | Every domain's backend route, schema, permissions, flags, frontend page, tables, workers |
| `DB-RELATIONSHIPS.md` | FK relationships from `backend/schema-pg.sql` |
| `backend/CLAUDE.md` | Env vars (grep `process.env`), feature flags, middleware chain, common patterns, error conventions |
| `frontend/CLAUDE.md` | Provider hierarchy, hooks, API patterns, common patterns, error conventions |
| `CLAUDE.md` (root) | Project structure tree, file counts, integration list, migration version |
| `backend/routes/admin/CLAUDE.md` | Admin route modules, auth pattern, logging |
| `backend/routes/shopify/CLAUDE.md` | Shopify route files, tables, worker config |
| `backend/routes/reports/CLAUDE.md` | Report files, feature flag gates |
| `frontend/src/pages/redesign/CLAUDE.md` | Conventions, primitives API, required patterns |

## Step 1 — Scan the Codebase

Run these scans in PARALLEL using subagents:

### Scan A: Backend routes & schemas
- List all files in `backend/routes/` (including subdirs: admin/, shopify/, tier4/, reports/)
- For each route file: identify URL prefix, permissions (grep `requirePerm`/`requireAnyPerm`/`requireFeature`), DB tables touched
- List all files in `backend/schemas/`
- List all files in `backend/services/`, `backend/workers/`, `backend/middleware/`

### Scan B: Frontend pages & connections
- List all files in `frontend/src/pages/redesign/`
- List all files in `frontend/src/pages/admin/`, `pages/reports/`, `pages/shopify/`, `pages/dashboard/`
- Read `frontend/src/routes/appRoutes.jsx` for route path ↔ component mapping
- Read `frontend/src/ui/nav-config.js` for sidebar entries
- Read `frontend/src/ui/Breadcrumbs.jsx` for label map

### Scan C: Database & config
- Read `backend/schema-pg.sql` — extract all CREATE TABLE + REFERENCES relationships
- Grep `process.env.` across all backend files for env vars
- Read `backend/middleware/feature-flags.js` for feature flag list
- Read `backend/middleware/plan-limits.js` for plan limit definitions
- Read `backend/middleware/permissions.js` for permission rules
- Read `backend/shared/constants.js` for exported constants

### Scan D: Read current docs
- Read all 9 documentation files listed above
- Note their current content for comparison

## Step 2 — Compare & Report Changes

Before writing any files, output a change summary:

```
━━━ Documentation Update Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━
  DOMAIN-MAP.md:
    + Added: [list new domains/routes found]
    - Removed: [list domains no longer in codebase]
    ~ Changed: [list domains with updated info]

  DB-RELATIONSHIPS.md:
    + New tables: [list]
    + New FKs: [list]
    - Removed tables: [list]

  backend/CLAUDE.md:
    + New env vars: [list]
    + New feature flags: [list]
    ~ Other changes: [brief description]

  frontend/CLAUDE.md:
    ~ Changes: [brief description, or "No changes"]

  Root CLAUDE.md:
    ~ Changes: [brief description, or "No changes"]

  Directory CLAUDE.md files:
    ~ [file]: [brief description, or "No changes"]

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

### Important rules for each file:

**DOMAIN-MAP.md:**
- One section per domain (same format as existing entries)
- Every domain must have: backend route, permissions, frontend page, route path, nav entry, DB tables
- Remove domains whose route files no longer exist
- Add new domains for any new route files

**DB-RELATIONSHIPS.md:**
- Parse `backend/schema-pg.sql` for REFERENCES clauses
- Group by domain (same grouping as existing)
- Add new tables, remove deleted tables

**backend/CLAUDE.md (specific sections only):**
- "Feature Flags Registry" table — add/remove flags
- "Environment Variables" section — add new `process.env.*` vars found in codebase
- "Middleware Chain" — only update if new middleware added
- "Common Patterns" — only update if conventions changed
- Do NOT touch: "Database is Postgres", "Test Suites", "Common Gotchas", "Production Environment" sections

**frontend/CLAUDE.md (specific sections only):**
- "Provider Hierarchy & Hooks" — update if new providers/hooks added
- "Common Patterns" — only update if conventions changed
- Do NOT touch: "Key Conventions", "Test Suites", "Architecture Quick Reference" sections

**Root CLAUDE.md:**
- "Project Structure" tree — add new files/directories
- "Integrations" section — add new integrations
- "Migrations" — update version number if changed
- Do NOT touch: "Efficiency Rules", "UX Features", "Authentication System" unless they actually changed

**Directory CLAUDE.md files (admin, shopify, reports, redesign):**
- Update file counts, module lists, flag references if they changed
- These are small (5-10 lines) — review and update the full content

## Step 4 — Final Output

After all updates, output:

```
━━━ Documentation Updated ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Updated: [list of files that were modified]
  Unchanged: [list of files that needed no updates]
  
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