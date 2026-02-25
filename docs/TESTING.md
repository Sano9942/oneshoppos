# OneShopPOS - Testing Record

Last Updated: 2026-02-25

---

## Latest Automated Baseline

### Core Regression

Command:
```bash
cd backend
npm run preflight
npm run test:e2e-full
```

Result:
- `npm run preflight`: PASS
- `npm run test:e2e-full`: 69 passed, 0 failed

### Tier 4 Focused Smoke

Command:
```bash
cd backend
npm run test:tier4-smoke
```

Result:
- 53 passed, 0 failed

Covers:
- Notifications endpoints
- Company profile endpoints
- Accounting endpoints
- HR leave and payroll endpoints
- CRM and quotations endpoints
- Frontend Tier 4 route declarations
- Frontend Tier 4 nav path declarations

---

## Shopify Test Commands

```bash
cd backend
npm run test:shopify-utils
npm run test:shopify-mock
```

---

## Manual Smoke Checklist

1. Login and confirm role-based menu visibility
2. Create and complete a POS sale, then verify sales history
3. Open and close a cash shift
4. Confirm low-stock visibility in inventory/dashboard
5. Open Tier 4 routes and confirm page render:
   - `/accounting`
   - `/crm`
   - `/quotations`
   - `/hr/leave`
   - `/hr/payroll`
   - `/company-settings`

---

## Known Gaps

- No browser automation suite (Playwright/Cypress)
- Limited unit test coverage outside Shopify helpers
- Tier 3.1 email/SMS receipt flow still pending implementation and tests
