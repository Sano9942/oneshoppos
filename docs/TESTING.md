# OneShopPOS - Testing Record

Last Updated: 2026-02-27

---

## Automated Baseline

### Core Regression

Command:

```bash
cd backend
npm run preflight
npm run test:e2e-full
```

Result:

- `npm run preflight`: PASS
- `npm run test:e2e-full`: PASS

### Reports Phase 2 Verification

Command:

```bash
cd backend
npm run test:reports-phase2
```

Coverage:

- enables required report feature flags
- validates forecasting and smart replenishment endpoints
- creates/runs schedule and validates run history + delivery log
- validates saved views CRUD path
- validates governance definition create/list path
- performs cleanup of created schedule/view test records

### Additional Suites

Command:

```bash
cd backend
npm run test:tier4-smoke
npm run test:shopify-utils
npm run test:shopify-mock
```

Latest result:

- `npm run test:tier4-smoke`: PASS
- `npm run test:shopify-utils`: PASS
- `npm run test:shopify-mock`: PASS

---

## Manual Smoke Checklist

1. Login and verify role-based menu visibility.
2. Create and complete a POS sale, then verify sales history.
3. Open and close a cash shift.
4. Confirm low-stock visibility in inventory/dashboard.
5. Validate report tabs with PKR formatting and filters.
6. Validate schedule run-now from reports panel and confirm file output exists in `backend/exports/reports`.

---

## Known Gaps

- No browser automation suite (Playwright/Cypress).
- Limited unit test coverage outside key backend helpers.
- Shopify inbound webhook live validation remains environment-dependent.