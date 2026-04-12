# Feature Flags Reference

Last updated: Apr 13 2026

---

## How the System Works

- All flags live in `backend/middleware/feature-flags.js` → `DEFAULT_FEATURE_FLAGS`
- DB overrides per tenant in `feature_flags` table (tenant schema)
- Super-admin can toggle per tenant at `/admin` → tenant detail → feature flags
- When a flag is OFF, the API returns `503 Feature disabled` for that route
- Cache: 60 seconds per tenant — changes take up to 1 minute to apply

---

## Group 1 — Core Features (9 flags)

These gate entire feature domains at the API level. If turned off, the whole feature becomes inaccessible (503). All are ON by default and ON for packagesmall.

| Flag | Default | What it gates |
|------|---------|--------------|
| `backup_restore` | on | Backup & restore |
| `e_invoicing_export` | on | FBR CSV export in reports |
| `supplier_payables` | on | Supplier payables |
| `approvals` | on | Approvals workflow |
| `notifications` | on | In-app notifications |
| `accounting_core` | on | Chart of accounts, journal entries, credit/debit notes, postdated cheques |
| `crm_quotations` | on | CRM + quotations |
| `advanced_hr` | on | HR management |
| `multi_company` | on | Multi-company |

---

## Group 2 — Reports (5 flags)

All OFF by default. Safe to enable — no external dependencies.

| Flag | Default | What it gates |
|------|---------|--------------|
| `reports_enhanced_filters` | off | Better filter UI on report pages |
| `reports_profit_layer` | off | Profit breakdown in sales reports |
| `reports_inventory_health_plus` | off | Extended inventory health report |
| `reports_exceptions` | off | Anomaly/exceptions report |
| `reports_scheduled_exports` | off | Scheduled report delivery |

---

## Group 3 — Context & Kiosk (3 flags)

**Leave these OFF** unless you specifically need them. They change core login and API behaviour and can break things.

| Flag | Default | What it does |
|------|---------|-------------|
| `context_selection_required` | off | Forces outlet/employee selection on every login |
| `context_header_enforced` | off | Blocks API calls missing context headers |
| `kiosk_context_locked` | off | Locks kiosk to a specific outlet |

---

## Group 4 — Integrations (1 flag)

| Flag | Default | What it gates |
|------|---------|--------------|
| `marketplace_integrations` | on | Daraz, Facebook, WhatsApp, Google Merchant + Integrations Hub |

---

## Group 5 — Phase 2 Operational Depth (13 flags)

| Flag | Default | What it gates |
|------|---------|--------------|
| `phase2_scheduling` | on | Workforce scheduling |
| `phase2_returns_policy` | on | Return policies |
| `phase2_smart_collections` | on | Smart collections |
| `phase2_outlet_tax` | on | Outlet tax profiles |
| `phase2_scheduled_changes` | on | Scheduled catalog changes |
| `phase2_report_builder` | on | Custom report builder |
| `phase2_pos_layouts` | on | POS tile layout customization |
| `phase2_outlet_pricing` | off | Price lists per outlet — safe to enable |
| `phase2_draft_orders` | off | POS park-to-draft — safe to enable |
| `phase2_pos_approvals` | off | Manager approval flow in POS — safe to enable |
| `phase2_commissions` | off | Commission plans + earnings — safe to enable |
| `phase2_item_suggestions` | off | Product affinity suggestions in POS — safe to enable |
| `phase2_outlet_visibility` | off | Hide products per outlet — safe to enable |

---

## Group 6 — Phase 3 Marketing & Messaging (7 flags)

| Flag | Default | What it gates |
|------|---------|--------------|
| `marketing_campaigns` | on | Marketing campaigns |
| `customer_messaging` | on | Messaging inbox |
| `customer_invoicing` | on | Customer invoicing |
| `subscription_billing` | on | Customer subscription plans |
| `payment_links` | off | Payment links on invoices — safe to enable |
| `sms_campaigns` | off | SMS campaign sends — needs SMS provider first |
| `subscription_autocharge` | off | Auto-charge renewals — needs payment gateway first |

---

## Group 7 — Phase 4 Restaurant, Bookings & Services (11 flags)

| Flag | Default | What it gates |
|------|---------|--------------|
| `phase4_restaurant` | on | Restaurant floor, tables, sessions, checks |
| `phase4_restaurant_kds` | on | Kitchen Display System |
| `phase4_appointments` | on | Booking services + appointments |
| `phase4_service_projects` | on | Service projects |
| `phase4_service_contracts` | on | Contracts |
| `phase4_restaurant_qr` | off | Public QR menu — safe to enable |
| `phase4_restaurant_preauth` | off | Card preauth tabs — safe to enable |
| `phase4_appointments_waitlists` | off | Appointment waitlists — safe to enable |
| `phase4_appointments_classes` | off | Class/group bookings — safe to enable |
| `phase4_contract_ai` | off | AI contract analysis — needs `ANTHROPIC_API_KEY` on Railway |
| `phase4_google_calendar_sync` | off | Google Calendar sync — needs Google OAuth credentials |

---

## Group 8 — Phase 5 Pakistan (4 flags)

All OFF. Need external configuration before enabling.

| Flag | Default | What it needs |
|------|---------|--------------|
| `phase5_shipping_automation` | off | Courier API keys configured |
| `phase5_cod_reconciliation` | off | Courier COD CSV format configured |
| `phase5_payment_gateways` | off | `PAYMENT_GATEWAY=xpay` + `XPAY_API_KEY` on Railway |
| `phase5_sms_providers` | off | SMS provider credentials |

---

## FBR Integration (special — not in DEFAULT_FEATURE_FLAGS)

`fbr_integration` is seeded directly via DB migration (v9), not in `DEFAULT_FEATURE_FLAGS`. Defaults to OFF. Must be enabled per tenant individually. Needs FBR NTN + API token configured in tenant settings before it will work.

---

## packagesmall Current State (Apr 13 2026)

### ON
All Group 2, `marketplace_integrations`, `phase2_scheduling`, `phase2_returns_policy`, `phase2_smart_collections`, `phase2_outlet_tax`, `phase2_scheduled_changes`, `phase2_report_builder`, `phase2_pos_layouts`, `marketing_campaigns`, `customer_messaging`, `customer_invoicing`, `subscription_billing`, `phase4_restaurant`, `phase4_restaurant_kds`, `phase4_appointments`, `phase4_service_projects`, `phase4_service_contracts`

### OFF (safe to enable)
`phase2_outlet_pricing`, `phase2_draft_orders`, `phase2_pos_approvals`, `phase2_commissions`, `phase2_item_suggestions`, `phase2_outlet_visibility`, `payment_links`, `phase4_restaurant_qr`, `phase4_restaurant_preauth`, `phase4_appointments_waitlists`, `phase4_appointments_classes`, `reports_enhanced_filters`, `reports_profit_layer`, `reports_inventory_health_plus`, `reports_exceptions`, `reports_scheduled_exports`

### OFF (needs external config first)
`fbr_integration`, `phase5_shipping_automation`, `phase5_cod_reconciliation`, `phase5_payment_gateways`, `phase5_sms_providers`, `phase4_contract_ai`, `phase4_google_calendar_sync`, `subscription_autocharge`, `sms_campaigns`

### OFF (leave off)
`context_selection_required`, `context_header_enforced`

### Removed (Apr 2026)
All 22 `ui_redesign_*` flags — deleted from `DEFAULT_FEATURE_FLAGS`, no code consumed them
