'use strict';

/**
 * Credit-exposure gate (V02 wholesale depth).
 *
 * THE authoritative on-account credit check: locks the customer row with
 * SELECT … FOR UPDATE, then sums outstanding AR under that lock, so two
 * concurrent on-account writers for the same customer serialize instead of
 * both reading the same "under the limit" snapshot and jointly blowing past
 * a hard block (the completion-04-era race: two branch cashiers each see
 * Rs 90k outstanding against a 100k limit, both proceed → 110k+ exposure).
 *
 * Callers (grep-audited on-account writers):
 *   - routes/sales.js Credit-tender AR insert (POS / field / conversion)
 *   - services/customer-invoicing.js convertQuotationToInvoice
 *   - services/customer-invoicing.js createBatchInvoices
 * Route-level UX (warn banners, manager-PIN override prompts) stays in the
 * routes; this service only enforces the hard floor inside the transaction.
 *
 * Exposure rule: status NOT IN ('paid','cancelled','void') — 'void' excluded
 * per the completion-04 fix (a voided sale's reversed invoice is not
 * exposure). Backorders are NOT counted: no AR row exists until conversion,
 * so the limit naturally applies to fulfilled amounts only.
 */

/**
 * @param {object} client - transaction client (tenant search_path active)
 * @param {object} opts
 * @param {number} opts.customerId
 * @param {number} opts.amount           - new credit being extended
 * @param {boolean} [opts.overrideAuthorized] - perm/PIN override already
 *        verified by the route; skips the hard block but still locks the row
 *        (keeps writers serialized so overridden sales can't interleave a
 *        non-overridden one past the check).
 * @returns {Promise<{limit:number, outstanding:number, overLimit:boolean, mode:string}>}
 * @throws statusCode 403 code CREDIT_LIMIT_EXCEEDED when mode='hard', over
 *         the limit, and no override.
 */
async function assertCreditWithinLimit(client, { customerId, amount, overrideAuthorized = false }) {
  const { rows: [cust] } = await client.query(
    `SELECT id, credit_limit, credit_block_mode
       FROM customers WHERE id = $1 FOR UPDATE`,
    [customerId]
  );
  if (!cust) {
    throw Object.assign(new Error("Customer not found"), { statusCode: 400 });
  }
  const limit = Number(cust.credit_limit || 0);
  const mode = cust.credit_block_mode || "warn";

  let outstanding = 0;
  try {
    const { rows: [agg] } = await client.query(
      `SELECT COALESCE(SUM(balance_due), 0)::numeric AS outstanding
         FROM customer_invoices
        WHERE customer_id = $1
          AND status NOT IN ('paid', 'cancelled', 'void')`,
      [customerId]
    );
    outstanding = Number(agg?.outstanding || 0);
  } catch (e) {
    // customer_invoices missing on a very old tenant → nothing outstanding
    if (!String(e.message || "").includes("does not exist")) throw e;
  }

  const overLimit = limit > 0 && outstanding + Number(amount) > limit;
  if (overLimit && mode === "hard" && !overrideAuthorized) {
    throw Object.assign(
      new Error("Credit limit exceeded"),
      {
        statusCode: 403,
        code: "CREDIT_LIMIT_EXCEEDED",
        limit,
        outstanding,
        attempted: Number(amount),
        deficit: outstanding + Number(amount) - limit,
      }
    );
  }
  return { limit, outstanding, overLimit, mode };
}

module.exports = { assertCreditWithinLimit };
