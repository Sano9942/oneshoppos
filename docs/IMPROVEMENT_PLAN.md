# OneShopPOS - Improvement Plan

Created: 2026-02-26  
Last Updated: 2026-02-25  
Status: In Progress

---

## Overview

This plan tracks delivery in five tiers. Tiers 1 and 4 are complete, Tier 3 is mostly complete, and Tier 2/5 remain open.

---

## Tier 1 - Quick Wins (Completed)

| # | Item | Status | Notes |
|---|---|---|---|
| 1.1 | Dashboard redesign | Done | Recent sales feed, low stock badges, improved layout |
| 1.2 | POS UX improvements | Done | Hotkeys, discount fixes, warnings, quick amounts |
| 1.3 | Centralized API base URL | Done | `frontend/src/config.js` used across frontend |
| 1.4 | Reports visual upgrade | Done | KPI strip, trend visuals, broader CSV exports |
| 1.5 | Low stock alerts | Done | Sidebar indicators and visibility improvements |

---

## Tier 2 - Placeholder Pages (Pending)

| # | Route | Status | Notes |
|---|---|---|---|
| 2.1 | `/lookup` | Pending | Product lookup module |
| 2.2 | `/custom-fields` | Pending | Custom field definitions |
| 2.3 | `/partners` | Pending | Partner account management |
| 2.4 | `/shopcast` | Pending | Broadcast/publishing workflow |

---

## Tier 3 - Enhancements (Mostly Complete)

| # | Item | Status | Notes |
|---|---|---|---|
| 3.1 | Email or SMS receipts | Pending | Requires SMTP/SMS provider setup and endpoint/UI wiring |
| 3.2 | Thermal printer support | Done | Browser print flow supports thermal printers |
| 3.3 | Multi-outlet consolidated reports | Done | Outlet comparison and CSV exports |
| 3.4 | Replenishment suggestions | Done | Reorder quantities and draft PO creation |
| 3.5 | Customer segmentation (RFM) | Done | Segment analytics and export |
| 3.6 | Automated DB backups | Done | Scheduled backups with retention |
| 3.7 | Shopify sync queue cleanup | Done | Scheduled cleanup of stale sync events |

---

## Tier 4 - New Modules (Completed)

| # | Module | Status | Notes |
|---|---|---|---|
| 4.1 | Accounting core | Done | P and L, cashflow, AP, period management |
| 4.2 | CRM and quotations | Done | Lead pipeline, activities, quotation-to-sale conversion |
| 4.3 | Advanced HR | Done | Leave workflow and payroll period generation |
| 4.4 | Notification engine | Done | In-app notification center and triggers |
| 4.5 | Company profile | Done | Profile API, logo upload, branded header/invoice source data |

Validation:
- `npm run test:tier4-smoke`: 53 passed, 0 failed

---

## Tier 5 - Technical Debt and Infrastructure (Pending)

| # | Item | Status | Notes |
|---|---|---|---|
| 5.1 | Split `backend/index.js` | Pending | Move to route modules |
| 5.2 | API rate limiting | Pending | Add abuse protection middleware |
| 5.3 | PWA/offline mode | Pending | Service worker and offline strategy |
| 5.4 | Real-time updates | Pending | WebSocket or SSE |
| 5.5 | Remove legacy files | Pending | Clean stale artifacts and snapshots |

---

## Next Recommended Sequence

1. Complete `3.1` email receipt workflow
2. Start Tier 2 route implementations (`/lookup` first)
3. Begin Tier 5.1 backend route split to reduce regression risk
