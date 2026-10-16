/**
 * One Toy Store F9 (f): supplier bill drafts (PHASE-F-PLAN F9, "Drafts").
 *
 * A draft is a supplier_bills row with status 'draft' and the check screen as
 * it was left in draft_state (lines, toys chosen, new toys, totals, paid now).
 * It changes nothing: no lines, no stock, no supplier money, no codes learned.
 * Its files are kept on it, so the very same file can't go on another bill
 * meanwhile. Finishing it is the normal save with draft_id
 * (services/supplier-bill-save.js): the same row becomes 'saved'.
 */
const fail = (status, msg) => Object.assign(new Error(msg), { statusCode: status });

/** Save a new draft or update one. files: [{ file_name, content_type, size_bytes, sha256, storage_key }] already stored. */
async function saveDraft(client, payload, files, ctx) {
  const { rows: [sup] } = await client.query("SELECT id FROM suppliers WHERE id = $1", [Number(payload.supplier_id) || 0]);
  if (!sup) throw fail(400, "Choose the supplier");
  const outletId = Number(payload.outlet_id) || null;
  const billNo = String(payload.bill_number || "").trim() || null;
  const billDate = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.bill_date || "")) ? payload.bill_date : null;
  const state = payload.state && typeof payload.state === "object" ? payload.state : {};

  let draft;
  if (payload.draft_id) {
    ({ rows: [draft] } = await client.query(
      `UPDATE supplier_bills SET supplier_id = $1, outlet_id = $2, bill_number = $3, bill_date = $4, draft_state = $5, updated_at = NOW()
        WHERE id = $6 AND status = 'draft' RETURNING *`,
      [sup.id, outletId, billNo, billDate, state, Number(payload.draft_id)]));
    if (!draft) throw fail(409, "This draft was already saved or thrown away");
  } else {
    ({ rows: [draft] } = await client.query(
      `INSERT INTO supplier_bills (supplier_id, outlet_id, bill_number, bill_date, status, draft_state, created_by)
       VALUES ($1,$2,$3,$4,'draft',$5,$6) RETURNING *`,
      [sup.id, outletId, billNo, billDate, state, ctx.employeeId || null]));
  }
  const { rows: [{ n }] } = await client.query("SELECT COUNT(*)::int AS n FROM supplier_bill_files WHERE bill_id = $1", [draft.id]);
  for (const [i, f] of files.entries()) {
    await client.query(
      `INSERT INTO supplier_bill_files (bill_id, file_name, content_type, size_bytes, sha256, storage_key, page_count, sort_order, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [draft.id, f.file_name, f.content_type, f.size_bytes, f.sha256, f.storage_key, f.page_count || null, n + i, ctx.employeeId || null]);
  }
  const { draft_state: _state, ...row } = draft;
  return row;
}

/** The open drafts, newest first. */
async function listDrafts(db) {
  const { rows } = await db.query(
    `SELECT b.id, b.supplier_id, s.name AS supplier_name, b.bill_number, to_char(b.bill_date, 'YYYY-MM-DD') AS bill_date,
            b.created_at, b.updated_at, e.name AS started_by_name,
            COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(b.draft_state->'lines') = 'array' THEN b.draft_state->'lines' END), 0) AS lines,
            (SELECT COUNT(*)::int FROM supplier_bill_files f WHERE f.bill_id = b.id AND f.active) AS files
       FROM supplier_bills b JOIN suppliers s ON s.id = b.supplier_id LEFT JOIN employees e ON e.id = b.created_by
      WHERE b.status = 'draft'
      ORDER BY b.updated_at DESC, b.id DESC`);
  return rows;
}

/** One draft with its screen state and files, or null. */
async function getDraft(db, id) {
  const { rows: [d] } = await db.query(
    `SELECT b.id, b.supplier_id, b.outlet_id, b.bill_number, to_char(b.bill_date, 'YYYY-MM-DD') AS bill_date,
            b.draft_state AS state, b.created_at, b.updated_at, e.name AS started_by_name
       FROM supplier_bills b LEFT JOIN employees e ON e.id = b.created_by
      WHERE b.id = $1 AND b.status = 'draft'`, [Number(id) || 0]);
  if (!d) return null;
  const { rows: files } = await db.query(
    `SELECT id, file_name, content_type, size_bytes, sha256 FROM supplier_bill_files
      WHERE bill_id = $1 AND active ORDER BY sort_order, id`, [d.id]);
  return { ...d, files };
}

/** Throw a draft away (its files go with it). Returns false when there is no such draft. */
async function deleteDraft(db, id) {
  const { rowCount } = await db.query("DELETE FROM supplier_bills WHERE id = $1 AND status = 'draft'", [Number(id) || 0]);
  return rowCount > 0;
}

module.exports = { saveDraft, listDrafts, getDraft, deleteDraft };
