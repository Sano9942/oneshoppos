/**
 * One Toy Store F9 (f): undo a whole supplier bill (PHASE-F-PLAN F9, "Mistake
 * after saving"; owner decision). Only on the shop day the bill was saved and
 * only while none of its pieces has gone out since (sold, moved, adjusted);
 * after that the bill is corrected instead.
 *
 * Puts the shop back as it was before the bill, in ONE transaction:
 *   stock          pieces in → out again; pieces sent back → in again
 *                  (services/stock-ledger.js, no stock gate: a toy that was
 *                  below zero before the bill goes back below zero)
 *   cost / price   back to what they were, where nobody changed them since
 *   money          the bill, its Not received entries and its sent-back return
 *                  removed from the supplier's account; money paid on the spot
 *                  really left, so it stays as a payment on account
 *   the rest       delivery note, extra pieces waiting, codes learned from this
 *                  bill, new toys made by it (removed; shop code + barcode free
 *                  again), files (can be uploaded again); extras from earlier
 *                  bills that this bill billed go back to waiting
 * The bill row stays, status 'undone' with who / when / why; History tags the
 * reversing changes "bill_undone".
 */
const stockLedger = require("./stock-ledger");
const productHistory = require("./product-history");

const fail = (status, msg) => Object.assign(new Error(msg), { statusCode: status });
const r2 = (n) => Math.round(Number(n) * 100) / 100;

const MOVE_WORDS = {
  sale: "sold", transfer: "transferred", adjustment: "adjusted", count: "changed by a stock count",
  supplier_return: "sent back to a supplier", online_order: "sold online", delivery: "changed by a delivery",
};

/** ctx: { employeeId, today (YYYY-MM-DD shop date), tz, reason } */
async function undoSupplierBill(client, billId, ctx) {
  const reason = String(ctx.reason || "").trim();
  if (!reason) throw fail(400, "Say why the bill is undone");
  const { rows: [bill] } = await client.query(
    `SELECT b.*, s.name AS supplier_name, to_char(b.saved_at AT TIME ZONE $2, 'YYYY-MM-DD') AS saved_day,
            to_char(b.saved_at AT TIME ZONE $2, 'DD Mon') AS saved_day_label
       FROM supplier_bills b JOIN suppliers s ON s.id = b.supplier_id
      WHERE b.id = $1 FOR UPDATE OF b`, [Number(billId) || 0, ctx.tz]);
  if (!bill) throw fail(404, "No such bill");
  if (bill.status !== "saved") throw fail(409, bill.status === "undone" ? "This bill is already undone" : "This bill isn't saved yet (a draft): throw the draft away instead");
  if (bill.saved_day !== ctx.today) {
    throw fail(409, `A bill can be undone only on the day it was saved (${bill.saved_day_label}): correct the bill instead`);
  }
  const { rows: [corrected] } = await client.query("SELECT 1 FROM supplier_bill_corrections WHERE bill_id = $1 LIMIT 1", [bill.id]);
  if (corrected) throw fail(409, "This bill was corrected after saving, so it can't be undone: correct it again instead");
  const refNo = `${bill.supplier_name} bill ${bill.bill_number || "(no number)"}`;

  const { rows: toys } = await client.query(
    `SELECT lt.product_id, lt.qty, lt.unit_cost, lt.previous_cost, l.is_new_product, l.sort_order, p.name
       FROM supplier_bill_line_toys lt JOIN supplier_bill_lines l ON l.id = lt.line_id
       JOIN products p ON p.id = lt.product_id
      WHERE l.bill_id = $1 ORDER BY l.sort_order, lt.id`, [bill.id]);
  const productIds = [...new Set(toys.map((t) => t.product_id))];

  // None of its pieces gone out since: any stock decrease after the bill at this branch.
  const { rows: [moved] } = await client.query(
    `SELECT m.kind, p.name FROM stock_movements m JOIN products p ON p.id = m.product_id
      WHERE m.product_id = ANY($1::int[]) AND m.outlet_id = $2 AND m.qty_change < 0
        AND m.created_at > (SELECT saved_at FROM supplier_bills WHERE id = $3)
        AND NOT (COALESCE(m.ref_type, '') = 'supplier_bill' AND m.ref_id IS NOT DISTINCT FROM $3)
      ORDER BY m.id LIMIT 1`, [productIds, bill.outlet_id, bill.id]);
  if (moved) {
    throw fail(409, `${moved.name} was ${MOVE_WORDS[moved.kind] || "taken out of stock"} after this bill was saved, so the bill can't be undone: correct the bill instead`);
  }
  const { rows: [matched] } = await client.query(
    "SELECT 1 FROM supplier_waiting_items WHERE received_bill_id = $1 AND status <> 'waiting' LIMIT 1", [bill.id]);
  if (matched) throw fail(409, "Extra pieces from this bill were already billed on a later bill or marked free: correct the bill instead");

  // 1. Stock back.
  const stockChanges = [];
  for (const t of toys) {
    const q = Number(t.qty);
    if (q > 0) {
      await stockLedger.decrementStock(client, {
        productId: t.product_id, outletId: bill.outlet_id, qty: q, gate: false, movementType: "adjust",
        refType: "supplier_bill_undo", refId: bill.id,
      });
    } else if (q < 0) {
      await stockLedger.incrementStock(client, { productId: t.product_id, outletId: bill.outlet_id, qty: -q, refType: "supplier_bill_undo", refId: bill.id });
    }
    if (q) stockChanges.push({ product_id: t.product_id, outlet_id: bill.outlet_id, delta: -q });
  }

  // 2. Cost back (the toy's first line on the bill holds its cost before it),
  //    selling price back (History rows this bill tagged), where unchanged since.
  const seen = new Set();
  for (const t of toys) {
    if (seen.has(t.product_id) || t.is_new_product || t.previous_cost == null) continue;
    seen.add(t.product_id);
    await client.query("UPDATE products SET cost_price = $1 WHERE id = $2 AND cost_price = $3",
      [t.previous_cost, t.product_id, r2(t.unit_cost)]);
  }
  const { rows: prices } = await client.query(
    `SELECT DISTINCT ON (product_id) product_id, old_value, new_value FROM price_changes
      WHERE ref_type = 'supplier_bill' AND ref_id = $1 AND field = 'price' AND variant_id IS NULL
      ORDER BY product_id, id`, [bill.id]);
  for (const pc of prices) {
    if (pc.old_value == null) continue;
    await client.query("UPDATE products SET price = $1 WHERE id = $2 AND price = $3 AND deleted_at IS NULL",
      [pc.old_value, pc.product_id, pc.new_value]);
  }

  // 3. Money: the bill off the account; paid-now money stays as a payment on account.
  let paidKept = 0;
  if (bill.supplier_invoice_id) {
    const { rows: pays } = await client.query(
      `UPDATE supplier_payments SET supplier_invoice_id = NULL,
              notes = TRIM(COALESCE(notes, '') || ' (bill undone: kept as a payment on account)')
        WHERE supplier_invoice_id = $1 RETURNING amount, voided`, [bill.supplier_invoice_id]);
    paidKept = r2(pays.filter((p) => p.voided !== true).reduce((a, p) => a + Number(p.amount), 0));
  }
  await client.query("DELETE FROM supplier_account_entries WHERE supplier_bill_id = $1", [bill.id]);
  await client.query("DELETE FROM supplier_waiting_items WHERE received_bill_id = $1", [bill.id]);
  // (f) 6/6: extras from earlier bills that this bill billed wait again.
  await client.query(
    `UPDATE supplier_waiting_items SET status = 'waiting', matched_bill_id = NULL, matched_line_id = NULL, matched_by = NULL, matched_at = NULL
      WHERE matched_bill_id = $1 AND status = 'billed'`, [bill.id]);
  await client.query(
    "UPDATE supplier_bills SET grn_id = NULL, supplier_invoice_id = NULL, supplier_return_id = NULL WHERE id = $1", [bill.id]);
  if (bill.supplier_invoice_id) await client.query("DELETE FROM supplier_invoices WHERE id = $1", [bill.supplier_invoice_id]);
  if (bill.supplier_return_id) {
    await client.query("DELETE FROM supplier_return_items WHERE supplier_return_id = $1", [bill.supplier_return_id]);
    await client.query("DELETE FROM supplier_returns WHERE id = $1", [bill.supplier_return_id]);
  }
  if (bill.grn_id) {
    await client.query("DELETE FROM grn_items WHERE grn_id = $1", [bill.grn_id]);
    await client.query("DELETE FROM goods_received_notes WHERE id = $1", [bill.grn_id]);
  }

  // 4. Codes learned from this bill (made in its own transaction, so created at saved_at).
  await client.query(
    `DELETE FROM supplier_item_codes WHERE supplier_id = $1 AND product_id = ANY($2::int[])
        AND created_at = (SELECT saved_at FROM supplier_bills WHERE id = $3)`,
    [bill.supplier_id, productIds, bill.id]);

  // 5. New toys made by the bill: removed, their shop code and barcode free again.
  const newIds = [...new Set(toys.filter((t) => t.is_new_product).map((t) => t.product_id))];
  if (newIds.length) {
    await client.query("DELETE FROM supplier_item_codes WHERE product_id = ANY($1::int[])", [newIds]);
    await client.query("DELETE FROM product_barcodes WHERE product_id = ANY($1::int[])", [newIds]);
    await client.query("UPDATE label_reprints SET cleared_at = NOW() WHERE product_id = ANY($1::int[]) AND cleared_at IS NULL", [newIds]);
    await client.query(
      `UPDATE products SET deleted_at = NOW(), status = 'inactive', barcode = NULL, sku = sku || '~undone-' || $2::text
        WHERE id = ANY($1::int[])`, [newIds, bill.id]);
  }

  // 6. Files can be uploaded again; the bill stays as undone.
  await client.query("UPDATE supplier_bill_files SET active = false WHERE bill_id = $1", [bill.id]);
  const { rows: [undone] } = await client.query(
    `UPDATE supplier_bills SET status = 'undone', undone_by = $2, undone_at = NOW(), undo_reason = $3, updated_at = NOW()
      WHERE id = $1 RETURNING *`, [bill.id, ctx.employeeId || null, reason]);
  await productHistory.tagChanges(client, {
    kind: "bill_undone", refType: "supplier_bill", refId: bill.id, refNo: `${refNo} undone`, note: reason, employeeId: ctx.employeeId || null,
  });
  return { bill: undone, stockChanges, paidKept, newToysRemoved: newIds.length };
}

/** Bills saved or undone on this shop day, newest first. */
async function billsOfDay(db, today, tz) {
  const { rows } = await db.query(
    `SELECT b.id, b.supplier_id, s.name AS supplier_name, b.bill_number, to_char(b.bill_date, 'YYYY-MM-DD') AS bill_date,
            b.status, COALESCE(b.account_amount, b.supplier_total, b.lines_total) AS amount,
            (SELECT COUNT(*)::int FROM supplier_bill_lines l WHERE l.bill_id = b.id) AS lines,
            b.saved_at, es.name AS saved_by_name, b.undone_at, eu.name AS undone_by_name, b.undo_reason
       FROM supplier_bills b JOIN suppliers s ON s.id = b.supplier_id
       LEFT JOIN employees es ON es.id = b.saved_by LEFT JOIN employees eu ON eu.id = b.undone_by
      WHERE b.status IN ('saved', 'undone') AND to_char(b.saved_at AT TIME ZONE $2, 'YYYY-MM-DD') = $1
      ORDER BY b.saved_at DESC, b.id DESC`, [today, tz]);
  return rows;
}

module.exports = { undoSupplierBill, billsOfDay };
