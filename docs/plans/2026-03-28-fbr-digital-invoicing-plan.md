# FBR Digital Invoicing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Real-time FBR Digital Invoicing integration — async invoice posting with retry queue, category-level tax/HS code inheritance, and province-aware tax rate lookup system.

**Architecture:** Feature-flagged per tenant. Sales/returns/voids enqueue FBR payloads post-commit. A separate worker process polls the queue and posts to FBR API. Tax rate reference table shared across tenants in public schema.

**Tech Stack:** Node.js/Express backend, PostgreSQL (schema-per-tenant), React frontend, Pino logging, existing multi-tenant infrastructure.

**Design doc:** `docs/plans/2026-03-28-fbr-digital-invoicing-design.md`

---

## Task 1: Migration v9 — Schema Changes

**Files:**
- Modify: `backend/migrate-pg.js` (append after v8, before closing `]`)
- Modify: `backend/schema-pg.sql` (add new columns + tables to DDL)

**Step 1: Add migration v9 to migrate-pg.js**

Append this entry to the `MIGRATIONS` array (after the v8 object, before `];`):

```js
{
  version: 9,
  description: "FBR Digital Invoicing: category tax/HS inheritance, FBR queue, tax rate reference",
  up: async (client) => {
    // Categories: tax + HS code inheritance
    await client.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS tax_id INTEGER REFERENCES taxes(id)`);
    await client.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS hs_code TEXT`);

    // Taxes: FBR-specific breakdown fields
    await client.query(`ALTER TABLE taxes ADD COLUMN IF NOT EXISTS fbr_further_tax NUMERIC(8,4) DEFAULT 0`);
    await client.query(`ALTER TABLE taxes ADD COLUMN IF NOT EXISTS fbr_extra_tax NUMERIC(8,4) DEFAULT 0`);
    await client.query(`ALTER TABLE taxes ADD COLUMN IF NOT EXISTS fbr_fed_rate NUMERIC(8,4) DEFAULT 0`);

    // Company profile: FBR config
    await client.query(`ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS fbr_api_token TEXT`);
    await client.query(`ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS fbr_environment TEXT DEFAULT 'sandbox'`);
    await client.query(`ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS fbr_default_hs_code TEXT`);
    await client.query(`ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS fbr_province TEXT`);

    // Customers: buyer tax ID
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS ntn_cnic TEXT`);

    // Sales: FBR tracking
    await client.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS fbr_status TEXT DEFAULT 'not_applicable'`);
    await client.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS fbr_irn TEXT`);
    await client.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS fbr_qr_code TEXT`);

    // Returns: FBR tracking
    await client.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS fbr_status TEXT DEFAULT 'not_applicable'`);
    await client.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS fbr_irn TEXT`);

    // FBR invoice queue
    await client.query(`CREATE TABLE IF NOT EXISTS fbr_invoices (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER REFERENCES sales(id),
      return_id INTEGER REFERENCES returns(id),
      invoice_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      fbr_irn TEXT,
      fbr_response JSONB,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 5,
      last_error TEXT,
      next_retry_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      posted_at TIMESTAMPTZ
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fbr_invoices_status ON fbr_invoices(status, next_retry_at)`);

    // Tax rate suggestions (tenant schema)
    await client.query(`CREATE TABLE IF NOT EXISTS tax_rate_suggestions (
      id SERIAL PRIMARY KEY,
      reference_id INTEGER NOT NULL,
      suggested_by_tenant TEXT,
      suggested_by_employee INTEGER,
      field_name TEXT NOT NULL,
      current_value NUMERIC(8,4),
      suggested_value NUMERIC(8,4) NOT NULL,
      source_reference TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    // Feature flag
    await client.query(`INSERT INTO feature_flags (key, enabled, description)
      VALUES ('fbr_integration', false, 'FBR Digital Invoicing - real-time invoice posting to FBR API')
      ON CONFLICT (key) DO NOTHING`);

    // Tax rate reference — public schema only (shared across tenants)
    const { rows } = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'tenants' LIMIT 1"
    );
    if (rows.length) {
      await client.query(`CREATE TABLE IF NOT EXISTS tax_rate_reference (
        id SERIAL PRIMARY KEY,
        hs_code TEXT NOT NULL,
        description_en TEXT NOT NULL,
        description_ur TEXT,
        federal_gst NUMERIC(8,4) DEFAULT 0,
        punjab_pra NUMERIC(8,4) DEFAULT 0,
        sindh_srb NUMERIC(8,4) DEFAULT 0,
        kpk_kpra NUMERIC(8,4) DEFAULT 0,
        balochistan_bra NUMERIC(8,4) DEFAULT 0,
        exemption_notes TEXT,
        last_updated DATE DEFAULT CURRENT_DATE
      )`);
    }
  },
},
```

**Step 2: Update schema-pg.sql with new columns and tables**

Add the new columns to existing CREATE TABLE statements and add the new tables. This ensures new tenant schemas get the full schema on provisioning.

**Step 3: Run migration locally**

```bash
cd backend && node migrate-pg.js
```

Expected: `Migration v9 applied successfully` for public schema and each tenant schema.

**Step 4: Commit**

```bash
git add backend/migrate-pg.js backend/schema-pg.sql
git commit -m "feat(fbr): migration v9 — FBR queue, category tax/HS, tax rate reference"
```

---

## Task 2: Category Tree Inheritance Extension

**Files:**
- Modify: `backend/category-tree.js` (add `resolveInheritedField`, extend `fetchCategoryRows`)

**Step 1: Extend fetchCategoryRows to include tax_id and hs_code**

In `fetchCategoryRows()`, update the SELECT to include the new columns:

```js
const { rows } = await db.query(
  "SELECT id, name, description, parent_id, sort_order, is_active, tax_id, hs_code FROM categories ORDER BY sort_order, name"
);
```

Also update `normalizeCategoryRow()` to pass through `tax_id` and `hs_code`.

**Step 2: Add resolveInheritedField function**

```js
function resolveInheritedField(byId, categoryId, fieldName) {
  let current = categoryId;
  while (current) {
    const cat = byId.get(current);
    if (!cat) break;
    if (cat[fieldName] != null) return cat[fieldName];
    current = cat.parent_id;
  }
  return null;
}
```

Export it alongside existing functions.

**Step 3: Commit**

```bash
git add backend/category-tree.js
git commit -m "feat(fbr): extend category tree with tax_id/hs_code inheritance"
```

---

## Task 3: FBR Service — API Client & Payload Builders

**Files:**
- Create: `backend/services/fbr.js`

**Step 1: Create the FBR service**

```js
const logger = require("./logger");

const FBR_URLS = {
  sandbox: "https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb",
  production: "https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata",
  validate: "https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata",
};

const BACKOFF_DELAYS = [60, 300, 900, 3600, 14400]; // seconds: 1m, 5m, 15m, 1h, 4h

function buildInvoicePayload(sale, items, company, customer, categoryTree) {
  // Map SanoPOS sale data to FBR DI API JSON format
  // See design doc for full FBR payload structure
  const { resolveInheritedField } = require("../category-tree");
  const byId = categoryTree?.byId;

  return {
    invoiceType: "Sale Invoice",
    invoiceDate: new Date(sale.timestamp).toISOString().split("T")[0],
    sellerBusinessName: company.company_name,
    sellerNTNCNIC: company.ntn || "",
    sellerProvince: company.fbr_province || "",
    sellerAddress: company.address || "",
    buyerNTNCNIC: customer?.ntn_cnic || "",
    buyerBusinessName: customer?.name || "Walk-in Customer",
    buyerRegistrationType: customer?.ntn_cnic ? "Registered" : "Unregistered",
    invoiceRefNo: sale.invoice_number,
    items: items.map((item) => {
      const hsCode = byId
        ? resolveInheritedField(byId, item.category_id, "hs_code")
        : null;
      const taxRate = Number(item.effective_tax_rate || item.tax_rate || 0);
      const valueExclTax = Number(item.price_at_sale || item.price) * Number(item.quantity);
      return {
        hsCode: hsCode || company.fbr_default_hs_code || "",
        productDescription: item.product_name || item.name || "",
        quantity: Number(item.quantity),
        uoM: "Numbers, pieces, units",
        valueSalesExcludingST: valueExclTax,
        salesTaxApplicable: (valueExclTax * taxRate) / 100,
        furtherTax: 0, // populated from taxes.fbr_further_tax if available
        extraTax: 0,
        fedPayable: 0,
        discount: Number(item.discount_amount || 0),
        saleType: "Goods at standard rate (default)",
      };
    }),
  };
}

function buildCreditNotePayload(returnRecord, items, company, customer, categoryTree) {
  const payload = buildInvoicePayload(
    { ...returnRecord, timestamp: returnRecord.created_at || returnRecord.timestamp },
    items,
    company,
    customer,
    categoryTree
  );
  payload.invoiceType = "Credit Note";
  payload.invoiceRefNo = returnRecord.return_number || `RET-${returnRecord.id}`;
  return payload;
}

function buildDebitNotePayload(sale, company) {
  return {
    invoiceType: "Debit Note",
    invoiceDate: new Date().toISOString().split("T")[0],
    sellerBusinessName: company.company_name,
    sellerNTNCNIC: company.ntn || "",
    sellerProvince: company.fbr_province || "",
    invoiceRefNo: sale.invoice_number,
    originalInvoiceRefNo: sale.fbr_irn,
    reason: "Sale voided",
  };
}

async function postToFbr(payload, token, environment) {
  const url = FBR_URLS[environment] || FBR_URLS.sandbox;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `FBR API error: ${res.status}`);
    err.status = res.status;
    err.fbrResponse = body;
    throw err;
  }
  return body;
}

async function validateConnection(token, environment) {
  const url = FBR_URLS.validate;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ test: true }),
  });
  return { ok: res.ok, status: res.status };
}

async function enqueueFbrInvoice(db, { saleId, returnId, invoiceType, payload }) {
  await db.query(
    `INSERT INTO fbr_invoices (sale_id, return_id, invoice_type, payload, status, next_retry_at)
     VALUES ($1, $2, $3, $4, 'pending', NOW())`,
    [saleId || null, returnId || null, invoiceType, JSON.stringify(payload)]
  );
}

function getNextRetryDelay(retryCount) {
  return BACKOFF_DELAYS[Math.min(retryCount, BACKOFF_DELAYS.length - 1)];
}

module.exports = {
  buildInvoicePayload,
  buildCreditNotePayload,
  buildDebitNotePayload,
  postToFbr,
  validateConnection,
  enqueueFbrInvoice,
  getNextRetryDelay,
  FBR_URLS,
  BACKOFF_DELAYS,
};
```

**Step 2: Commit**

```bash
git add backend/services/fbr.js
git commit -m "feat(fbr): FBR service — API client, payload builders, queue helper"
```

---

## Task 4: FBR Routes — Config, Dashboard, Retry

**Files:**
- Create: `backend/routes/fbr.js`
- Modify: `backend/routes/registerAllRoutes.js` (add require line)

**Step 1: Create routes/fbr.js**

Export a function `(app, deps)` with these endpoints:
- `GET /api/fbr/config` — returns FBR fields from company_profile (requirePerm `all_access`)
- `PUT /api/fbr/config` — updates FBR fields on company_profile (requirePerm `all_access`)
- `POST /api/fbr/test-connection` — calls `validateConnection()` with tenant's token
- `GET /api/fbr/dashboard` — returns counts by status from fbr_invoices
- `GET /api/fbr/invoices` — paginated list with status/date filters
- `POST /api/fbr/invoices/:id/retry` — resets status to 'pending', retry_count to 0
- `POST /api/fbr/invoices/retry-all` — resets all 'failed' to 'pending'

All endpoints gated by `requirePerm("all_access")` and `requireFeature("fbr_integration")` (except config GET/PUT which don't need the feature flag — admin needs to configure before enabling).

**Step 2: Register in registerAllRoutes.js**

Add after existing route registrations:

```js
// --- ROUTES: FBR ---
require("./fbr")(app, deps);
```

**Step 3: Commit**

```bash
git add backend/routes/fbr.js backend/routes/registerAllRoutes.js
git commit -m "feat(fbr): FBR routes — config, dashboard, invoice list, retry"
```

---

## Task 5: Tax Lookup Routes

**Files:**
- Create: `backend/routes/tax-lookup.js`
- Modify: `backend/routes/registerAllRoutes.js` (add require line)

**Step 1: Create routes/tax-lookup.js**

Export a function `(app, deps)` with:
- `GET /api/tax-lookup` — search `tax_rate_reference` (public schema) by HS code or description, filterable by province. Uses `masterDb` or raw pool query against public schema.
- `GET /api/tax-lookup/export` — returns all rows as JSON (frontend converts to Excel via xlsx)
- `POST /api/tax-lookup/suggest` — inserts into `tax_rate_suggestions` in tenant schema. Requires `reference_id`, `field_name`, `suggested_value`. Optional: `source_reference`, `notes`.

All endpoints require authentication (any logged-in user).

**Step 2: Register in registerAllRoutes.js**

```js
// --- ROUTES: TAX LOOKUP ---
require("./tax-lookup")(app, deps);
```

**Step 3: Commit**

```bash
git add backend/routes/tax-lookup.js backend/routes/registerAllRoutes.js
git commit -m "feat(fbr): tax lookup routes — search, export, suggest correction"
```

---

## Task 6: Admin Routes — Tax Rate CRUD + FBR Health

**Files:**
- Modify: `backend/routes/admin.js` (add endpoints at end)

**Step 1: Add tax rate reference CRUD**

In `admin.js`, add these endpoints (all use `requireAllowedIp` + `requireSuperAdmin`):

- `GET /api/admin/tax-rates` — `SELECT * FROM tax_rate_reference ORDER BY hs_code` (public schema, use `db` directly since admin routes run before tenant middleware)
- `POST /api/admin/tax-rates` — INSERT new rate
- `PUT /api/admin/tax-rates/:id` — UPDATE rate
- `DELETE /api/admin/tax-rates/:id` — DELETE rate

**Step 2: Add suggestion review endpoints**

- `GET /api/admin/tax-rate-suggestions` — query across tenant schemas (iterate active tenants, SELECT from each tenant's `tax_rate_suggestions WHERE status = 'pending'`)
- `PUT /api/admin/tax-rate-suggestions/:id` — approve (update reference + mark approved) or reject. Body: `{ status: "approved"|"rejected", tenant_slug }`. Must SET search_path to the correct tenant to update the suggestion row.

**Step 3: Add FBR health endpoint**

- `GET /api/admin/fbr-health` — iterate active tenants with FBR enabled, query each tenant's `fbr_invoices` for: total pending, total failed, avg delay (NOW() - created_at for pending), oldest pending. Return per-tenant stats.

**Step 4: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat(fbr): admin routes — tax rate CRUD, suggestions review, FBR health"
```

---

## Task 7: Hook FBR Enqueue into Sales, Returns, Voids

**Files:**
- Modify: `backend/routes/sales.js` (post-commit section + void endpoint)
- Modify: `backend/routes/returns.js` (post-commit section)

**Step 1: Add FBR enqueue to sales.js POST handler**

After `assignInvoiceNumberToSale` (around line 570), add:

```js
// FBR Digital Invoicing — enqueue if enabled
try {
  const { rows: [ff] } = await db.query(
    "SELECT enabled FROM feature_flags WHERE key = 'fbr_integration'"
  );
  if (ff?.enabled) {
    const { buildInvoicePayload, enqueueFbrInvoice } = require("../services/fbr");
    const { fetchCategoryIndexes } = require("../category-tree");
    const categoryTree = await fetchCategoryIndexes(db);
    const { rows: saleItems } = await db.query(
      `SELECT si.*, p.name as product_name, p.category_id
       FROM sale_items si LEFT JOIN products p ON si.product_id = p.id
       WHERE si.sale_id = $1`, [saleId]
    );
    const { rows: [customer] } = customer_id
      ? await db.query("SELECT name, ntn_cnic FROM customers WHERE id = $1", [customer_id])
      : { rows: [null] };
    const payload = buildInvoicePayload(
      { timestamp: new Date(), invoice_number: invoiceNumber },
      saleItems, req.company, customer, categoryTree
    );
    await enqueueFbrInvoice(db, { saleId, invoiceType: "sale", payload });
    await db.query("UPDATE sales SET fbr_status = 'pending' WHERE id = $1", [saleId]);
  }
} catch (fbrErr) {
  logger.error({ err: fbrErr, saleId }, "FBR enqueue failed (non-blocking)");
}
```

**Step 2: Add FBR cancellation to void endpoint**

In the void handler, after the transaction commits and inventory sync, add:

```js
// FBR: queue debit note if sale was posted to FBR
try {
  const { rows: [sale] } = await db.query(
    "SELECT fbr_status, fbr_irn, invoice_number FROM sales WHERE id = $1", [id]
  );
  if (sale?.fbr_status === "posted") {
    const { buildDebitNotePayload, enqueueFbrInvoice } = require("../services/fbr");
    const payload = buildDebitNotePayload(sale, req.company);
    await enqueueFbrInvoice(db, { saleId: Number(id), invoiceType: "debit_note", payload });
  }
} catch (fbrErr) {
  logger.error({ err: fbrErr, saleId: id }, "FBR void enqueue failed (non-blocking)");
}
```

**Step 3: Add FBR enqueue to returns.js POST handler**

After the transaction commits (after `enqueueInventorySyncEvents`), add similar FBR enqueue logic with `buildCreditNotePayload` and `invoiceType: "credit_note"`.

**Step 4: Commit**

```bash
git add backend/routes/sales.js backend/routes/returns.js
git commit -m "feat(fbr): hook FBR enqueue into sales, returns, and void flows"
```

---

## Task 8: Modify Categories & Customers Routes

**Files:**
- Modify: `backend/routes/categories.js` (accept tax_id, hs_code in POST/PUT)
- Modify: `backend/routes/customers.js` (accept ntn_cnic in POST/PUT)

**Step 1: Update categories.js**

In the POST handler, add `tax_id` and `hs_code` to the destructured body fields and include them in the INSERT query.

In the PUT handler, add `tax_id` and `hs_code` to the merge-with-existing pattern and include in the UPDATE query.

**Step 2: Update customers.js**

In both POST and PUT handlers, add `ntn_cnic` to the destructured body fields and include in INSERT/UPDATE queries. Follow the existing `|| null` pattern for optional fields.

**Step 3: Commit**

```bash
git add backend/routes/categories.js backend/routes/customers.js
git commit -m "feat(fbr): accept tax_id/hs_code on categories, ntn_cnic on customers"
```

---

## Task 9: FBR Worker Process

**Files:**
- Create: `backend/workers/fbr-worker.js`

**Step 1: Create the worker**

The worker is a standalone Node process that:
1. Loads dotenv + creates a pg Pool from `DATABASE_URL`
2. Exposes HTTP `/health` on a configurable port (default 8081)
3. Every 30 seconds: queries master DB for active tenants, checks each tenant's `feature_flags` for `fbr_integration`, processes pending `fbr_invoices`
4. Uses `SET search_path TO tenant_<slug>, public` before querying each tenant
5. Row-locks pending records: `UPDATE fbr_invoices SET status = 'processing' WHERE id = $1 AND status = 'pending' RETURNING *`
6. Calls `postToFbr()` from `services/fbr.js`
7. On success: updates `fbr_invoices` status + `posted_at` + `fbr_irn`, updates `sales.fbr_irn` + `sales.fbr_status` (or returns equivalent)
8. On failure: increments `retry_count`, calculates `next_retry_at` from `getNextRetryDelay()`, stores `last_error`. If `retry_count >= max_retries`, sets `status = 'failed'`
9. Handles SIGTERM gracefully (finish in-flight, then exit)
10. Concurrency: max 5 per tenant, 20 globally via a simple counter

**Step 2: Commit**

```bash
git add backend/workers/fbr-worker.js
git commit -m "feat(fbr): background worker — polls queue, posts to FBR with retry"
```

---

## Task 10: Seed Tax Rate Reference Data

**Files:**
- Create: `backend/scripts/seed-tax-rates.js`

**Step 1: Create seed script**

A one-time script that INSERTs ~100-150 common retail HS codes into `tax_rate_reference` in the public schema. Categories to cover:

- Grocery (essential food items — exempt)
- Packaged food (standard rate)
- Beverages (standard + FED for sugary drinks)
- Textiles/clothing
- Electronics
- Books/stationery
- Toys
- Pharmaceuticals (exempt)
- Cosmetics/toiletries
- Hardware/tools
- Furniture
- Automotive parts
- Sports goods
- Jewelry
- Tobacco (high rate)

Include both English and Urdu descriptions. Rates sourced from FBR's current tax schedule. Include `exemption_notes` with SRO references where applicable.

Run: `node backend/scripts/seed-tax-rates.js`

**Step 2: Commit**

```bash
git add backend/scripts/seed-tax-rates.js
git commit -m "feat(fbr): seed script for tax rate reference data (~100 HS codes)"
```

---

## Task 11: Frontend — FBR Settings Page

**Files:**
- Create: `frontend/src/pages/redesign/FBRSettingsRedesign.jsx`
- Create: `frontend/src/pages/FBRSettingsRoute.jsx` (thin wrapper)
- Modify: `frontend/src/App.jsx` (add lazy import + route)
- Modify: `frontend/src/ui/nav-config.js` (add sidebar entry)

**Step 1: Create FBRSettingsRedesign.jsx**

Page with `PageShell` title "FBR Settings". Form fields:
- NTN (text input, pre-filled from company_profile)
- STRN (text input, pre-filled)
- Province (dropdown: Punjab, Sindh, KPK, Balochistan, ICT, AJK, Gilgit-Baltistan)
- FBR API Token (password input)
- Environment (toggle: Sandbox / Production)
- Default HS Code (text input with "Look up" link)
- "Test Connection" button → calls `POST /api/fbr/test-connection`
- "Save" button → calls `PUT /api/fbr/config`
- Connection status indicator (green/red/grey)

Fetch initial data from `GET /api/fbr/config`.

**Step 2: Create thin route wrapper + add to App.jsx**

```jsx
// FBRSettingsRoute.jsx
import FBRSettingsRedesign from "./redesign/FBRSettingsRedesign";
export default function FBRSettingsRoute() { return <FBRSettingsRedesign />; }
```

In App.jsx, add lazy import and route inside RequireAuth/RequireContext:
```jsx
const FBRSettingsRoute = lazy(() => import("./pages/FBRSettingsRoute"));
// In routes:
<Route path="/settings/fbr" element={<RequirePerm perm="all_access"><FBRSettingsRoute /></RequirePerm>} />
```

**Step 3: Add to nav-config.js**

Add under a new "Compliance" group or under existing "Settings" group:
```js
{ name: "FBR Settings", path: "/settings/fbr", icon: FileCheck, requiredPerm: "all_access", requiredFlag: "fbr_integration" },
```

Import `FileCheck` from `lucide-react`.

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/FBRSettingsRedesign.jsx frontend/src/pages/FBRSettingsRoute.jsx frontend/src/App.jsx frontend/src/ui/nav-config.js
git commit -m "feat(fbr): FBR settings page — config, test connection, province selector"
```

---

## Task 12: Frontend — FBR Dashboard Page

**Files:**
- Create: `frontend/src/pages/redesign/FBRDashboardRedesign.jsx`
- Create: `frontend/src/pages/FBRDashboardRoute.jsx` (thin wrapper)
- Modify: `frontend/src/App.jsx` (add lazy import + route)
- Modify: `frontend/src/ui/nav-config.js` (add sidebar entry)

**Step 1: Create FBRDashboardRedesign.jsx**

Page with `PageShell` title "FBR Invoices". Sections:
- **Summary cards**: Posted Today, Pending, Failed, Total (from `GET /api/fbr/dashboard`)
- **Invoice table**: columns — Invoice #, Date, Amount, Type (sale/credit/debit), FBR Status (dot), FBR IRN, Retry Count
- **Filters**: status dropdown (all/pending/posted/failed), date range picker, search by invoice number
- **Row actions**: Retry (for failed), View Payload (modal with JSON), View Response (modal)
- **Bulk action**: "Retry All Failed" button
- Pagination
- Auto-refresh every 30 seconds

Data from `GET /api/fbr/invoices?status=X&from=X&to=X&page=X`.

**Step 2: Create thin wrapper + add to App.jsx + nav-config.js**

Same pattern as Task 11. Route: `/fbr`. Nav entry:
```js
{ name: "FBR Invoices", path: "/fbr", icon: Receipt, requiredPerm: "all_access", requiredFlag: "fbr_integration" },
```

**Step 3: Commit**

```bash
git add frontend/src/pages/redesign/FBRDashboardRedesign.jsx frontend/src/pages/FBRDashboardRoute.jsx frontend/src/App.jsx frontend/src/ui/nav-config.js
git commit -m "feat(fbr): FBR dashboard page — invoice queue, retry, filters"
```

---

## Task 13: Frontend — Tax Rate Lookup Page

**Files:**
- Create: `frontend/src/pages/redesign/TaxLookupRedesign.jsx`
- Create: `frontend/src/pages/TaxLookupRoute.jsx` (thin wrapper)
- Modify: `frontend/src/App.jsx` (add lazy import + route)
- Modify: `frontend/src/ui/nav-config.js` (add sidebar entry)

**Step 1: Create TaxLookupRedesign.jsx**

Page with `PageShell` title "Tax Rate Lookup". Sections:
- **Province selector** at top (dropdown, affects which provincial rate column is highlighted)
- **Search bar** — search by product name, HS code, or category (EN/UR)
- **Results table**: HS Code, Description (EN), Description (UR), Federal GST, Selected Provincial Rate, Exemption Notes
- **"Download Full Schedule"** button — uses xlsx dynamic import + `downloadCsv` pattern
- **"Suggest Correction"** button per row — opens modal with: field selector (which rate), suggested value, SRO reference, notes. Calls `POST /api/tax-lookup/suggest`
- **Banner**: "Last updated: [date from max(last_updated)]"

Data from `GET /api/tax-lookup?q=search&province=punjab`.

**Step 2: Route, nav entry**

Route: `/tax-lookup`. Nav entry visible to all authenticated users (no requiredPerm):
```js
{ name: "Tax Lookup", path: "/tax-lookup", icon: Search },
```

**Step 3: Commit**

```bash
git add frontend/src/pages/redesign/TaxLookupRedesign.jsx frontend/src/pages/TaxLookupRoute.jsx frontend/src/App.jsx frontend/src/ui/nav-config.js
git commit -m "feat(fbr): tax rate lookup page — province-aware search, export, suggest"
```

---

## Task 14: Frontend — Admin Tax Rates Page

**Files:**
- Create: `frontend/src/pages/admin/AdminTaxRates.jsx`
- Modify: `frontend/src/App.jsx` (add route under admin section)

**Step 1: Create AdminTaxRates.jsx**

Super-admin page with two tabs:
- **Tax Rates** tab: editable table of `tax_rate_reference`. Add/edit/delete rows. Fields: HS Code, Description EN, Description UR, Federal GST, Punjab PRA, Sindh SRB, KPK KPRA, Balochistan BRA, Exemption Notes.
- **Suggestions** tab: pending suggestions from tenants. Shows: tenant name, HS code, field, current value, suggested value, SRO reference, notes. Actions: Approve (auto-updates reference rate), Reject.

Data from `GET /api/admin/tax-rates` and `GET /api/admin/tax-rate-suggestions`.

**Step 2: Add route in App.jsx**

Under the existing admin routes section:
```jsx
<Route path="/admin/tax-rates" element={<AdminTaxRates />} />
```

**Step 3: Commit**

```bash
git add frontend/src/pages/admin/AdminTaxRates.jsx frontend/src/App.jsx
git commit -m "feat(fbr): admin tax rates page — CRUD + suggestion review"
```

---

## Task 15: Frontend — Category & Customer Form Updates

**Files:**
- Modify: Category create/edit component (find via grep for category POST/PUT form)
- Modify: Customer create/edit component (find via grep for customer POST/PUT form)

**Step 1: Add tax_id and hs_code to category form**

Add:
- Tax dropdown (fetched from `GET /api/taxes`). Show hint: "Inherited from parent: [parent tax name]" when the category has a parent with a tax set.
- HS Code text input. Show hint: "Inherited from parent: [parent HS code]" when applicable.
- "Look up HS code" link that navigates to `/tax-lookup`.

**Step 2: Add ntn_cnic to customer form**

Add: NTN/CNIC text input (optional). Label: "NTN / CNIC (for FBR invoicing)".

**Step 3: Commit**

```bash
git add [category form file] [customer form file]
git commit -m "feat(fbr): add tax/HS code to category form, NTN/CNIC to customer form"
```

---

## Task 16: Frontend — Receipt & Sales History Updates

**Files:**
- Modify: `frontend/src/utils/receipt.js` (add FBR IRN + QR code section)
- Modify: Sales History page (add FBR status column)

**Step 1: Update receipt.js**

In `buildReceiptSections()` or `buildReceiptHtml()`, after existing receipt content, add:
- If `sale.fbr_irn` exists: render "FBR Ref: [IRN]" + QR code (use a QR code library or inline SVG)
- If `sale.fbr_status === 'pending'`: render "FBR: Processing..."
- If `sale.fbr_status === 'failed'`: render "FBR: Pending" (don't alarm customer)

**Step 2: Update Sales History**

Add a new column "FBR" with dot indicators:
- Green dot = `posted`
- Amber dot = `pending`
- Red dot = `failed`
- Grey dot / no dot = `not_applicable`

Only show this column when `fbr_integration` feature flag is enabled.

**Step 3: Commit**

```bash
git add frontend/src/utils/receipt.js [sales history file]
git commit -m "feat(fbr): FBR IRN on receipts, FBR status in sales history"
```

---

## Task 17: Update CLAUDE.md and ROADMAP.md

**Files:**
- Modify: `CLAUDE.md` (add FBR section)
- Modify: `ROADMAP.md` (add FBR integration entry)

**Step 1: Update CLAUDE.md**

Add FBR integration section covering: feature flag, routes, worker process, migration v9, category inheritance.

**Step 2: Update ROADMAP.md**

Add a `## FBR Digital Invoicing (Mar 2026)` section describing what was built. Move "FBR real-time API" from deferred to completed.

**Step 3: Commit**

```bash
git add CLAUDE.md ROADMAP.md
git commit -m "docs: add FBR Digital Invoicing to CLAUDE.md and ROADMAP.md"
```

---

## Task 18: Push Branch

**Step 1: Push to remote**

```bash
git push -u origin feature/fbr-digital-invoicing
```

---

## Build Sequence Summary

| Task | What | Dependencies |
|------|------|-------------|
| 1 | Migration v9 | None |
| 2 | Category tree extension | Task 1 |
| 3 | FBR service | Task 1 |
| 4 | FBR routes | Tasks 1, 3 |
| 5 | Tax lookup routes | Task 1 |
| 6 | Admin tax rate routes | Task 1 |
| 7 | Hook into sales/returns/voids | Tasks 1, 2, 3 |
| 8 | Categories/customers routes | Task 1 |
| 9 | FBR worker | Tasks 1, 3 |
| 10 | Seed tax rate data | Task 1 |
| 11 | FBR settings page | Task 4 |
| 12 | FBR dashboard page | Task 4 |
| 13 | Tax lookup page | Task 5 |
| 14 | Admin tax rates page | Task 6 |
| 15 | Category/customer form updates | Task 8 |
| 16 | Receipt + sales history updates | Task 7 |
| 17 | Docs update | All |
| 18 | Push branch | All |

**Parallelizable groups:**
- Tasks 2, 3, 10 can run in parallel (all depend only on Task 1)
- Tasks 4, 5, 6, 7, 8 can partially parallelize after their deps
- Tasks 11-16 (frontend) can parallelize after their backend deps
