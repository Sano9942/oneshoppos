# Phase 3 Marketing, Engagement & Financial Tools Design

**Date:** 2026-04-09  
**Audience:** Product owner, implementation engineers, future agents  
**Status:** Repo-specific design baseline for the next SanoPOS competitive wave  
**Companion sources:** `competitive-analysis-2.md`, `feature-development-references.md`

---

## 1. Purpose

This document defines the Phase 3 design for SanoPOS after the current Phase 1 omnichannel and Phase 2 operational-depth work.

Phase 3 in this design uses the broader scope implied by `feature-development-references.md`, then adapts that scope to the actual systems already present in this repo.

This document is based on:

- the current repo state after Phase 1 and Phase 2 planning
- a repo inspection of backend routes, workers, schema, billing, CRM, notifications, and frontend pages
- the curated external references already collected in the two source documents

---

## 2. Scope Decision

### 2.1 What Phase 3 Covers

This Phase 3 design includes:

- email marketing campaigns
- SMS campaigns as a provider-gated extension
- 2-way customer messaging inbox
- customer invoicing
- batch invoicing
- invoice deposits
- automatic payment reminders
- payment links
- recurring billing and subscriptions

### 2.2 What Phase 3 Does Not Cover

These items should stay out of the main Phase 3 implementation scope:

- unified cross-channel customer history, which is already shipped in Phase 1
- storefront popups, lead capture widgets, and page-builder style marketing tools
- service-business contracts and e-signatures
- banking, BNPL, or other licensing-blocked financial products

### 2.3 Delivery Assumption

Phase 3 should be built as a **foundation-first** release:

- fully ship email campaigns, WhatsApp inbox, customer invoices, deposits, and reminders
- design SMS sending and true auto-charge subscriptions behind adapters and feature flags
- keep provider-specific activation separate from the core domain model

---

## 3. Reference Mapping

The external references from the two source documents were intentionally used in the design, but filtered through current repo reality.

### 3.1 Square

Use Square as the primary product-model reference for:

- subscriptions and recurring billing
- invoices and invoice-linked payment flows
- payment links
- reminder-driven billing lifecycle thinking

Relevant references already captured in `feature-development-references.md`:

- Square Subscriptions API
- Square Invoices API
- Square Checkout API

### 3.2 Shopify

Shopify is less central to Phase 3 than it was in Phase 1 and Phase 2, but it still informs:

- customer-facing commerce expectations
- multi-surface workflow consistency
- operational product shape for link-based payments and customer interaction flows

### 3.3 Open-Source GitHub References

Use OSS projects for architecture and UX patterns only, not direct code copying:

- `knadh/listmonk` for campaign modeling, scheduling, and delivery tracking
- `chatwoot/chatwoot` for thread/inbox workflow patterns
- `invoiceninja/invoiceninja` for invoices, deposits, reminders, and billing states
- `killbill/killbill` for subscription lifecycle concepts
- `medusajs/medusa` for payment-link and modular commerce service boundaries

### 3.4 Product-Model Conclusion

- Use **Square** as the primary feature-model reference for billing surfaces.
- Use **Chatwoot** and **Listmonk** as the strongest UX and workflow references for inbox and campaigns.
- Use **Invoice Ninja** and **Kill Bill** for invoice and subscription lifecycle modeling.
- Extend the current SanoPOS foundations rather than introducing external products or a parallel architecture.

---

## 4. Current Repo Baseline

### 4.1 Backend Foundations to Reuse

- `backend/services/email.js`
- `backend/services/email-templates.js`
- `backend/services/boss.js`
- `backend/workers/email-worker-boss.js`
- `backend/routes/email.js`
- `backend/routes/webhooks.js`
- `backend/routes/integrations/whatsapp.js`
- `backend/routes/billing.js`
- `backend/services/payment-gateway.js`
- `backend/routes/tier4/crm.js`
- `backend/routes/customers.js`
- `backend/routes/tier4/notifications.js`
- `backend/migrate-pg.js`
- `backend/schema-pg.sql`

### 4.2 Frontend Foundations to Reuse

- `frontend/src/pages/redesign/BillingRedesign.jsx`
- `frontend/src/pages/redesign/CustomersRedesign.jsx`
- `frontend/src/pages/redesign/QuotationsRedesign.jsx`
- `frontend/src/pages/redesign/NotificationsRedesign.jsx`
- `frontend/src/routes/appRoutes.jsx`

### 4.3 Already Present as Foundations

- Resend-backed email sending already exists.
- `pg-boss` already exists and should be the standard scheduler and background job mechanism.
- Billing checkout already has a payment-gateway adapter seam and `payment_intents`.
- CRM quotations already exist and can become an input path into customer invoicing.
- Customer segmentation inputs already exist through tags, groups, loyalty tiers, DOB, city, and purchase-summary data.
- WhatsApp integration and webhook verification already exist.

### 4.4 Still Genuinely Missing

- campaign model, audience builder, and delivery tracking
- unified customer messaging inbox
- generic message thread model beyond WhatsApp-specific storage
- customer invoice domain and ledger
- deposit-aware invoice flows
- payment-link generation for customer-facing collection
- reminder scheduling for unpaid invoices
- subscription plan and customer-subscription domain models
- provider-agnostic SMS adapter
- provider-gated recurring auto-charge flow

### 4.5 Important Implication

Phase 3 should **reuse the current email, billing, CRM, customer, and webhook foundations** instead of introducing a separate marketing app or billing app inside the repo.

---

## 5. Design Principles

- Use `pg-boss` as the only scheduler and retry mechanism for campaign sends, reminders, subscription renewals, and delayed follow-ups.
- Keep all new work additive and feature-flagged.
- Introduce a generic messaging domain now, then plug WhatsApp into it first.
- Treat customer invoicing as a first-class subsystem and not as a side effect of POS sales.
- Keep provider-specific capabilities behind adapters so Phase 3 remains implementable even when external accounts are not fully ready.
- Prefer audience filters based on already-available customer data rather than inventing a new segmentation engine in v1.

---

## 6. Phase 3 Architecture by Workstream

## 6.1 Campaigns and Audience Automation

### Goal

Close the largest customer-engagement gap by introducing scheduled outbound campaigns with segmentation and delivery history.

### Delivery Cut

Phase 3A

### External Anchors

- Listmonk for campaigns, audience, scheduling, and send-state thinking
- Square competitive benchmark for built-in campaign expectations

### Design Decisions

- Support email first as the fully shippable outbound channel.
- Support SMS as a channel type in the model, but keep actual sending provider-gated.
- Use repo-native filters only: group, tags, loyalty tier, city, birth month, last purchase window, spend range, channel reachability.
- Templates should be reusable and separated from campaign instances.
- Campaign sends should log one delivery record per recipient per channel.

### New or Changed Interfaces

- `GET /api/marketing/campaigns`
- `POST /api/marketing/campaigns`
- `PUT /api/marketing/campaigns/:id`
- `POST /api/marketing/campaigns/:id/send-test`
- `POST /api/marketing/campaigns/:id/schedule`
- `GET /api/marketing/audiences/preview`

### Data Model Additions

- `marketing_templates`
- `marketing_campaigns`
- `marketing_campaign_audiences`
- `marketing_campaign_deliveries`

### Default Behavior

- Campaigns start as draft.
- Test-send is required before scheduling in the UI.
- Email sends immediately when the feature is enabled and provider config exists.
- SMS can be configured in campaigns but remains blocked until a provider adapter is enabled.

---

## 6.2 Customer Messaging Inbox

### Goal

Turn the current WhatsApp integration from a template sender into a real conversation inbox.

### Delivery Cut

Phase 3A

### External Anchors

- Chatwoot for inbox workflow, thread states, assignment, and reply flow
- Square competitive benchmark for unified customer messaging expectations

### Design Decisions

- Introduce generic `message_threads` and `message_entries` tables.
- Treat WhatsApp as the first connected channel.
- Existing WhatsApp tables should be migrated or mirrored into the generic messaging layer.
- Keep message ingestion webhook-driven and idempotent.
- Inbox v1 should support thread list, message timeline, outbound reply, assignment, unread state, and simple status tags.

### New or Changed Interfaces

- `GET /api/messaging/threads`
- `GET /api/messaging/threads/:id/messages`
- `POST /api/messaging/threads/:id/send`
- `PUT /api/messaging/threads/:id`
- `POST /api/webhooks/whatsapp` delegates into the messaging service

### Data Model Additions

- `message_threads`
- `message_entries`

### Default Behavior

- A new inbound WhatsApp message creates or updates a thread by phone number.
- Customer linkage is best-effort through customer mobile matching.
- Reply sending uses the existing WhatsApp provider client.
- Threads expose unread counts and last-activity timestamps for the UI.

---

## 6.3 Customer Invoicing, Deposits, and Reminders

### Goal

Add a customer-facing invoicing subsystem for quotes, staged payments, and remote collection.

### Delivery Cut

Phase 3A for invoices, deposits, and reminders  
Phase 3B for payment links when gateway capability is available

### External Anchors

- Square Invoices API
- Invoice Ninja for invoice, deposit, and reminder lifecycle

### Design Decisions

- Create a dedicated invoice subsystem instead of extending POS `sales`.
- Allow quotation-to-invoice conversion from the current CRM flow.
- Support deposit collection as a payment against invoice balance.
- Support reminder rules driven by invoice due date and status.
- Payment links belong to invoices and should reuse the existing payment-gateway seam.

### New or Changed Interfaces

- `GET /api/customer-invoices`
- `POST /api/customer-invoices`
- `PUT /api/customer-invoices/:id`
- `POST /api/customer-invoices/batch`
- `POST /api/customer-invoices/:id/send`
- `POST /api/customer-invoices/:id/payment-link`
- `POST /api/customer-invoices/:id/payments`
- `POST /api/customer-invoices/:id/reminders/run`

### Data Model Additions

- `customer_invoices`
- `customer_invoice_items`
- `customer_invoice_payments`
- `customer_invoice_payment_links`
- `customer_invoice_reminders`

### Default Behavior

- Invoices move through draft, sent, partial, paid, overdue, void.
- Deposits reduce outstanding balance but do not close the invoice until fully paid.
- Reminder jobs run through `pg-boss`.
- Payment links are feature-flagged if gateway support is unavailable.

---

## 6.4 Recurring Billing and Customer Subscriptions

### Goal

Introduce subscription-ready recurring billing for memberships and recurring service plans.

### Delivery Cut

Phase 3B

### External Anchors

- Square Subscriptions API
- Kill Bill for lifecycle thinking

### Design Decisions

- Support subscription plans, customer subscriptions, billing cadence, and renewal scheduling in v1.
- Support manual-renewal fallback in v1.
- Support auto-charge only when provider tokens and gateway capability are ready.
- Keep plan definitions separate from tenant platform billing, which already exists in `billing.js`.

### New or Changed Interfaces

- `GET /api/subscription-plans`
- `POST /api/subscription-plans`
- `PUT /api/subscription-plans/:id`
- `GET /api/customer-subscriptions`
- `POST /api/customer-subscriptions`
- `PUT /api/customer-subscriptions/:id`
- `POST /api/customer-subscriptions/:id/pause`
- `POST /api/customer-subscriptions/:id/resume`

### Data Model Additions

- `subscription_plans`
- `customer_subscriptions`
- `subscription_runs`

### Default Behavior

- Subscriptions move through draft, active, paused, cancelled, expired.
- Renewal jobs are scheduled through `pg-boss`.
- If auto-charge is disabled, the system generates an invoice or reminder task instead of silently failing.

---

## 7. Schema and Feature Flags

Target migration version: **v21**. Current highest migration in repo review is **v20**.

### 7.1 New Tables

- `marketing_templates`
- `marketing_campaigns`
- `marketing_campaign_audiences`
- `marketing_campaign_deliveries`
- `message_threads`
- `message_entries`
- `customer_invoices`
- `customer_invoice_items`
- `customer_invoice_payments`
- `customer_invoice_payment_links`
- `customer_invoice_reminders`
- `subscription_plans`
- `customer_subscriptions`
- `subscription_runs`

### 7.2 Existing Table Extensions

Extend:

- `customers` for consent and channel-reachability metadata
- existing WhatsApp conversation/message tables only as needed for migration compatibility
- optionally `crm_quotations` for invoice conversion linkage

### 7.3 Feature Flags

- `marketing_campaigns`
- `customer_messaging`
- `customer_invoicing`
- `payment_links`
- `subscription_billing`
- `sms_campaigns`
- `subscription_autocharge`

---

## 8. Frontend Surface Recommendation

Add these new pages and route surfaces:

- `/marketing/campaigns`
- `/messaging/inbox`
- `/customer-invoices`
- `/subscriptions`

Reuse and extend:

- `BillingRedesign.jsx` for payment-link and subscription-admin entry points where appropriate
- `CustomersRedesign.jsx` for consent, reachable channels, invoice history, and quick communication actions
- `QuotationsRedesign.jsx` for quote-to-invoice conversion

---

## 9. Scope Cut Recommendation

### 9.1 Phase 3A: Shippable Engagement and Invoicing

Ship first:

- email campaigns
- audience preview and templates
- WhatsApp inbox
- customer invoices
- batch invoices
- deposits
- automatic reminders

### 9.2 Phase 3B: Provider-Gated Extensions

Ship after Phase 3A is stable:

- payment links
- SMS sending
- recurring customer subscriptions
- auto-charge activation

### 9.3 Why This Cut Is Recommended

- Phase 3A fits the repo's current strengths: Resend, `pg-boss`, CRM, customers, and WhatsApp.
- Phase 3B depends more heavily on gateway and provider capability.
- This split preserves momentum without blocking Phase 3 on external service readiness.

---

## 10. Acceptance Criteria

- Users can create, test, schedule, and review email campaigns with delivery history.
- Staff can view and reply to customer WhatsApp threads from a unified inbox.
- Staff can create invoices, record deposits, send reminders, and track balances.
- Batch invoice generation works for multiple customers without duplicate billing on rerun.
- Subscription plans and customer subscriptions exist as first-class records, even when auto-charge is still disabled.
- All provider-gated behavior degrades clearly and safely when configuration is missing.

