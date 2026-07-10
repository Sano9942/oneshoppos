# Business Modules — Feature Catalog & Bucket Classification

> Code-grounded catalog for the self-service "Business Modules" settings page.
> Grounded 2026-07-10 against actual source (three parallel code sweeps + direct reads of
> `backend/middleware/feature-flags.js`, `backend/config/mode-registry.js`, `backend/routes/auth.js`).
> Every mechanism claim below carries a file reference. Re-verify against code in Step 2 of PLAN.md
> before turning this into `backend/config/business-modules.js` — code moves.

> **Step 2 re-verification completed 2026-07-10** — every mechanism claim re-checked against source
> and encoded in `backend/config/business-modules.js` (+ bidirectional test
> `backend/tests/unit/business-modules-catalog.test.js`, 20 tests green). `DEFAULT_FEATURE_FLAGS`
> has exactly **106 keys**, all classified. Drift found and fixed in this doc: `phase2_pos_layouts`
> (missing → POS add-ons sub_toggle), `notifications` (unclassified → Bucket D/UNMANAGED),
> `phase4_restaurant_preauth` (dormant, zero consumers → UNMANAGED), serialized-inventory
> "inline in write routes" claim corrected (no backend gate exists). Final shape: 11 Bucket A cards,
> 30 Bucket B cards, 9 Bucket C cards, 7 UNMANAGED flags.

## Agreed spec constraints (fixed — do not re-litigate)

- All free within plan. No paywalls / entitlement layer / upgrade prompts.
- Capabilities-only v1: industry skin (labels, POS layout, vocabulary, report groups, widgets) frozen as chosen at signup. **Confirmed compatible with code**: `pos_layout_mode`, `labels`, `unit_vocabulary` come from the static `INDUSTRY_PRESETS` entry, NOT from `tenant_modes` (`backend/routes/auth.js:221-233`) — enabling a mode does not change the skin.
- Owner decisions (2026-07-10): **curated bundles** (~25 cards, not per-flag), **warn+confirm with live counts** on disable, **gate-only** mode enabling, **simple `depends_on`** dependency modeling.
- Hide-not-delete on disable; no sample-data seeding on enable.
- Super-admin backstop: platform lock prevents tenant self-enable (new build — no kill-switch exists today, verified).
- **Amendments (owner-approved 2026-07-10, second-opinion review — see the Amendments section below and PLAN.md "Deferred to v2")**: config preservation on disable (`saved_flags` snapshot/restore); `scope` + state-enum metadata on every catalog entry; legacy `PUT /api/feature-flags/:key` restricted to non-catalog-managed keys; enable-direction change preview (dependencies + roles named BEFORE apply); bidirectional catalog + permission-catalog tests; new `manage_business_modules` permission; module toggles never touch `role_permissions`.
- **Guiding rule**: bundles recommend, customers decide; disabling preserves configuration; enabling never causes hidden side effects.

## The machinery (verified)

| Mechanism | Location | Notes |
|---|---|---|
| `DEFAULT_FEATURE_FLAGS` (~100 keys) | `backend/middleware/feature-flags.js:9-201` | DB rows override defaults; 60s per-tenant cache |
| `requireFeature` / `requireMode` | `feature-flags.js:242,307` | Both 403 when off |
| **`requireMode` empty-map fall-through** | `feature-flags.js:313` | Zero `tenant_modes` rows ⇒ every mode check passes. Retail presets have NO modes ⇒ retail tenants live in fall-through today. **Never DELETE mode rows; only flip `enabled`.** |
| `MODE_REGISTRY` + `getFeatureFlagsForModes` | `backend/config/mode-registry.js:3-94` | 10 modes → flag bundles. THE atomic-pairing source of truth |
| Tenant flag write (exists) | `PUT /api/feature-flags/:key`, `registerAllRoutes.js:431-462` | `requirePerm("all_access")`, upserts ANY key, invalidates cache. **Bypass hole — being closed in PLAN Step 6**: will reject catalog-managed keys (module/bundle/Bucket D flags) with 409 `MANAGED_BY_BUSINESS_MODULES`; stays usable for `sub_toggles` + `UNMANAGED_FLAGS` only |
| Tenant mode write | **does not exist** | Only setup wizard, `applyPreset()` (full reset), super-admin `PUT /api/admin/tenants/:id/modes` (cascades bundle flags, `admin/tenants.js:686-719`) |
| Recommended-for-industry source | `services/preset-apply.js:expectedFlagsForPreset()` (:118-141) | mode flags + `PRESET_EXTRA_FLAGS` + signup bundle + multi-outlet bundle |
| Frontend flag read | `frontend/src/hooks/useFeatureFlags.js` | localStorage cache, **no refresh mechanism**; POS has a separate independent fetch (`POSContext.jsx:99-101`) |
| Frontend mode read | `PresetContext.hasMode` ← `GET /api/context/bootstrap` ← `tenant_modes WHERE enabled=true` (`auth.js:211-232`) | Fetched once per login; fail-opens before load |
| Subscription interplay | `requireActiveSubscription` wraps flag PUT | Trial/grace can toggle; `payment_status='expired'` paid tenants cannot (403). Acceptable — expired is read-only by design |

## Modes (10) — `VALID_MODES`

`restaurant`, `appointments`, `commissions`, `service_projects`, `subscriptions`, `workflow_tickets`, `rentals`, `room_management`, `treatment_plans`, `wholesale` (`mode-registry.js:79`).

---

## Bucket A — vertical modules (toggle = mode row + registry flag bundle, atomically)

| Card | Mode | Flags flipped (bundle) | Backend gate | Cleanliness notes |
|---|---|---|---|---|
| Restaurant | `restaurant` | `phase4_restaurant` + 12 sub-flags (registry `mode-registry.js:4-21`) | mode+flag+perm on `restaurant.js`, `kds.js`, `modifiers.js`, `tips.js`, `restaurant/*`, `restaurant-inbox.js`, `restaurant-kiosk.js` | Gate-only caveat on card: POS keeps the tenant's retail layout (floor/KDS pages fully work). `delivery_aggregators` NOT in bundle (Bucket C). Workers `kds-load-snapshot`, `course-release`, `reservation*` are table-presence gated — add flag checks (PLAN Step 3) |
| Appointments & Booking | `appointments` | `phase4_appointments` (+ optional sub-toggles `_classes`, `_waitlists`, `_resources` — enable with card, individually listed) | `bookings.js:18`, `classes.js:20`, `client-service-records.js` | `booking-reminders` (inline `boot/workers.js`) has NO flag check — fix in Step 3 |
| Subscriptions & Memberships | `subscriptions` | `subscription_billing` | `subscriptions.js:28` | `subscription_autocharge` excluded (Bucket C — needs gateway). Dunning worker only pre-filters plan≠free |
| Rentals | `rentals` | `phase4_rentals` + `rental_inspections` (extra, per rental presets) | `rentals.js:26` | `rental_online_booking` separate opt-in sub-toggle (public exposure — warn copy). `rental-overdue-worker` has NO flag check — Step 3. Disable-impact count: contracts `status='checked_out'` |
| Rooms & Lodging | `room_management` | `phase4_room_management` + `room_guest_registration` | `rooms.js:35` | `room_channel_sync` → Bucket C (needs feed). `room_online_booking` opt-in sub-toggle (public). `room-overdue-checkout` + `night-audit` workers have NO flag check — Step 3. Impact: active bookings/in-house stays |
| Clinical / Treatment Plans | `treatment_plans` | `phase4_treatment_plans` + `clinical_recalls` | `treatment-plans.js:41`, `recalls.js:30`, `handouts.js:31`, `reports/clinical.js` | Sub-toggles: `vet_vaccinations`, `clinical_handouts`. `treatment-plan-worker` NO flag check — Step 3. Impact: active plans |
| Service Tickets (Repair) | `workflow_tickets` | `phase4_workflow_tickets` | `service-tickets.js:20` | Impact: open tickets |
| Projects & Contracts | `service_projects` | `phase4_service_projects` + `phase4_service_contracts` | `projects.js:12`, `contracts.js:8` | Sub-toggle `phase4_contract_ai` (platform key set; cost-cap only). Impact: active projects/contracts |
| Commissions | `commissions` | `phase2_commissions` | `commissions.js` (flag; no requireMode call site — mode row still written for consistency) | Frontend nav gates flag+mode (`nav-config.js:250`) |
| Wholesale / B2B Credit | `wholesale` | `wholesale_credit_controls` + sub-toggles `wholesale_schemes`, `wholesale_backorders`, `wholesale_van_sales`, `wholesale_secondary_sales` | flags only (no `requireMode("wholesale")` call site — mode row written for registry consistency) | `wholesale_van_sales` depends_on `wholesale_field_sales`. Schemes/credit are inline-enforced in promo/credit engines, verified present |
| Field Sales (mobile reps) | — (flag-only vertical) | `wholesale_field_sales` | `field.js:63` | No mode. Clean flag-only card. GPS/geofence works without config (defaults) |

**Atomicity rule** (owner-fixed): a Bucket A toggle flips the `tenant_modes` row AND the registry bundle in ONE `deps.db.transaction`. Mirror the super-admin cascade (`admin/tenants.js:703-710`), then invalidate BOTH caches.

**Critical transition trap**: enabling the FIRST mode row on a currently-modeless tenant (all retail presets) switches `requireMode` from fall-through to enforcing for **every** mode-gated route on that tenant. If the tenant has drifted flags (a `phase4_*` flag manually enabled without its mode row), those surfaces 403 the moment any unrelated module is enabled. **Mitigation (must-build, PLAN Step 5)**: on first mode-row insert, backfill enabled mode rows for any mode whose registry flags are already enabled.

## Bucket B — operational toggles (flag-only cards)

| Card | Flag(s) | Backend enforcement | Notes / leaks |
|---|---|---|---|
| Gift Cards | `phase2g_gift_cards` | `gift-cards.js` | POS tender chip gated (`POSCheckoutModal.jsx:95`) — clean |
| Loyalty & Points | `phase2g_loyalty` | `loyalty.js`, `customers.js` tiers | **LEAK**: POS wallet/points checkout UI (`useLoyaltyWallet`, `POSContext.jsx:519`) has no flag gate — fix in Step 3 before exposing |
| Holds & Layaway | `phase2g_holds` | `holds.js` | Clean (POS buttons gated `POSSubHeader.jsx:39`). `hold-expiry-worker` table-presence gated |
| Draft Orders | `phase2_draft_orders` | `draft-orders.js` | POS gated via posFlags |
| Serialized Inventory | `phase2g_serialized_inventory` | **NONE — Step 2 correction**: no backend flag gate exists (`routes/product-serials.js` is not flag-gated; the flag's only backend reference is the defaults map). Enforcement is the POS serial modal + per-product `serial_required` | POS serial modal gated; card copy says "gates the POS capture UI" |
| Inventory Intelligence | `phase2g_inventory_intelligence` | `inventory-intelligence.js` | ABC worker flag-checks ✅ (`abc-worker-boss.js:40`) |
| Batch & Expiry Tracking | `batch_expiry_tracking` | `batches.js` | Expiry worker flag-checks ✅. Real gate is per-product `track_batches` |
| Production (Kit/BOM) | `kit_bom_engine` | `stock-conversions.js`, recipe-costing report | Core bundle-sale decrement deliberately ungated (shipped pre-flag) — card copy: gates the production surfaces |
| Accounting | `accounting_core` | `tier4/accounting.js` (~18 routes) | **LEAK**: sub-pages (ChartOfAccounts, JournalEntries, CreditDebitNotes, PostdatedCheques) have no inline flag guard — URL-reachable, backend 403s. Step 3 |
| Quotations & CRM | `crm_quotations` | `tier4/crm.js` | On by default |
| Customer Invoicing | `customer_invoicing` | `customer-invoices.js` | `payment_links` sub-flag → Bucket C |
| Marketing Campaigns | `marketing_campaigns` | `marketing.js` | `sms_campaigns` → Bucket C |
| Customer Messaging | `customer_messaging` | `messaging.js` | |
| Customer Notifications | `customer_notifications` | centrally in `services/customer-notify.notify()` | Channels degrade to configured providers (email works out of box) |
| Staff Scheduling | `phase2_scheduling` | `schedules.js` | |
| Advanced HR | `advanced_hr` | `tier4/hr.js` | |
| Forms (intake/waivers) | `custom_forms` | `forms.js` | |
| Packages & Passes | `packages_passes` | `packages.js` | depends_on: none hard; pairs with Appointments/Subscriptions in copy |
| Member Check-In | `member_checkin` | `members.js` | Flag-only (nav has no mode requirement, `nav-config.js:182`) |
| Price Books & Outlet Pricing | `phase2g_price_books`, `phase2_outlet_pricing`, `phase2_outlet_visibility`, `phase2_outlet_tax` | respective route files | Multi-outlet-seeded set; group as one "Multi-outlet pricing & visibility" card, sub-toggles |
| Catalog Automation | `phase2_smart_collections`, `phase2_scheduled_changes`, `phase2_item_suggestions` | respective files | One card, sub-toggles |
| POS Add-ons | `phase2g_omni_input`, `phase2g_variant_picker`, `phase2g_price_override`, `phase2g_per_line_restock`, `phase2g_receipt_barcode_lookup`, `phase2_pos_approvals` + **`phase2_pos_layouts` (Step 2 addition — was missing from this catalog; default ON, gates `pos-layouts.js` + `pos-devices.js`; classified as a sub_toggle)** | mostly frontend/posFlags + inline | One "POS power features" card, sub-toggles. Several have no backend enforcement — toggling only changes UI (fine, note in config) |
| Risk & Loss Controls | `phase2g_risk_controls`, `shift_auto_close`, `offline_returns`(D — see below) | `risk-controls.js`; workers flag-check ✅ | |
| Reports Add-ons | `reports_profit_layer`, `reports_exceptions`, `reports_inventory_health_plus`, `reports_scheduled_exports`, `reports_enhanced_filters`, `phase2_report_builder`, `retail_weekly_digest` | reports/* + worker (digest flag-checks ✅) | One "Advanced reports" card, sub-toggles |
| Approvals & Return Policies | `approvals`, `phase2_returns_policy` | `tier4/approvals.js`, `return-policies.js` | |
| Receipt Designer | `receipt_designer_v2` | frontend-only | Default ON |
| Label Designer | `phase2g_label_designer` | frontend-only | |
| AI Insights | `ai_insights` | soft DB-row check `insights-ai.js:30-37` | Platform key set; PUT writes a real row so the soft gate works. Cost-cap note in card copy |
| Supplier Payables / E-invoicing export / Backup | `supplier_payables`, `e_invoicing_export`, `backup_restore` | `grn.js`, `barcode-expenses.js` | Default ON; low-priority cards (may fold into an "Operations" card) |
| COD Reconciliation | `phase5_cod_reconciliation` | `fulfillment.js` | depends_on Couriers (C) in copy, soft |

## Bucket C — "Set up / Connect" cards (existing flows; NEVER a bare toggle)

| Card | Flag / gate | Existing setup flow to launch | Connected-state source |
|---|---|---|---|
| FBR Digital Invoicing | `fbr_integration` (DB-seeded, NOT in defaults — GET already unions DB-only keys, `registerAllRoutes.js:406-414`) | `/settings/fbr` | `company_profile` FBR config (NTN/token) |
| Marketplace Channels (Daraz / Meta / WhatsApp / Google) | `marketplace_integrations` | `/settings/integrations` hub | `integration_settings` credentials (hub already aggregates) |
| WooCommerce | connection check | existing Woo settings page | `woocommerce` connection row |
| Shopify | connection check (no flag — verified) | Shopify settings | `shopify_connections.is_active` |
| Couriers & Shipping | `phase5_shipping_automation` | `/settings/couriers` | `courier_integrations` credentials |
| Online Payments | `phase5_payment_gateways`, `payment_links`, `subscription_autocharge` | billing/integrations | platform env (`XPAY_API_KEY`) + tenant config |
| SMS Provider | `phase5_sms_providers`, `sms_campaigns` | integrations hub | provider credentials |
| Delivery Aggregators (foodpanda/Careem) | `delivery_aggregators` | integrations | webhook config; depends_on Restaurant |
| Room Channel Sync (OTA/iCal) | `room_channel_sync` | rooms settings | feed config; depends_on Rooms |

## Bucket D — NOT merchant-facing (super-admin only; excluded from the page)

| Flag | Why excluded |
|---|---|
| `context_selection_required`, `context_header_enforced`, `kiosk_context_locked` | Structural multi-outlet enforcement, read directly in `tenant-auth.js`/`resolveContext`; seeded by second-outlet trigger (`outlets.js:93-98`) |
| `multi_company` | Gates the Company Profile surface itself — self-disable could lock a tenant out of its own settings |
| `offline_returns` | Gated rollout flag (risky write path), platform decision |
| `notifications` | **Step 2 addition** — gates the core in-app notification center (`routes/tier4/notifications.js`, 4 requireFeature sites); self-disable would silently break the bell + cross-feature alerts. Was unclassified in the first draft of this catalog |
| `phase4_restaurant_preauth` | **Step 2 addition** — fully dormant: zero consumers anywhere in backend or frontend (only the defaults map + migration seed; `restaurant_preauth_holds` exists in DDL only). Reserved for when pre-auth ships |
| (plus the platform lock table itself — Step 6) | |

## Known leaks & worker gaps (input to PLAN Step 3)

1. **Workers without per-tenant flag/mode checks** (table-presence gated only — keep processing after module disable): `rental-overdue`, `room-overdue-checkout`, `night-audit`, `treatment-plan`, `channel-sync`, `kds-load-snapshot`, `course-release`, `booking-reminders` (inline), `reservation`/`reservation-reminder`, `hold-expiry`. Six workers already flag-check correctly (`anomaly`, `abc`, `expiry-alert`, `recall`, `shift-auto-close`, `retail-digest`) — copy their pattern.
2. **POS loyalty/wallet UI ignores `phase2g_loyalty`** (`POSContext.jsx:519` + `useLoyaltyWallet`) — only the admin tiers page self-guards.
3. **Accounting sub-pages** (ChartOfAccounts/JournalEntries/CreditDebitNotes/PostdatedCheques) URL-reachable with flag off (no inline guard; backend 403 is the stop).
4. **Report deep-links** `/reports/<slug>` render standalone with no flag guard (backend 403 is the stop).
5. **Routes are never flag-gated in the router** (`appRoutes.jsx` uses perm-only `perm()` helper) — hiding relies on nav filter + per-page inline self-guards. Acceptable pattern; just ensure every exposed module's page self-guards.
6. **Frontend refresh**: `useFeatureFlags` has no refresh API (localStorage cache); POS fetches flags separately; `PresetContext` fetches bootstrap once. Post-toggle propagation is designed in PLAN Step 9.
7. **`GET /api/feature-flags` "auth"** is only an `x-employee-id` header presence check (`registerAllRoutes.js:386-389`) — do NOT copy this pattern; the new endpoints use `requirePerm` properly. (The PUT sibling gets a catalog-managed-key restriction in PLAN Step 6; the GET's auth model stays as-is — pre-existing, out of scope.)

---

## Amendments (owner-approved 2026-07-10, second-opinion review)

These extend the catalog schema and rules above. PLAN.md Step 2 encodes them; the deferred
counterparts live in PLAN.md "Deferred to v2" (each deferral's data-model fingerprint ships in v1).

### 1. `scope` field (forward metadata — v1 enforces everything tenant-wide)

Every catalog entry carries `scope`, classifying how the module would activate once per-outlet
activation ships (deferred D1). No v1 behavior depends on it beyond card copy.

| Scope | Meaning (future) | Likely members |
|---|---|---|
| `tenant` | One state for the whole business | Accounting, Loyalty, Quotations & CRM, AI Insights, Advanced HR, Marketing, Messaging, Notifications, Approvals, Backup, Reports add-ons, Field Sales, Wholesale credit |
| `outlet` | Selected locations activate it | Restaurant, Rooms, Rentals, Appointments, Clinical, Service Tickets, Projects, Production, Batch & Expiry, Member Check-In, Multi-outlet pricing |
| `hybrid` | Installed company-wide, mapped/configured per outlet | Shopify, WooCommerce, Marketplace Channels, Couriers, Online Payments, SMS, Delivery Aggregators, Room Channel Sync, FBR |
| `device` | Outlet + terminal/device level | POS add-ons card, Customer Display-adjacent toggles, Receipt/Label designers |

Step 2 assigns the definitive value per card during re-verification — the table above is the
planning-time expectation, not the source of truth.

### 2. Card state enum (replaces bare on/off in the API)

`GET /api/business-modules` returns a computed `state` per card:

| State | Meaning | Derivation |
|---|---|---|
| `off` | Merchant hasn't enabled it | flags/mode off |
| `on` | Enabled and usable | flags/mode on (Bucket A/B) |
| `setup_required` | Bucket C card without working credentials/config | `connected_check` fails |
| `connected` | Bucket C card with stored credentials | `connected_check` passes |
| `locked` | Platform lock prevents self-enable | `platform_module_locks` row (global or per-tenant) |
| `attention_required` | Enabled but degraded (reserved — e.g. credential expiry, broken dependency) | defined per card as needed; may be unused in v1 |

### 3. Config preservation — `tenant_business_modules` (PLAN Step 5 migration)

Per-tenant-schema table: `module_key TEXT PRIMARY KEY, enabled BOOLEAN NOT NULL, saved_flags JSONB, updated_by TEXT, updated_at TIMESTAMPTZ DEFAULT NOW()`.

- **Disable**: snapshot the card's current flag values (bundle flags + sub_toggles) into `saved_flags`, then set them false. Mode row flips `enabled=false` (never DELETE).
- **Re-enable**: restore exactly the snapshot. Full registry-bundle defaults apply only on FIRST enable (no row / null snapshot).
- Consequence: a merchant's sub-toggle choices survive off/on cycles — "disabling preserves configuration" is enforceable, and D3 (sub-toggle editing UI) needs no schema work later.
- D1 fingerprint: this table later gains `default_outlet_enabled`, with an `outlet_business_modules` override table beside it.

### 4. `UNMANAGED_FLAGS` allowlist + bidirectional test

`backend/config/business-modules.js` exports `UNMANAGED_FLAGS`: the explicit list of
`DEFAULT_FEATURE_FLAGS` keys deliberately OUTSIDE the module system (Bucket D structural keys:
`context_selection_required`, `context_header_enforced`, `kiosk_context_locked`, `multi_company`,
`offline_returns`, plus whatever Step 2 finds). The Step 2 unit test asserts **every**
`DEFAULT_FEATURE_FLAGS` key is classified exactly once (module primary / bundle / sub_toggle /
Bucket C / Bucket D / UNMANAGED) and fails on any unclassified key — future features cannot ship
a flag outside the customer-choice system without an explicit decision.

### 5. Roles & permissions contract (PLAN Step 7)

- `backend/config/permissions-catalog.js`: every live permission string `{ id, label, category, module_key? }` + a test that every `requirePerm`/`requireAnyPerm` call-site string exists in it.
- New permission `manage_business_modules` — granted to NO default role (Administrators pass via `all_access`); the business-modules routes gate on it, making module management delegable without full admin.
- Each catalog card gains `permissions: []` (the perms that grant USE of the module); the GET payload derives `roles_with_access` per card for the enable-confirm line ("Staff roles that will gain access: …").
- **Invariant**: a module toggle never writes to `role_permissions`. Role assignments stay dormant while a module is off and work again on re-enable — same hide-not-delete principle as data.
- Verified pre-existing gaps this step also fixes: role editor's hardcoded 17-permission list (missing 11+ live perms — `AdministratorRedesign.jsx:16`), unvalidated `PUT /api/roles/:id/permissions`, unguarded `GET /api/roles` + `GET /api/roles/:id/permissions` (`roles.js:5,86`).
