# SanoPOS Retail Gap Audit - 2026-04-23

This audit records what the **pre-refresh** retail surface map missed or misframed compared with live repo truth on 2026-04-23.

It remains the **historical correction layer**, not the current completeness-verification source.

It should be read as the explanation layer behind:
- [docs/sanopos-retail-surface-map.md](../sanopos-retail-surface-map.md)
- [docs/sanopos-retail-capability-matrix.md](../sanopos-retail-capability-matrix.md)
- [docs/audits/sanopos-retail-completeness-check-2026-04-23.md](sanopos-retail-completeness-check-2026-04-23.md)

## Missing Surfaces

The previous report was strong on classic retail core, but it undercounted several merchant-relevant surfaces that are live in the repo:

### Missing frontend pages
- [frontend/src/pages/redesign/ExpensesRedesign.jsx](../../frontend/src/pages/redesign/ExpensesRedesign.jsx)
- [frontend/src/pages/redesign/TipPoolsRedesign.jsx](../../frontend/src/pages/redesign/TipPoolsRedesign.jsx)
- [frontend/src/pages/redesign/ReceiptTemplatesRedesign.jsx](../../frontend/src/pages/redesign/ReceiptTemplatesRedesign.jsx)
- [frontend/src/pages/redesign/NotificationsRedesign.jsx](../../frontend/src/pages/redesign/NotificationsRedesign.jsx)
- [frontend/src/pages/redesign/BillingRedesign.jsx](../../frontend/src/pages/redesign/BillingRedesign.jsx)
- [frontend/src/pages/redesign/MyTicketsRedesign.jsx](../../frontend/src/pages/redesign/MyTicketsRedesign.jsx)

### Missing backend routes
- [backend/routes/billing.js](../../backend/routes/billing.js)
- [backend/routes/schedules.js](../../backend/routes/schedules.js)
- [backend/routes/insights.js](../../backend/routes/insights.js)
- [backend/routes/insights-ai.js](../../backend/routes/insights-ai.js)
- [backend/routes/support.js](../../backend/routes/support.js)

### Missing retail-adjacent surfaces
- Customer portal routes and pages under `backend/routes/customer-portal/` and `frontend/src/pages/portal/`
- Notifications route ownership in [backend/routes/tier4/notifications.js](../../backend/routes/tier4/notifications.js)
- Admin support/oversight surfaces under `frontend/src/pages/admin/` and `backend/routes/admin/`

## Understated Depth

The previous report understated the true depth of the platform in several places:

- **Merchant operations depth**: retail-adjacent merchant pages like billing, support, notifications, expenses, scheduling, tip pools, and portal self-service are not side trivia; they materially affect whether a retail tenant can run the business in one system.
- **Evidence base**: the repo has `68` frontend test files, including direct retail coverage for POS, inventory, reports, billing, integrations, workforce, and FBR. The previous report barely surfaced that proof.
- **Inventory intelligence**: ABC classification, cycle counts, reorder surfaces, and related workers/tables make the inventory story deeper than a plain stock ledger.
- **Omnichannel breadth**: the repo contains a real chain of storefront, orders, fulfillment, channel publication, marketplace adapters, courier settings, shipment tracking, and COD settlement surfaces.
- **Compliance and admin support**: FBR flows, support tickets, notifications, and admin oversight widen the operational footprint beyond the old "POS + inventory + reports" impression.

## Overstated or Weakly-Proven Claims

The previous report sometimes blurred the line between "exists in code" and "merchant-ready enough to claim strongly."

### Areas that need bounded wording
- **AI insights**: [backend/routes/insights-ai.js](../../backend/routes/insights-ai.js) and [frontend/src/pages/dashboard/AIChatPanel.jsx](../../frontend/src/pages/dashboard/AIChatPanel.jsx) exist, but they should be described as experimental or partial, not as a hardened analytics assistant claim.
- **Offline returns and offline continuity**: there is real offline queue infrastructure, but it should be framed as limited continuity support, not full offline-first retail autonomy.
- **Kiosk flows**: kiosk surfaces exist, but the repo does not yet justify broad kiosk-product claims.
- **Advanced pricing/price books**: the surface is meaningful, but at least some workflow paths remain rollout-gated or thinner than a broad merchandising-platform claim.
- **Workforce scheduling**: [frontend/tests/smoke/workforce.smoke.spec.js](../../frontend/tests/smoke/workforce.smoke.spec.js) documents a known backend bug around schedule publish, so this area should not be sold as fully mature.

### Why this matters
- A surface map is naturally additive and optimistic
- A capability matrix must be stricter: it should downgrade claims when rollout flags, test gaps, or known failure modes are visible

## Evidence Gaps

The previous report did not make evidence levels visible enough.

### Missing test-aware framing
- POS is directly covered by [frontend/tests/pos-core.spec.js](../../frontend/tests/pos-core.spec.js) and unit tests such as [frontend/tests/unit/cartMath.test.jsx](../../frontend/tests/unit/cartMath.test.jsx)
- Returns and return policies are covered by [frontend/tests/smoke/draft-orders-returns.smoke.spec.js](../../frontend/tests/smoke/draft-orders-returns.smoke.spec.js)
- Pricing/promotion evidence exists in [frontend/tests/smoke/pricing-promotions.smoke.spec.js](../../frontend/tests/smoke/pricing-promotions.smoke.spec.js)
- Reports and dashboard evidence exist in [frontend/tests/reports.spec.js](../../frontend/tests/reports.spec.js) and [frontend/tests/smoke/insights-dashboard.smoke.spec.js](../../frontend/tests/smoke/insights-dashboard.smoke.spec.js)
- Billing evidence exists in [frontend/tests/billing.spec.js](../../frontend/tests/billing.spec.js)
- Integrations evidence exists in [frontend/tests/integrations.spec.js](../../frontend/tests/integrations.spec.js)
- Workforce evidence exists in [frontend/tests/smoke/workforce.smoke.spec.js](../../frontend/tests/smoke/workforce.smoke.spec.js)
- Admin evidence exists in [frontend/tests/admin-panel.spec.js](../../frontend/tests/admin-panel.spec.js)

### Missing gate-aware framing
- The previous report listed feature-rich areas without consistently separating:
  - default-on retail baseline
  - feature-flag rollout surface
  - plan/tier gated depth
  - connection-based integration depth
  - internal/admin-only surface

### Missing claim boundaries
- Many surfaces needed explicit language like:
  - "supports standard retail workflow"
  - "works for SMB retail operations"
  - "not a full enterprise suite"
  - "not a specialized vertical workflow"

## Recommended Wording Changes

Use these wording patterns going forward:

- Prefer **"supports standard retail workflow"** over **"fully covers"**
- Prefer **"shipped but gated"** over **"available"** when a feature flag or connection requirement is visible
- Prefer **"retail-adjacent merchant operations"** over silently excluding billing/support/portal/admin surfaces
- Prefer **"platform breadth"** for admin, support, and ops tooling rather than counting them as merchant-facing differentiators
- Prefer **"partial"** when a real surface exists but tests, defaults, or known bugs keep it from a clean maturity claim

Concrete examples:

- Replace "AI insights shipped" with "AI insights surface exists and is best treated as partial/experimental"
- Replace "offline retail support" with "offline queue and limited continuity support"
- Replace "advanced workforce scheduling" with "workforce scheduling foundations with a known publish-path bug"
- Replace "full omnichannel suite" with "credible SMB omnichannel retail spanning storefront, orders, fulfillment, and channel integrations"

## Bottom Line

The earlier report was a strong code-surface inventory, but it was not the complete retail truth picture.

The main corrections were:
- include retail-adjacent merchant surfaces on purpose
- make evidence visible
- separate rollout-gated depth from baseline retail claims
- add claim boundaries so marketing language stays honest

That is why the documentation set now needs four layers instead of one:
- inventory
- capability matrix
- gap audit
- completeness audit
