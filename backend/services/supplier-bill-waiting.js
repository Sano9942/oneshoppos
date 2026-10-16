/**
 * One Toy Store F9 (f) 6/6: extra pieces waiting for the supplier's bill
 * (PHASE-F-PLAN F9; owner: extra pieces kept are billed by the supplier on a
 * new bill). The check screen matches them to that bill (services/
 * supplier-bill-save.js, line.waiting); this is the list and "No bill coming
 * (free)": the pieces stay in stock and nothing goes on the account.
 */
const fail = (status, msg) => Object.assign(new Error(msg), { statusCode: status });

/** Every extra still waiting, oldest first, with the bill it came on. */
async function waitingItems(db, { supplierId = null, today, tz = "Asia/Karachi" } = {}) {
  const params = [today, tz];
  let where = "w.status = 'waiting'";
  if (Number(supplierId)) {
    params.push(Number(supplierId));
    where += ` AND w.supplier_id = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT w.id, w.supplier_id, s.name AS supplier_name, w.product_id, p.name, p.sku, w.qty, w.unit_cost,
            w.received_bill_id, b.bill_number, to_char(b.bill_date, 'YYYY-MM-DD') AS bill_date, o.name AS outlet_name,
            w.note, w.created_at, ($1::date - (w.created_at AT TIME ZONE $2)::date) AS days
       FROM supplier_waiting_items w
       JOIN suppliers s ON s.id = w.supplier_id JOIN products p ON p.id = w.product_id
       LEFT JOIN supplier_bills b ON b.id = w.received_bill_id LEFT JOIN outlets o ON o.id = b.outlet_id
      WHERE ${where}
      ORDER BY w.id`, params);
  return rows.map((r) => ({ ...r, days: Math.max(0, Number(r.days) || 0) }));
}

/** No bill coming: the supplier gave the pieces free. ctx: { employeeId }. */
async function markFree(client, id, note, ctx) {
  const why = String(note || "").trim();
  if (!why) throw fail(400, "Write a note: why is no bill coming?");
  const { rows: [w] } = await client.query("SELECT * FROM supplier_waiting_items WHERE id = $1 FOR UPDATE", [Number(id) || 0]);
  if (!w) throw fail(404, "No such waiting item");
  if (w.status !== "waiting") throw fail(409, `Those pieces were already ${w.status === "free" ? "marked free" : "billed"}`);
  const { rows: [done] } = await client.query(
    `UPDATE supplier_waiting_items SET status = 'free', matched_by = $2, matched_at = NOW(),
            note = CONCAT_WS(' · ', NULLIF(note, ''), 'No bill coming (free): ' || $3)
      WHERE id = $1 RETURNING *`, [w.id, ctx.employeeId || null, why]);
  return done;
}

module.exports = { waitingItems, markFree };
