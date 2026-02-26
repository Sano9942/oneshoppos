# LEGACY_UI_REMOVAL_GUARDRAIL

Purpose:
- Prevent partial or unsafe legacy UI deletions during redesign cutover.

Mandatory gate before deleting any legacy page file:
1. Import-graph gate:
   - For each delete candidate `frontend/src/pages/<Name>.jsx`, verify there are no imports of `./<Name>` or `../<Name>` anywhere in `frontend/src`.
2. Dependency classification gate:
   - If a redesign page imports `../<Name>`, classify `<Name>` as a retained logic dependency, not a delete candidate.
3. Build gate:
   - `cd frontend && npm run build` must pass.
4. Route smoke gate:
   - Verify routes render in browser:
     - `/dashboard`
     - `/inventory`
     - `/reports`
     - `/accounting`
     - `/sales-history`
     - `/integrations/shopify`

Required forensic capture before large delete batches:
1. Save `git status --short`.
2. Save `git diff --name-status`.
3. Save `git diff --stat`.
4. Save `git reflog --date=iso -n 80`.
5. Save `git log --oneline --decorate --graph -n 30`.

Output location:
- Store each cleanup incident/checkpoint in `docs/archive/legacy-ui-cleanup-incident-<timestamp>.md`.

Current known retained logic dependencies:
1. `frontend/src/pages/Accounting.jsx`
2. `frontend/src/pages/Reports.jsx`
3. `frontend/src/pages/InvoiceView.jsx`
4. `frontend/src/pages/ShopifyIntegration.jsx`
