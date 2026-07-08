# Core Platform Research — pre-build-wave health check

**Date:** 2026-07-08 · **Against:** main @ v126 · **Method:** read-only code tracing (parallel Explore
agents across independent call paths) + six driven behavior flows on fresh local test tenants + a
fresh-context verifier on the worst findings. No production DB access. **Findings only — this session
changed no code, ran no migrations, touched no schema.**

Scope: the CORE platform, **not** the vertical-depth work — that master checklist
(`docs/fable5/vertical-depth/prompts-per-plan.md`) is assumed complete and is not re-flagged here.

## Contents
- [`01-CORE-SPINE.md`](./01-CORE-SPINE.md) — POS/sales, inventory, CRM, HR, reporting, platform
  (multi-tenant/admin, billing, portals, storefront, notifications).
- [`02-INTEGRATIONS.md`](./02-INTEGRATIONS.md) — Shopify, WooCommerce, marketplaces, couriers, FBR,
  payment gateway, email, SMS — does each call through or is it decorative?
- [`03-VERTICAL-CONNECTIVITY.md`](./03-VERTICAL-CONNECTIVITY.md) — the 10 modes' seams into the spine
  (connectivity only), with six driven flows.
- [`AUTO-STOCK-ENTRY.md`](./AUTO-STOCK-ENTRY.md) — standalone deep-dive: automating the data-entry
  operator toward zero, now → next → moonshot.

---

## Platform verdict: launch-grade in structure, NOT launch-grade in money-path hardening.

The platform is **architecturally sound and genuinely wired**. Multi-tenant isolation is clean (every
transactional route goes through the `deps.db` ALS proxy — no raw-pool cross-schema leak found
anywhere in the spine). The marquee flows work end-to-end: six verticals driven on fresh tenants all
passed (weight sale, wholesale credit/AR, dental charting, salon appointment→commission, hotel folio,
rental checkout→return). Payment, FBR, email, SMS, and deposit chains are real. Auth, bcrypt, portal
IDOR protection, and admin impersonation controls are solid.

**But the money and stock write paths are under-hardened in a consistent, recognizable way:** the POS
sale path was correctly locked (`FOR UPDATE`, credit re-check, gift-card lock) — and then **its
siblings were not**. The same class of bug recurs across returns, wallet tender, loyalty redemption,
inventory transfer, quotation-convert, supplier-return, and commission calc: a check done outside the
transaction without a row lock, or a client-supplied money value trusted without a server-side cap.
Individually low-probability; collectively they are the thing to fix before a serious launch wave,
because every one is reachable from a hostile or double-clicking client and several move real money.

**The worst cross-module issues (fix before the next build wave):**

1. **POS sale total is client-trusted** (`sales.js:1181`) — the server never re-prices lines against
   the catalog, and POS uses a *different* pricing engine than storefront/quote/field. A crafted
   client sets its own total.
2. **Tax-exclusive sales never add tax to the total** (`sales.js:1181` / `tax-snapshot.js:181`) —
   exclusive-mode tenants under-collect and under-book GST.
3. **Loyalty points + wallet redemption have no balance check and no lock**
   (`sales.js:1189/2033`, `:1237/2216`) — negative balances and concurrent double-spend of
   money-equivalent value.
4. **Returns over-refund by amount is unvalidated** and **`store_credit` refunds credit nothing**
   (`returns.js:458/493`, `:601`) — refund more than was paid; or process store credit and the
   customer's wallet is never credited.
5. **Marketplace/WhatsApp inbound is largely a mirage** — Daraz & Meta webhooks are no-ops, the
   WhatsApp inbox write silently fails (wrong DB pool), and the sync worker schedules nothing; courier
   credentials are stored in plaintext and `config_json` is never parsed. (Payment/FBR/aggregator
   inbound are the exceptions that work.)

None of these are in the vertical-depth surface; they're in the shared core, which is exactly what
this pass was meant to surface.

---

## Ranked additions master-list (internal gaps + competitive parity)

Ranked by value × (inverse) effort. "Internal" = a gap this audit surfaced; "Parity" = a
capability Square/Shopify/Loyverse ship that SanoPOS lacks.

### Tier A — high value, low/medium effort (do first)
| # | Add | Type | Why | Anchor |
|---|---|---|---|---|
| A1 | **Shared `decrementStock/incrementStock` helper** (3-table + `FOR UPDATE` + `WHERE qty≥n` + batch ledger) | Internal | Kills the whole oversell/drift bug family (transfer, quote-convert, supplier-return, PO-receive) in one place | `01-CORE-SPINE.md` M3/M6/M7/H7 |
| A2 | **Server-authoritative POS pricing + total validation** via `resolvePriceForContext` | Internal | Closes client-trusted totals + unifies POS with storefront/quote pricing | H1/M1 |
| A3 | **Loyalty: balance check + `FOR UPDATE` + configurable point value + redemption cap** | Internal + Parity | Stops negative-balance abuse; matches Square/Loyverse configurable points | H3 |
| A4 | **Wallet tender: lock + re-check inside the tx** | Internal | Stops stored-value overspend race | H4 |
| A5 | **Returns: server-side refund cap + implement `store_credit` wallet credit + move qty check into the tx** | Internal | Stops over-refund and silent store-credit loss | H5/H6/M2 |
| A6 | **Add tax to total in exclusive mode** | Internal | Revenue/books integrity for exclusive-mode tenants | H2 |
| A7 | **Union DB flags into `/api/feature-flags`** (unhides FBR dashboard for all PK tenants) | Internal | One-line fix; currently every tenant's FBR queue is unreachable | claim-audit LEAK #5 |
| A8 | **Partial-PO receiving** (keep PO open, bill received qty) | Parity | Square/Shopify staple; today a partial receipt closes the PO and over-bills | M5 |

### Tier B — high value, medium effort
| # | Add | Type | Why |
|---|---|---|---|
| B1 | **AI invoice/challan → stock-in** (Phase 2 of `AUTO-STOCK-ENTRY.md`) | Internal + differentiator | The data-entry-operator killer; SDK + R2 + preview UI already exist |
| B2 | **Fix the reshaping-layer leaks** (clinical chart_preset, orphaned Clinical reports, inverted restaurant reports, dead portal tabs, decorative dashboard_widgets) | Internal | Makes the industry-language marketing claim honest end-to-end (see `../claim-audit/`) |
| B3 | **Commission idempotency** (`ON CONFLICT`/pre-delete) | Internal | Stops payroll double-pay on recalc |
| B4 | **Real inbound marketplace order capture** (Daraz/Meta webhooks + WhatsApp inbox pool fix) | Internal + Parity | Today it's manual-pull or silently broken |
| B5 | **Customer merge/dedup** | Parity | No merge exists; every POS accumulates duplicate customers |
| B6 | **Split-tender coverage validation + change-due modeling** | Parity | Enforce Σpayments ≥ total for cash/card/split |

### Tier C — strategic / larger effort
| # | Add | Type | Why |
|---|---|---|---|
| C1 | **AI stock-entry moonshot** (photo→match→auto-categorize→auto-price→stock-in, human-in-loop) | Differentiator | White space vs incumbents for the emerging-market wedge |
| C2 | **Encrypt courier + WooCommerce credentials; parse `config_json`** | Internal (security) | At-rest plaintext creds; silent adapter-field defaults |
| C3 | **Cycle counts at variant/batch granularity** | Parity | Today product-level only; desyncs variant/batch catalogs |
| C4 | **Negative-stock policy toggle per product** | Parity | Shopify/Square allow/block oversell per item |
| C5 | **FBR failure alerting + dead-letter** (+ marketing OR-logic audiences, subscription-dunning predicate fix, attendance TZ fix) | Internal | Reliability/correctness cleanups |

---

## Adjacent research
`docs/nvidia ai/nvidia-ai-research-conversation.md` — a separate research conversation (2026-07-08)
on where NVIDIA AI/edge infrastructure could sit *beside* the SanoPOS stack (document extraction,
demand forecasting, loss-prevention vision, edge appliances). Research-only, no code impact; kept in
the repo for reference. It overlaps this doc's AI stock-entry direction (`AUTO-STOCK-ENTRY.md`) —
both point at document-extraction as the highest-value near-term AI lever.
