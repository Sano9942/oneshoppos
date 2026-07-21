# Data Ownership, Finance, and Reporting

## Data ownership matrix

| Data | Canonical scope | Outlet behavior |
|---|---|---|
| Product identity | Organization | Availability and local presentation |
| Product commercial configuration | Legal company | Price/availability overrides |
| Inventory | Legal company + stock location | Outlet groups relevant locations |
| Customer commercial relationship | Legal company | Shared across authorized outlets |
| Loyalty program | Legal company | Participating outlets and modules |
| Wallet, store credit, gift card | Legal company + currency | Accepted by participating outlets |
| Supplier identity | Organization | No outlet-owned balance |
| Supplier account and payable | Legal company | Orders may specify receiving outlet |
| Employee identity | Organization | Outlet/module/register assignment |
| Employment | Legal company | Outlet role assignments |
| Accounting ledger | Legal company | Outlet is a reporting dimension |
| Official tax report | Legal company | Can filter by outlet |
| Management consolidation | Organization | Rolls up legal companies and outlets |

## Catalog layering

```text
Organization catalog identity
→ Legal-company commercial and regulatory configuration
→ Outlet availability, menu, shelf and price override
→ Stock-location quantity and custody
```

Catalog item types share identity and extension points: physical product, service, menu item, bundle/kit, recipe-produced item, rental asset class, and future bookable item. Specialized modules attach their data rather than create unrelated catalogs.

## Central pricing engine

The deterministic resolution order is documented and versioned. A starting precedence is:

```text
Legal-company base price
→ Price list
→ Customer or group agreement
→ Outlet/channel adjustment
→ Quantity rule
→ Promotion
→ Authorized manual override
```

Rules produce an explanation and immutable transaction snapshot. The engine uses decimal money types, explicit currency, defined rounding stage, and country-package tax rules. Floating-point numbers are prohibited for financial calculation.

## Inventory ledger

Inventory is an auditable movement ledger, with a verified balance projection for performance.

Required movement facts:

- Legal company and stock location
- Product, variant, unit, batch, and serial where relevant
- Signed quantity and normalized base-unit quantity
- Movement type and reason
- Source and destination for transfers
- Related business document
- Actor, device, outlet, and time
- Idempotency and offline origin
- Cost layer or valuation facts when applicable

Employees never edit a quantity without producing an adjustment movement. Transfers use dispatch, in-transit, receipt, and discrepancy records. Cross-company movement is a future intercompany purchase/sale, not an internal transfer.

## Customer and loyalty

Customer profiles are legal-company relationships shared across outlets. Organization-level identity linkage may identify possible duplicates across legal companies, but balances, consent, transaction history, and access remain legally scoped.

Loyalty is a non-cash ledger owned by a legal-company program. It supports participating outlets/modules, earning rules, redemption, tiers, expiry, reversal on return, and complete history.

## Stored value

Wallets, store credit, and gift cards represent financial liabilities. Each is scoped to a legal company and currency and uses an immutable ledger.

Distinguish:

- Customer-deposited wallet funds
- Refund or promotional store credit
- Gift-card liability

Cross-company acceptance is deferred until intercompany settlement, tax, and liability rules exist.

## Supplier model

An organization may share supplier identity, but every legal company owns its supplier account, contracts, tax details, negotiated prices, purchases, invoices, returns, payments, and payable balance.

## Accounting ledger

Each legal company owns a double-entry ledger with:

- Chart of accounts
- Fiscal periods and close controls
- Journal entries and lines
- Cash and bank accounts
- Accounts receivable and payable
- Tax control accounts
- Inventory valuation
- Stored-value liability
- Payment clearing and gateway settlement

Operational events post balanced accounting entries through Accounting contracts. Users perform business operations; they do not need to construct ordinary journals manually.

Dimensions include outlet, stock location, module, department, register, project, channel, and salesperson. Dimensions enable analysis without separate outlet ledgers.

## Financial invariants

- Debit total equals credit total for every posted journal.
- Posted entries are corrected by reversal and replacement.
- Every tender allocation equals the settled transaction amount within explicit rounding tolerance.
- Stored-value balance equals its ledger.
- Accounts receivable and payable reconcile to control accounts.
- Inventory valuation reconciles to stock events under the configured valuation method.
- Fiscal document sequences are gap-explained and legal-company scoped.

## Reporting architecture

### Operational queries

Current-state screens and small reports query domain-owned projections optimized for recent operations.

### Financial and statutory reports

Read from controlled ledger and fiscal projections with reproducible period and configuration versions.

### Analytical reporting

Durable domain events populate analytical read models. Large reports run asynchronously, produce an auditable result artifact, and never compete with checkout for uncontrolled resources.

### Consolidation

Organization dashboards combine legal-company results through account and currency mappings. They are management reports unless an approved consolidation process produces formal statements.

The current report system is broad but route-oriented; its present structure is summarized in [Functional Domains](../technical-architecture-report/04-functional-domains.md). vNext reporting consumes domain contracts instead of duplicating business rules in every report query.
