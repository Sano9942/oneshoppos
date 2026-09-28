// What we owe a supplier — ONE definition for the aging list, the supplier
// ledger, the payables report and the supplier list (One Toy Store pilot, D13,
// D37, D38; owner decision 2026-09-28):
//
//   opening balance + bills − payments (not voided; per bill or on account) − returns
//
// A payment "on account" is a supplier_payments row with no supplier_invoice_id:
// the owner pays credit suppliers lump sums whenever money is available, and a
// lump sum lowers the balance only — no bill is marked paid.

// Shared by schema-pg.sql (new tenants) and migration v145 (existing tenants).
const SUPPLIER_ACCOUNT_DDL = `
  ALTER TABLE suppliers
    ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS opening_balance_date DATE;
  ALTER TABLE supplier_payments ALTER COLUMN supplier_invoice_id DROP NOT NULL;
`;

// One row per supplier. Every total comes from its own subquery, so a bill
// with several payments is never counted more than once (the D38 fan-out).
const SUPPLIER_TOTALS_SQL = `
  SELECT s.id AS supplier_id,
         COALESCE(s.opening_balance, 0)::float AS opening_balance,
         COALESCE(inv.n, 0)::int AS invoice_count,
         COALESCE(inv.total, 0)::float AS total_invoiced,
         COALESCE(pay.total, 0)::float AS total_paid,
         COALESCE(ret.total, 0)::float AS total_returned,
         ROUND(COALESCE(s.opening_balance, 0) + COALESCE(inv.total, 0)
               - COALESCE(pay.total, 0) - COALESCE(ret.total, 0), 2)::float AS balance
    FROM suppliers s
    LEFT JOIN (SELECT supplier_id, COUNT(*) AS n, SUM(amount) AS total
                 FROM supplier_invoices GROUP BY supplier_id) inv ON inv.supplier_id = s.id
    LEFT JOIN (SELECT supplier_id, SUM(amount) AS total
                 FROM supplier_payments WHERE voided IS NOT TRUE GROUP BY supplier_id) pay ON pay.supplier_id = s.id
    LEFT JOIN (SELECT supplier_id, SUM(total_value) AS total
                 FROM supplier_returns GROUP BY supplier_id) ret ON ret.supplier_id = s.id
`;

module.exports = { SUPPLIER_ACCOUNT_DDL, SUPPLIER_TOTALS_SQL };
