# ADR-006: Data and Financial Ownership

- Status: Proposed
- Date: 2026-07-17

## Context

Mixed modules and future multi-company operation require stable ownership for products, customers, stock, stored value, suppliers, employees, and finance.

## Decision

- Product identity is organization scoped; commercial/regulatory configuration is legal-company scoped; availability and stock are outlet/location scoped.
- Customers and loyalty are legal-company relationships shared across participating outlets.
- Supplier identity may be shared; contracts and payables are legal-company scoped.
- User identity is organization scoped; employment is legal-company scoped; access uses explicit assignments.
- Inventory is an immutable stock-location movement ledger.
- Wallet, store credit, and gift cards are legal-company and currency scoped.
- Each legal company owns a double-entry ledger; outlets/modules are dimensions.
- Pricing uses one deterministic engine and immutable snapshots.

## Consequences

- Cross-company stored value and stock are deferred pending settlement workflows.
- Operational domains post through owned Accounting and Inventory contracts.
- Historical transactions remain unchanged after catalog, price, or tax changes.
- Reconciliation becomes a release invariant.

## Specification

[Data, Finance, and Reporting](../06-data-finance-and-reporting.md)
