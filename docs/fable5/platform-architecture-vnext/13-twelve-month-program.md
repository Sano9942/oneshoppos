# Twelve-Month Milestone Program

This schedule is an outcome-based planning assumption, not a promise. Quality gates control progression. With a nontechnical founder relying primarily on AI, independent architecture and security review is required at critical milestones.

## Program governance

- One prioritized platform backlog
- No new major verticals
- Monthly architecture and risk review
- Demonstrable working workflow at every milestone
- Decision, evidence, owner, and acceptance criteria for each deliverable
- Visible technical-debt and legacy-removal register
- Staging remains production-like

## Months 1–2: Architecture and safety foundation

### Deliverables

- Accepted ADR package and domain ownership map
- Current route/table/test/capability inventories
- Critical security remediation
- Tenant-client lifecycle safety
- Required production encryption and portal secrets
- Webhook verification policy
- Complete process shutdown
- CI baseline and Staging
- Protected current-behavior journeys
- Target schema and contract conventions
- Design-system foundation

### Exit evidence

- No known critical tenant-isolation or secret-storage issue
- CI required for merge/deployment
- Test and staging database upgrade rehearsal
- Architecture checks prevent new boundary violations

## Months 3–5: Shared platform and business foundation

### Month 3

- Organization/legal-company/outlet/register model
- Tenant router and typed context
- Identity, employment, assignments, device identity
- Subscription lifecycle and module runtime
- Standard API errors, outbox, audit

### Month 4

- Catalog and units
- Pricing and tax engine
- Customer and consent
- Loyalty and stored-value ledgers
- Pakistan package foundations

### Month 5

- Stock-location inventory ledger
- Procurement and supplier accounts
- Payment orchestration
- Core accounting posting and reconciliation
- Operational reporting contracts

### Exit evidence

- Domain invariants pass real-PostgreSQL tests
- One complete synthetic business can be provisioned through new foundations
- Money, tax, stock, and journals reconcile
- Legacy mappings are measurable and removable

## Months 6–8: Launch modules and experiences

### Month 6: Retail

- Retail POS workspace
- Shift, sale, payment, receipt
- Returns, exchange, void
- Customer, loyalty, stored value
- Stock and accounting integration

### Month 7: Wholesale

- Account pricing and terms
- Quote and order
- Credit approval
- Allocation, partial fulfillment, backorder
- Invoice, payment, statement, return

### Month 8: Food Service

- Table, Counter, and Hybrid profiles
- Menu and modifier structure
- Check/table/seat/course behavior
- Kitchen routing and status
- Split, tip, service charge, void, comp, settlement

### Exit evidence

- Online versions of launch workflows pass quality gates
- Focused workspaces tested with representative users
- Route-local business truth removed for migrated workflows
- Performance within the initial operating target

## Months 9–10: Edge and hardware

### Month 9

- Edge prototype decision
- Encrypted local schema
- Device enrollment
- Versioned sync outbox/inbox
- Retail offline lifecycle
- Conflict diagnostics and recovery

### Month 10

- Food Service multi-device coordination
- Kitchen operation during cloud outage
- Hardware Gateway and durable jobs
- Initial printer/scanner/drawer/display matrix
- Windows installation, update, and diagnostics

### Exit evidence

- Multi-register retail and restaurant simulations run through prolonged outage
- No duplicate sale/payment after retry and reinstall exercises
- Hardware failures do not corrupt committed operations
- Cloud/edge compatibility and upgrade tests pass

## Months 11–12: Production readiness and founding pilots

### Month 11

- Load, soak, and failure testing
- Penetration and security review
- Backup restore and migration rehearsals
- Incident playbooks and on-call process
- FBR and Pakistan tax professional validation
- Support tools, runbooks, billing, and customer export

### Month 12

- Selected founding-customer deployments
- On-site or closely assisted observation
- Product usability correction
- Operational cost measurement
- Pricing validation
- Launch readiness review

### Exit evidence

- Fifteen launch gates accepted
- No unresolved critical security, financial, sync, or migration risk
- Real pilot days complete successfully
- Support can diagnose capability, sync, device, payment, and migration state
- Formal go/no-go record for paid launch

## Staffing recommendation

At minimum, obtain periodic experienced review from:

- Senior platform/backend architect
- PostgreSQL/data engineer
- Security engineer or penetration tester
- Product/UX practitioner for POS observation
- Pakistan tax/accounting professional

AI may perform much implementation and test generation, but it cannot serve as the only independent assurance source.

## Scope-change rule

A change enters the active program only when it improves a launch gate, removes a material risk, satisfies a founding customer without breaking architecture, or is legally required. Every addition states the work displaced by it.
