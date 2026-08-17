# WS4 — Auto-stock-entry, Phase 1 `feature track`

**Model:** Sonnet (Opus for the supplier-mapper UX architecture if needed). **Branch:**
`feat/ws4-auto-stock-phase1` off `main`. Separate cadence — not a bug-fix workstream.

## Context
Roadmap: `docs/fable5/archive/core-research/AUTO-STOCK-ENTRY.md`. Phase 1 is low-risk UX plumbing on the
existing capable import engine (`routes/import.js` — CSV/XLSX parse, per-row `_errors`, FK-by-name
resolution, SKU dedup, single-tx bulk insert with `outlet_stock` upsert). Do NOT start Phase 2/3 (AI
invoice parse) here — those are gated on `ANTHROPIC_API_KEY` being set on Railway (absent today; also
silently disables current AI insights — flag that to the user separately).

## Verify first
Read `import.js` + `ImportRedesign.jsx` + `services/import/mappers/index.js` to confirm the current
capabilities before extending. Confirm `embedded-barcode.js` scale-label decode is live
(`products.js:378,383`).

## Task (Phase 1 only)
- **Scan-to-create at POS** — on barcode-not-found (`GET /api/products/scan/:barcode`), open a
  quick-create drawer pre-filled with the scanned barcode → `POST /api/products`. Removes the
  POS→form→retype loop.
- **Supplier-catalog import mapper** — add a `supplier` entity + generic "map their header → our field"
  column-mapping step to `import.js`/mappers. Reuse the existing preview→confirm UX.
- **Fuzzy name-match on import** — add `pg_trgm` `similarity()` suggestions in the preview grid
  ("row 4 looks like existing SKU X — merge?"). Requires the `pg_trgm` extension; keep human-confirm
  (false-match risk).
- **Cost→price rule** — optional margin % per category → auto-fill retail price from cost on
  import/GRN.
- **GRN name-match** — extend `grn.js` scan-receive to also fuzzy-match by name when a supplier line
  has no barcode.

## Verify the fix
- Import tests from `backend/` cwd; diff vs baseline.
- Drive the local frontend: unknown barcode at POS → quick-create → product exists; supplier CSV with a
  custom header maps + imports; near-duplicate name flagged in preview.

## Commit & push (REQUIRED)
Commit per feature, push `feat/ws4-auto-stock-phase1`. No PR. Co-Authored-By trailer.
