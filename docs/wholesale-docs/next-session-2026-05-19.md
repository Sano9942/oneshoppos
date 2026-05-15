# Handoff prompt — paste into a fresh Claude session

Copy everything below the line into the very first message of the new tab.

---

We're continuing the SanoPOS wholesale roadmap. **TIER 1 IS COMPLETE** as of 2026-05-15. **TIER 2 OPTION B IS NOW COMPLETE** as of 2026-05-16 — all three items (2.10 Reorder, 2.2 MOQ, 2.11 Visibility) shipped and verified live. Current migration: **v96**.

## Read these first

1. `docs/wholesale-docs/sanopos-wholesale-master-reference.md` — full state and roadmap
2. The "Tier 2 Option B shipped 2026-05-16" subsection in the headline area
3. Auto-memory file `tier2_option_b_complete.md` — implementation notes and gotchas

## Critical: don't trust CLAUDE.md or memory files blindly

CLAUDE.md files and the auto-memory at `C:\Users\HP\.claude\projects\d--newprojects-oneshoppos\memory\` drift over time. Use them for orientation, but verify against source for any concrete claim — schema columns, route signatures, middleware behavior. Grep first, read the actual file, then act.

## State entering this session

- Migration version: **v96** (Tier 2 Option B's two migrations)
- Branch: `main` (clean except for `.claude/settings.json` which has been dirty across multiple sessions and is unrelated)
- All commits pushed and auto-deployed (Railway backend + Vercel frontend)
- Active wholesale test tenant on prod: `wholesalewalktest1778451`
- Tier 2 Option B commits (in order): `c027c21` (2.10 reorder), `1a9011c` (2.2 MOQ), `e040012` (2.11 visibility)

## What's left from Tier 2 Option B

**Recommended polish for this session (no schema changes, ~half-day each):**

1. **Seed visibility test data on the wholesale tenant.** Use Supabase MCP to create two customer groups (e.g. "Tier A Distributors", "Tier B Retail"), assign 2-3 test customers to each, mark 1-2 products as `visibility='restricted'` with `customer_group_products` mappings, then walk through the storefront / portal reorder / field-rep flows to confirm each surface enforces correctly. No code changes — this is verification work.

2. **Vitest unit tests for `moq.js` and `product-visibility.js`.** Both helpers were smoke-tested with fake DBs during implementation; formal unit tests would catch regressions. Pattern: `backend/tests/unit/pricing-service.test.js` is a good template (real module + injected fake `db`). Skip if low priority.

3. **Bulk import: add MOQ + visibility columns to the products template.** `routes/import.js` + `frontend/src/pages/redesign/ImportRedesign.jsx` + the .xlsx template at `/api/import/template/products`. This was in the original plan but deferred to keep each commit focused. Useful for tenants who already have product catalogs they want to bulk-update with rules.

4. **Admin "Customer Group → Visible Products" management page.** Today, visibility is configured per-product on `ProductFormPage.jsx`. Some tenants will want the reverse view: pick a group, see/edit which products it can access. Net-new page, mounts under `/customer-groups/:id/products` or similar. Defer if not asked.

## Tier 2 items NOT yet built (deferred until a real customer asks)

- 2.3 — Quote → Sales Order pipeline
- 2.4 — Backorder management
- 2.5 — Vaulted payment cards / stored methods
- 2.6 — Company hierarchy (parent/child accounts)
- 2.7 — RFQ workflow
- 2.8 — Deposit-required orders
- 2.9 — Grid ordering (matrix entry)
- Tier 1.3.5 — Retrospective rebates
- Tier 1.4.5 — Transaction-level manufacturer view

None of these are urgent without customer pull. The Option B subset was deliberately chosen because each item ships real B2B portal value without touching the order pipeline.

## What to do first this session

1. Read the master reference Tier 2 Option B section.
2. Read this handoff end-to-end.
3. Run the verification walkthrough first — seed test data, confirm each enforcement surface (storefront filter, portal reorder, field-rep picker), and document any rough edges you find before writing more code.
4. Decide whether to ship polish items 2-4 above, or move on to a different area (retail-side work, Tier 1.3.5, etc.). Confirm with the user before touching code.

## Operational rules (carry forward)

- **Commit each item separately. Push to main directly — no PRs unless I explicitly ask.**
- Backend changes auto-deploy via Railway. Frontend auto-deploys via Vercel. Verify both landed before claiming work is live.
- For any migration: verify the new `schema_version` landed on ≥1 prod tenant via Supabase MCP. Past migrations (v90→v91) silently lost rows.
- Use Supabase MCP for read-only prod queries. Don't run destructive SQL on prod schemas without confirming first.
- Vitest is the test runner (not Jest). Run integration tests from `backend/` directory.
- Run `npm run build` in `frontend/` to verify before commit.
- When introducing new schema columns, audit every endpoint that queries the affected table.
- **PII guard for manufacturer portal** (still applies): any new endpoint touching `customers` must not select `customer_id/name/phone/email/address` — only `c.city` is allowed. Grep before commit.
- Use the `utils/dates.js` helpers (`todayLocalStr`, `localDateStr`, `daysAgoLocalStr`, `monthStartLocalStr`) for any date filter / default-range / filename-suffix code. Never write fresh `toISOString().slice(0, 10)`.

## Architectural callbacks from Tier 2 Option B

These came up during implementation and are easy to forget:

- **`customer_groups` is now load-bearing for FOUR things**: (a) auto `discount_percent`, (b) `price_lists.customer_group_id` FK overrides, (c) additive stacking with loyalty tiers, (d) catalog visibility whitelist via `customer_group_products`. Before touching the table or its FK relationships, grep `customer_groups` across the whole backend.
- **Portal's view of "orders" depends on the endpoint**: `/me/orders` returns only `web_orders` (kept for dashboard backward compat); `/me/order-history` returns the unified `web_orders` + `sales` union (Tier 2.10). Don't change `/me/orders` shape without auditing the dashboard widget.
- **MOQ gate trigger**: `/api/sales` only enforces MOQ when `field_visit_uuid` OR a resolved `field_visit_id` is set. POS has neither. If you ever introduce a new non-POS sale source, decide whether it should set `field_visit_uuid` (to inherit MOQ) or stay free-form.
- **Visibility helper SQL placeholder pattern**: `visibleProductSqlFragment` returns `{ sql, params }` where `sql` contains a literal `$PLACEHOLDER` token. The caller substitutes it with the right positional index (`$N`) because two of the three call sites use a running `paramIdx` counter rather than `params.length`. Don't try to inline-format `$1/$2` in the helper — it'd break for those callers.
- **Storefront detail returns 404, not 403, for restricted SKUs.** Same shape as a missing product. Intentional — leaking that a SKU exists but is restricted to other accounts is a contractual problem.

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

For visibility testing you'll need to seed at least 2 customer groups + assign customers + flag products. Use Supabase MCP for the inserts since there's no admin UI for the group→customers mapping today (that lives on the existing Customer Groups admin page and Customer detail page; check before building anything new).
