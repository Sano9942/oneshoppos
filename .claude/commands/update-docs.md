---
name: update-docs
description: Fast diff-based docs update — reads only changed files since last docs commit, updates affected CLAUDE.md files. Run after feature work. (~$0.20/run)
user_invocable: true
---

# Update Documentation (Diff-Based)

Fast, targeted documentation update. Only reads files that changed — not the entire codebase.

## Step 1 — Find What Changed

Run these commands to identify changed files:

```bash
# Find the last docs update commit
LAST_DOCS=$(git log --oneline --all --grep="docs:" --grep="update.*doc\|doc.*update" -n 1 --format="%H" 2>/dev/null)

# If no docs commit found, use last 10 commits as fallback
if [ -z "$LAST_DOCS" ]; then
  LAST_DOCS="HEAD~10"
fi

# List all changed source files (not CLAUDE.md, not node_modules)
git diff --name-only "$LAST_DOCS"...HEAD -- \
  '*.js' '*.jsx' '*.ts' '*.sql' '*.css' \
  ':!node_modules' ':!*CLAUDE.md' ':!*.test.js' ':!*.spec.js'
```

Also run:
```bash
# Detect added/deleted files (these always need doc updates)
git diff --diff-filter=AD --name-only "$LAST_DOCS"...HEAD -- \
  '*.js' '*.jsx' '*.ts' ':!node_modules' ':!*.test.js' ':!*.spec.js'
```

If **no files changed**, say "No source changes since last docs update. Nothing to do." and stop.

## Step 2 — Map Changes to Directories

Group the changed files by their documentation owner:

| Changed file path pattern | CLAUDE.md to update |
|--------------------------|-------------------|
| `backend/routes/*.js` | Root routes don't have own CLAUDE.md — update `backend/CLAUDE.md` if new route added |
| `backend/routes/admin/*.js` | `backend/routes/admin/CLAUDE.md` |
| `backend/routes/reports/*.js` | `backend/routes/reports/CLAUDE.md` |
| `backend/routes/shopify/*.js` | `backend/routes/shopify/CLAUDE.md` |
| `backend/routes/tier4/*.js` | `backend/routes/tier4/CLAUDE.md` |
| `backend/routes/integrations/*.js` | `backend/routes/integrations/CLAUDE.md` |
| `backend/schemas/*.js` | `backend/schemas/CLAUDE.md` |
| `backend/services/*.js` | `backend/services/CLAUDE.md` |
| `backend/services/couriers/*.js` | `backend/services/couriers/CLAUDE.md` |
| `backend/services/marketplace/*.js` | `backend/services/CLAUDE.md` (marketplace section) |
| `backend/workers/*.js` | `backend/workers/CLAUDE.md` |
| `backend/middleware/*.js` | `backend/middleware/CLAUDE.md` + possibly `backend/CLAUDE.md` (middleware chain) |
| `backend/utils/*.js` | `backend/utils/CLAUDE.md` |
| `backend/boot/*.js` | `backend/boot/CLAUDE.md` |
| `backend/jobs/*.js` | `backend/jobs/CLAUDE.md` |
| `backend/scripts/*.js` | `backend/scripts/CLAUDE.md` |
| `backend/shopify/*.js` | `backend/shopify/CLAUDE.md` |
| `backend/types/*.d.ts` | `backend/types/CLAUDE.md` |
| `backend/schema-pg.sql` | `DB-RELATIONSHIPS.md` + root `CLAUDE.md` (migration version) |
| `backend/middleware/feature-flags.js` | `backend/CLAUDE.md` (feature flags registry) |
| `backend/middleware/permissions.js` | `backend/CLAUDE.md` (permission rules) |
| `backend/migrate-pg.js` | Root `CLAUDE.md` (migration version) |
| `frontend/src/pages/redesign/*.jsx` | `frontend/src/pages/redesign/CLAUDE.md` |
| `frontend/src/pages/redesign/pos/*.jsx` | `frontend/src/pages/redesign/pos/CLAUDE.md` |
| `frontend/src/pages/admin/*.jsx` | `frontend/src/pages/admin/CLAUDE.md` |
| `frontend/src/pages/reports/*.jsx` | `frontend/src/pages/reports/CLAUDE.md` |
| `frontend/src/pages/dashboard/*.jsx` | `frontend/src/pages/dashboard/CLAUDE.md` |
| `frontend/src/pages/shopify/*.jsx` | `frontend/src/pages/shopify/CLAUDE.md` |
| `frontend/src/pages/*.jsx` | `frontend/src/pages/CLAUDE.md` |
| `frontend/src/ui/*.jsx` | `frontend/src/ui/CLAUDE.md` |
| `frontend/src/components/*.jsx` | `frontend/src/components/CLAUDE.md` |
| `frontend/src/auth/*.jsx` | `frontend/src/auth/CLAUDE.md` |
| `frontend/src/utils/*.js` | `frontend/src/utils/CLAUDE.md` |
| `frontend/src/contexts/*.jsx` | `frontend/src/contexts/CLAUDE.md` |
| `frontend/src/hooks/*.js` | `frontend/src/hooks/CLAUDE.md` |
| `frontend/src/types/*.ts` | `frontend/src/types/CLAUDE.md` |
| `frontend/src/routes/*.jsx` | `frontend/src/routes/CLAUDE.md` |
| `frontend/tests/*.spec.js` | `frontend/tests/CLAUDE.md` |

**Build a list of affected CLAUDE.md files.** Only these will be updated.

## Step 3 — Verify File Counts for Affected Directories

For EACH affected directory, run a shell count to get ground truth:

```bash
# Example for backend/services/couriers/:
ls backend/services/couriers/*.js 2>/dev/null | wc -l
```

Use the appropriate glob pattern:
- Backend: `*.js`
- Frontend: `*.jsx` (and `*.js` where applicable)
- Tests: `*.test.js` or `*.spec.js`
- Types: `*.d.ts` or `*.ts`

**NEVER trust subagent counts. Shell counts are the source of truth.**

## Step 4 — Read & Update (Bottom-Up)

### Phase A — Tier 3 (directory docs)
For each affected directory, launch a subagent IN PARALLEL (use `model: "sonnet"`):

Each agent's task:
1. Read the CHANGED files in that directory (from git diff, not all files)
2. Read the current CLAUDE.md for that directory
3. Check if file count changed (compare shell count vs doc's stated count)
4. Check if new files were added or old files removed
5. Check if the changed files affect the doc's description (new exports, renamed functions, changed permissions)
6. If changes needed: Edit the CLAUDE.md. If not: report "no changes needed"

**CRITICAL agent instructions:**
- Only read files that appear in the git diff, NOT the entire directory
- If a file was ADDED: read it fully to understand what it does, add to the doc
- If a file was DELETED: remove from the doc
- If a file was MODIFIED: read the diff (not full file) to understand what changed
- Do NOT change file counts without verifying via shell command first
- Preserve the existing doc format and style exactly

### Phase B — Tier 2 (backend/frontend master docs)
Only run if any Tier 3 doc was updated. Launch 2 agents in parallel:

**Backend agent**: Read all updated backend Tier 3 CLAUDE.md files. Check if `backend/CLAUDE.md` needs updates:
- New env vars? (grep `process.env` in changed files only)
- New feature flags? (check if feature-flags.js changed)
- New middleware? (check if middleware/ changed)
- New route file added? (update project structure if needed)

**Frontend agent**: Read all updated frontend Tier 3 CLAUDE.md files. Check if `frontend/CLAUDE.md` needs updates:
- New hooks or contexts?
- New route wrappers?
- Changed conventions?

### Phase C — Tier 1 (root docs)
Only run if Tier 2 docs were updated OR if `schema-pg.sql` / `migrate-pg.js` changed:

- Update root `CLAUDE.md` project structure tree if new files/directories added
- Update migration version if changed
- Update `DOMAIN-MAP.md` if new routes added
- Update `DB-RELATIONSHIPS.md` if schema-pg.sql changed

## Step 5 — Final Output

```
━━━ Documentation Updated (diff-based) ━━━━━━━━━━━━━━━━━━━━
  Changed files detected: X source files across Y directories
  
  Updated:
    [list of CLAUDE.md files that were modified]
  
  Skipped (no changes in directory):
    [list of CLAUDE.md files not affected]

  Total: X/40 docs updated
  Review: git diff -- "*.md"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Rules

- **Do NOT read files that didn't change** — this is the whole point of the diff approach
- **Do NOT modify source code files** — documentation only
- **Do NOT rewrite docs from scratch** — use Edit to change specific lines
- **Use `model: "sonnet"` for all subagents** — keeps cost low
- **Shell counts are the ONLY source of truth for file counts** — never trust agent counts
- If a section is ambiguous or you're unsure whether something changed, keep the existing content
- Keep existing formatting and style — consistency over preference