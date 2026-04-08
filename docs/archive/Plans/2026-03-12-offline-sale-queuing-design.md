# Offline Sale Queuing — Design

**Date:** 2026-03-12
**Status:** Approved

## Overview

When the POS loses connectivity mid-shift, sales are queued in `localStorage` and automatically synced when the connection returns. No service worker. Leverages the existing `idempotency_key` on every sale payload for safe replay.

## Architecture

### Storage

- Key: `pos_offline_queue_${employeeId}` in `localStorage`
- Value: JSON array of sale payloads (identical to `POST /api/sales` body)
- Cap: 50 sales max, warning banner at 40
- Each payload ~1-2KB; `localStorage` 5MB limit accommodates ~2000+

### Flow

1. `completeSale()` catches network error or detects `!navigator.onLine`
2. Instead of showing error, pushes payload to queue in `localStorage`
3. Shows provisional receipt with `"Invoice: PENDING"` and note "Sale queued offline — final receipt available after sync"
4. Clears cart normally — cashier continues working
5. `window.addEventListener('online', syncQueue)` fires on reconnect
6. `syncQueue()` iterates queue, POSTs each sale sequentially
7. Successful sales (including `{ duplicate: true }` idempotency hits) are removed from queue
8. Banner disappears when queue is empty; shows green "X sales synced" briefly

### Connectivity Detection

- `navigator.onLine` checked before `fetch()` in `completeSale()`
- `window.addEventListener('online', syncQueue)` for automatic retry
- Network errors (TypeError from failed fetch) also trigger queue path
- "Sync now" manual button on banner

### Multi-Tab Sync

- `window.addEventListener('storage', ...)` keeps banner in sync across tabs
- `idempotency_key` prevents duplicate POSTs if both tabs try to sync

## Limitations & Mitigations

| Concern | Solution |
|---------|----------|
| Receipt | Provisional receipt with `"Invoice: PENDING"` + offline note |
| Loyalty earn | Show estimated points on receipt (client-computed) |
| Loyalty redeem | **Blocked** offline — "Points redemption requires connectivity" |
| Wallet deduction | **Blocked** offline — "Wallet payment requires connectivity" |
| Stock visibility | Accept display lag; backend handles negative stock gracefully |
| Queue cap | 50 sales max, warning at 40 |
| Employee scoping | Queue keyed by `pos_offline_queue_${employeeId}` |
| Shift closed before sync | Backend accepts queued sale if referenced shift existed |
| Multi-tab | `storage` event listener + idempotency_key deduplication |
| Promotions/discounts | Already computed client-side — no issue |

## Files Touched

- `frontend/src/pages/redesign/pos/POSContext.jsx` — `completeSale()` offline branch, `syncQueue()`, online listener, queue state, block wallet/points-redeem when offline
- `frontend/src/pages/redesign/pos/POSRedesign.jsx` — offline banner + "Sync now" button + queue count
- `frontend/src/pages/redesign/pos/POSCheckoutModal.jsx` — disable wallet/points-redeem toggle when `!navigator.onLine`
- `backend/routes/sales.js` — relax shift validation for sales with `idempotency_key` where shift is already closed

## Not in Scope

- Service Worker / IndexedDB (not needed for brief outages)
- Offline product search (requires caching entire catalog)
- Real-time alerts when queue exceeds threshold
