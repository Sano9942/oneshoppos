# COD Settlements Module — Claude Guide

7-file sub-module for Cash-on-Delivery settlement reconciliation. Rendered inside `CODSettlementsRedesign.jsx` (parent in `pages/redesign/`). Feature-flagged: `phase5_cod_settlements`.

## Architecture

`CODSettlementsRedesign.jsx` (parent) manages top-level view state — either `list` or `detail` — and renders:
- `BatchList` — list view with filters and import trigger
- `BatchDetail` — drill-down into a single batch
- `ImportWizard` — overlaid modal-style wizard (step 1–4)

The parent also renders `BatchHeaderCard`, `LineTable`, `ManualMatchModal`, `ApproveConfirmModal` indirectly via `BatchDetail`.

## Files

| File | Role |
|------|------|
| `BatchList.jsx` | Batch list with courier + status filters. Props: `onOpenImport`, `onOpenBatch(id)` |
| `BatchDetail.jsx` | Single batch drill-down. Props: `batchId`, `onBack`. Owns all batch-level actions |
| `BatchHeaderCard.jsx` | Summary card (status, totals, action buttons slot via `children`) |
| `LineTable.jsx` | Settlement lines table. Props: `lines`, `readOnly`, `onResolveNote`, `onManualMatch` |
| `ManualMatchModal.jsx` | Search + select web order for manual line matching. Props: `open`, `line`, `onClose`, `onMatched(lineId, webOrderId)` |
| `ApproveConfirmModal.jsx` | Confirmation dialog before batch approval. Props: `open`, `batch`, `busy`, `onCancel`, `onConfirm` |
| `ImportWizard.jsx` | 4-step import wizard (see below) |

## Batch Lifecycle & Status Values

`imported` → `matching` → `review` → `approved` / `rejected`

- **`imported`**: batch created, match not yet run. "Run match" button available.
- **`matching`**: match job in progress (button disabled).
- **`review`**: match complete, lines need human review. "Re-run match" + "Approve batch" available.
- **`approved`** / **`rejected`**: terminal states. `LineTable` becomes read-only.

Approve button is gated: `hasPerm("all_access")` only — managers cannot approve.

## ImportWizard — 4-Step Flow

**Step 1** — Select courier (only enabled couriers shown)  
**Step 2** — Upload CSV or XLSX file (parsed client-side via `xlsx` library)  
**Step 3** — Map file columns to required fields (`courier_tracking_number`, `remitted_amount`) and optional fields (`courier_order_ref`, `courier_fee`)  
**Step 4** — Preview first 10 rows + set batch reference + confirm import

**Step-skip gotcha:** If the selected courier already has a saved `cod_csv_mapping` in `config_json` AND the uploaded file's headers contain the required mapped columns, **step 3 is skipped automatically** — the wizard jumps from step 2 to step 4. This is intentional UX (repeat imports from the same courier skip re-mapping).

**Mapping persistence:** "Save this mapping" checkbox (default: checked) calls `PATCH /api/couriers/:id/csv-mapping`. Failure to save is a soft warning — it does not block the import.

**Import sequence:**
1. Save mapping (if checked) — failure is non-blocking toast warning
2. `POST /api/fulfillment/cod/settlements/import` — creates batch + lines
3. `POST /api/fulfillment/cod/settlements/:id/match` — auto-runs match immediately. Failure here is also non-blocking (toast warning, user can re-run from detail view)

**`config_json` parsing:** `courier_integrations.config_json` is stored as `TEXT` (not JSONB). `ImportWizard` defensively parses it with `JSON.parse()` in `readCodMapping()` — never assume it's already an object.

## API Endpoints Used

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/couriers` | Load courier list (BatchList + ImportWizard) |
| GET | `/api/fulfillment/cod/settlements` | List batches (query: `courier_id`, `status`) |
| GET | `/api/fulfillment/cod/settlements/:id` | Batch detail + lines |
| POST | `/api/fulfillment/cod/settlements/import` | Create batch from mapped rows |
| POST | `/api/fulfillment/cod/settlements/:id/match` | Run/re-run automatic matching |
| POST | `/api/fulfillment/cod/settlements/:id/resolve` | Save note or manual match on a line |
| POST | `/api/fulfillment/cod/settlements/:id/approve` | Approve batch (admin only) |
| PATCH | `/api/couriers/:id/csv-mapping` | Persist column mapping to courier config |
