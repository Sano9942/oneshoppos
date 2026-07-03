# Backend services exhaustive wave shard

Scope: authoritative `deferred` production JavaScript rows under `backend/services/**` from `.audit/backend/file-coverage-ledger.csv`. Read-only application audit; tests and archives excluded.

## Checkpointed full-file receipts

The following paths were read in full. Evidence scope for each review included exported entrypoints, inputs and trust boundaries, SQL parameterization and transaction/idempotency behavior, tenant scoping, secrets, outbound network destinations/credentials, async error handling, and Postgres assumptions.

- `backend/services/alerting.js`
- `backend/services/allocation.js`
- `backend/services/approval-policy.js`
- `backend/services/booking-availability.js`
- `backend/services/booking-reminders.js`
- `backend/services/boss.js`
- `backend/services/catalog-scheduler.js`
- `backend/services/contracts.js`
- `backend/services/couriers/base-adapter.js`
- `backend/services/couriers/blueex-adapter.js`
- `backend/services/couriers/bykea-adapter.js`
- `backend/services/couriers/callcourier-adapter.js`
- `backend/services/couriers/dhl-adapter.js`
- `backend/services/couriers/fedex-adapter.js`
- `backend/services/couriers/generic-adapter.js`
- `backend/services/couriers/index.js`
- `backend/services/couriers/leopards-adapter.js`
- `backend/services/couriers/mnp-adapter.js`
- `backend/services/couriers/pakpost-adapter.js`
- `backend/services/couriers/postex-adapter.js`
- `backend/services/couriers/rider-adapter.js`
- `backend/services/couriers/swyft-adapter.js`
- `backend/services/couriers/tcs-adapter.js`
- `backend/services/couriers/trax-adapter.js`
- `backend/services/crypto.js`
- `backend/services/geo.js`
- `backend/services/inventory-intelligence.js`
- `backend/services/logger.js`
- `backend/services/manager-pin.js`
- `backend/services/marketing.js`
- `backend/services/marketplace/base-marketplace.js`
- `backend/services/menu-schedule-resolver.js`
- `backend/services/online-inbox.js`
- `backend/services/payment-gateway.js`
- `backend/services/phase4-polling.js`
- `backend/services/pricing.js`
- `backend/services/product-visibility.js`
- `backend/services/project-billing.js`
- `backend/services/projects.js`
- `backend/services/public-tenant-context.js`
- `backend/services/reservation.js`
- `backend/services/restaurant-floor.js`
- `backend/services/sms.js`
- `backend/services/subscriptions.js`

## Candidates under evidence closure

- Tenant-admin-configured SMS `api_url` reaches unrestricted server-side `fetch` with attacker-chosen JSON and configured credentials (`services/sms.js`); route/schema reachability confirmed through generic integration connect plus send-test SMS.
- Courier `api_base_url` is tenant-admin writable and reaches several unrestricted adapter `fetch` calls, including requests carrying courier credentials and customer/order PII.
- Menu schedule module cache uses only outlet ID as its process-global key, allowing colliding outlet IDs in different tenant schemas to reuse one tenant's cached schedule decisions.
- Public appointment overlap is a check-then-insert sequence without a transaction, lock, or exclusion constraint, permitting concurrent double booking.
- Subscription renewal lacks row locking/idempotency around invoice/run/period advancement; a retry after commit can immediately create and bill the next period.

Final dispositions, exact line evidence, counterevidence, and remaining receipts will replace this checkpoint when the shard is complete.
