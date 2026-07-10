"use strict";

/**
 * config/business-modules.js
 *
 * Single source of truth for the self-service "Business Modules" settings
 * page (docs/fable5/business-modules/FEATURE-CATALOG.md + PLAN.md).
 * Every DEFAULT_FEATURE_FLAGS key is classified exactly once — as a card
 * primary flag, a card sub_toggle, or a member of UNMANAGED_FLAGS. The
 * bidirectional test in tests/unit/business-modules-catalog.test.js fails
 * the build on any unclassified key, so a future feature cannot ship a flag
 * outside the customer-choice system without an explicit decision here.
 *
 * Buckets:
 *   A — vertical modules. Toggle flips the tenant_modes row AND the card's
 *       flag bundle atomically (mirrors routes/admin/tenants.js mode cascade).
 *   B — operational toggles. Flags only, no mode row.
 *   C — "Set up / Connect" cards. NEVER a bare toggle — the toggle endpoint
 *       rejects them (409 REQUIRES_SETUP); the UI routes to setup_route and
 *       state derives from connected_check.
 *
 * Card fields:
 *   bucket        "A" | "B" | "C"
 *   title         merchant-facing card title
 *   description   merchant-facing copy (includes caveats, e.g. gate-only)
 *   scope         "tenant" | "outlet" | "hybrid" | "device" — FORWARD METADATA
 *                 ONLY. v1 enforces everything tenant-wide; scope records how
 *                 the module would activate once per-outlet activation ships
 *                 (PLAN.md deferral D1) so the catalog needs no redesign then.
 *   mode          Bucket A only — the tenant_modes row this card owns
 *   flags         the flag bundle flipped together with the card
 *   sub_toggles   [{ key, title, depends_on?, note? }] — individually
 *                 toggleable children. NOT auto-enabled on card enable (they
 *                 keep their current/preset-seeded value); they are snapshot-
 *                 preserved on disable and remain writable via the legacy
 *                 PUT /api/feature-flags/:key endpoint (v1 has no sub-toggle
 *                 editing UI — PLAN.md deferral D3).
 *   depends_on    card keys that must be enabled first (simple, no cycles)
 *   impact_queries named COUNT queries run against the tenant schema for the
 *                 disable-direction warn+confirm dialog
 *   setup_route / connected_check / setup_required_when   Bucket C only
 *
 * State enum (MODULE_STATES) — computed per card by GET /api/business-modules:
 *   off                merchant hasn't enabled it (flags/mode off)
 *   on                 enabled and usable (Bucket A: tenant_modes row enabled,
 *                      falling back to the primary flag when the tenant has no
 *                      mode rows yet; Bucket B: any primary flag on)
 *   setup_required     Bucket C card whose connected_check fails — the feature
 *                      flag may even be on, but without credentials/config the
 *                      surface cannot do anything (see setup_required_when)
 *   connected          Bucket C card whose connected_check passes
 *   locked             platform_module_locks row (global or per-tenant)
 *                      prevents tenant self-enable
 *   attention_required enabled but degraded (reserved — e.g. credential
 *                      expiry, broken dependency; may be unused in v1)
 */

const MODULE_STATES = Object.freeze({
  OFF: "off",
  ON: "on",
  SETUP_REQUIRED: "setup_required",
  CONNECTED: "connected",
  LOCKED: "locked",
  ATTENTION_REQUIRED: "attention_required",
});

const VALID_SCOPES = Object.freeze(["tenant", "outlet", "hybrid", "device"]);

// Flags deliberately NOT in DEFAULT_FEATURE_FLAGS (DB-seeded per country pack
// / migration). Valid catalog members; the existence test accepts them.
const DB_ONLY_FLAGS = Object.freeze(["fbr_integration"]);

// ─────────────────────────────────────────────────────────────────────────────
// Bucket A — vertical modules (mode row + registry flag bundle, atomically)
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET_A = {
  restaurant: {
    bucket: "A",
    title: "Restaurant",
    description:
      "Floor plans, tables, checks, kitchen display, tabs, reservations, menu engineering. " +
      "Note: enabling this on a non-restaurant business keeps your current POS layout — " +
      "the floor plan, checks and KDS pages fully work, but the till itself is not reskinned.",
    scope: "outlet",
    mode: "restaurant",
    // MODE_REGISTRY.restaurant.feature_flags_to_enable, verified 2026-07-10.
    flags: [
      "phase4_restaurant",
      "phase4_restaurant_kds",
      "phase4_restaurant_qr",
      "phase4_restaurant_86",
      "phase4_restaurant_void_comp",
      "phase4_restaurant_pay_at_table",
      "phase4_restaurant_reservations",
      "phase4_restaurant_kds_analytics",
      "phase4_restaurant_day_parting",
      "phase4_restaurant_fire_chits",
      "phase4_restaurant_seats",
      "phase4_restaurant_drive_thru",
      "phase4_restaurant_menu_engineering",
    ],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {
      open_table_sessions: {
        label: "Open table sessions",
        sql: "SELECT COUNT(*)::int AS count FROM restaurant_table_sessions WHERE status NOT IN ('closed')",
      },
      open_tabs: {
        label: "Open tabs",
        sql: "SELECT COUNT(*)::int AS count FROM restaurant_tabs WHERE status = 'open'",
      },
    },
  },

  appointments: {
    bucket: "A",
    title: "Appointments & Booking",
    description:
      "Appointment calendar, service booking, staff schedules, reminders and a public booking page.",
    scope: "outlet",
    mode: "appointments",
    flags: ["phase4_appointments"],
    sub_toggles: [
      { key: "phase4_appointments_classes", title: "Group classes & timetable" },
      { key: "phase4_appointments_waitlists", title: "Waitlists on full slots" },
      { key: "phase4_appointments_resources", title: "Bookable resources (rooms, chairs, equipment)" },
    ],
    depends_on: [],
    impact_queries: {
      upcoming_appointments: {
        label: "Upcoming appointments",
        sql: "SELECT COUNT(*)::int AS count FROM appointments WHERE status IN ('pending','confirmed') AND start_at >= NOW()",
      },
    },
  },

  subscriptions_memberships: {
    bucket: "A",
    title: "Subscriptions & Memberships",
    description:
      "Recurring billing plans, memberships and renewal tracking. Automatic card charging is a separate " +
      "Online Payments setup.",
    scope: "tenant",
    mode: "subscriptions",
    flags: ["subscription_billing"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {
      active_subscriptions: {
        label: "Active subscriptions",
        sql: "SELECT COUNT(*)::int AS count FROM customer_subscriptions WHERE status = 'active'",
      },
    },
  },

  rentals: {
    bucket: "A",
    title: "Rentals",
    description:
      "Rental contracts, asset check-out and return, late fees and condition inspections.",
    scope: "outlet",
    mode: "rentals",
    // registry bundle [phase4_rentals] + the rental-preset extra (PRESET_EXTRA_FLAGS).
    flags: ["phase4_rentals", "rental_inspections"],
    sub_toggles: [
      {
        key: "rental_online_booking",
        title: "Public online rental booking",
        note: "Exposes a public booking surface — confirm before enabling.",
      },
    ],
    depends_on: [],
    impact_queries: {
      checked_out_contracts: {
        label: "Contracts currently checked out",
        sql: "SELECT COUNT(*)::int AS count FROM rental_contracts WHERE status = 'checked_out'",
      },
    },
  },

  rooms_lodging: {
    bucket: "A",
    title: "Rooms & Lodging",
    description:
      "Room inventory, bookings, folios, check-in/check-out, night audit and guest registration.",
    scope: "outlet",
    mode: "room_management",
    // registry bundle [phase4_room_management] + lodging-preset extra.
    // room_channel_sync is deliberately NOT here — it is a Bucket C card.
    flags: ["phase4_room_management", "room_guest_registration"],
    sub_toggles: [
      {
        key: "room_online_booking",
        title: "Public direct room booking",
        note: "Exposes a public booking surface — confirm before enabling.",
      },
    ],
    depends_on: [],
    impact_queries: {
      active_bookings: {
        label: "Active bookings & in-house stays",
        sql: "SELECT COUNT(*)::int AS count FROM room_bookings WHERE status IN ('reserved','confirmed','checked_in')",
      },
    },
  },

  clinical: {
    bucket: "A",
    title: "Clinical / Treatment Plans",
    description:
      "Multi-visit treatment plans, charting, lab orders, consent forms, patient recalls and folios.",
    scope: "outlet",
    mode: "treatment_plans",
    // registry bundle [phase4_treatment_plans] + clinical-preset extra.
    flags: ["phase4_treatment_plans", "clinical_recalls"],
    sub_toggles: [
      { key: "vet_vaccinations", title: "Vaccination tracking (veterinary)" },
      { key: "clinical_handouts", title: "Patient handout library (physiotherapy)" },
    ],
    depends_on: [],
    impact_queries: {
      active_plans: {
        label: "Active treatment plans",
        sql: "SELECT COUNT(*)::int AS count FROM treatment_plans WHERE status IN ('active','on_hold')",
      },
    },
  },

  service_tickets: {
    bucket: "A",
    title: "Service Tickets (Repair)",
    description:
      "Repair and alteration job tickets — intake, status board, deposits and final invoicing.",
    scope: "outlet",
    mode: "workflow_tickets",
    flags: ["phase4_workflow_tickets"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {
      open_tickets: {
        label: "Open tickets",
        sql: "SELECT COUNT(*)::int AS count FROM service_tickets WHERE status IN ('intake','approved','in_progress','on_hold')",
      },
    },
  },

  projects_contracts: {
    bucket: "A",
    title: "Projects & Contracts",
    description:
      "Service projects with milestones, activity log, contracts with e-sign flow and milestone invoicing.",
    scope: "outlet",
    mode: "service_projects",
    flags: ["phase4_service_projects", "phase4_service_contracts"],
    sub_toggles: [
      {
        key: "phase4_contract_ai",
        title: "AI contract drafting",
        note: "Uses the platform AI service; subject to platform cost caps.",
      },
    ],
    depends_on: [],
    impact_queries: {
      active_projects: {
        label: "Active projects",
        sql: "SELECT COUNT(*)::int AS count FROM service_projects WHERE status IN ('draft','active','on_hold')",
      },
      open_contracts: {
        label: "Contracts awaiting signature",
        sql: "SELECT COUNT(*)::int AS count FROM contracts WHERE status IN ('draft','sent','viewed')",
      },
    },
  },

  commissions: {
    bucket: "A",
    title: "Commissions",
    description:
      "Commission plans and per-employee commission tracking on sales and services.",
    scope: "tenant",
    mode: "commissions",
    // No requireMode("commissions") call site exists (flag-gated only) — the
    // mode row is still written for registry consistency, matching the
    // super-admin cascade.
    flags: ["phase2_commissions"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  wholesale_credit: {
    bucket: "A",
    title: "Wholesale / B2B Credit",
    description:
      "Customer credit limits, payment terms, on-account sales, AR aging and statements. " +
      "Optional extras: trade schemes, backorders, van sales and the manufacturer partner portal.",
    scope: "tenant",
    mode: "wholesale",
    // No requireMode("wholesale") call site (inline credit/promo enforcement,
    // verified) — mode row written for registry consistency.
    flags: ["wholesale_credit_controls"],
    sub_toggles: [
      { key: "wholesale_schemes", title: "Trade schemes (slab/tier discounts)" },
      { key: "wholesale_backorders", title: "Backorders & partial fulfillment" },
      {
        key: "wholesale_van_sales",
        title: "Van sales (sell from vehicle stock)",
        depends_on: ["field_sales"],
      },
      { key: "wholesale_secondary_sales", title: "Manufacturer partner portal" },
    ],
    depends_on: [],
    impact_queries: {
      customers_with_credit: {
        label: "Customers with a credit limit",
        sql: "SELECT COUNT(*)::int AS count FROM customers WHERE COALESCE(credit_limit, 0) > 0 AND deleted_at IS NULL",
      },
    },
  },

  field_sales: {
    bucket: "A",
    title: "Field Sales (Mobile Reps)",
    description:
      "Mobile order-booker app — daily routes, GPS check-in at the shop, order capture and visit reports. " +
      "Works out of the box with default geofence settings.",
    scope: "tenant",
    mode: null, // flag-only vertical — no tenant_modes row
    flags: ["wholesale_field_sales"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {
      field_reps: {
        label: "Field rep employees",
        sql: "SELECT COUNT(*)::int AS count FROM employees WHERE employee_type = 'field_rep' AND deleted_at IS NULL",
      },
      open_visits: {
        label: "Planned or in-progress visits",
        sql: "SELECT COUNT(*)::int AS count FROM field_visits WHERE status IN ('planned','checked_in')",
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bucket B — operational toggles (flags only)
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET_B = {
  gift_cards: {
    bucket: "B",
    title: "Gift Cards",
    description: "Sell and redeem gift cards at the till; balances tracked per card.",
    scope: "tenant",
    flags: ["phase2g_gift_cards"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {
      outstanding_gift_cards: {
        label: "Active gift cards with balance",
        sql: "SELECT COUNT(*)::int AS count FROM gift_cards WHERE status = 'active' AND COALESCE(remaining_value, 0) > 0",
      },
    },
  },

  loyalty: {
    bucket: "B",
    title: "Loyalty & Points",
    description:
      "Customer points, tiers and wallet redemption at checkout. Balances are kept when disabled.",
    scope: "tenant",
    flags: ["phase2g_loyalty"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {
      customers_with_points: {
        label: "Customers holding points",
        sql: "SELECT COUNT(*)::int AS count FROM customers WHERE COALESCE(loyalty_points, 0) > 0 AND deleted_at IS NULL",
      },
    },
  },

  holds_layaway: {
    bucket: "B",
    title: "Holds & Layaway",
    description: "Put items on hold or layaway with deposits and expiry handling.",
    scope: "outlet",
    flags: ["phase2g_holds"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {
      active_holds: {
        label: "Active holds/layaways",
        sql: "SELECT COUNT(*)::int AS count FROM holds WHERE status = 'active'",
      },
    },
  },

  draft_orders: {
    bucket: "B",
    title: "Draft Orders",
    description:
      "Save in-progress orders and complete them later. Required plumbing for restaurant checks.",
    scope: "outlet",
    flags: ["phase2_draft_orders"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {
      open_drafts: {
        label: "Open draft orders",
        sql: "SELECT COUNT(*)::int AS count FROM draft_orders WHERE status IN ('open','claimed')",
      },
    },
  },

  serialized_inventory: {
    bucket: "B",
    title: "Serialized Inventory",
    description:
      "Track individual serial numbers (IMEI, warranty items) from receiving through sale. " +
      "Gates the POS serial-capture UI; per-product enforcement via the product's serial-required setting.",
    scope: "tenant",
    flags: ["phase2g_serialized_inventory"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  inventory_intelligence: {
    bucket: "B",
    title: "Inventory Intelligence",
    description: "ABC classification, cycle counts, sales velocity, reorder suggestions.",
    scope: "tenant",
    flags: ["phase2g_inventory_intelligence"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  batch_expiry: {
    bucket: "B",
    title: "Batch & Expiry Tracking",
    description:
      "Lot/batch capture at receiving, first-expired-first-out consumption and expiring-soon alerts. " +
      "Only products you mark as batch-tracked are affected.",
    scope: "outlet",
    flags: ["batch_expiry_tracking"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  production_kit_bom: {
    bucket: "B",
    title: "Production (Kits & Recipes)",
    description:
      "Production screen, recipe costing and assembled products. Basic bundle products keep working " +
      "at the till even with this off — this gates the production surfaces.",
    scope: "outlet",
    flags: ["kit_bom_engine"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  accounting: {
    bucket: "B",
    title: "Accounting",
    description:
      "Chart of accounts, journal entries, credit/debit notes, postdated cheques and financial statements.",
    scope: "tenant",
    flags: ["accounting_core"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  quotations_crm: {
    bucket: "B",
    title: "Quotations & CRM",
    description: "Customer quotations with convert-to-sale, plus CRM notes and follow-ups.",
    scope: "tenant",
    flags: ["crm_quotations"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  customer_invoicing: {
    bucket: "B",
    title: "Customer Invoicing",
    description:
      "B2B invoices with balances, reminders and statements. Online payment links are part of the " +
      "Online Payments setup.",
    scope: "tenant",
    flags: ["customer_invoicing"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {
      unpaid_invoices: {
        label: "Invoices with outstanding balance",
        sql: "SELECT COUNT(*)::int AS count FROM customer_invoices WHERE COALESCE(balance_due, 0) > 0",
      },
    },
  },

  marketing_campaigns: {
    bucket: "B",
    title: "Marketing Campaigns",
    description:
      "Audience filters and campaign sends (email out of the box; SMS needs the SMS Provider setup).",
    scope: "tenant",
    flags: ["marketing_campaigns"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  customer_messaging: {
    bucket: "B",
    title: "Customer Messaging",
    description: "Two-way message inbox with customers (WhatsApp threads land here when connected).",
    scope: "tenant",
    flags: ["customer_messaging"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  customer_notifications: {
    bucket: "B",
    title: "Customer Notifications",
    description:
      "Automatic status updates to customers (ticket ready, booking reminder). Email works out of the " +
      "box; SMS/WhatsApp use whatever providers you have connected.",
    scope: "tenant",
    flags: ["customer_notifications"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  staff_scheduling: {
    bucket: "B",
    title: "Staff Scheduling",
    description: "Shift rosters and staff schedules.",
    scope: "tenant",
    flags: ["phase2_scheduling"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  advanced_hr: {
    bucket: "B",
    title: "Advanced HR",
    description: "Leave management, payroll generation and HR records.",
    scope: "tenant",
    flags: ["advanced_hr"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  custom_forms: {
    bucket: "B",
    title: "Forms (Intake & Waivers)",
    description: "Custom intake forms, waivers and questionnaires attached to customers and visits.",
    scope: "tenant",
    flags: ["custom_forms"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  packages_passes: {
    bucket: "B",
    title: "Packages & Passes",
    description:
      "Prepaid session packages and class passes. Pairs well with Appointments and Memberships.",
    scope: "tenant",
    flags: ["packages_passes"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {
      active_packages: {
        label: "Active customer packages",
        sql: "SELECT COUNT(*)::int AS count FROM customer_packages WHERE status = 'active'",
      },
    },
  },

  member_checkin: {
    bucket: "B",
    title: "Member Check-In",
    description: "Door check-in kiosk with active-membership validation.",
    scope: "outlet",
    flags: ["member_checkin"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  multi_outlet_pricing: {
    bucket: "B",
    title: "Multi-Outlet Pricing & Visibility",
    description:
      "Price books plus per-outlet pricing, product visibility and tax profiles. Seeded automatically " +
      "when you add a second location.",
    scope: "outlet",
    flags: ["phase2g_price_books"],
    sub_toggles: [
      { key: "phase2_outlet_pricing", title: "Per-outlet prices" },
      { key: "phase2_outlet_visibility", title: "Per-outlet product visibility" },
      { key: "phase2_outlet_tax", title: "Per-outlet tax profiles" },
    ],
    depends_on: [],
    impact_queries: {},
  },

  catalog_automation: {
    bucket: "B",
    title: "Catalog Automation",
    description: "Smart collections, scheduled price/status changes and reorder-item suggestions.",
    scope: "tenant",
    flags: ["phase2_smart_collections", "phase2_scheduled_changes"],
    sub_toggles: [
      { key: "phase2_item_suggestions", title: "Item suggestions" },
    ],
    depends_on: [],
    impact_queries: {},
  },

  pos_addons: {
    bucket: "B",
    title: "POS Power Features",
    description:
      "Omni search input, variant matrix picker, price override with manager PIN, per-line restock on " +
      "returns, receipt barcode lookup, POS approvals and per-device quick layouts. Several of these " +
      "are till-UI features without separate server enforcement.",
    scope: "device",
    flags: [
      "phase2g_omni_input",
      "phase2g_variant_picker",
      "phase2g_price_override",
      "phase2g_per_line_restock",
      "phase2g_receipt_barcode_lookup",
      "phase2_pos_approvals",
    ],
    sub_toggles: [
      // Drift fix 2026-07-10: phase2_pos_layouts (default ON, gates
      // routes/pos-layouts.js + routes/pos-devices.js) was missing from
      // FEATURE-CATALOG.md — classified here as a POS add-on child.
      { key: "phase2_pos_layouts", title: "Per-device quick grid layouts" },
    ],
    depends_on: [],
    impact_queries: {},
  },

  risk_loss_controls: {
    bucket: "B",
    title: "Risk & Loss Controls",
    description: "Anomaly alerts, shrinkage tracking and automatic shift close.",
    scope: "tenant",
    flags: ["phase2g_risk_controls", "shift_auto_close"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  reports_addons: {
    bucket: "B",
    title: "Advanced Reports",
    description:
      "Profit layer, exception reports, inventory health, scheduled exports, enhanced filters and the " +
      "custom report builder.",
    scope: "tenant",
    flags: [
      "reports_profit_layer",
      "reports_exceptions",
      "reports_inventory_health_plus",
      "reports_scheduled_exports",
      "reports_enhanced_filters",
      "phase2_report_builder",
    ],
    sub_toggles: [
      { key: "retail_weekly_digest", title: "Weekly owner digest email" },
    ],
    depends_on: [],
    impact_queries: {},
  },

  approvals_return_policies: {
    bucket: "B",
    title: "Approvals & Return Policies",
    description: "Manager approval policies for discounts/voids/returns, plus return policy windows.",
    scope: "tenant",
    flags: ["approvals", "phase2_returns_policy"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  receipt_designer: {
    bucket: "B",
    title: "Receipt Designer",
    description: "Customize receipt layout, sections and branding.",
    scope: "device",
    flags: ["receipt_designer_v2"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  label_designer: {
    bucket: "B",
    title: "Label Designer",
    description: "Design and print product/barcode labels.",
    scope: "device",
    flags: ["phase2g_label_designer"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  ai_insights: {
    bucket: "B",
    title: "AI Insights",
    description:
      "Ask questions about your business in plain language and get AI-generated answers from your data. " +
      "Subject to platform usage caps.",
    scope: "tenant",
    flags: ["ai_insights"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  operations: {
    bucket: "B",
    title: "Operations",
    description: "Supplier payables, e-invoicing CSV export and tenant data backup/export.",
    scope: "tenant",
    flags: ["supplier_payables", "e_invoicing_export", "backup_restore"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },

  cod_reconciliation: {
    bucket: "B",
    title: "COD Reconciliation",
    description:
      "Cash-on-delivery settlement tracking against courier payouts. Most useful together with the " +
      "Couriers & Shipping connection.",
    scope: "tenant",
    flags: ["phase5_cod_reconciliation"],
    // Deliberately no hard depends_on: the prerequisite would be a Bucket C
    // card, which the toggle path cannot auto-enable (409 REQUIRES_SETUP).
    // The pairing lives in the description copy instead.
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bucket C — "Set up / Connect" cards (never a bare toggle)
//
// connected_check: { type: "query", sql } — sql returns one row with a boolean
// `connected` column, run against the tenant schema — or { type: "env", env }
// for platform-level capability checks.
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET_C = {
  fbr_digital_invoicing: {
    bucket: "C",
    title: "FBR Digital Invoicing",
    description:
      "Real-time invoice reporting to FBR (Pakistan). Requires your NTN and FBR API token.",
    scope: "hybrid",
    // DB-seeded key, deliberately NOT in DEFAULT_FEATURE_FLAGS.
    flags: ["fbr_integration"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
    setup_route: "/settings/fbr",
    setup_required_when: "No NTN or FBR API token saved in the company profile.",
    connected_check: {
      type: "query",
      sql: "SELECT (COALESCE(ntn, '') <> '' AND COALESCE(fbr_api_token, '') <> '') AS connected FROM company_profile WHERE id = 1",
    },
  },

  marketplace_channels: {
    bucket: "C",
    title: "Marketplace Channels",
    description: "Sell on Daraz, Facebook/Instagram, WhatsApp and Google — sync products, stock and orders.",
    scope: "hybrid",
    flags: ["marketplace_integrations"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
    setup_route: "/settings/integrations",
    setup_required_when: "No active marketplace credentials saved in the Integrations Hub.",
    connected_check: {
      type: "query",
      sql: "SELECT COUNT(*) > 0 AS connected FROM integration_settings WHERE category = 'marketplace' AND is_active = true",
    },
  },

  woocommerce: {
    bucket: "C",
    title: "WooCommerce",
    description: "Connect your WooCommerce store — import products and sync stock.",
    scope: "hybrid",
    flags: [], // connection-checked, no feature flag (verified)
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
    setup_route: "/integrations/woocommerce",
    setup_required_when: "No WooCommerce credentials saved.",
    connected_check: {
      type: "query",
      sql: "SELECT COUNT(*) > 0 AS connected FROM integration_settings WHERE provider = 'woocommerce' AND is_active = true",
    },
  },

  shopify: {
    bucket: "C",
    title: "Shopify",
    description: "Connect your Shopify store — import products, sync stock and orders.",
    scope: "hybrid",
    flags: [], // connection-checked, no feature flag (verified)
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
    setup_route: "/integrations/shopify",
    setup_required_when: "No active Shopify connection.",
    connected_check: {
      type: "query",
      sql: "SELECT COUNT(*) > 0 AS connected FROM shopify_connections WHERE is_active = true",
    },
  },

  couriers_shipping: {
    bucket: "C",
    title: "Couriers & Shipping",
    description:
      "Book shipments and track deliveries with Pakistani and international couriers (TCS, Leopards, " +
      "PostEx, DHL and more). Requires courier account credentials.",
    scope: "hybrid",
    flags: ["phase5_shipping_automation"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
    setup_route: "/courier-settings",
    setup_required_when: "No courier enabled with API credentials.",
    connected_check: {
      type: "query",
      sql: "SELECT COUNT(*) > 0 AS connected FROM courier_integrations WHERE enabled = true AND COALESCE(api_key, '') <> ''",
    },
  },

  online_payments: {
    bucket: "C",
    title: "Online Payments",
    description:
      "Accept online card payments, payment links on invoices and automatic subscription charging. " +
      "Availability depends on the platform payment gateway.",
    scope: "hybrid",
    flags: ["phase5_payment_gateways", "payment_links", "subscription_autocharge"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
    setup_route: "/billing",
    setup_required_when: "The platform payment gateway is not configured (no gateway key).",
    connected_check: { type: "env", env: "XPAY_API_KEY" },
  },

  sms_provider: {
    bucket: "C",
    title: "SMS Provider",
    description:
      "Connect an SMS provider (Zong, Jazz, Twilio or generic HTTP) to send campaign and reminder texts.",
    scope: "hybrid",
    flags: ["phase5_sms_providers", "sms_campaigns"],
    sub_toggles: [],
    depends_on: [],
    impact_queries: {},
    setup_route: "/settings/integrations",
    setup_required_when: "No active SMS provider credentials saved.",
    connected_check: {
      type: "query",
      sql: "SELECT COUNT(*) > 0 AS connected FROM integration_settings WHERE category = 'sms' AND is_active = true",
    },
  },

  delivery_aggregators: {
    bucket: "C",
    title: "Delivery Aggregators",
    description:
      "Receive foodpanda / Careem orders straight into your order inbox. Requires store IDs and webhook " +
      "secrets from the platform.",
    scope: "hybrid",
    flags: ["delivery_aggregators"],
    sub_toggles: [],
    depends_on: ["restaurant"],
    impact_queries: {},
    setup_route: "/settings/integrations",
    setup_required_when: "No active aggregator (foodpanda/Careem) integration saved.",
    connected_check: {
      type: "query",
      sql: "SELECT COUNT(*) > 0 AS connected FROM integration_settings WHERE provider IN ('foodpanda','careem') AND is_active = true",
    },
  },

  room_channel_sync: {
    bucket: "C",
    title: "Room Channel Sync (OTA / iCal)",
    description:
      "Sync room availability with booking channels via iCal feeds to prevent double-bookings.",
    scope: "hybrid",
    flags: ["room_channel_sync"],
    sub_toggles: [],
    depends_on: ["rooms_lodging"],
    impact_queries: {},
    setup_route: "/rooms",
    setup_required_when: "No channel feed configured for any room.",
    connected_check: {
      type: "query",
      sql: "SELECT COUNT(*) > 0 AS connected FROM room_channel_feeds",
    },
  },
};

const BUSINESS_MODULES = Object.freeze({
  ...BUCKET_A,
  ...BUCKET_B,
  ...BUCKET_C,
});

// ─────────────────────────────────────────────────────────────────────────────
// UNMANAGED_FLAGS — DEFAULT_FEATURE_FLAGS keys deliberately OUTSIDE the module
// system (Bucket D). These never appear on the Business Modules page and stay
// writable via the legacy PUT /api/feature-flags/:key + super-admin tooling.
// Value = the reason for exclusion (surfaced in tests/docs, not to merchants).
// ─────────────────────────────────────────────────────────────────────────────

const UNMANAGED_FLAGS = Object.freeze({
  context_selection_required:
    "Structural multi-outlet enforcement read by tenant-auth/resolveContext; seeded by the second-outlet trigger.",
  context_header_enforced:
    "Structural multi-outlet enforcement read by tenant-auth/resolveContext; seeded by the second-outlet trigger.",
  kiosk_context_locked:
    "Structural kiosk enforcement; deliberate opt-in even after multi-outlet upgrade.",
  multi_company:
    "Gates the Company Profile surface itself — self-disable could lock a tenant out of its own settings.",
  offline_returns:
    "Gated-rollout flag on a risky write path; platform decision, not a merchant choice.",
  notifications:
    "Gates the core in-app notification center (routes/tier4/notifications.js) — self-disable would silently break the notification bell and cross-feature alerts.",
  phase4_restaurant_preauth:
    "Dormant/reserved — no consumer anywhere in code (restaurant_preauth_holds table exists in DDL only). Revisit when pre-auth ships.",
});

// ─────────────────────────────────────────────────────────────────────────────
// Derivations
// ─────────────────────────────────────────────────────────────────────────────

/** All flag keys a card manages (primary bundle + sub_toggles). */
function cardManagedFlags(card) {
  return [...card.flags, ...card.sub_toggles.map((s) => s.key)];
}

/**
 * Classify a flag key. Returns one of:
 *   { role: "primary", module_key }   — in a card's flag bundle
 *   { role: "sub_toggle", module_key }
 *   { role: "unmanaged" }             — UNMANAGED_FLAGS member
 *   null                              — unknown key (not catalog-managed)
 */
function classifyFlag(flagKey) {
  for (const [key, card] of Object.entries(BUSINESS_MODULES)) {
    if (card.flags.includes(flagKey)) return { role: "primary", module_key: key };
    if (card.sub_toggles.some((s) => s.key === flagKey)) {
      return { role: "sub_toggle", module_key: key };
    }
  }
  if (Object.prototype.hasOwnProperty.call(UNMANAGED_FLAGS, flagKey)) {
    return { role: "unmanaged" };
  }
  return null;
}

/**
 * Keys the legacy PUT /api/feature-flags/:key endpoint must REJECT once the
 * PLAN Step 6 lockdown lands: module primary flags. Sub_toggles and
 * UNMANAGED_FLAGS keys remain legacy-writable.
 */
function isCatalogManagedFlag(flagKey) {
  const c = classifyFlag(flagKey);
  return !!c && c.role === "primary";
}

/**
 * Module keys recommended for a tenant's industry preset — derived from
 * services/preset-apply.js expectedFlagsForPreset (mode flags + preset extras
 * + signup bundles + multi-outlet bundle) plus the preset's mode list.
 */
function presetRecommendedModules(industryType, { outletCount = 1 } = {}) {
  // Lazy requires: keep this config importable without pulling the service
  // graph at module-load time (mirrors preset-apply's own lazy require).
  const { expectedFlagsForPreset } = require("../services/preset-apply");
  const { getPreset } = require("./industry-config");
  const expected = new Set(expectedFlagsForPreset(industryType, { outletCount }));
  const preset = getPreset(industryType);
  const recommended = [];
  for (const [key, card] of Object.entries(BUSINESS_MODULES)) {
    const byMode = card.mode && preset.modes.includes(card.mode);
    const byFlag = cardManagedFlags(card).some((f) => expected.has(f));
    if (byMode || byFlag) recommended.push(key);
  }
  return recommended.sort();
}

module.exports = {
  MODULE_STATES,
  VALID_SCOPES,
  DB_ONLY_FLAGS,
  BUSINESS_MODULES,
  UNMANAGED_FLAGS,
  cardManagedFlags,
  classifyFlag,
  isCatalogManagedFlag,
  presetRecommendedModules,
};
