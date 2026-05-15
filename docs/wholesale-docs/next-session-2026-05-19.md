# Handoff prompt — paste into a fresh Claude session

Copy everything below the line into the very first message of the new tab.

---

We're continuing the SanoPOS wholesale roadmap. **TIER 1 IS COMPLETE** as of 2026-05-15. **TIER 2 OPTION B IS NOW COMPLETE AND END-TO-END VERIFIED ON PROD** as of 2026-05-16 — all three items (2.10 Reorder, 2.2 MOQ, 2.11 Visibility) shipped and walked through Playwright on `wholesalewalktest1778451`, all 15 sub-tests pass. Current migration: **v96**.

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

## What was verified on 2026-05-16 (no need to re-run)

End-to-end Playwright walkthrough on `wholesalewalktest1778451`, driven through the real UI as a real user. 15 sub-tests, all pass:

- Anonymous storefront listing hides restricted SKU; direct-URL to restricted SKU detail returns 404 (no existence leak).
- POS bypasses both MOQ and visibility — INV-2026-00006 (Khalid, ungrouped, Bulk B) and INV-2026-00007 (Test Distributor, Tier A, Bulk B) rang cleanly.
- Customer-portal `/me/order-history` unifies `web_orders` and `sales` with `source` tag.
- Portal Reorder for an ungrouped customer correctly skips a newly-restricted SKU with the spec banner.
- Portal Reorder for a Tier A customer mints a fresh cart and redirects to `/store/.../cart?adopt=<token>`; storefront's `useState` initializer adopts the token before the cart hook reads localStorage; URL param is stripped from history.
- Field-rep app shows the "(Min 12 · Case 6)" hint; Add seeds qty to 12; +/- steps by `order_increment=6`; decrementing below min drops the line.
- `/api/sales` POST with `field_visit_uuid` + qty 5 → 400 `MOQ_VIOLATION` with both `below_min` and `not_a_multiple` reasons + the "Ask the manager to ring this through POS" hint.
- Storefront cart POST with restricted product_id → 404 "Product not found"; with qty 5 of an MOQ-12 product → 400 `MOQ_VIOLATION`.
- Tier 1.3 promotions composed cleanly with Tier 2.2 MOQ — when MOQ pushed Bulk A to qty 12, the "Bulk A Volume Slab" promotion auto-fired (-Rs 12,000).

Seed state is now retained as permanent demo state on this tenant (see auto-memory `tier2_option_b_complete.md` for the full breakdown).

## What's left from Tier 2 Option B (still useful polish — none blocking)

1. **Vitest unit tests for `moq.js` and `product-visibility.js`.** Both helpers were smoke-tested with fake DBs during implementation AND verified end-to-end on prod; formal unit tests would catch future regressions but are no longer load-bearing. Pattern: `backend/tests/unit/pricing-service.test.js` is a good template (real module + injected fake `db`). Skip if low priority.

2. **Bulk import: add MOQ + visibility columns to the products template.** `routes/import.js` + `frontend/src/pages/redesign/ImportRedesign.jsx` + the .xlsx template at `/api/import/template/products`. Useful for tenants who already have product catalogs they want to bulk-update with rules. Defer until a tenant asks.

3. **Admin "Customer Group → Visible Products" management page.** Today, visibility is configured per-product on `ProductFormPage.jsx`. Some tenants will want the reverse view: pick a group, see/edit which products it can access. Net-new page, mounts under `/customer-groups/:id/products` or similar. Defer until asked.

4. **Operational gotchas surfaced during the walkthrough — none are bugs, all are minor polish opportunities:**
   - Portal self-signup OTP requires email inbox access. No admin "mark verified" affordance today. If you ever want admins to invite portal users without self-signup, add a button on the Buyers page that emails a reset link AND sets `portal_enabled_at`.
   - No admin UI exists to set `portal_enabled_at` on an existing customer. Signup is the only path that flips it today.
   - Sales-channel publication toggles on the product form don't surface on/off state through ARIA — they're presentational. Small a11y nit.

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
3. Verification is done — don't re-seed or re-walk unless something concrete looks broken. Pick from the polish backlog above or move to a different area (retail-side work, Tier 1.3.5, etc.) based on what the user asks for. Confirm before touching code.

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

### Employee logins

| Field | Value |
|---|---|
| Login URL | https://sanopos.com/login |
| Store Code | `wholesalewalktest1778451` |
| Admin user | `Wholesale Test Owner` / `TestWholesale778!` / PIN `4321` |
| Cashier user | `Test Cashier` / `TestCashier1!` / PIN `1234` |
| Field rep user | `Field Rep One` / `TestField234!` / PIN `7777` |
| Tenant ID | 103 |

### Customers seeded (5 total — Tier 2 Option B verification state retained as demo)

| ID | Name | Group | Notes |
|---|---|---|---|
| 1 | Test Distributor | Tier A Premium (10% discount) | Has portal account, password `PortalPass123!` |
| 2 | Shaheen General Store | Tier A Premium | No portal account |
| 3 | New City Mart | Tier B Standard (5% discount) | No portal account |
| 4 | Khalid Kiryana Store | (ungrouped) | Has portal account, password `PortalPass123!` |
| 5 | Ahmed Brothers | (ungrouped) | No portal account |

### Products seeded (Tier 2 Option B rules retained)

| ID | Name | Price | MOQ rule | Visibility |
|---|---|---|---|---|
| 1 | Bulk Product A (Sample) | Rs 10,000 | `min_order_qty=12`, `order_increment=6` | `all` |
| 2 | Bulk Product B (Sample) | Rs 15,000 | none | `restricted` → mapped to Tier A Premium only |
| 3 | Clearance Item (Sample) | Rs 2,000 | none | `all` |

All three are published to the storefront channel.

### Portal customer logins

| Customer | Email | Password | Portal URL |
|---|---|---|---|
| Khalid Kiryana Store (ungrouped) | `khalid+test@sanomerchandise.com` | `PortalPass123!` | https://sanopos.com/portal/wholesalewalktest1778451/login |
| Test Distributor (Tier A) | `testdist+test@sanomerchandise.com` | `PortalPass123!` | https://sanopos.com/portal/wholesalewalktest1778451/login |

Use Khalid to reproduce the "ungrouped buyer can't reorder restricted SKU" path; use Test Distributor for the happy-path Reorder → storefront cart adoption.

### Demo sales (rang through POS during 2026-05-16 verification — kept for reorder testing)

- INV-2026-00006: Khalid, 1 × Bulk B, Rs 15,000
- INV-2026-00007: Test Distributor, 1 × Bulk B, Rs 15,000
