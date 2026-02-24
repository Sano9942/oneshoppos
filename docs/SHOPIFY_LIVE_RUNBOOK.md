# Shopify Live Runbook (When API Keys Are Available)

## Purpose
This runbook is the exact sequence to move from integration-ready code to live Shopify validation and UAT signoff.

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

