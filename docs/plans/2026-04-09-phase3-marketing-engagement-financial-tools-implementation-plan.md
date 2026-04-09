# Phase 3 Marketing, Engagement & Financial Tools Implementation Plan

**Date:** 2026-04-09  
**Audience:** Implementation engineers, future agents, reviewers  
**Status:** Execution plan aligned to the current repo baseline  
**Companion design doc:** `docs/plans/2026-04-09-phase3-marketing-engagement-financial-tools-design.md`

---

## 1. Summary

This plan turns the Phase 3 design into an execution sequence against the current SanoPOS codebase.

Phase 3 in this plan includes:

- email campaigns and audience automation
- WhatsApp-first customer messaging inbox
- customer invoicing
- batch invoicing
- invoice deposits
- automatic payment reminders
- payment links
- recurring customer subscriptions
- SMS and auto-charge capability behind provider-gated adapters

The plan intentionally extends existing systems instead of replacing them.

Recommended delivery cut:

- `Phase 3A`:
  - campaign templates, audience preview, email sends
  - generic messaging inbox with WhatsApp ingestion and replies
  - customer invoices
  - batch invoicing
  - deposits
  - reminder scheduler
- `Phase 3B`:
  - payment links
  - SMS sending adapter
  - subscription plans and customer subscriptions
  - auto-charge activation hooks

---

## 2. Implementation Principles

- Reuse `pg-boss` for every scheduled or retryable workflow.
- Reuse Resend for v1 outbound email instead of introducing a second email system.
- Reuse current WhatsApp integration and webhook verification, but move message lifecycle into a generic messaging service.
- Reuse current billing gateway seam for payment links and future recurring-charge capability.
- Keep all provider-dependent features behind flags and adapter boundaries.
- Prefer additive migrations and compatibility shims over destructive refactors.

---

## 3. Reference Inputs Used By Workstream

### Campaigns

- Square competitive benchmark for built-in marketing capability
- `listmonk` for campaign scheduling and delivery-state modeling

### Messaging

- Square competitive benchmark for customer messaging
- `chatwoot` for inbox workflow patterns

### Invoices and Billing

- Square Invoices API
- Square Checkout API
- `Invoice Ninja`
- `Medusa`

### Subscriptions

- Square Subscriptions API
- `Kill Bill`

These references should guide data model and workflow shape, but implementation remains repo-native.

---

## 4. Required Public Interfaces and Data Contracts

### Campaigns

- `GET /api/marketing/campaigns`
- `POST /api/marketing/campaigns`
- `PUT /api/marketing/campaigns/:id`
- `POST /api/marketing/campaigns/:id/send-test`
- `POST /api/marketing/campaigns/:id/schedule`
- `GET /api/marketing/audiences/preview`

### Messaging

- `GET /api/messaging/threads`
- `GET /api/messaging/threads/:id/messages`
- `POST /api/messaging/threads/:id/send`
- `PUT /api/messaging/threads/:id`
- existing `POST /api/webhooks/whatsapp` becomes the inbound entry point for messaging ingestion

### Customer Invoicing

- `GET /api/customer-invoices`
- `POST /api/customer-invoices`
- `PUT /api/customer-invoices/:id`
- `POST /api/customer-invoices/batch`
- `POST /api/customer-invoices/:id/send`
- `POST /api/customer-invoices/:id/payment-link`
- `POST /api/customer-invoices/:id/payments`
- `POST /api/customer-invoices/:id/reminders/run`

### Subscriptions

- `GET /api/subscription-plans`
- `POST /api/subscription-plans`
- `PUT /api/subscription-plans/:id`
- `GET /api/customer-subscriptions`
- `POST /api/customer-subscriptions`
- `PUT /api/customer-subscriptions/:id`
- `POST /api/customer-subscriptions/:id/pause`
- `POST /api/customer-subscriptions/:id/resume`

---

## 5. Schema and Migration Work

## 5.1 New Tables

Target migration version: **v21**.

Add migrations and schema updates for:

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

## 5.2 Existing Table Extensions

Extend:

- `customers` with consent and channel-reachability metadata
- `crm_quotations` with optional invoice-link fields
- existing WhatsApp tables only as needed for migration compatibility and backfill

## 5.3 Feature Flags

Add default feature flags in backend and frontend:

- `marketing_campaigns`
- `customer_messaging`
- `customer_invoicing`
- `payment_links`
- `subscription_billing`
- `sms_campaigns`
- `subscription_autocharge`

---

## 6. Execution Order

## 6.1 Phase 3A

Implement all Phase 3A workstreams before starting Phase 3B. This is the lowest-risk cut that still closes the most visible competitive gaps.

## 6.2 Workstream 1: Migration and Domain Foundations

### Backend

Target files:

- `backend/migrate-pg.js`
- `backend/schema-pg.sql`

Tasks:

- add all `v21` tables and indexes
- add feature flags
- add customer consent fields
- add quotation-to-invoice linkage fields
- backfill generic messaging rows from existing WhatsApp conversation/message data where possible

### Acceptance

- migration is additive
- migration can run on a repo state that already includes `v20`
- existing WhatsApp data remains queryable after migration

---

## 6.3 Workstream 2: Campaign Service and Email Automation

### Backend

Target files:

- `backend/services/email.js`
- `backend/services/email-templates.js`
- `backend/services/boss.js`
- new marketing route/service modules

Tasks:

- create marketing template and campaign services
- create audience-preview resolver using existing customer fields and profile aggregates
- enqueue campaign deliveries through `pg-boss`
- log one delivery row per attempted recipient
- add test-send flow and schedule flow

### Frontend

Target files:

- new marketing redesign page
- `frontend/src/routes/appRoutes.jsx`
- navigation config

Tasks:

- add campaign list, composer, template picker, audience preview, test send, and schedule UI
- expose clear provider-state messages when SMS is not enabled

### Acceptance

- draft, test, schedule, sent, failed, and partial states are visible
- email campaigns send through existing email infrastructure

---

## 6.4 Workstream 3: Generic Messaging Inbox with WhatsApp First

### Backend

Target files:

- `backend/routes/webhooks.js`
- `backend/routes/integrations/whatsapp.js`
- new messaging route/service modules

Tasks:

- create thread and message services
- update WhatsApp webhook handling to persist inbound messages into generic thread/message tables
- update outbound WhatsApp reply path to write to the same generic tables
- support thread list filters, unread count, assignment, and status fields

### Frontend

Target files:

- new inbox redesign page
- `frontend/src/routes/appRoutes.jsx`

Tasks:

- add thread list, customer context, message timeline, reply composer, assignment, and unread behavior

### Acceptance

- inbound WhatsApp messages create or update threads
- staff can reply from the inbox
- thread state remains consistent between webhook events and UI actions

---

## 6.5 Workstream 4: Customer Invoices, Deposits, and Reminders

### Backend

Target files:

- `backend/routes/tier4/crm.js`
- new invoice route/service modules
- billing and email helper surfaces as needed

Tasks:

- add invoice CRUD and line-item calculation
- support quotation-to-invoice conversion
- support deposit and partial-payment recording
- compute invoice status from ledgered payments
- create reminder-rule scheduler and send logic through email first
- add batch invoice generation

### Frontend

Target files:

- new invoice redesign page
- `frontend/src/pages/redesign/QuotationsRedesign.jsx`
- `frontend/src/pages/redesign/CustomersRedesign.jsx`
- `frontend/src/routes/appRoutes.jsx`

Tasks:

- add invoice list, detail, send, payment history, deposit entry, reminder status
- add convert-to-invoice action from quotations
- surface customer invoice history where useful

### Acceptance

- invoice status transitions correctly through draft, sent, partial, paid, overdue, void
- deposits reduce outstanding balance
- batch generation is idempotent enough for safe rerun

---

## 6.6 Workstream 5: Payment Links

### Backend

Target files:

- `backend/services/payment-gateway.js`
- customer invoice payment-link service/routes

Tasks:

- extend the current payment-gateway seam for invoice-linked hosted checkout sessions
- store gateway reference and payment-link metadata against invoice records
- add graceful fallback when gateway mode is manual

### Frontend

Tasks:

- allow staff to generate, copy, resend, and revoke payment links from invoice detail
- show clear UI when gateway support is unavailable

### Acceptance

- payment links are generated only when gateway support exists
- disabled-gateway mode fails safely with user-readable errors

---

## 6.7 Workstream 6: Subscription Plans and Customer Subscriptions

### Backend

Target files:

- new subscription route/service modules
- `backend/services/boss.js`

Tasks:

- add subscription-plan CRUD
- add customer-subscription CRUD and lifecycle transitions
- schedule renewal jobs through `pg-boss`
- create manual-renewal fallback
- add auto-charge adapter hook points without making provider activation mandatory

### Frontend

Target files:

- new subscriptions redesign page
- `frontend/src/routes/appRoutes.jsx`

Tasks:

- add plan management, subscription list, detail, pause, resume, and renewal-status UI

### Acceptance

- subscriptions can be created and renewed without auto-charge enabled
- auto-charge code paths stay feature-gated

---

## 6.8 Workstream 7: Permissions, Navigation, and Observability

### Backend

Tasks:

- add permission checks for campaign, inbox, invoice, and subscription routes
- add audit-log coverage for send, reply, invoice state change, reminder trigger, and subscription actions
- add queue-depth and failure visibility for campaign/reminder workers where useful

### Frontend

Tasks:

- add nav entries and route guards
- add clear empty states and disabled states
- surface provider configuration gaps instead of silent failures

---

## 7. Testing Strategy

### Backend Integration Coverage

- campaign CRUD and audience preview
- scheduled email campaign enqueue and delivery logging
- WhatsApp webhook ingestion idempotency
- outbound inbox reply persistence
- invoice create, send, deposit, reminder, payment-link, and batch flows
- subscription lifecycle and renewal scheduling

### Frontend Coverage

- campaign page loads and schedules correctly
- inbox thread list and reply flow work
- invoice list/detail/deposit/reminder actions work
- subscriptions page handles active and provider-disabled states

### Regression Coverage

- existing tenant billing flows still work
- existing WhatsApp template-send flow still works or is cleanly routed through the new layer
- quotation workflows still work before and after invoice conversion

---

## 8. Acceptance Criteria

- Phase 3A can ship without SMS and auto-charge provider readiness.
- Email campaigns use existing Resend infrastructure and `pg-boss` scheduling.
- Inbox v1 supports real inbound and outbound WhatsApp conversations.
- Customer invoices support deposits, reminders, and balance tracking.
- Payment-link and subscription work does not break existing tenant platform billing.
- All new behavior is feature-flagged and can be rolled out incrementally.

---

## 9. Recommended File and Module Shape

Prefer grouped subsystems instead of scattering logic:

- backend route modules for marketing, messaging, invoices, and subscriptions
- backend service modules for audience resolution, message orchestration, invoice state, payment-link creation, and subscription runs
- frontend redesign pages matching each new domain surface

This keeps Phase 3 parallelizable and consistent with the current repo direction.
