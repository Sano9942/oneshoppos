# SanoPOS Feature Flag Audit — 2026-04-23

**Source**: [backend/middleware/feature-flags.js](../backend/middleware/feature-flags.js) `DEFAULT_FEATURE_FLAGS` (84 flags).
**Method**: For each flag, confirmed (1) where it's enforced via `requireFeature(...)`, (2) where it's read by frontend, and (3) why it exists.

Every one of the 84 flags is referenced in code — there are **no orphan flags** (flags with no checks anywhere). The question is whether each flag still *needs* to be a switch.

---

## Classification

Four buckets:

| Bucket | Meaning | Count |
|---|---|---|
| **A. Keep forever** | Mode gate, plan tier, or region gate that has a permanent business reason to be a switch | 38 |
| **B. Retire after stable** | Rollout flag for a shipped feature — delete after confidence period | 32 |
| **C. Keep but reconsider** | Works as-is but the gating rationale is weak; candidate for simplification | 11 |
| **D. Already dead / remove now** | Flag exists but the feature is gone, renamed, or unreachable | 3 |

Total: 84.

---

## Bucket A — Keep forever (38 flags)

### Mode gates (25) — one preset toggles them on; retail tenants must never see them

| Flag | Mode | Why keep |
|---|---|---|
| `phase4_restaurant` | restaurant | Gates nav + all restaurant routes |
| `phase4_restaurant_qr` | restaurant | QR menu — optional within restaurant |
| `phase4_restaurant_kds` | restaurant | KDS display — optional |
| `phase4_restaurant_preauth` | restaurant | Card pre-auth tabs — optional |
| `phase4_restaurant_86` | restaurant | 86-list — optional |
| `phase4_restaurant_void_comp` | restaurant | Void/comp audit |
| `phase4_restaurant_pay_at_table` | restaurant | Pay-at-table |
| `phase4_restaurant_reservations` | restaurant | Dine-in reservations |
| `phase4_restaurant_kds_analytics` | restaurant | KDS analytics |
| `phase4_restaurant_day_parting` | restaurant | Day-parting menus |
| `phase4_restaurant_fire_chits` | restaurant | Fire-order chits |
| `phase4_restaurant_seats` | restaurant | Seat assignment |
| `phase4_restaurant_drive_thru` | restaurant | Drive-thru |
| `phase4_restaurant_menu_engineering` | restaurant | Menu engineering report |
| `phase4_appointments` | appointments | Salon/clinic bookings |
| `phase4_appointments_waitlists` | appointments | Waitlist |
| `phase4_appointments_classes` | appointments | Class-based bookings |
| `phase4_google_calendar_sync` | appointments | Calendar sync |
| `phase4_service_projects` | service_projects | Project tracking |
| `phase4_service_contracts` | service_projects | Contract management |
| `phase4_contract_ai` | service_projects | AI contract analysis (opt-in even within mode) |
| `phase4_workflow_tickets` | workflow_tickets | Service tickets |
| `phase4_rentals` | rentals | Rental contracts |
| `phase4_room_management` | room_management | Hotel rooms |
| `phase4_treatment_plans` | treatment_plans | Clinical plans |

All gate nav in `frontend/src/ui/nav-config.js` and route-level `requireFeature()`. **Removing any of these would expose non-retail features to retail tenants.**

### Plan / tier gates (8) — free vs pro entitlement

| Flag | Why keep |
|---|---|
| `accounting_core` | Tier 4 / Pro-only |
| `supplier_payables` | Tier 4 / Pro-only |
| `approvals` | Tier 4 / Pro-only |
| `crm_quotations` | Tier 4 / Pro-only |
| `advanced_hr` | Tier 4 / Pro-only |
| `multi_company` | Pro-only (enforced in `tier4/company-profile.js`) |
| `notifications` | Tier 4 / Pro-only |
| `backup_restore` | Pro-only (enforced in `barcode-expenses.js` export endpoints) |

### Region gates (3) — Pakistan-specific

| Flag | Why keep |
|---|---|
| `fbr_integration` | Pakistan-only FBR posting; non-PK tenants must not see it |
| `e_invoicing_export` | PK e-invoicing export |
| `phase5_cod_reconciliation` | PK-heavy COD flow (still relevant for all regions but initially PK) |

### Genuine opt-ins (2) — customer-facing choices that require merchant decision

| Flag | Why keep |
|---|---|
| `marketplace_integrations` | Merchant actively chooses to expose catalog on Daraz/Facebook/Google/WhatsApp — material decision |
| `subscription_billing` | Mode-gated to subscriptions mode; enables recurring billing UI |

---

## Bucket B — Retire after stable (32 flags)

These are **rollout flags for features that have shipped and are working**. They should be deleted in batches after a confidence window (2–4 weeks of no rollback events per flag). Each removal = delete the flag line + delete the `requireFeature('flag')` calls + delete the nav/UI gate + the feature runs for everyone.

### Phase 2 (12 flags) — mostly shipped Q1 2026, all default ON where it matters

| Flag | Default | Status | Retire? |
|---|---|---|---|
| `phase2_scheduling` | ON | Stable, in use | Retire next |
| `phase2_returns_policy` | ON | Stable | Retire next |
| `phase2_smart_collections` | ON | Stable | Retire next |
| `phase2_outlet_tax` | ON | Stable | Retire next |
| `phase2_scheduled_changes` | ON | Stable | Retire next |
| `phase2_report_builder` | ON | Stable | Retire next |
| `phase2_pos_layouts` | ON | Stable | Retire next |
| `phase2_outlet_pricing` | OFF | Still rolling out | Retire when enabled broadly |
| `phase2_draft_orders` | OFF | Still rolling out | Retire later |
| `phase2_pos_approvals` | OFF | Still rolling out | Retire later |
| `phase2_commissions` | OFF | Still rolling out | Retire later |
| `phase2_item_suggestions` | OFF | Still rolling out | Retire later |
| `phase2_outlet_visibility` | OFF | Still rolling out | Retire later |

Recommendation: **the seven default-ON ones are safe to delete now** — if they've been ON in defaults and nobody's hit issues, the flag is a no-op.

### Phase 2-G retail tier-1 polish (13 flags) — all default OFF, staged rollout

| Flag | Retire when |
|---|---|
| `phase2g_omni_input` | After 4 weeks of tenant opt-ins with no rollback |
| `phase2g_variant_picker` | Same |
| `phase2g_gift_cards` | Same |
| `phase2g_loyalty` | Same |
| `phase2g_price_books` | Same |
| `phase2g_price_override` | Same |
| `phase2g_serialized_inventory` | Same |
| `phase2g_per_line_restock` | Same |
| `phase2g_inventory_intelligence` | Same |
| `phase2g_receipt_barcode_lookup` | Same |
| `phase2g_label_designer` | Same |
| `phase2g_holds` | Same |
| `phase2g_risk_controls` | Same |

These are all recent (v62–v76), so they're legitimate rollout gates today. Set a calendar reminder: **review for retirement in June 2026**.

### Phase 5 (3 flags)

| Flag | Status |
|---|---|
| `phase5_shipping_automation` | Rolling out via couriers — retire once adapter set stabilizes |
| `phase5_payment_gateways` | Retire once xPay is GA |
| `phase5_sms_providers` | Retire once one SMS provider is default |

### Reports enhancements (5 flags)

| Flag | Status |
|---|---|
| `reports_enhanced_filters` | Retire — enhanced filter UI is the only UI now |
| `reports_profit_layer` | Retire — profit columns aren't controversial |
| `reports_inventory_health_plus` | Retire — no separate "basic" version exists |
| `reports_exceptions` | Retire — exceptions panel is just part of analytics |
| `reports_scheduled_exports` | Keep longer — scheduled exports are resource-heavy; having a kill switch is useful |

### Recent polish (4 flags, v75–v76)

| Flag | Default | Retire when |
|---|---|---|
| `retail_weekly_digest` | OFF | After 4 weeks of clean sends |
| `receipt_designer_v2` | **ON** | Already effectively default — remove after 2 more weeks of no bug reports |
| `shift_auto_close` | OFF | After confirming no false auto-closes in 4 weeks |
| `offline_returns` | OFF | After 4 weeks of clean offline return sync |

---

## Bucket C — Keep but reconsider (11 flags)

These work but the rationale is shaky. Don't delete, but revisit the architecture.

| Flag | Issue | Recommendation |
|---|---|---|
| `customer_invoicing` | Gates customer-invoices routes but no free/pro distinction enforced | Either tie to plan tier or retire |
| `customer_messaging` | Gates messaging routes | Same — tie to plan or retire |
| `marketing_campaigns` | Gates marketing routes | Same — tie to plan or retire |
| `payment_links` | Gates `/payment-link` endpoint only | Collapse into `customer_invoicing` — too granular |
| `sms_campaigns` | Gates SMS campaign send | Tie to `phase5_sms_providers` or retire |
| `subscription_autocharge` | Sub-flag of `subscription_billing` | Collapse into parent |
| `context_selection_required` | Optional enforcement | Keep — some tenants disable for single-outlet convenience |
| `context_header_enforced` | Optional enforcement | Keep — same reason |
| `kiosk_context_locked` | Kiosk lockdown | Keep — security posture toggle |
| `notifications` | Listed as "Pro" but nav + bell UI always show | Either make Free-tier work without it or hide bell when off |
| `approvals` | Listed as "Pro" but POS approval modal is widely used | Same question — clarify if Free tier sees any approvals |

---

## Bucket D — Already dead / remove now (3)

| Flag | Issue |
|---|---|
| `ai_insights` | Mentioned in `backend/CLAUDE.md` flag registry but **not in `DEFAULT_FEATURE_FLAGS`**; `routes/insights-ai.js` does a soft DB check instead. Either add it properly or remove from the registry docs. |
| `shopify_integration` | Already removed from `DEFAULT_FEATURE_FLAGS` per this audit's notes; `routes/shopify/*` gates on connection existence. Nothing to do; already clean. Documenting for awareness. |
| `ui_redesign_*` (22 historical) | Already gone from `DEFAULT_FEATURE_FLAGS`. The memory note `feature_flags_guide.md` claiming "22 dead ui_redesign flags" is **stale** — they're already deleted. Memory updated separately. |

So Bucket D is effectively a "documentation cleanup" bucket, not a code-change bucket.

---

## Summary + Recommended Action Order

**84 flags today → target ~50 flags after cleanup** (all of Bucket A + whatever Phase 2-G + Phase 5 you keep as genuine rollout gates for the next few months).

### Immediate (low risk, quick wins)
1. **Delete 7 default-ON Phase 2 flags** (`phase2_scheduling`, `phase2_returns_policy`, `phase2_smart_collections`, `phase2_outlet_tax`, `phase2_scheduled_changes`, `phase2_report_builder`, `phase2_pos_layouts`) — they've been ON forever. One PR per flag. Each: remove from `DEFAULT_FEATURE_FLAGS`, remove `requireFeature()` calls, remove nav/UI gates.
2. **Delete 4 reports flags** (`reports_enhanced_filters`, `reports_profit_layer`, `reports_inventory_health_plus`, `reports_exceptions`) — no meaningful "legacy path" to fall back to.
3. **Fix `backend/CLAUDE.md`** — remove `ai_insights` from the flag registry or seed it properly.

### 2–4 weeks out
4. **Retire `receipt_designer_v2`** once zero bug reports come in from v76 rollout.

### June 2026 review
5. **Evaluate Phase 2-G and Phase 5 retirement** — each flag independently, based on real rollout data.

### Architecture decision
6. **Collapse over-granular Tier 4 flags**: merge `payment_links` → `customer_invoicing`, `subscription_autocharge` → `subscription_billing`, `sms_campaigns` → `phase5_sms_providers`.

### Do not touch
- All 25 mode flags (`phase4_*`) — these are load-bearing for multi-preset architecture.
- Plan tier gates — they encode business tiers.
- Region gates (`fbr_integration`, `e_invoicing_export`).

---

## Why this matters

Each flag costs:
- One `DEFAULT_FEATURE_FLAGS` entry
- At least one `requireFeature()` call per gated route
- A DB row per tenant per flag in `feature_flags` table
- A UI branch in at least one component
- A mental tax on every developer writing new code in the area

Deleting a stable flag is low-risk (the feature still runs; you just remove the switch). Keeping stale flags is high-cost (confusion about what's on, drift between what the flag gates and what the code does).

The architecture is sound. The *discipline* of retiring flags after rollout needs to become routine — that's the actual fix.
