# Shopify Live Runbook (When API Keys Are Available)

## Purpose

This runbook is the exact sequence to move from integration-ready code to live Shopify validation and UAT signoff.

## Current Progress Snapshot (2026-02-26)

Completed already:

- Connection saved and active in POS.
- Live locations fetched from Shopify.
- POS outlet-to-location mapping configured.
- Product mapping applied.
- Live reconciliation run and corrective workflow validated.
- Outbound inventory sync event processed successfully.

Still pending for final go-live:

- Configure webhook secret in POS + Shopify with matching value.
- Use public HTTPS callback URL reachable by Shopify.
- Execute and verify inbound webhook delivery (`inbound_processed > 0`).
- Capture final UAT evidence/signoff.

## 1) Environment Preparation

1. Copy `backend/.env.shopify.example` to `backend/.env`.
2. Set:
   - `SHOPIFY_SECRET_KEY`
   - `APP_PUBLIC_BASE_URL` (public HTTPS URL reachable by Shopify)
3. Start backend and frontend.

## 2) Pre-Live Local Verification

Run:

```powershell
cd backend
npm run test:shopify-utils
npm run test:shopify-mock
node --check index.js
```

## 3) Connect Shopify From UI

1. Open `Shopify Integration` page.
2. Save connection settings:
   - `shop_domain`
   - `api_version`
   - Admin access token
   - webhook secret
3. Click `Verify Connection`.
4. Click `Run Live Validation`.

Expected:

- Connection verification succeeds.
- Live validation returns pass/rows with mapped inventory sample checks.

## 4) Configure Webhooks In Shopify Admin

1. In integration page click `Webhook Setup`.
2. Copy callback URL and required topics.
3. In Shopify admin create webhook subscriptions using:
   - JSON format
   - same webhook secret configured in POS
4. Trigger a webhook test from Shopify admin.

Expected:

- Webhook accepted by POS.
- `external_sync_events` gets inbound processed rows.

## 5) Mapping + Queue Validation

1. Fetch live locations and confirm mapping.
2. Generate/apply live product suggestions.
3. Execute a stock-changing POS action (sale/void/adjustment).
4. Confirm outbound event lifecycle:
   - `pending/retry` -> `processed` (or `dead_letter` with reason)

## 6) Reconciliation & Governance Validation

1. Run live reconciliation.
2. Submit corrective request (`Request Push` / `Request Pull`).
3. Confirm approval appears in Approvals page.
4. Confirm requester cannot self-approve (403).
5. Approve as second authorized user.
6. Validate row status update and audit endpoint:
   - `GET /api/reconciliation/inventory/:id/audit`

## 7) UAT Completion

1. Load `UAT Checklist` on Shopify Integration page.
2. Collect screenshots/video evidence for each checklist item in `docs/TESTING.md`.
3. Record:
   - shop domain
   - API version
   - date/time
   - approver name

## 8) Go-Live Gate

Proceed only when:

1. Live validation passes.
2. Webhooks are confirmed delivering valid signed payloads.
3. Queue backlog/dead-letter are acceptable.
4. UAT evidence checklist is complete and signed.

---

## Execution Checklist (Fill During Go-Live)

- [x] Shopify connection active in POS
- [x] Live locations fetched
- [x] Location mapping configured
- [x] Product mapping configured
- [x] Outbound event processed successfully
- [ ] Webhook secret configured in POS
- [ ] Matching webhook secret configured in Shopify
- [ ] Public HTTPS callback URL configured (`APP_PUBLIC_BASE_URL`)
- [ ] Webhook subscriptions created for required topics
- [ ] Inbound webhook test processed successfully
- [ ] UAT evidence captured and signed

Monitoring complete. Import appears finished.

Final stable state (as of 2026-02-26 19 (line 45, column 8)):

products: 7794
shopify_product_map rows: 8346
shopify_connections.last_sync_at: 2026-02-26 19 (line 44, column 47)
Counts stayed unchanged for ~25 seconds across 5 samples.
So the Shopify import ran successfully and has now stabilized.
