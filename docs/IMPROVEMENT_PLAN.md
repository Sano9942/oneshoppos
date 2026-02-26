# OneShopPOS - Improvement Plan

Created: 2026-02-26  
Last Updated: 2026-02-27  
Status: In Progress

---

## Overview

This plan tracks delivery in major tiers and focused initiatives.

- Tiers 1 through 5: delivered or in controlled progress
- Reports Power-Up (Phase 1 + Phase 2): implemented and verified
- Remaining strategic backlog: Tier 2 placeholders, Tier 3.1 receipts, deeper test automation

---

## Tier Status Summary

| Tier | Focus | Status |
|---|---|---|
| Tier 1 | Quick wins | Done |
| Tier 2 | Placeholder pages (`/lookup`, `/custom-fields`, `/partners`, `/shopcast`) | Pending |
| Tier 3 | Enhancements | Mostly done (`3.1` pending) |
| Tier 4 | New modules (Accounting/CRM/HR/Company/Notifications) | Done |
| Tier 5 | Stabilization/hardening/refactor track | In progress |

---

## Reports Power-Up Initiative (Delivered)

### Scope delivered

1. Profit and margin layer
2. Inventory health layer
3. Exceptions reporting
4. Shared report filter model and drilldown behavior
5. Export metadata improvements
6. Forecasting and smart replenishment
7. Scheduled report packs with run logs and generated files
8. Saved views
9. Governance/report definition versions

### Release method

- Feature-flagged rollout with additive APIs (no breaking changes to existing report routes)
- Backend telemetry for report requests
- Restart-safe worker wiring for schedule processing

### Data model delivered

- `report_schedules`
- `report_schedule_runs`
- `report_delivery_log`
- `saved_report_views`
- `report_definition_versions`

### Verification baseline

- `npm run preflight`: PASS
- `npm run test:e2e-full`: PASS
- `npm run test:reports-phase2`: PASS (26 passed, 0 failed)
- Frontend build: PASS

---

## Remaining Priority Work

### 1. Tier 3.1 Email/SMS receipts (pending)
- Provider integration and templates
- Delivery logging and retry policy
- Receipt channel options in POS flow

### 2. Tier 2 placeholder modules (pending)
- `/lookup`
- `/custom-fields`
- `/partners`
- `/shopcast`

### 3. Reliability and QA depth (ongoing)
- Browser automation suite (Playwright/Cypress)
- Additional backend unit coverage for report calculations and edge cases
- Performance profiling for heavy report ranges and large datasets

---

## Guardrails (unchanged)

1. Additive-first schema and API changes
2. Feature flags for high-risk changes
3. Transaction-safe money/stock operations
4. No destructive cutovers without rollback path
5. Keep docs and test baseline updated with every phase gate