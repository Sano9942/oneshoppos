# COD Settlements UI — Design

**Date:** 2026-04-11
**Status:** Approved, pending implementation plan
**Scope:** Frontend page + small backend additions for the COD reconciliation flow
**Backend state:** 6 endpoints already exist at `backend/routes/fulfillment.js:973-1270`, feature-flagged on `phase5_cod_reconciliation`

## Context

COD (cash-on-delivery) is the dominant payment method in Pakistani retail. Couriers deliver parcels, collect cash from customers, deduct their fees, and remit the balance to the merchant — usually weekly, in a CSV or Excel report. The merchant then has to reconcile what the courier says they sent against what the merchant expected, flag shortfalls, investigate disputes, and close the loop.

The backend for this flow was built as part of Phase 5 but has no consumer. This design describes the frontend UI and the minimal backend additions needed to make it usable.

Ledger integration is explicitly out of scope — approving a batch will finalize the reconciliation record but will not post journal entries. That's a follow-up decision.

## Decisions (locked in during brainstorming)

1. **CSV column mapping is user-configurable, saved per courier.** No hardcoded per-courier parsers. First import for a courier maps columns; subsequent imports reuse the saved mapping. Mapping persisted to `courier_integrations.config_json.cod_csv_mapping`.
2. **Unmatched lines support manual match via web_order search.** Backend's existing `/resolve` endpoint is extended to accept an optional `matched_order_id`. No new table, no new enum value.
3. **Approve does not post to any accounting ledger.** The batch is a reconciliation record. Bookkeepers export/read the batch and enter journal entries in their accounting tool.
4. **Permissions are split.** `manage_orders` for import/match/resolve; `all_access` (admin only) for approve. This matches the maker-checker pattern already used in Returns and Expenses.
5. **New top-level nav entry `/cod-settlements`.** Not buried under Integrations Hub or Fulfillment. Feature-flagged on `phase5_cod_reconciliation`, permission-gated on `manage_orders` for nav visibility.

## Architecture

Single-page React component with three internal views switched by local state:

- **List view** — table of batches, filters by courier + status, "Import new batch" CTA
- **Import wizard** — 4 steps: courier → upload → map columns → preview & confirm
- **Batch detail view** — header KPIs + tabbed line table + per-line actions + approve flow

No sub-routes; navigation is stateful. Matches the pattern used by `ShopifyIntegrationRedesign` and `IntegrationsHubRedesign`.

### Frontend files

```
frontend/src/pages/redesign/CODSettlementsRedesign.jsx   # Main page, view switcher
frontend/src/pages/CODSettlementsRoute.jsx               # 5-line thin wrapper
frontend/src/pages/redesign/cod/
  ├── BatchList.jsx         # List view
  ├── ImportWizard.jsx      # 4-step wizard shell
  ├── ImportStepCourier.jsx # Step 1 — courier select
  ├── ImportStepUpload.jsx  # Step 2 — file parse (papaparse/xlsx)
  ├── ImportStepMapping.jsx # Step 3 — column mapping
  ├── ImportStepPreview.jsx # Step 4 — preview & confirm
  ├── BatchDetail.jsx       # Detail view shell (header + tabs)
  ├── BatchHeaderCard.jsx   # KPIs + state-dependent buttons
  ├── LineTable.jsx         # Shared table used by all tabs
  ├── ManualMatchModal.jsx  # Web-order search + pick
  └── ApproveConfirmModal.jsx # Type-batch-ref-to-confirm modal
```

### Wiring

- `ui/nav-config.js` — new entry `{ label: "COD Settlements", path: "/cod-settlements", icon: Wallet }`
- `ui/Breadcrumbs.jsx` — add `"cod-settlements": "COD Settlements"` to LABELS
- `routes/appRoutes.jsx` — lazy import + `<Route path="/cod-settlements" element={<RequireAuth><RequirePerm perm="manage_orders"><CODSettlementsRoute /></RequirePerm></RequireAuth>} />`
- Feature-flag check inside the component: if `phase5_cod_reconciliation` is off, redirect to `/`

### Backend additions (minimal)

1. **`PATCH /api/courier-integrations/:id/csv-mapping`** — save user's column mapping. Body: `{ mapping: { courier_tracking_number: "Tracking No", remitted_amount: "COD Amount", ... } }`. Persists to `courier_integrations.config_json.cod_csv_mapping`. Permission: `manage_orders`.

2. **Extend `POST /api/fulfillment/cod/settlements/:id/resolve`** — accept optional `matched_order_id`. If provided, update `matched_order_id`, recompute `expected_amount` from `web_orders.grand_total`, recompute `difference`, recompute `match_status` (matched / short / over). If not provided, behave as today (note only).

3. **New `GET /api/web-orders/search?q=...`** — small search endpoint for the ManualMatchModal. Matches on `external_order_number` LIKE, `customer_name` ILIKE, `customer_phone` LIKE, and exact `grand_total` if `q` parses as a number. Returns up to 20 results with `{ id, external_order_number, customer_name, grand_total, order_date, payment_status, is_already_matched }`. The `is_already_matched` flag is computed from `EXISTS (SELECT 1 FROM cod_settlement_lines WHERE matched_order_id = web_orders.id)`. Permission: `manage_orders`.

4. **Change `/approve` permission from `manage_orders` to `all_access`.** One-line change.

No schema migrations. `config_json` is already JSONB; `matched_order_id` column already exists.

## Import wizard data flow

**Step 1 — Courier selection.** Dropdown from `GET /api/couriers`, active only. On select, read saved mapping from the courier's `config_json.cod_csv_mapping`.

**Step 2 — File upload.** Drag-drop or file picker, accepts `.csv` and `.xlsx`. Parsing is client-side using `papaparse` (CSV) and `xlsx` (Excel), both already in the codebase via the bulk-import page. Result: 2D array of rows. Nothing sent to the backend yet.

**Step 3 — Column mapping.** Skipped if the saved mapping's source columns all exist in the uploaded file.

Required target fields: `courier_tracking_number`, `remitted_amount`.
Optional target fields: `courier_order_ref`, `courier_fee`.

Each target renders a `<select>` populated with the CSV's header row. "Save mapping for this courier" checkbox (default on) persists the choice via the new PATCH endpoint on confirm.

**Step 4 — Preview & confirm.** Render first 10 mapped rows as a table. Show total line count and sum of remitted amounts. "Batch reference" free-text input.

On confirm: `POST /api/fulfillment/cod/settlements/import` → immediately call `POST /:id/match` → navigate to the batch detail view.

### Error cases

| Case | Handling |
|---|---|
| Empty CSV | Inline error, block step 2 |
| Unparseable file | Inline error, block step 2 |
| Required field unmapped | Disabled "Next" button on step 3 |
| Non-numeric amount column | Inline warning in step 4 preview, block confirm |
| Backend import fails | Toast error, stay on step 4, user can retry |
| Saved mapping drifts (columns missing) | Fall back to mapping step automatically |
| 5000+ rows | Soft warning, no hard cap |

## Batch detail view

### Header card

- Batch reference, courier name, imported date/by, status pill
- Six KPI tiles: Total Lines, Total Remitted, Matched Count, Matched Amount, Unmatched Count, Short Amount
- Variance banner if `matched_amount + short_amount ≠ total_amount`
- State-dependent action buttons (right-aligned)

### Tabs

| Tab | Shows | Default sort |
|---|---|---|
| All | every line | line id |
| Matched | `match_status = matched` | matched order number |
| Short | `match_status = short` | difference DESC |
| Over | `match_status = over` | difference DESC |
| Unmatched | `match_status = unmatched` | remitted_amount DESC |
| Duplicate | `match_status = duplicate` | tracking number |

Count badge per tab.

### Line table columns

Tracking #, Courier Ref, Matched Order, Expected, Remitted, Fee, Difference (red/green), Status pill, Resolution note (truncated + tooltip), Actions.

### Per-line actions

| Match status | Actions |
|---|---|
| Matched / Short / Over | "Add note" (inline textarea) |
| Unmatched | "Match manually" (opens ManualMatchModal) + "Add note" |
| Duplicate | "Add note" only |

### ManualMatchModal

Search input → `GET /api/web-orders/search?q=...` → result list (order number, customer, total, date, payment_status, already-matched warning) → click result → `POST /:id/resolve` with `{ line_id, matched_order_id, resolution_note: "Manually matched by <user>" }`.

### State-dependent header buttons

| Batch status | Buttons |
|---|---|
| `imported` | "Run match" (safety net; match runs automatically after import) |
| `matching` | Disabled spinner "Matching in progress…" |
| `review` | "Approve batch" (admin only, greyed out otherwise) + "Re-run match" |
| `approved` | All actions hidden — read-only |
| `rejected` | Not implemented in v1 (YAGNI) |

### ApproveConfirmModal

Approving a batch with shorts is a finance commitment. The modal:
- Shows variance summary ("PKR 1,500 shortfall across 3 lines")
- Requires typing the batch ref to enable the "Confirm approval" button
- Warns that the action cannot be undone
- On confirm: `POST /:id/approve`, refresh the batch

### Read-only after approve

No edits, no notes, nothing. If a mistake is found, bookkeeper imports a correcting batch. Auditability wins over flexibility.

## Error handling & edge cases

- **Import partial failure** — backend runs in a transaction, so atomic. Frontend just catches.
- **Match running twice** — second call is a no-op because status is already `matching`.
- **Approve race** — backend uses `SELECT ... FOR UPDATE` + status check. Second admin gets an error; UI refreshes to show the approved state.
- **Manual match to an already-matched order** — allowed but warned in the modal (the `is_already_matched` flag on search results).
- **Negative remitted amounts** — courier reversals. Schema allows NUMERIC(12,2) signed; UI shows a "reversal" pill.
- **Zero remitted with non-zero fee** — COD failed (customer refused). Classified as `short` — correct.
- **Matched order with cancelled payment_status** — line detail shows `payment_status` so bookkeeper can add a resolution note.
- **Same tracking in two batches** — partial remittance + top-up. Batches are independent; web_order is the source of truth for total received.

## Testing

- **Integration tests** — new `backend/tests/integration/cod-settlements.test.js` covering: import → match classification → resolve with note → resolve with manual match → approve → approve race → approve wrong state error.
- **Playwright smoke** — extend `phase5-pakistan.smoke.spec.js` with a full import → match → approve path.
- **No React unit tests** — project convention is unit tests only for pure logic (cartMath, POSContext hooks). Component rendering is covered by Playwright.

## Out of scope (explicitly deferred)

- Ledger integration (Q3 decision)
- Reject/reopen states (YAGNI)
- Bulk line actions (defeats line-by-line review)
- CSV export of a batch (one-liner follow-up)
- Email notifications on batch state changes (not asked for)
- Hardcoded per-courier parsers (Q1 decision)

## Open questions for implementation

None. All design decisions are locked. The implementation plan can proceed directly.
