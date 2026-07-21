# Functional Domain Architecture

## POS, sales, and returns

The sale transaction is the main business spine. The checkout route begins at [`backend/routes/sales.js`](../../../backend/routes/sales.js#L595), and the central database transaction begins at [`backend/routes/sales.js`](../../../backend/routes/sales.js#L1697).

Checkout supports:

- Cash, card, credit, wallet, gift card, and split tenders
- Room and treatment folio charges
- Tax-inclusive, tax-exclusive, and no-tax modes
- Per-line tax-rate and HS-code snapshots
- Cart and line discounts
- Promotions and slab schemes
- Customer and outlet price lists
- Loyalty earning and redemption
- Credit limits, exposure checks, and payment terms
- Manager-PIN credit override
- Product variants
- Outlet-level variant stock
- Serialized products and sale-item serial bridges
- Batch/lot inventory and FEFO consumption
- Kit/BOM component consumption
- Weighted quantities
- Backorder creation and conversion
- Appointment completion
- Restaurant seats, courses, modifiers, tips, and server attribution
- Offline idempotency keys
- FBR enqueueing
- Shopify inventory synchronization events
- Low-stock notifications

Stock validation is repeated under `FOR UPDATE` locks. Credit exposure is also rechecked inside the transaction to serialize concurrent credit sales.

Voiding a sale transactionally:

- Marks the sale voided once
- Restores stock or kit components
- Restores variant and batch state
- Releases serial numbers
- Reverses accounts-receivable effects
- Records audit information
- Enqueues FBR debit-note work when applicable

Returns support:

- Full and partial returns
- Exchanges
- Restock choice per line
- Return reasons
- Refund idempotency
- Gift-card and payment refund context
- Offline return queueing when enabled
- FBR credit-note integration

## Catalog and pricing

Catalog functionality includes:

- Hierarchical categories
- Leaf-only product assignment
- Category tax and HS-code inheritance
- Brands and suppliers
- Product variants and option values
- Multi-image product media
- Soft deletion
- Product status
- SKU, barcode, PLU, and embedded EAN-13 lookup
- Product reviews and moderation
- Sales-channel publication state
- Bundles, kits, recipes, and assembled products
- Serialized inventory
- Batch/lot/expiry tracking
- Minimum-order quantity and increments
- Wholesale product visibility
- Age-restricted product markers

Pricing includes:

- Standard product and variant prices
- Cost and compare-at prices
- Customer-group price books
- Outlet price-list assignments
- Quantity breaks
- Promotions
- Loyalty-tier discounts
- Scheduled catalog changes
- Category default margins for import and receiving

The main product route is [`backend/routes/products.js`](../../../backend/routes/products.js#L209).

## Inventory and procurement

Inventory functions include:

- Outlet stock
- Variant outlet stock
- Adjustments
- Transfers
- Stock counts
- Inventory reconciliation
- Reorder intelligence
- ABC classification
- Cycle-count scheduling
- Lead time and safety stock
- Batch movement ledger
- Serialized inventory status
- Kit production and disassembly
- Stock reservations and allocations

Procurement includes:

- Suppliers
- Purchase orders
- Approval workflow
- Purchase-order templates
- Goods received notes
- Supplier invoices
- Supplier payments
- Supplier returns
- Scan receiving and fuzzy product matching
- Batch and serial capture

## Customers, CRM, finance, and subscriptions

Customer records can represent retail buyers, wholesale buyers, members, guests, patients, owners, or service clients depending on the tenant preset.

Customer-related capabilities include:

- Groups and product visibility
- Multiple addresses
- Wallet/store credit
- Loyalty points and tiers
- Gift cards
- Reviews
- CRM leads and activities
- Quotations
- Statements
- Credit limits and payment terms
- AR aging
- Customer invoices
- Invoice payments
- Payment links
- Invoice reminders
- Subscription plans
- Customer subscriptions
- Dunning and renewal runs
- Packages and session passes
- Marketing campaigns
- Messaging inbox
- Customer notification rules and delivery history

Accounting and finance include:

- Cash shifts and denominations
- Expenses
- Chart of accounts
- Journal entries and lines
- Accounting periods
- Credit notes
- Debit notes
- Post-dated cheques
- Supplier payables
- Customer receivables
- Approval requests and actions

## Omnichannel storefront and fulfillment

The native storefront exposes:

- Store configuration
- Published categories and products
- Product variants, images, reviews, and pickup availability
- Anonymous carts
- Customer-linked carts
- Minimum-order enforcement
- Quote calculation
- Pickup and shipping methods
- Atomic checkout
- Online payment initiation
- Public order status
- Curbside-arrival notification

Storefront checkout in [`backend/routes/storefront.js`](../../../backend/routes/storefront.js#L636):

1. Resolves tenant.
2. Validates cart and customer details.
3. Recalculates the final quote.
4. Validates inventory.
5. Creates the web order and line snapshots.
6. Decrements/reserves stock.
7. Creates fulfillment allocation.
8. Records optional backorders.
9. Deletes the cart.
10. Returns a public order token and payment availability.

Fulfillment includes:

- Web orders
- Inventory reservations
- Outlet allocation
- Picklists
- Loadsheets
- Shipments
- Tracking events
- Proof of delivery
- COD settlement batches
- Pickup readiness
- Curbside arrival

## Restaurant

Restaurant mode includes:

- Floor plans and sections
- Tables and table sessions
- Checks
- Seats
- Split checks
- Course assignment and course-fire control
- Tabs
- Pre-authorization holds
- Modifiers
- KDS stations and routing
- KDS tickets, items, timing, and events
- 86'd item availability
- Void and comp reasons
- Tip capture and pooling
- Menu schedules and day parts
- Reservations
- Waitlist
- QR ordering
- Pay-at-table
- Kiosk slots
- Drive-through context
- Online ordering inbox
- Delivery aggregator ingestion
- Menu engineering and KDS analytics

Restaurant checkout still enters the common sale path, preserving shared payments, tax, inventory, customer, receipt, and reporting behavior.

## Appointments, classes, packages, and membership

The scheduling engine supports:

- Bookable services and variants
- Staff assignment
- Resource assignment
- Availability rules
- Appointment blocks
- Appointment segments
- Deposits
- Card-on-file/no-show flows
- Reminders
- Public booking
- Waitlists and offers
- Group classes
- Class bookings
- Packages and session passes
- Package redemption against appointments, classes, or sales
- Member codes
- Public member check-in kiosk
- Salon service-history and formula notes

## Projects, contracts, and photography

Service-project mode includes:

- Projects
- Contacts
- Milestones
- Activities
- Project billing
- Contract templates
- Contracts
- Signers
- Contract events
- Project files
- Photography client-visible galleries
- Customer proof selections

## Repair and workflow tickets

Repair/service operations include:

- Configurable ticket types
- Intake checklists
- Device records
- Encrypted device passcodes
- Ticket activities
- Parts, labor, and fee lines
- Serialized parts
- Stock decrement guards
- Quotations and estimates
- Deposits
- Warranty periods
- Customer notifications
- Completion and status workflows

## Rentals

Rental mode supports:

- Rental item templates
- Individual rental assets
- Contracts and contract lines
- Asset checkout and return
- Drivers
- Meter or odometer readings
- Inspections
- Damage records
- Maintenance schedules and history
- Deposits and pre-authorization
- Delivery scheduling
- Late fees
- Public booking

## Lodging

Room-management mode includes:

- Room types
- Rooms and hostel beds
- Rate overrides
- Room bookings
- Guest folios and charge lines
- Multiple guests
- Guest registration
- Group bookings
- Master-folio routing
- Direct online booking
- Booking-expiry holds
- iCal channel feeds
- External channel blocks
- Channel-sync dead letters
- Overdue checkout
- Night audit snapshots
- Occupancy and revenue analytics

## Clinical

Clinical mode supports:

- Patient subjects, including pets
- Treatment plans and templates
- Treatment sessions
- Vital signs
- Prescriptions
- Body and dental chart areas
- Session chart entries
- Clinical documents
- Lab orders
- Consent forms
- Treatment folios
- Vaccination records
- Patient recalls
- Allergy and alert data
- Physiotherapy handouts

## Wholesale and field sales

Wholesale features include:

- Credit limits and hard/warn block modes
- Payment terms
- AR aging
- Slab and volume schemes
- Customer-specific price books
- Minimum order quantities
- Product visibility by customer group
- Backorders and fulfillment
- Manufacturer partners and brand mapping
- Manufacturer portal
- Field-rep routes
- GPS and selfie check-ins
- Visit outcomes
- Offline field orders
- Van stock locations
- Van reconciliation
- Proof of delivery

## Reporting and analytics

Reporting is split into domain modules for:

- Sales
- Inventory
- Purchasing
- Finance
- Staff and shifts
- Customers and clinical data
- Multichannel operations
- Governance and audit
- FBR export
- KDS analytics
- Menu engineering
- Recipe costing
- Stock aging

The system also provides:

- Saved views
- Scheduled reports
- Delivery logs
- Custom report definitions
- Report widgets
- Report telemetry
- AI-assisted analytical questions

