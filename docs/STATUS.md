# OneShopPOS - Project Status

Last Updated: 2026-02-26  
Current Phase: Tier 4 completed, Shopify go-live validation in progress  
System State: Operational

---

## Current Snapshot

- Backend API: `http://localhost:5000`
- Frontend app: `http://localhost:5173`
- Latest migration in runner: `migrate46.js`
- Feature flags include Tier 4 keys:
  - `notifications`
  - `accounting_core`
  - `crm_quotations`
  - `advanced_hr`
  - `multi_company`

Shopify current snapshot:
- Connection: active (`one-toy-store-dev.myshopify.com`)
- Location mappings: configured
- Product mappings: configured (at least one active mapping)
- Reconciliation: working (live rows generated and resolvable)
- Outbound sync events: working (recent event processed successfully)
- Inbound webhook sync: pending full validation (webhook secret/base URL setup still required)

---

## Delivered Through Tier 4

- Tier 1: Completed
- Tier 2: Not started (placeholder routes still present)
- Tier 3: Mostly completed (`3.1` email receipts still pending)
- Tier 4: Completed and smoke-tested end-to-end

---

## Tier 4 Deliverables (Completed)

- Notifications module
  - API: `/api/notifications*`
  - UI: bell dropdown in app header
- Company profile module
  - API: `/api/company-profile*`
  - UI: `/company-settings`
- Accounting module
  - API: `/api/accounting*`
  - UI: `/accounting`
- Advanced HR module
  - API: `/api/hr/leave*`, `/api/hr/payroll*`
  - UI: `/hr/leave`, `/hr/payroll`
- CRM and Quotations module
  - API: `/api/crm*`, `/api/quotations*`
  - UI: `/crm`, `/quotations`

---

## Latest Verification

- `npm run preflight`: PASS
- `npm run test:e2e-full`: 69 passed, 0 failed
- `npm run test:tier4-smoke`: 53 passed, 0 failed
- `npm run test:shopify-utils`: PASS
- `npm run test:shopify-mock`: PASS

---

## Shopify Remaining (Go-Live)

1. Configure webhook secret in POS Shopify config.
2. Configure same webhook secret in Shopify admin webhook subscriptions.
3. Use public HTTPS callback URL (`APP_PUBLIC_BASE_URL`) reachable by Shopify.
4. Run live inbound webhook test and confirm `inbound_processed > 0`.
5. Capture UAT evidence in `docs/TESTING.md` and `docs/SHOPIFY_LIVE_RUNBOOK.md`.

---

## Resume Checklist

1. Start services (`START.bat` or backend/frontend separately)
2. Run `node backend/run_migrations.js`
3. Run `npm run preflight` in `backend/`
4. Run `npm run test:e2e-full` in `backend/`
5. Run `npm run test:tier4-smoke` in `backend/`
