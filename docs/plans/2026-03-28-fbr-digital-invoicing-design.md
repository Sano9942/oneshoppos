# FBR Digital Invoicing — Design Document

_Date: March 28, 2026_
_Status: Approved_

## Overview

Real-time invoice posting to FBR's Digital Invoicing (DI) API for Pakistani tenants. Each sale, return, or void is reported to FBR asynchronously via a background worker process, with a retry queue for failures.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Posting strategy | Fire-and-forget with DB-backed retry queue (Approach C) | No POS delay, admin visibility into failures |
| Architecture | Separate worker process (Approach 2) | Isolates FBR network calls from main Express process; scales with tenant count |
| Events reported | Sales + Returns + Voids (B+) | FBR requires invoices + credit notes; voids need debit notes |
| HS code assignment | Category-level with inheritance | Set once per category, all products inherit. Override at product level. |
| Tax resolution | Category-level with inheritance (manual assignment) | Admin assigns tax to categories; products inherit via tree walk |
| Walk-in buyers | "Unregistered" with no NTN | FBR allows for B2C sales |
| FBR IRN on receipts | IRN + QR code | FBR-recommended for compliance verification |
| Sandbox testing | Manual (swap token in settings) | Built-in test scenario UI deferred to future |
| Online channels | POS sales only for now | Shopify/WooCommerce FBR reporting deferred |
| Feature gating | `fbr_integration` feature flag per tenant | Zero impact on tenants who don't need FBR |
| Tax rate reference | Shared lookup table + tenant suggestions | Province-aware rates, super-admin managed, crowdsourced corrections |
| Upgrade signal to Approach 3 | Queue depth >100, avg delay >5min, volume >10K/day | Monitor via `/api/admin/fbr-health` |

## Data Flow

### Sale → FBR Invoice

```
Cashier completes sale at POS
        |
sales.js creates sale record + assigns invoice number (as today)
        |
Check: is fbr_integration feature flag enabled?
  -> No: set fbr_status = 'not_applicable', done
  -> Yes: |
        |
Resolve HS code per item:
  Category hs_code -> Parent category hs_code -> fbr_default_hs_code
        |
Build FBR JSON payload (using invoice_number, tax from sale_items, HS codes)
        |
Insert into fbr_invoices (status: 'pending')
        |
Set sale.fbr_status = 'pending'
        |
Return sale response to cashier (no delay)
```

### Return → FBR Credit Note

Same flow via `routes/returns.js` post-commit. `invoice_type = 'credit_note'`.

### Void → FBR Debit Note

When a sale is voided and `fbr_status = 'posted'`, queue a debit note (`invoice_type = 'debit_note'`).

### Worker Process

```
Every 30 seconds:
  -> Query master DB for active tenants with fbr_integration enabled
  -> For each tenant:
      -> SET search_path to tenant schema
      -> SELECT from fbr_invoices WHERE status = 'pending' AND next_retry_at <= NOW()
      -> For each record (max 5 concurrent per tenant, 20 globally):
          -> Load FBR credentials from company_profile
          -> POST to FBR API (sandbox or production)
          -> Success: update fbr_invoices + sale.fbr_irn + sale.fbr_status = 'posted'
          -> Failure: retry_count++, next_retry_at with backoff
          -> Max retries (5) exceeded: status = 'failed'
```

### Retry Backoff Schedule

| Retry | Delay |
|-------|-------|
| 1 | 1 minute |
| 2 | 5 minutes |
| 3 | 15 minutes |
| 4 | 1 hour |
| 5 | 4 hours |

After retry 5 fails -> `status = 'failed'`, admin must manually retry.

## Tax + HS Code Inheritance

Resolution chain (most specific wins):

```
Product tax_id -> Category tax_id -> Parent category tax_id -> Store default tax
Product hs_code (future) -> Category hs_code -> Parent category hs_code -> fbr_default_hs_code
```

Example:
```
Grocery (tax: Exempt 0%, HS: 0901)
  Packaged Food (tax: GST 18%, HS: 2106)
    Chips (no override -> inherits GST 18%, HS 2106)
    Rice (tax override: Exempt 0% -> uses Exempt, inherits HS 2106)
  Fresh Produce (no override -> inherits Exempt 0%, HS 0901)
    Tomatoes (no override -> inherits Exempt 0%, HS 0901)
```

## Schema Changes (Migration v9)

### Modified tables

**categories** — add `tax_id INTEGER REFERENCES taxes(id)`, `hs_code TEXT`

**taxes** — add `fbr_further_tax NUMERIC(8,4) DEFAULT 0`, `fbr_extra_tax NUMERIC(8,4) DEFAULT 0`, `fbr_fed_rate NUMERIC(8,4) DEFAULT 0`

**company_profile** — add `fbr_api_token TEXT`, `fbr_environment TEXT DEFAULT 'sandbox'`, `fbr_default_hs_code TEXT`, `fbr_province TEXT`

**customers** — add `ntn_cnic TEXT`

**sales** — add `fbr_status TEXT DEFAULT 'not_applicable'`, `fbr_irn TEXT`, `fbr_qr_code TEXT`

**returns** — add `fbr_status TEXT DEFAULT 'not_applicable'`, `fbr_irn TEXT`

### New tables (tenant schema)

**fbr_invoices** — queue table with `id`, `sale_id`, `return_id`, `invoice_type` (sale/credit_note/debit_note), `payload` (JSONB), `status` (pending/posted/failed/expired), `fbr_irn`, `fbr_response` (JSONB), `retry_count`, `max_retries`, `last_error`, `next_retry_at`, `created_at`, `posted_at`. Index on `(status, next_retry_at)`.

**tax_rate_suggestions** — `id`, `reference_id`, `suggested_by_tenant`, `suggested_by_employee`, `field_name`, `current_value`, `suggested_value`, `source_reference`, `notes`, `status` (pending/approved/rejected), `reviewed_at`, `created_at`

### New tables (public schema only)

**tax_rate_reference** — `id`, `hs_code`, `description_en`, `description_ur`, `federal_gst`, `punjab_pra`, `sindh_srb`, `kpk_kpra`, `balochistan_bra`, `exemption_notes`, `last_updated`. Seeded with ~100-150 common retail categories.

### Feature flag

```sql
INSERT INTO feature_flags (key, enabled, description)
VALUES ('fbr_integration', false, 'FBR Digital Invoicing - real-time invoice posting')
ON CONFLICT (key) DO NOTHING;
```

## FBR API Details

- **Sandbox:** `https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb`
- **Production:** `https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata`
- **Validation:** `https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata`
- **Auth:** Bearer token in `Authorization` header
- **Format:** JSON POST per invoice

### FBR Invoice Payload (key fields)

```json
{
  "invoiceType": "Sale Invoice",
  "invoiceDate": "2026-03-28",
  "sellerBusinessName": "...",
  "sellerNTNCNIC": "...",
  "sellerProvince": "...",
  "sellerAddress": "...",
  "buyerNTNCNIC": "...",
  "buyerBusinessName": "...",
  "buyerRegistrationType": "Registered|Unregistered",
  "invoiceRefNo": "INV-001",
  "items": [{
    "hsCode": "4901",
    "productDescription": "...",
    "quantity": 1,
    "uoM": "Numbers, pieces, units",
    "valueSalesExcludingST": 1000,
    "salesTaxApplicable": 180,
    "furtherTax": 0,
    "extraTax": 0,
    "fedPayable": 0,
    "discount": 0,
    "saleType": "Goods at standard rate (default)"
  }]
}
```

## Backend Components

### New files

| File | Purpose |
|------|---------|
| `backend/services/fbr.js` | FBR API client, payload builders, HS/tax resolution |
| `backend/workers/fbr-worker.js` | Separate Railway service, polls queue + posts to FBR |
| `backend/routes/fbr.js` | FBR config, dashboard, invoice list, retry endpoints |
| `backend/routes/tax-lookup.js` | Tax rate reference search, export, suggest |

### New endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/fbr/config` | GET | admin | Get FBR settings |
| `/api/fbr/config` | PUT | admin | Update FBR settings |
| `/api/fbr/test-connection` | POST | admin | Validate FBR token |
| `/api/fbr/dashboard` | GET | admin | Summary stats |
| `/api/fbr/invoices` | GET | admin | Paginated invoice list |
| `/api/fbr/invoices/:id/retry` | POST | admin | Retry failed invoice |
| `/api/fbr/invoices/retry-all` | POST | admin | Retry all failed |
| `/api/tax-lookup` | GET | authenticated | Search reference rates |
| `/api/tax-lookup/export` | GET | authenticated | Download Excel schedule |
| `/api/tax-lookup/suggest` | POST | authenticated | Submit rate correction |
| `/api/admin/tax-rates` | GET/POST | super-admin | List/add reference rates |
| `/api/admin/tax-rates/:id` | PUT/DELETE | super-admin | Update/remove rate |
| `/api/admin/tax-rate-suggestions` | GET | super-admin | List pending suggestions |
| `/api/admin/tax-rate-suggestions/:id` | PUT | super-admin | Approve/reject |
| `/api/admin/fbr-health` | GET | super-admin | Queue depth, failure rates |

### Modified files

| File | Change |
|------|--------|
| `routes/sales.js` | Post-commit: check FBR flag, enqueue invoice. Void: enqueue debit note. |
| `routes/returns.js` | Post-commit: check FBR flag, enqueue credit note. |
| `routes/categories.js` | Accept `tax_id` and `hs_code` in POST/PUT. |
| `routes/customers.js` | Accept `ntn_cnic` in POST/PUT. |
| `category-tree.js` | Add `resolveInheritedField()` for tax/HS code inheritance. |
| `migrate-pg.js` | Add migration v9. |
| `schema-pg.sql` | Add new tables + columns. |
| `routes/registerAllRoutes.js` | Register fbr.js and tax-lookup.js routes. |

## Frontend Components

### New pages

| Page | Route | Auth | Purpose |
|------|-------|------|---------|
| `FBRSettingsRedesign.jsx` | `/settings/fbr` | admin | FBR config (NTN, STRN, province, token, env, default HS) |
| `FBRDashboardRedesign.jsx` | `/fbr` | admin | Invoice queue: summary cards, filterable table, retry actions |
| `TaxLookupRedesign.jsx` | `/tax-lookup` | all | Province-aware rate search, Excel download, suggest correction |
| `AdminTaxRates.jsx` | `/admin/tax-rates` | super-admin | Rate CRUD + suggestion review |

### Modified pages

| Page | Change |
|------|--------|
| Category create/edit | Add tax dropdown + HS code input with lookup link |
| Customer create/edit | Add NTN/CNIC field |
| `receipt.js` | Add FBR IRN + QR code when available |
| Sales History | Add FBR status column (dot indicator) |
| `nav-config.js` | Add FBR + Tax Lookup sidebar entries |

## Worker Process

**File:** `backend/workers/fbr-worker.js`
**Railway:** Separate service, start command `node backend/workers/fbr-worker.js`

### Safeguards

| Safeguard | How |
|-----------|-----|
| No duplicate processing | `UPDATE SET status='processing' WHERE status='pending'` row lock |
| Tenant isolation | try/catch per tenant, errors don't cascade |
| Concurrency limit | Max 5 per tenant, 20 globally |
| Health check | HTTP `/health` endpoint for Railway monitoring |
| Graceful shutdown | Finishes in-flight posts on SIGTERM |
| Logging | Pino with tenant context |

## Monitoring & Alerts

- `GET /api/admin/fbr-health` — queue depth, avg posting delay, failure rate per tenant
- Alert email (existing alerting system) when queue depth > 100 or avg delay > 5 min
- Upgrade signal to Approach 3 (Redis/BullMQ): queue depth consistently high, volume > 10K/day, worker CPU > 80%

## Tax Rate Reference System

### Lookup page (`/tax-lookup`)
- Province selector at top
- Searchable by product name, HS code, or category (English + Urdu)
- Shows: HS Code, Description (EN/UR), Federal GST, Provincial rate, Exemption notes
- "Download Full Schedule" button (Excel export)
- "Suggest Correction" button per row

### Super-admin management (`/admin/tax-rates`)
- Full CRUD on reference rates
- Pending suggestion review with approve/reject
- Seeded with ~100-150 common retail categories

### Rate suggestion flow
```
Tenant notices rate change -> Submits correction (value + SRO reference)
        |
Super-admin reviews in /admin/tax-rates
        |
Approve -> rate updates for ALL tenants
Reject -> dismissed
```

## Not In Scope (Future Roadmap)

- **FBR sandbox test scenario UI** — automated scenario runner for FBR certification
- **Online channel FBR reporting** — Shopify/WooCommerce invoice posting
- **Provincial revenue integrations** — PRA, SRB, KPRA, BRA portals
- **Auto-updating tax rates** — web scraper or FBR feed
- **CCTV/loss prevention timestamp logging** — POS event timestamps for DVR cross-reference

## References

- [FBR DI API Technical Spec v1.3](https://download1.fbr.gov.pk/Docs/202441821416329TechnicalSpecificationDigitalInvoicing1.2.3.pdf)
- [FBR DI API v1.12](https://download1.fbr.gov.pk/Docs/20257301172130815TechnicalDocumentationforDIAPIV1.12.pdf)
- [FBR POS Integration Guide](https://oneclickpos.pk/fbr-integrated-systems/fbr-pos-integration-pakistan-2025/)
- [FBR Scenario Testing Guide](https://logiclayer.com.pk/blog/fbr-invoice-scenario-testing-guide/)
