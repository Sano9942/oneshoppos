# Tier 4 Routes — Claude Guide

- **7 files** — premium features, all use factory pattern: `module.exports = function(deps)`
- **`index.js`** — aggregator, composes all sub-routers into one Express router
- **`accounting.js`** — P&L, COA, cheques, journal entries. Guards: `requireFeature("accounting_core")` + `requireAnyPerm(["view_reports", "manage_employees"])`. Uses `toUtcStart/toUtcEnd` for date boundaries
- **`approvals.js`** — PO/transfer approval workflow. Guard: `requireFeature("approvals")`. PO submission is transactional (status + `approval_requests` atomically). Only `"Draft"` POs can be submitted
- **`crm.js`** — Leads + activities + quotations. Guards: `requirePerm("manage_orders")` + `requireFeature("crm_quotations")`
- **`hr.js`** — Leave requests + payroll. Guards: `requirePerm("all_access")` + `requireFeature("advanced_hr")`. Creates notification on leave submission
- **`notifications.js`** — CRUD + read/read-all. Guard: `requireFeature("notifications")`. Supports `?unread_only=1`
- **`company-profile.js`** — GET/PUT company settings. `GET /api/company-profile` and `PUT /api/company-profile` require `requireFeature('multi_company')`; PUT also requires `requirePerm('all_access')`. Additional: `PUT /api/company-profile/onboarding-dismiss` (`all_access`, no feature flag), `PUT /api/company-profile/logo` (`all_access` + `multi_company`). `GET /api/company-profile/currency` is **unauthenticated** (accepts `?tenant=slug` in MT mode). Currency endpoint returns `cash_denominations` JSON with fallback `[100,50,20,10,5,1]`
