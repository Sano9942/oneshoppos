# Currency & Timezone Centralization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all hardcoded PKR/Rs currency references with a dynamic, tenant-aware currency system powered by a CurrencyProvider context. Expand timezone selection to full IANA list. Make cash denominations configurable.

**Architecture:** New `CurrencyProvider` wraps the app in `main.jsx` (outside AuthProvider). It fetches currency/denominations from a new unauthenticated endpoint `GET /api/company-profile/currency`. All 56 frontend files and 5 backend files with hardcoded currency are updated to use the dynamic source.

**Tech Stack:** React Context API, PostgreSQL (schema migration), Express endpoint, `Intl.supportedValuesOf('timeZone')`

---

## Task 1: Schema Migration — Add `cash_denominations` Column

**Files:**
- Modify: `backend/migrate-pg.js` (add version 2 migration)
- Modify: `backend/schema-pg.sql` (add column to CREATE TABLE for fresh installs)

**Step 1: Add migration to migrate-pg.js**

In the `MIGRATIONS` array, add a new entry after the existing version 1:

```javascript
{
  version: 2,
  description: "Add cash_denominations to company_profile",
  up: async (client) => {
    await client.query(`
      ALTER TABLE company_profile
        ADD COLUMN IF NOT EXISTS cash_denominations TEXT DEFAULT '[5000,1000,500,100,50,20,10]'
    `);
  },
},
```

**Step 2: Update schema-pg.sql**

In the `company_profile` CREATE TABLE block (after line 643, before the closing `);`), add:

```sql
  cash_denominations TEXT DEFAULT '[5000,1000,500,100,50,20,10]'
```

**Step 3: Run migration locally**

```bash
cd backend && node -e "const db = require('./db-pg'); require('./migrate-pg').then(() => db.getPool().end())"
```

Expected: Migration applies version 2 successfully.

**Step 4: Verify column exists**

```bash
cd backend && node -e "const db = require('./db-pg'); db.query(\"SELECT cash_denominations FROM company_profile WHERE id=1\").then(r => { console.log(r.rows[0]); db.getPool().end(); })"
```

Expected: `{ cash_denominations: '[5000,1000,500,100,50,20,10]' }`

**Step 5: Commit**

```bash
git add backend/migrate-pg.js backend/schema-pg.sql
git commit -m "feat: add cash_denominations column to company_profile"
```

---

## Task 2: Backend — New Currency Endpoint

**Files:**
- Modify: `backend/routes/tier4/company-profile.js` (add GET /currency route at line 25)

**Step 1: Add unauthenticated currency endpoint**

After the existing GET route (line 24) and before the PUT route (line 26), add:

```javascript
  // GET /api/company-profile/currency — public (no auth)
  // Used by CurrencyProvider on frontend mount
  router.get("/currency", async (req, res) => {
    try {
      const { rows: [row] } = await db.query(
        "SELECT currency_symbol, currency_code, cash_denominations FROM company_profile WHERE id = 1"
      );
      if (!row) return res.json({ symbol: "$", code: "USD", denominations: [100, 50, 20, 10, 5, 1] });
      let denominations;
      try { denominations = JSON.parse(row.cash_denominations || "[]"); } catch { denominations = [100, 50, 20, 10, 5, 1]; }
      res.json({
        symbol: row.currency_symbol || "$",
        code: row.currency_code || "USD",
        denominations,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to load currency" });
    }
  });
```

**Important:** This route must NOT have `requireFeature` or `requirePerm` middleware — it's public so CurrencyProvider works on unauthenticated pages (CustomerDisplay, SetupWizard).

**Step 2: Add `cash_denominations` to the PUT route**

In the PUT route destructuring (around line 32), add `cash_denominations` to the destructured fields. In the UPDATE SQL, add `cash_denominations = COALESCE($N, cash_denominations)` with the appropriate parameter number.

**Step 3: Test manually**

```bash
curl http://localhost:5000/api/company-profile/currency
```

Expected: `{"symbol":"Rs","code":"PKR","denominations":[5000,1000,500,100,50,20,10]}`

**Step 4: Commit**

```bash
git add backend/routes/tier4/company-profile.js
git commit -m "feat: add public GET /api/company-profile/currency endpoint"
```

---

## Task 3: Backend — Fix Hardcoded Currency in 5 Files

**Files:**
- Modify: `backend/utils/receiptEmail.js` (line 26)
- Modify: `backend/utils/digestEmail.js` (lines 14, 17)
- Modify: `backend/services/printer.js` (line 47)
- Modify: `backend/routes/tier4/crm.js` (lines 544-545, 569)
- Modify: `backend/routes/grn.js` (line 204)

**Step 1: Fix receiptEmail.js**

Change the `fmt` function to accept `currencySymbol` as a parameter:

```javascript
// Before:
function fmt(n) { return `PKRs ${Number(n || 0).toLocaleString(...)}`; }

// After:
function fmt(n, currencySymbol = "$") { return `${currencySymbol} ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
```

Update the exported `buildReceiptEmailHtml` function signature to accept `currencySymbol` and pass it through to all `fmt()` calls.

Then update the caller in `backend/routes/email.js` — pass `req.company?.currency_symbol || "$"` when calling the receipt email builder.

**Step 2: Fix digestEmail.js**

Line 14: Change fallback from `"PKRs"` to `"$"`.
Line 17: Change `"en-PK"` to `"en-US"` (neutral locale for uniform formatting).

**Step 3: Fix printer.js**

Line 47: Change the `fmt` function to accept `currencySymbol` parameter. Update `loadConfig` or the print function to read symbol from company profile or printer config.

The caller in `backend/routes/printer.js` should pass `req.company?.currency_symbol || "$"`.

**Step 4: Fix crm.js**

Lines 544-545, 569: Replace `PKRs` with `${req.company?.currency_symbol || "$"}`.

**Step 5: Fix grn.js**

Line 204: Replace `PKRs` with `${req.company?.currency_symbol || "$"}`.

**Step 6: Commit**

```bash
git add backend/utils/receiptEmail.js backend/utils/digestEmail.js backend/services/printer.js backend/routes/tier4/crm.js backend/routes/grn.js backend/routes/email.js backend/routes/printer.js
git commit -m "fix: replace hardcoded PKR currency with dynamic company profile symbol in backend"
```

---

## Task 4: Frontend — Create CurrencyContext

**Files:**
- Create: `frontend/src/contexts/CurrencyContext.jsx`
- Modify: `frontend/src/main.jsx` (wrap with CurrencyProvider)

**Step 1: Create CurrencyContext.jsx**

```jsx
import { createContext, useContext, useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "";

const CurrencyContext = createContext({
  symbol: "$",
  code: "USD",
  denominations: [100, 50, 20, 10, 5, 1],
  fmt: (n) => `$ ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  refresh: () => {},
});

export function CurrencyProvider({ children }) {
  const [currency, setCurrency] = useState({
    symbol: "$",
    code: "USD",
    denominations: [100, 50, 20, 10, 5, 1],
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/company-profile/currency`);
      if (res.ok) {
        const data = await res.json();
        setCurrency({
          symbol: data.symbol || "$",
          code: data.code || "USD",
          denominations: Array.isArray(data.denominations) ? data.denominations : [100, 50, 20, 10, 5, 1],
        });
      }
    } catch {
      // Silently use defaults on failure
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmt = useCallback(
    (n) => `${currency.symbol} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    [currency.symbol]
  );

  return (
    <CurrencyContext.Provider value={{ ...currency, fmt, refresh: load }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  return useContext(CurrencyContext);
}
```

**Step 2: Wrap in main.jsx**

```jsx
import { CurrencyProvider } from './contexts/CurrencyContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <CurrencyProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </CurrencyProvider>
  </StrictMode>,
)
```

**Step 3: Verify in browser**

Open dev tools console: React DevTools → find CurrencyContext.Provider → verify value shows `{ symbol: "Rs", code: "PKR", denominations: [...], fmt: fn }`.

**Step 4: Commit**

```bash
git add frontend/src/contexts/CurrencyContext.jsx frontend/src/main.jsx
git commit -m "feat: add CurrencyProvider context for dynamic currency formatting"
```

---

## Task 5: Frontend — Fix Cascade Sources (3 files → 27 children auto-fixed)

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx` (line 140-145)
- Modify: `frontend/src/pages/reports/ReportShared.jsx` (line 6)
- Modify: `frontend/src/pages/dashboard/DashboardShared.jsx` (lines 3-7)

**Step 1: Fix POSContext.jsx**

Replace the `money()` function (lines 140-145):

```javascript
// Before:
const money = (v) =>
  new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    minimumFractionDigits: 0,
  }).format(v || 0);

// After:
import { useCurrency } from "../../../contexts/CurrencyContext";

// Inside the POSProvider component, near top:
const { fmt: money, denominations: currencyDenominations } = useCurrency();
```

Remove the old `money` function definition. Export `currencyDenominations` through the POS context value for shift modals.

This auto-fixes: POSCartTable, POSSearchArea, POSCheckoutModal, POSReceiptModal, POSRedesign, POSSidebar (they all use `money` from POS context).

**Step 2: Fix ReportShared.jsx**

```javascript
// Before (line 6):
export const fmt = (n) => "PKRs " + Number(n || 0).toFixed(2);

// After:
// ReportShared can't use hooks (not a component), so export a factory:
export { useCurrency } from "../../contexts/CurrencyContext";
// Keep fmt as a fallback for non-component contexts:
export const fmt = (n) => Number(n || 0).toFixed(2);
```

**However**, since all 13 report modules are React components, the cleaner approach is:
- Remove the `fmt` export from ReportShared.jsx
- In each report module, add `const { fmt } = useCurrency()` directly

This is 13 small changes but each is a one-line addition + removal of the `fmt` import from ReportShared.

**Step 3: Fix DashboardShared.jsx**

```javascript
// Before (lines 3-7):
export function useCurrency(data) {
  const symbol = data?.currency?.symbol || "PKRs";
  return (n) => `${symbol} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// After:
export { useCurrency } from "../../contexts/CurrencyContext";
```

Then update the 7 dashboard components: change `const fmt = useCurrency(data)` to `const { fmt } = useCurrency()`.

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/pos/POSContext.jsx frontend/src/pages/reports/ReportShared.jsx frontend/src/pages/dashboard/DashboardShared.jsx
git commit -m "feat: wire cascade currency sources to CurrencyProvider"
```

---

## Task 6: Frontend — Fix Dashboard Components (7 files)

**Files:**
- Modify: `frontend/src/pages/dashboard/DashboardKPICards.jsx`
- Modify: `frontend/src/pages/dashboard/DashboardTrends.jsx`
- Modify: `frontend/src/pages/dashboard/DashboardContribution.jsx`
- Modify: `frontend/src/pages/dashboard/DashboardExceptions.jsx`
- Modify: `frontend/src/pages/dashboard/DashboardInventoryAlerts.jsx`
- Modify: `frontend/src/pages/dashboard/DashboardOutletRanking.jsx`
- Modify: `frontend/src/pages/dashboard/DashboardRecentSales.jsx`

**Step 1: In each file**

Change:
```javascript
import { useCurrency } from "./DashboardShared";
const fmt = useCurrency(data);
```

To:
```javascript
import { useCurrency } from "../../contexts/CurrencyContext";
const { fmt } = useCurrency();
```

Remove `data` parameter dependency from `useCurrency` call.

**Step 2: Commit**

```bash
git add frontend/src/pages/dashboard/Dashboard*.jsx
git commit -m "feat: wire dashboard components to CurrencyProvider"
```

---

## Task 7: Frontend — Fix Report Modules (13 files)

**Files:**
- Modify: `frontend/src/pages/reports/ReportsSales.jsx`
- Modify: `frontend/src/pages/reports/ReportsInventory.jsx`
- Modify: `frontend/src/pages/reports/ReportsFinance.jsx`
- Modify: `frontend/src/pages/reports/ReportsPurchasing.jsx`
- Modify: `frontend/src/pages/reports/ReportsOperations.jsx`
- Modify: `frontend/src/pages/reports/ReportsCatalog.jsx`
- Modify: `frontend/src/pages/reports/ReportsAnalytics.jsx`
- Modify: `frontend/src/pages/reports/ReportsAudit.jsx`
- Modify: `frontend/src/pages/reports/ReportsCustomers.jsx`
- Modify: `frontend/src/pages/reports/ReportsStaff.jsx`
- Modify: `frontend/src/pages/reports/ReportsShifts.jsx`
- Modify: `frontend/src/pages/reports/ReportsGovernance.jsx`
- Modify: `frontend/src/pages/Reports.jsx`

**Step 1: In each file**

Change:
```javascript
import { fmt } from "./ReportShared";
// or
import { fmt } from "../reports/ReportShared";
```

To:
```javascript
import { useCurrency } from "../../contexts/CurrencyContext";
// Inside the component:
const { fmt } = useCurrency();
```

Note: `Reports.jsx` imports from `"./reports/ReportShared"` — adjust import path accordingly.

**Step 2: Commit**

```bash
git add frontend/src/pages/reports/*.jsx frontend/src/pages/Reports.jsx
git commit -m "feat: wire report modules to CurrencyProvider"
```

---

## Task 8: Frontend — Fix Individual Redesign Files (20 files)

**Files:** All files with local `money()` or `fmt()` functions.

Each file follows the same pattern:

**Step 1: For each file, replace local formatter**

Remove:
```javascript
const money = (v) => "PKRs " + Number(v || 0).toFixed(2);
// or
const fmt = (v) => "PKRs " + Number(v || 0).toFixed(2);
```

Add:
```javascript
import { useCurrency } from "../../contexts/CurrencyContext";
// Inside the component function:
const { fmt } = useCurrency();
// If the file used `money`, rename all `money(` calls to `fmt(` — or:
const { fmt: money } = useCurrency();
```

**Files and their local formatter variable names:**

| File | Local var | Replace with |
|------|-----------|-------------|
| `SalesHistoryRedesign.jsx` | `money` | `const { fmt: money } = useCurrency()` |
| `ReturnsRedesign.jsx` | `money` | `const { fmt: money } = useCurrency()` |
| `ReturnedStockRedesign.jsx` | `money` | `const { fmt: money } = useCurrency()` |
| `CustomersRedesign.jsx` | `money` | `const { fmt: money } = useCurrency()` |
| `ExpensesRedesign.jsx` | `money` | `const { fmt: money } = useCurrency()` |
| `SuppliersRedesign.jsx` | `fmt` | `const { fmt } = useCurrency()` |
| `SupplierPayablesRedesign.jsx` | `money` | `const { fmt: money } = useCurrency()` |
| `PurchaseOrdersRedesign.jsx` | `money` | `const { fmt: money } = useCurrency()` |
| `HRManagementRedesign.jsx` | `money` | `const { fmt: money } = useCurrency()` |
| `CashManagementRedesign.jsx` | `fmt` | `const { fmt } = useCurrency()` — also replace hardcoded denominations |
| `QuotationsRedesign.jsx` | `money` | `const { fmt: money } = useCurrency()` |
| `CRMRedesign.jsx` | `money` | `const { fmt: money } = useCurrency()` |
| `PromotionsRedesign.jsx` | `money` | `const { fmt: money } = useCurrency()` — also fix `Number()` bug |
| `ReportsPowerUpPanel.jsx` | `money` | `const { fmt: money } = useCurrency()` |
| `Accounting.jsx` | `fmt` | `const { fmt } = useCurrency()` |
| `InvoiceView.jsx` | `fmt` | `const { fmt } = useCurrency()` |
| `ParkedSalesRedesign.jsx` | inline | Replace `"PKRs " + ...toFixed(2)` with `fmt(value)` |
| `OrdersRedesign.jsx` | inline | Replace `"PKRs " + ...toFixed(2)` with `fmt(value)` |
| `InventoryRedesign.jsx` | inline | Replace `"PKRs " + ...toFixed(2)` with `fmt(value)` |
| `BarcodeTemplates.jsx` | inline | Replace `"PKRs " + ...toFixed(2)` with `fmt(value)` |

**Step 2: Commit in batches**

```bash
git add frontend/src/pages/redesign/*.jsx frontend/src/pages/Accounting.jsx frontend/src/pages/InvoiceView.jsx frontend/src/pages/BarcodeTemplates.jsx
git commit -m "feat: replace hardcoded currency in 20 redesign/page files"
```

---

## Task 9: Frontend — Fix POS Special Cases (5 files)

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSRecentSalesPanel.jsx` (line 9)
- Modify: `frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx` (lines 7, 527)
- Modify: `frontend/src/pages/redesign/pos/POSOpeningGateModal.jsx` (lines 126, 161)
- Modify: `frontend/src/pages/redesign/pos/POSCloseShiftModal.jsx` (lines 6, 106-108, 128, 149)
- Modify: `frontend/src/pages/redesign/pos/POSSidebar.jsx` (line 127)

**Step 1: POSRecentSalesPanel.jsx and POSReturnExchangeModal.jsx**

These define their own local `money()` — replace with `useCurrency()`:

```javascript
import { useCurrency } from "../../../contexts/CurrencyContext";
// Inside component:
const { fmt: money } = useCurrency();
```

For POSReturnExchangeModal line 527, replace `"PKRs 0.00"` with `money(0)`.

**Step 2: POSOpeningGateModal.jsx and POSCloseShiftModal.jsx**

These have hardcoded denominations and inline `"PKR"` / `"Rs"` formatting.

Replace hardcoded `DENOMS` array:
```javascript
// Before:
const DENOMS = [5000, 1000, 500, 100, 50, 20, 10];

// After:
import { useCurrency } from "../../../contexts/CurrencyContext";
// Inside component:
const { fmt: money, denominations, symbol } = useCurrency();
// Use `denominations` instead of `DENOMS`
```

Replace inline `"PKR {value.toFixed(2)}"` with `money(value)`.
Replace `"Rs {denomination}"` labels with `{symbol} {denomination}`.

**Step 3: POSSidebar.jsx**

Line 127: Replace `"PKR " + discountInput` with `symbol + " " + discountInput` (using `symbol` from `useCurrency()`).

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/pos/POS*.jsx
git commit -m "feat: replace hardcoded currency in POS special case files"
```

---

## Task 10: Frontend — Fix receipt.js (utility, not a component)

**Files:**
- Modify: `frontend/src/utils/receipt.js` (lines 64-70 + function signatures)
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx` (where it calls receipt functions)

**Step 1: Update receipt.js fmt() to accept symbol parameter**

```javascript
// Before (lines 64-70):
function fmt(n) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency", currency: "PKR", minimumFractionDigits: 0,
  }).format(n || 0);
}

// After:
function makeFmt(symbol = "$") {
  return (n) => `${symbol} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
```

**Step 2: Update buildReceiptHtml and buildReceiptSections signatures**

```javascript
// Before:
export function buildReceiptSections(slip, template) { ... }
export function buildReceiptHtml(slip, template) { ... }

// After:
export function buildReceiptSections(slip, template, currencySymbol = "$") { ... }
export function buildReceiptHtml(slip, template, currencySymbol = "$") {
  const fmt = makeFmt(currencySymbol);
  // ... rest uses fmt() as before
}
```

**Step 3: Update POSContext.jsx callers**

Where POSContext calls `buildReceiptHtml(slip, template)`, change to:
```javascript
const { symbol } = useCurrency(); // already imported in Task 5
buildReceiptHtml(slip, template, symbol);
```

Same for `buildReceiptSections` calls (e.g., in POSReceiptModal).

**Step 4: Commit**

```bash
git add frontend/src/utils/receipt.js frontend/src/pages/redesign/pos/POSContext.jsx frontend/src/pages/redesign/pos/POSReceiptModal.jsx
git commit -m "feat: pass dynamic currency symbol to receipt utilities"
```

---

## Task 11: Frontend — Fix CustomerDisplayPage.jsx

**Files:**
- Modify: `frontend/src/pages/CustomerDisplayPage.jsx` (lines 60-65)

**Step 1: Replace local money function**

```javascript
// Before:
const money = (n) => Number(n || 0).toLocaleString(undefined, {...});

// After:
import { useCurrency } from "../contexts/CurrencyContext";
// Inside component:
const { fmt: money } = useCurrency();
```

**Step 2: Commit**

```bash
git add frontend/src/pages/CustomerDisplayPage.jsx
git commit -m "feat: wire CustomerDisplayPage to CurrencyProvider"
```

---

## Task 12: Setup Wizard — Full Timezone + Currency + Denominations

**Files:**
- Modify: `frontend/src/pages/SetupWizard.jsx`

**Step 1: Add full IANA timezone list**

Replace the limited `timezones` derived from `COUNTRY_DATA[country].timezones` with the full list:

```javascript
const ALL_TIMEZONES = Intl.supportedValuesOf("timeZone");
```

Keep the country auto-fill (`COUNTRY_DATA[country].timezones[0]`), but the dropdown shows ALL_TIMEZONES with the auto-filled one pre-selected.

Add a search filter to the timezone dropdown:
```javascript
const [tzSearch, setTzSearch] = useState("");
const filteredTz = ALL_TIMEZONES.filter(tz => tz.toLowerCase().includes(tzSearch.toLowerCase()));
```

**Step 2: Add denomination presets per country**

```javascript
const COUNTRY_DENOMS = {
  Pakistan: [5000, 1000, 500, 100, 50, 20, 10],
  "United States": [100, 50, 20, 10, 5, 1],
  "United Kingdom": [50, 20, 10, 5, 2, 1],
  "United Arab Emirates": [1000, 500, 200, 100, 50, 20, 10, 5],
  India: [2000, 500, 200, 100, 50, 20, 10],
  "Saudi Arabia": [500, 200, 100, 50, 10, 5, 1],
  Canada: [100, 50, 20, 10, 5],
  Australia: [100, 50, 20, 10, 5],
  Other: [100, 50, 20, 10, 5, 1],
};
```

Auto-fill when country changes (alongside currency + timezone).

**Step 3: Add denominations to form state**

```javascript
const [form, setForm] = useState({
  ...existing fields,
  denominations: [5000, 1000, 500, 100, 50, 20, 10],
});
```

Auto-fill on country change:
```javascript
if (field === "country") {
  next.denominations = COUNTRY_DENOMS[value] || COUNTRY_DENOMS.Other;
}
```

**Step 4: Add denomination chip editor UI in Step 2**

After the currency fields, add:

```jsx
<Field label="Cash Denominations">
  <div className="flex flex-wrap gap-2">
    {form.denominations
      .sort((a, b) => b - a)
      .map((d) => (
        <span key={d} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-sm">
          {d}
          <button type="button" onClick={() => removeDenom(d)} className="text-blue-400 hover:text-red-500">×</button>
        </span>
      ))}
  </div>
  <div className="flex gap-2 mt-2">
    <input type="number" className={inputCls} placeholder="Add denomination"
      value={denomInput} onChange={(e) => setDenomInput(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDenom(); } }} />
    <button type="button" onClick={addDenom} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">Add</button>
  </div>
</Field>
```

Helper functions:
```javascript
const [denomInput, setDenomInput] = useState("");
const addDenom = () => {
  const v = parseInt(denomInput, 10);
  if (v > 0 && !form.denominations.includes(v)) {
    set("denominations", [...form.denominations, v].sort((a, b) => b - a));
  }
  setDenomInput("");
};
const removeDenom = (d) => set("denominations", form.denominations.filter(x => x !== d));
```

**Step 5: Send denominations in form submission**

In the POST body (around line 183), add `cash_denominations: JSON.stringify(form.denominations)`.

Update `backend/routes/setup.js` to accept and store `cash_denominations` in the company_profile UPDATE.

**Step 6: Commit**

```bash
git add frontend/src/pages/SetupWizard.jsx backend/routes/setup.js
git commit -m "feat: setup wizard — full IANA timezone list, editable denominations"
```

---

## Task 13: Company Settings — Timezone Dropdown + Denomination Editor

**Files:**
- Modify: `frontend/src/pages/redesign/CompanySettingsRedesign.jsx`

**Step 1: Replace timezone text input with IANA dropdown**

Replace the plain `<Input>` for timezone (lines 270-276) with a searchable select:

```jsx
const ALL_TIMEZONES = Intl.supportedValuesOf("timeZone");
const [tzSearch, setTzSearch] = useState("");

<FormField label="Timezone">
  <input placeholder="Search timezones..." value={tzSearch}
    onChange={(e) => setTzSearch(e.target.value)} className={inputCls} />
  <select className={selectCls} value={form.timezone || ""}
    onChange={(e) => upd("timezone", e.target.value)}>
    {ALL_TIMEZONES
      .filter(tz => tz.toLowerCase().includes(tzSearch.toLowerCase()))
      .map(tz => <option key={tz} value={tz}>{tz}</option>)}
  </select>
</FormField>
```

**Step 2: Add denomination chip editor**

Same chip/tag UI as the setup wizard (Task 12 Step 4). Add a "Cash Denominations" section after the currency fields.

Parse `form.cash_denominations` from JSON string to array on load, and stringify back to JSON on save.

**Step 3: Call `refresh()` from CurrencyProvider after save**

```javascript
import { useCurrency } from "../../contexts/CurrencyContext";
const { refresh } = useCurrency();

// After successful save:
refresh(); // Re-fetches currency data so the whole app updates
```

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/CompanySettingsRedesign.jsx
git commit -m "feat: company settings — full timezone dropdown, editable denominations"
```

---

## Task 14: Smoke Test & Cleanup

**Step 1: Start backend and frontend**

```bash
cd backend && npm start &
cd frontend && npm run dev &
```

**Step 2: Verify currency displays correctly**

- Login → Dashboard → KPI cards should show `Rs` prefix (not `PKRs`)
- POS → add item to cart → prices show `Rs` prefix
- Reports → any report tab → amounts show `Rs` prefix
- Company Settings → change currency to `$` / `USD` → save → verify all pages update

**Step 3: Verify denominations**

- POS → open shift → denomination chips should match company_profile
- POS → close shift → same denominations
- Cash Management → same denominations

**Step 4: Verify setup wizard**

- Navigate to `/setup` (if accessible in dev mode)
- Select different countries → verify timezone auto-fills, currency auto-fills, denominations auto-fill
- Add/remove a denomination chip → verify it works

**Step 5: Verify receipts**

- Complete a sale in POS → print receipt → verify currency symbol
- Email receipt → verify currency symbol in email HTML

**Step 6: Run existing tests**

```bash
cd backend && npx jest --forceExit 2>&1 | tail -20
```

Expected: No new failures (currency changes are display-only, not business logic).

**Step 7: Final commit**

```bash
git add -A
git commit -m "chore: cleanup after currency centralization"
```

---

## Summary

| Task | Description | Files | Effort |
|------|-------------|-------|--------|
| 1 | Schema migration (cash_denominations) | 2 | 5 min |
| 2 | Backend currency endpoint | 1 | 10 min |
| 3 | Backend fix hardcoded currency | 7 | 15 min |
| 4 | CurrencyContext + main.jsx | 2 | 10 min |
| 5 | Fix cascade sources (POS/Report/Dashboard) | 3 | 15 min |
| 6 | Fix dashboard components | 7 | 10 min |
| 7 | Fix report modules | 13 | 15 min |
| 8 | Fix individual redesign files | 20 | 25 min |
| 9 | Fix POS special cases | 5 | 15 min |
| 10 | Fix receipt.js utility | 3 | 10 min |
| 11 | Fix CustomerDisplayPage | 1 | 5 min |
| 12 | Setup wizard enhancements | 2 | 20 min |
| 13 | Company settings enhancements | 1 | 15 min |
| 14 | Smoke test & cleanup | 0 | 15 min |
| **Total** | | **~58 files** | **~3 hours** |
