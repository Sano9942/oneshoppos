# Handoff prompt — paste into a fresh Claude session

Copy everything below the line into the very first message of the new tab.

---

We're continuing the SanoPOS wholesale roadmap. **TIER 1 IS COMPLETE** as of 2026-05-15. Yesterday (2026-05-16) shipped two polish items: the `toISOString().slice(0, 10)` UTC-trap audit (commit `3cf96d2`) and the manufacturer-portal password-reset flow (commit `899d6dc`). Both pushed to main, auto-deployed.

Now starting **Tier 2 Option B** — a lightweight, low-risk subset of the Shopify B2B / Cin7 parity work. ~2 weeks of independent, reversible features. No order-pipeline or customer-schema rewrites.

## Read these first

1. `docs/wholesale-docs/sanopos-wholesale-master-reference.md` — full state and roadmap
2. `docs/wholesale-docs/next-session-2026-05-17.md` — previous handoff with Tier 1 state

## Critical: don't trust CLAUDE.md or memory files blindly

CLAUDE.md files and the auto-memory at `C:\Users\HP\.claude\projects\d--newprojects-oneshoppos\memory\` drift over time. Use them for orientation, but verify against source for any concrete claim — schema columns, route signatures, middleware behavior. Grep first, read the actual file, then act.

## State entering this session

- Migration version: **94**
- Branch: `main` (clean)
- All commits pushed and auto-deployed (Railway backend + Vercel frontend)
- Active wholesale test tenant on prod: `wholesalewalktest1778451`

## Tier 2 Option B scope (3 items)

Picked these because they're independent of each other, don't touch the order pipeline or customer schema, and ship real B2B portal value in ~2 weeks. Deferred Tier 2 items (2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9) require a real customer driving the design.

### Item 1: 2.10 — Reorder previous order at portal (~4 days)

**Decision: Customer portal, reorder from completed sale (option a, not saved templates).**

- Location: `/portal/:tenantSlug` (existing customer portal — not manufacturer portal)
- Source data: completed `sales` rows for the logged-in customer
- Behavior: "Reorder" button on the order history view → cart loads with same items at current price (not historical price)
- Out of scope: saved named order templates (defer until a customer asks)

### Item 2: 2.2 — MOQ / case-pack enforcement (~3 days)

**Decision: Both flavors; enforce on portal + field-rep app; NOT on POS.**

- Schema: `products.min_order_qty INT` (minimum) + `products.order_increment INT` (must be multiple of)
- Enforcement surfaces:
  - Customer portal (storefront cart + portal order flow)
  - Field-rep order app (`/field/order/:customer_id`)
  - NOT POS — physical cashiers don't need this; in-person buyers can override naturally
- Both frontend block (before submit) and backend reject (defense in depth)

### Item 3: 2.11 — Customer-specific catalog visibility (~1 week)

**Decision: Option C (customer-group based) with C2 default — restricted SKUs hidden from ungrouped buyers.**

- Schema:
  - Add `products.visibility` enum `'all' | 'restricted'`, default `'all'` (preserves today's behavior)
  - New join table `customer_group_products (customer_group_id, product_id)` — which groups can see a restricted product
  - Note: the existing `customer_groups` table is half-used today (only powers `discount_percent`). This gives it a second job.
- Default behavior for ungrouped buyers (C2): see only `visibility = 'all'` SKUs. Safer than "see everything" — a forgotten new buyer sees a partial catalog (fixable) rather than private-label SKUs they shouldn't (embarrassing/contractual).
- Enforcement: portal product search/listing, storefront product listing, field-rep product picker
- Out of scope: per-customer overrides (use a single-buyer group instead)

## What to do first this session

1. Read the master reference end-to-end.
2. Read this handoff end-to-end.
3. **Verify the current state of relevant code before designing:**
   - `customer_groups` table — what columns exist today; is it really only used for `discount_percent`?
   - Existing storefront cart flow (`backend/services/storefront-cart.js`) and customer portal order flow (`backend/routes/customer-portal/`) — find the right hook points
   - Field-rep order capture (`frontend/src/pages/redesign/field/`) — find the cart submit path
4. Write a single implementation plan covering all three items, in this build order: 2.10 first (smallest, no schema), then 2.2 (small migration), then 2.11 (largest migration). Each as its own commit.
5. Confirm the plan with me before writing code.

## Operational rules (carry forward)

- **Commit each item separately. Push to main directly — no PRs unless I explicitly ask.**
- Backend changes auto-deploy via Railway. Frontend auto-deploys via Vercel. Verify both landed before claiming work is live.
- For migrations: verify the new `schema_version` landed on ≥1 prod tenant via Supabase MCP. Past migrations (v90→v91) silently lost rows.
- Use Supabase MCP for read-only prod queries. Don't run destructive SQL on prod schemas without confirming first.
- Vitest is the test runner (not Jest). Run integration tests from `backend/` directory.
- Run `npm run build` in `frontend/` to verify before commit.
- When introducing new schema columns, audit every endpoint that queries the affected table.
- **PII guard for manufacturer portal** (still applies): any new endpoint touching `customers` must not select `customer_id/name/phone/email/address` — only `c.city` is allowed. Grep before commit.
- Use the new `utils/dates.js` helpers (`todayLocalStr`, `localDateStr`, `daysAgoLocalStr`, `monthStartLocalStr`) for any date filter / default-range / filename-suffix code. Never write fresh `toISOString().slice(0, 10)` — that's the UTC trap we just audited out.

## Test tenant credentials

| Field | Value |
|---|---|
| Login URL | https://sanopos.com/login |
| Store Code | `wholesalewalktest1778451` |
| Admin user | `Wholesale Test Owner` / `TestWholesale778!` / PIN `4321` |
| Cashier user | `Test Cashier` / `TestCashier1!` / PIN `1234` |
| Field rep user | `Field Rep One` / `TestField234!` / PIN `7777` |
| Tenant ID | 103 |
| 5 customers seeded | Test Distributor, Shaheen General Store, New City Mart, Khalid Kiryana Store, Ahmed Brothers |
| Existing customer groups | Check via Supabase MCP before relying on this — verify what's seeded |

For 2.11 testing, you'll need to seed at least 2 customer groups and assign test customers to them. Plan that into the implementation steps.

## What NOT to do this session

- Don't start Tier 2 items 2.3 (Quote→SO pipeline), 2.4 (backorders), 2.5 (vaulted cards), 2.6 (company hierarchy), 2.7 (RFQ), 2.8 (deposits), or 2.9 (grid ordering). All deferred until a real wholesale customer asks.
- Don't build Tier 1.3.5 (retrospective rebates) or Tier 1.4.5 (transaction-level manufacturer view). Both deferred — wait for a real customer.
- Don't speculatively refactor anything. Keep the changes scoped to the three items.
