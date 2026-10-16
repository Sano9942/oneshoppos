/**
 * One Toy Store F9 (f): the supplier bills list and one bill with its lines,
 * files and account entries (PHASE-F-PLAN F9: bill files "listed on the
 * supplier's page"; "every bill shows who saved it"). Saved and undone bills;
 * drafts have their own list (services/supplier-bill-drafts.js).
 */
const BILL_COLUMNS = `
  b.id, b.supplier_id, s.name AS supplier_name, b.outlet_id, b.bill_number, to_char(b.bill_date, 'YYYY-MM-DD') AS bill_date,
  b.status, COALESCE(b.account_amount, b.supplier_total, b.lines_total) AS amount, b.lines_total, b.supplier_total,
  b.total_differs, b.total_note, b.layout, b.paid_now_method, b.paid_now_amount, b.paid_now_reference,
  b.saved_at, es.name AS saved_by_name, b.undone_at, eu.name AS undone_by_name, b.undo_reason,
  (SELECT COUNT(*)::int FROM supplier_bill_lines l WHERE l.bill_id = b.id) AS lines,
  (SELECT COUNT(*)::int FROM supplier_bill_files f WHERE f.bill_id = b.id) AS files`;
const BILL_FROM = `
  FROM supplier_bills b JOIN suppliers s ON s.id = b.supplier_id
  LEFT JOIN employees es ON es.id = b.saved_by LEFT JOIN employees eu ON eu.id = b.undone_by`;

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

async function listBills(db, q = {}) {
  const where = ["b.status IN ('saved', 'undone')"];
  const params = [];
  const add = (sql, v) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (Number(q.supplier_id)) add("b.supplier_id = ?", Number(q.supplier_id));
  if (q.status === "saved" || q.status === "undone") add("b.status = ?", q.status);
  if (isDate(q.from)) add("b.bill_date >= ?::date", q.from);
  if (isDate(q.to)) add("b.bill_date <= ?::date", q.to);
  const text = String(q.q || "").trim();
  if (text) {
    params.push(`%${text}%`);
    where.push(`(b.bill_number ILIKE $${params.length} OR s.name ILIKE $${params.length})`);
  }
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  const offset = Math.max(Number(q.offset) || 0, 0);
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const { rows: [{ n }] } = await db.query(`SELECT COUNT(*)::int AS n ${BILL_FROM} ${whereSql}`, params);
  const { rows } = await db.query(
    `SELECT ${BILL_COLUMNS} ${BILL_FROM} ${whereSql}
      ORDER BY b.bill_date DESC NULLS LAST, b.saved_at DESC, b.id DESC
      LIMIT ${limit} OFFSET ${offset}`, params);
  return { bills: rows, total: n };
}

/** One saved / undone bill with lines (+ toys), files and account entries; null when none. */
async function getBill(db, id) {
  const { rows: [bill] } = await db.query(
    `SELECT ${BILL_COLUMNS}, o.name AS outlet_name ${BILL_FROM} LEFT JOIN outlets o ON o.id = b.outlet_id
      WHERE b.id = $1 AND b.status IN ('saved', 'undone')`, [Number(id) || 0]);
  if (!bill) return null;
  const { rows: lines } = await db.query(
    `SELECT l.id, l.sort_order, l.line_no, l.page, l.file_id, l.supplier_code, l.description, l.billed_qty, l.received_qty,
            l.rate, l.discount_pct, l.amount, l.split_into, l.unit_cost, l.sale_price, l.is_new_product, l.note,
            COALESCE(json_agg(json_build_object('product_id', lt.product_id, 'name', p.name, 'sku', p.sku, 'qty', lt.qty,
                                                'extra_qty', lt.extra_qty, 'unit_cost', lt.unit_cost, 'previous_cost', lt.previous_cost)
                              ORDER BY lt.id) FILTER (WHERE lt.id IS NOT NULL), '[]') AS toys
       FROM supplier_bill_lines l
       LEFT JOIN supplier_bill_line_toys lt ON lt.line_id = l.id LEFT JOIN products p ON p.id = lt.product_id
      WHERE l.bill_id = $1 GROUP BY l.id ORDER BY l.sort_order, l.id`, [bill.id]);
  const { rows: files } = await db.query(
    `SELECT id, file_name, content_type, size_bytes, storage_key, active, created_at
       FROM supplier_bill_files WHERE bill_id = $1 ORDER BY sort_order, id`, [bill.id]);
  const { rows: entries } = await db.query(
    `SELECT id, kind, amount, to_char(entry_date, 'YYYY-MM-DD') AS entry_date, note, voided, created_at
       FROM supplier_account_entries WHERE supplier_bill_id = $1 ORDER BY id`, [bill.id]);
  return { ...bill, lines, files, entries };
}

module.exports = { listBills, getBill };
