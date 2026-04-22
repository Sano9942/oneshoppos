# Phase 2-G.15 — Error-State Inventory

**Audit date:** 2026-04-22
**Scope:** 20 high-traffic retail pages × 5 error/empty states. Informs the Day 2–4 builds of 2-G.15 (6 specific recovery flows).

## Legend

- **done** — state is handled and has a recovery path (e.g. a Retry button, a non-empty EmptyState with a CTA, a redirect).
- **toast-only** — the state fires a toast but the page is left in a broken or blank state — no structured recovery.
- **skeleton-missing** — loading fires but no visible placeholder; users see a jumpy layout or a flash of empty content.
- **no-recovery** — the state is detected but users have no obvious way forward (e.g. "Something went wrong" with no retry).
- **—** — state does not apply to this page (e.g. permission-denied where all authenticated users can view).

## Methodology

Each cell was graded by reading the source file for the page. Counts of `EmptyState`, `Skeleton`/`animate-pulse`, `toast.error`/`setError`, and `loading`/`isLoading` are a proxy; recovery-quality was judged by whether a retry/navigate/fallback action exists in the error branch.

## Inventory

| # | Page | Empty | Loading | Error | Network-down | Permission-denied |
|---|------|-------|---------|-------|--------------|-------------------|
| 1 | `POSRedesign` | done (session-gate overlay) | skeleton-missing (no spinner during bootstrap) | **toast-only** (print/scan/stock 404 silently `return`) | **no-recovery** (offline queue exists but receipt print has no retry UX) | done (shift/attendance gate) |
| 2 | `DashboardRedesign` | done (zero-state KPIs) | done (skeleton placeholders) | toast-only (generic) | toast-only | — |
| 3 | `SalesHistoryRedesign` | done (EmptyState) | done | toast-only | toast-only | — |
| 4 | `CashManagementRedesign` | done | done | toast-only | toast-only | — |
| 5 | `CustomersRedesign` | done (5 EmptyState branches incl. wallet/ledger) | done | toast-only | toast-only | done (manage_customers gate) |
| 6 | `OrdersRedesign` | done | done | toast-only | toast-only | done (manage_orders gate) |
| 7 | `InventoryRedesign` | done | done (14 loading branches) | **no-recovery** (no error toast at all — silent fail) | **no-recovery** | done (manage_inventory gate) |
| 8 | `PurchaseOrdersRedesign` | done (4 EmptyState branches) | done | done (30 error handlers) | toast-only | done |
| 9 | `SuppliersRedesign` | done | done | toast-only | toast-only | done |
| 10 | `ReturnsRedesign` | done (5 branches) | done | toast-only | toast-only | done |
| 11 | `PromotionsRedesign` | done | done | toast-only | toast-only | done |
| 12 | `ExpensesRedesign` | done | done | toast-only | toast-only | done |
| 13 | `TransfersRedesign` | done | done | toast-only | toast-only | done |
| 14 | `StockAdjustmentsRedesign` | done | done | toast-only | toast-only | done |
| 15 | `EmployeesRedesign` | done | done | toast-only | toast-only | done (all_access) |
| 16 | `AttendanceRedesign` | **no-recovery** (no EmptyState) | **no-recovery** (no loading UI) | **no-recovery** (no error path) | **no-recovery** | — |
| 17 | `BackupRestoreRedesign` | done | done | **no-recovery** (no toast/error path) | **no-recovery** | done |
| 18 | `ReportsRedesign` | — (delegates to tabs) | — | — | — | — |
| 19 | `BrandsRedesign` | done | done | toast-only | toast-only | done |
| 20 | `CategoriesRedesign` | done | done | toast-only | toast-only | done |

## Summary

- **Empty states**: universally handled (18/20). Only `AttendanceRedesign` and the `POSRedesign` sub-areas lack structured empty UI in some branches.
- **Loading states**: mostly handled (18/20). Skeleton placeholders are used sparsely — most pages spin a button or show a tiny text "Loading…". `POSRedesign`'s bootstrap has no visible loader; the page shows empty shell until data arrives.
- **Error states**: weakest across the board. 15/20 fall into "toast-only" — the fetch fails, toast fires, but the table is left empty with no retry button and no hint the data failed (vs. "genuinely empty").
- **Network-down states**: the app has no dedicated network-down UI. Pages that fetch fall through to their error branch; POS alone has a true offline path (`offlineQueue`) but it covers completed sales only, not in-progress carts or receipt print.
- **Permission-denied**: handled universally via route-level `perm(...)` wrappers — pages assume the user has access once they render.

## Gaps targeted by 2-G.15 Day 2–4

The 6 specific recovery flows in the plan address the highest-impact `toast-only` / `no-recovery` cells above:

1. **Receipt print failure** → `POSReceiptRetryModal.jsx` (Day 2). Today `POSContext.printSlip` falls back silently to a browser popup when hardware fails. The retry modal adds: Print Again / Email / WhatsApp / Skip with `action_history` logging.
2. **Stale shift on POS open** → `POSShiftRecoveryModal.jsx` (Day 2). Today the POS bootstraps with yesterday's shift still open and gives no hint. The modal compares `opened_at` vs now, prompts to close before noon if > 20h old.
3. **Simultaneous refund collision** → `POSCartCollisionModal.jsx` (Day 3). Today two concurrent refund POSTs on the same sale both succeed. A partial-unique index on `(original_sale_id, idempotency_key)` + a 409 response with the existing return's ref closes the race.
4. **Cart-resume after accidental close** → `POSCartResumeModal.jsx` (Day 3). Today `offlineQueue` only stores *completed* sales. A sessionStorage checkpoint (debounced 1s, employee-keyed, 8h TTL) lets the cashier pick up where they left off.
5. **Barcode miss on scan** → `POSBarcodeMissModal.jsx` (Day 4). Today `POSContext.handleBarcodeScanned` silently `return`s on 404. Flag the miss, offer to add a new product inline (when `manage_inventory` perm).
6. **Insufficient stock at checkout** → `POSInsufficientStockModal.jsx` (Day 4). Today the sale POST returns a generic `err.message`. Backend extends `insufficient_stock` response with `available` + `product_id`; modal offers clamp / oversell (with `override_stock` perm) / cancel.

## Out of scope for 2-G.15

- **Full offline-queue refactor** (carts, payments) — deferred per roadmap.
- **Error boundaries on every page** — `ui/ErrorBoundary.jsx` already covers the shell; page-level boundaries are a separate track.
- **Network-down banner** — deferred; the 6 target flows cover the high-value bits.
- **Pages not in the top-20** — 75+ other `*Redesign.jsx` files were not graded. Treat them as "toast-only" by default until audited.

## Grading confidence

Grades were derived from static reads of the source. No dev-server walkthrough was performed. A future QA pass may reclassify some "toast-only" rows to "done" where the toast happens to be actionable enough in practice (e.g. "Network error — please refresh"). The goal here was to identify *where* the Day 2–4 builds should land, not to produce a perfect report.
