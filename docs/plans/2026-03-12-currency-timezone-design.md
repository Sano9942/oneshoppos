# Currency & Timezone Centralization Design

**Date:** 2026-03-12
**Goal:** Replace all hardcoded PKR/Rs currency references with a dynamic, tenant-aware currency system. Expand timezone selection to full IANA list. Make cash denominations configurable per tenant.

## Context

The app has 56+ frontend files and 5 backend files with hardcoded Pakistani Rupee references (`"PKRs"`, `"Rs"`, `"PKR"`, `"en-PK"`). This blocks multi-tenant deployment where each tenant may use a different currency. Timezone selection in the setup wizard is limited to 22 countries.

## Decisions

- **Currency display format:** Uniform `{symbol} {amount}` (e.g., `Rs 1,234.56`, `$ 1,234.56`, `€ 1,234.56`) — no locale-aware symbol placement
- **Currency source:** `company_profile` table (already has `currency_symbol` + `currency_code`)
- **Frontend architecture:** New `CurrencyProvider` context (not coupled to AuthProvider) — works on unauthenticated pages like CustomerDisplay
- **Denominations:** Stored in `company_profile.cash_denominations` (JSON array), auto-filled by country, editable by customer
- **Timezone:** Full IANA list via `Intl.supportedValuesOf('timeZone')`, auto-filled by country but overridable

## Schema Change

Add `cash_denominations` column to `company_profile`:

```sql
ALTER TABLE company_profile
  ADD COLUMN cash_denominations TEXT DEFAULT '[5000,1000,500,100,50,20,10]';
```

Bump schema version in `migrate-pg.js`.

## Backend Changes

### New endpoint

**`GET /api/company-profile/currency`** (no auth required)

```json
{ "symbol": "Rs", "code": "PKR", "denominations": [5000, 1000, 500, 100, 50, 20, 10] }
```

Added to `routes/tier4/company-profile.js`. Reads from `company_profile` row 1.

### Fix hardcoded currency in 5 files

| File | Current | Change |
|------|---------|--------|
| `utils/receiptEmail.js` | `"PKRs"` + `"en-PK"` | Accept `currencySymbol` parameter |
| `utils/digestEmail.js` | Fallback `"PKRs"` | Change fallback to `"$"` (neutral default) |
| `services/printer.js` | `"Rs "` + `"en-PK"` | Read symbol from printer config or parameter |
| `routes/tier4/crm.js` | `"PKRs"` in quotation email (3 places) | Use `req.company.currency_symbol` |
| `routes/grn.js` | `"PKRs"` in error message | Use `req.company.currency_symbol` |

### Callers that pass currency to email/printer

- `POST /api/email/send-receipt` (in `routes/email.js`) — pass `req.company.currency_symbol` to `receiptEmail.js`
- `POST /api/print/receipt` (in `routes/printer.js`) — pass symbol to `PrinterService`
- EOD digest builder (in `routes/reports/governance.js`) — already passes `currency` object, just fix fallback

## Frontend Changes

### New file: `frontend/src/contexts/CurrencyContext.jsx`

```jsx
const CurrencyContext = createContext({ symbol: "$", code: "USD", fmt: (n) => `$ ${n}`, denominations: [] });

export function CurrencyProvider({ children }) {
  // Fetches GET /api/company-profile/currency on mount
  // Provides: symbol, code, fmt(amount), denominations
}

export function useCurrency() {
  return useContext(CurrencyContext);
}
```

`fmt(1234.56)` returns `"Rs 1,234.56"` — uniform format: `{symbol} {Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.

### Wrap in App.jsx

```jsx
<CurrencyProvider>
  <AuthProvider>
    ...
  </AuthProvider>
</CurrencyProvider>
```

### Cascade fixes (change source, children auto-fixed)

| Source file | Change | Children auto-fixed |
|-------------|--------|---------------------|
| `POSContext.jsx` `money()` | Replace with `useCurrency().fmt` | POSCartTable, POSSearchArea, POSCheckoutModal, POSReceiptModal, POSRedesign, POSSidebar (7 files) |
| `ReportShared.jsx` `fmt()` | Replace with `useCurrency().fmt` | All 13 report modules |
| `DashboardShared.jsx` `useCurrency(data)` | Delete — replaced by global `useCurrency()` | All 7 dashboard components |

### Individual fixes (~20 files)

Each file: delete local `money()`/`fmt()` function, add `const { fmt } = useCurrency()`.

Files: SalesHistoryRedesign, ReturnsRedesign, ReturnedStockRedesign, CustomersRedesign, ExpensesRedesign, SuppliersRedesign, SupplierPayablesRedesign, PurchaseOrdersRedesign, HRManagementRedesign, CashManagementRedesign, QuotationsRedesign, CRMRedesign, PromotionsRedesign, ReportsPowerUpPanel, Accounting, InvoiceView, ParkedSalesRedesign, OrdersRedesign, InventoryRedesign, BarcodeTemplates.

### Special cases

| File | Handling |
|------|----------|
| `receipt.js` | Not a component — accept `symbol` parameter in `buildReceiptHtml(slip, template, symbol)` and `buildReceiptSections(slip, template, symbol)`. POSContext passes symbol from `useCurrency()`. |
| `POSCloseShiftModal.jsx` | Replace hardcoded `DENOMS = [5000,...]` with `useCurrency().denominations` |
| `POSOpeningGateModal.jsx` | Same — use `denominations` from context |
| `CashManagementRedesign.jsx` | Same — use `denominations` from context |
| `POSReturnExchangeModal.jsx:527` | Replace `"PKRs 0.00"` with `fmt(0)` |
| `PromotionsRedesign.jsx:67` | Fix bug: add missing `Number()` conversion + use `fmt()` |
| `CustomerDisplayPage.jsx` | Works because CurrencyProvider wraps outside AuthProvider |

## Setup Wizard Changes

### Timezone

- Keep country auto-fill behavior (Pakistan → `Asia/Karachi`)
- Replace limited dropdown with full IANA list: `Intl.supportedValuesOf('timeZone')` (~400 timezones)
- Add search/filter to the dropdown for usability

### Currency

- Keep country auto-fill (Pakistan → `Rs` + `PKR`)
- Symbol and code fields already exist — ensure they're editable
- Add a few common currency quick-picks for convenience

### Denominations

- Auto-fill based on country selection
- Show as editable chip/tag UI — customer can remove (click X) or add (type + Enter)
- Auto-sort highest to lowest
- Pre-defined sets for major countries:

| Country | Denominations |
|---------|--------------|
| Pakistan | 5000, 1000, 500, 100, 50, 20, 10 |
| USA | 100, 50, 20, 10, 5, 1 |
| UK | 50, 20, 10, 5, 2, 1 |
| UAE | 1000, 500, 200, 100, 50, 20, 10, 5 |
| India | 2000, 500, 200, 100, 50, 20, 10 |
| Saudi Arabia | 500, 200, 100, 50, 10, 5, 1 |
| Fallback | 100, 50, 20, 10, 5, 1 |

## Company Settings Changes

- Timezone: replace text input with full IANA dropdown (same as setup wizard)
- Currency symbol + code: already editable fields
- Denominations: add chip/tag editor (same UI as setup wizard)
- On save, invalidate CurrencyProvider cache (re-fetch)

## Files Changed Summary

- **Backend new:** 0 new files (endpoint added to existing company-profile.js)
- **Backend modified:** 7 files (schema migration, company-profile.js, receiptEmail.js, digestEmail.js, printer.js, crm.js, grn.js)
- **Frontend new:** 1 file (CurrencyContext.jsx)
- **Frontend modified:** ~50 files (currency replacement + setup wizard + company settings)
- **Schema:** 1 new column (`cash_denominations`)
