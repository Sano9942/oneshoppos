/**
 * Sale bill numbers — One Toy Store pilot D64 (every shop, owner 2026-10-19).
 *
 * INV-yymmdd-001: the shop date the bill was RUNG (an offline bill keeps the
 * day it was rung, not the day it synced), the count restarting each day and
 * growing past 999 if it must. Bills numbered before D64 keep their
 * INV-yyyy-nnnnn numbers; the old invoice_sequences table is left as it is.
 *
 * Shared by the till (routes/sales.js) and aggregator orders
 * (services/aggregator-orders.js) so a shop never mixes the two styles.
 * Customer invoices (services/customer-invoicing.js, INV-000001) are a
 * separate series and are not touched.
 */

const { tenantToday } = require("../utils/tz");

// Same statement in schema-pg.sql and migration v158.
const INVOICE_DAY_SEQUENCES_DDL = `
CREATE TABLE IF NOT EXISTS invoice_day_sequences (
  day DATE PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);
`;

function formatSaleInvoiceNumber(day, seq) {
  const [y, m, d] = day.split("-");
  return `INV-${y.slice(2)}${m}${d}-${String(seq).padStart(3, "0")}`;
}

/** Next number for a bill rung at `soldAt`, counted in the shop's timezone. */
async function saleInvoiceNumber(client, { soldAt, timezone }) {
  const day = tenantToday(timezone, soldAt || new Date());
  const { rows: [row] } = await client.query(
    `INSERT INTO invoice_day_sequences (day, last_seq) VALUES ($1::date, 1)
     ON CONFLICT (day) DO UPDATE SET last_seq = invoice_day_sequences.last_seq + 1
     RETURNING last_seq`,
    [day]
  );
  return formatSaleInvoiceNumber(day, row.last_seq);
}

module.exports = { INVOICE_DAY_SEQUENCES_DDL, formatSaleInvoiceNumber, saleInvoiceNumber };
