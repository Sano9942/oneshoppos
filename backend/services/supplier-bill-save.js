/**
 * One Toy Store F9 (c2): save a checked supplier bill (PHASE-F-PLAN F9; every
 * rule here is an owner decision written there).
 *
 *   value of a line   = amount × (1 − line discount %)
 *   bill discount     spread over the lines by value: share = discount ÷ Σ values
 *   cost of a piece   = value per billed unit × (1 − share) ÷ split   (latest bill replaces the cost)
 *   on the account    the FULL bill (positive lines) → supplier_invoices;
 *                     missing pieces → "Not received" (−);
 *                     minus lines (goods sent back) → a supplier return (−);
 *                     extra pieces kept → stock now, "waiting for supplier's
 *                     bill" (no money: the supplier sends a bill for them)
 *   waiting matched   (f) 6/6: a line of that later bill names the waiting
 *                     extras it bills (line.waiting = [{ id, qty }] pieces);
 *                     its received count includes them, so stock goes up only
 *                     by the pieces arriving now; the rows become Billed
 *   bill total        = Σ values − bill discount; must equal the total written
 *                     on the bill unless "supplier's total is different" is
 *                     ticked with a note (then account_amount, the owner's choice)
 *   paid now          cheque / bank transfer = a supplier payment on this bill;
 *                     cash from the till = the till's Paid out → Pay supplier
 * Everything in ONE transaction; stock only through services/stock-ledger.js;
 * History tagged with the supplier's name and bill number.
 */
const stockLedger = require("./stock-ledger");
const productHistory = require("./product-history");
const payouts = require("./till-payouts");
const { createNewToys } = require("./supplier-bill-new-toys");

const fail = (status, msg, extra = {}) => Object.assign(new Error(msg), { statusCode: status, ...extra });
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const r4 = (n) => Math.round(Number(n) * 10000) / 10000;
const num = (v) => (v === "" || v == null ? 0 : Number(v));

/** Check the payload and work out every number. Pure (no database). */
function planBill(p) {
  const lines = Array.isArray(p.lines) ? p.lines : [];
  const billDiscount = r2(num(p.bill_discount));
  const values = lines.map((l) => num(l.amount) * (1 - num(l.discount_pct) / 100));
  const valueTotal = values.reduce((a, b) => a + b, 0);
  const share = valueTotal > 0 ? billDiscount / valueTotal : 0;
  const billTotal = r2(valueTotal - billDiscount);

  const planned = lines.map((l, i) => {
    const label = `Line ${l.line_no ?? i + 1}`;
    const billed = num(l.billed_qty);
    const received = num(l.received_qty);
    const split = Math.max(1, Math.round(num(l.split_into) || 1));
    const pct = num(l.discount_pct);
    if (pct < 0 || pct > 100) throw fail(400, `${label}: discount must be 0 to 100 %`);
    if (l.is_new) throw fail(400, `${label}: the new toy wasn't created`); // saveSupplierBill creates them first
    const toys = (Array.isArray(l.toys) ? l.toys : []).map((t) => ({ product_id: Number(t.product_id), qty: num(t.qty) }));
    if (!toys.length || toys.some((t) => !t.product_id)) throw fail(400, `${label}: which toy is it?`);
    // (f) 6/6: waiting extras this line bills: already in stock, counted as received.
    const waiting = (Array.isArray(l.waiting) ? l.waiting : [])
      .map((w) => ({ id: Number(w.id), qty: num(w.qty) })).filter((w) => w.id && w.qty);
    if (waiting.some((w) => !(w.qty > 0))) throw fail(400, `${label}: matched pieces must be more than 0`);
    const matched = waiting.reduce((a, w) => a + w.qty, 0);
    if (matched && (billed < 0 || matched > Math.max(0, Math.min(received, billed)) * split + 1e-6)) {
      throw fail(400, `${label}: ${matched} pieces matched to waiting extras, more than billed and received`);
    }
    const pieces = received * split - matched;
    const shared = toys.reduce((a, t) => a + t.qty, 0);
    if (Math.abs(shared - pieces) > 1e-6) throw fail(400, `${label}: ${shared} of ${pieces} pieces shared out between the toys`);
    if (billed < 0 || received < 0) {
      if (billed !== received) throw fail(400, `${label}: a line sent back must have the same quantity billed and sent`);
      if (toys.some((t) => t.qty > 0)) throw fail(400, `${label}: a line sent back takes pieces out`);
    } else if (toys.some((t) => t.qty < 0)) {
      throw fail(400, `${label}: pieces can't be minus on a delivered line`);
    }
    const unitValue = billed ? values[i] / billed : num(l.rate) * (1 - pct / 100); // per billed unit, after the line discount
    const unitCost = r4((unitValue * (1 - share)) / split);
    // Extra pieces beyond the bill: the last pieces in toy order.
    let billedPieces = Math.max(0, Math.max(0, Math.min(received, billed)) * split - matched);
    const withExtra = toys.map((t) => {
      if (t.qty <= 0) return { ...t, billed_qty: t.qty, extra_qty: 0 };
      const b = Math.min(t.qty, billedPieces);
      billedPieces -= b;
      return { ...t, billed_qty: b, extra_qty: t.qty - b };
    });
    const missing = billed > 0 && received < billed ? billed - received : 0;
    return {
      src: l, label, billed, received, split, pct, value: values[i], unitCost,
      toys: withExtra, waiting,
      notReceivedValue: r2(missing * unitValue * (1 - share)),
      isReturn: billed < 0,
    };
  });

  const positive = planned.filter((x) => !x.isReturn);
  const returns = planned.filter((x) => x.isReturn);
  const returnValue = r2(-returns.reduce((a, x) => a + x.value * (1 - share), 0));
  const invoiceComputed = r2(positive.reduce((a, x) => a + x.value * (1 - share), 0));

  const written = p.written_total === "" || p.written_total == null ? null : r2(num(p.written_total));
  const matches = written != null && Math.abs(written - billTotal) < 0.5;
  let accountNet = billTotal;
  if (!matches) {
    if (!p.total_differs) {
      throw fail(400, written == null
        ? "Type the total written on the bill"
        : `The lines come to ${billTotal.toLocaleString()} but the bill says ${written.toLocaleString()}: check the lines, or tick "supplier's total is different" with a note`);
    }
    if (!String(p.total_note || "").trim()) throw fail(400, "Say why the supplier's total is different");
    accountNet = p.account_amount === "" || p.account_amount == null ? (written ?? billTotal) : r2(num(p.account_amount));
  }
  // The invoice carries the bill; returns lower it separately, so the net is accountNet.
  const invoiceAmount = matches ? invoiceComputed : r2(accountNet + returnValue);

  return { planned, billDiscount, billTotal, written, matches, accountNet, invoiceAmount, returnValue, share };
}

/**
 * Step (f): this supplier's live bills already carrying this bill number
 * (spaces and case ignored). Owner (B): warn and show them, allow continuing,
 * since a supplier reuses "Bill No 01" on different dates.
 */
async function earlierBillsWithNumber(client, supplierId, billNumber) {
  const no = String(billNumber || "").trim();
  if (!supplierId || !no) return [];
  const { rows } = await client.query(
    `SELECT b.id, b.bill_number, to_char(b.bill_date, 'YYYY-MM-DD') AS bill_date, b.saved_at,
            e.name AS saved_by_name, COALESCE(b.account_amount, b.supplier_total, b.lines_total) AS amount,
            (SELECT COUNT(*)::int FROM supplier_bill_lines l WHERE l.bill_id = b.id) AS lines
       FROM supplier_bills b LEFT JOIN employees e ON e.id = b.saved_by
      WHERE b.supplier_id = $1 AND b.status = 'saved' AND LOWER(btrim(b.bill_number)) = LOWER($2)
      ORDER BY b.id`, [supplierId, no]);
  return rows;
}

async function addDays(client, dateStr, days) {
  const { rows: [r] } = await client.query("SELECT to_char($1::date + $2::int, 'YYYY-MM-DD') AS d", [dateStr, days]);
  return r.d;
}

/**
 * Save inside the caller's transaction. ctx: { employeeId, employeeName, today }.
 * files: [{ file_name, content_type, size_bytes, sha256, storage_key, page_count }] already stored.
 */
async function saveSupplierBill(client, payload, files, ctx) {
  if (!Array.isArray(payload.lines) || !payload.lines.length) throw fail(400, "The bill has no lines");
  const { rows: [sup] } = await client.query("SELECT id, name, payment_terms, credit_days FROM suppliers WHERE id = $1", [Number(payload.supplier_id) || 0]);
  if (!sup) throw fail(400, "Choose the supplier");
  if (!payload.same_number_ok) {
    const earlier = await earlierBillsWithNumber(client, sup.id, payload.bill_number);
    if (earlier.length) {
      throw fail(409, `${sup.name} bill ${String(payload.bill_number).trim()} is already saved: is this a different bill?`,
        { code: "SAME_BILL_NUMBER", bills: earlier });
    }
  }
  // Step (d): new toys first (code, category, brand, price), then the bill as usual.
  const fresh = await createNewToys(client, payload.lines, sup.id);
  const p = { ...payload, lines: fresh.lines };
  const plan = planBill(p);
  const { rows: [outlet] } = await client.query("SELECT id FROM outlets WHERE id = $1", [Number(p.outlet_id) || 0]);
  if (!outlet) throw fail(400, "Choose the branch the goods went to");
  const productIds = [...new Set(plan.planned.flatMap((x) => x.toys.map((t) => t.product_id)))];
  const { rows: prods } = await client.query("SELECT id, name, price, cost_price FROM products WHERE id = ANY($1::int[]) AND deleted_at IS NULL", [productIds]);
  const prod = new Map(prods.map((x) => [x.id, x]));
  const missingToy = productIds.find((id) => !prod.has(id));
  if (missingToy) throw fail(400, `Toy #${missingToy} not found`);
  const waitingRows = await lockWaiting(client, plan, sup.id);

  // Step (f): finishing a draft saves that same row; its files stay on it.
  const draftId = Number(p.draft_id) || 0;
  for (const f of files) {
    const { rows: [dup] } = await client.query(
      `SELECT b.id, b.bill_number, s.name AS supplier_name FROM supplier_bill_files sf
         JOIN supplier_bills b ON b.id = sf.bill_id JOIN suppliers s ON s.id = b.supplier_id
        WHERE sf.sha256 = $1 AND sf.active AND b.id <> $2 LIMIT 1`, [f.sha256, draftId]);
    if (dup) throw fail(409, `${f.file_name} is already on bill ${dup.bill_number || `#${dup.id}`} of ${dup.supplier_name}`, { bill_id: dup.id });
  }

  const billNo = String(p.bill_number || "").trim() || null;
  const billDate = /^\d{4}-\d{2}-\d{2}$/.test(String(p.bill_date || "")) ? p.bill_date : ctx.today;
  const refNo = `${sup.name} bill ${billNo || "(no number)"}`;
  const linesTotal = r2(plan.planned.reduce((a, x) => a + num(x.src.amount), 0));

  const billValues = [sup.id, outlet.id, billNo, billDate, p.layout || null, linesTotal, plan.written,
    !plan.matches, plan.matches ? null : String(p.total_note || "").trim(), plan.matches ? null : plan.accountNet,
    p.printed_prev_balance == null ? null : num(p.printed_prev_balance), p.note || null, ctx.employeeId || null];
  let bill;
  if (draftId) {
    ({ rows: [bill] } = await client.query(
      `UPDATE supplier_bills SET supplier_id = $1, outlet_id = $2, bill_number = $3, bill_date = $4, status = 'saved', layout = $5,
              lines_total = $6, supplier_total = $7, total_differs = $8, total_note = $9, account_amount = $10,
              printed_prev_balance = $11, note = $12, saved_by = $13, saved_at = NOW(), draft_state = NULL, updated_at = NOW()
        WHERE id = $14 AND status = 'draft' RETURNING *`, [...billValues, draftId]));
    if (!bill) throw fail(409, "This draft was already saved or thrown away");
  } else {
    ({ rows: [bill] } = await client.query(
      `INSERT INTO supplier_bills (supplier_id, outlet_id, bill_number, bill_date, status, layout, lines_total, supplier_total,
                                   total_differs, total_note, account_amount, printed_prev_balance, note,
                                   created_by, saved_by, saved_at)
       VALUES ($1,$2,$3,$4,'saved',$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,NOW()) RETURNING *`, billValues));
  }

  const { rows: kept } = await client.query(
    "SELECT id FROM supplier_bill_files WHERE bill_id = $1 AND active ORDER BY sort_order, id", [bill.id]);
  const fileIds = kept.map((r) => r.id);
  for (const [j, f] of files.entries()) {
    const i = kept.length + j;
    const { rows: [fr] } = await client.query(
      `INSERT INTO supplier_bill_files (bill_id, file_name, content_type, size_bytes, sha256, storage_key, page_count, sort_order, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [bill.id, f.file_name, f.content_type, f.size_bytes, f.sha256, f.storage_key, f.page_count || null, i, ctx.employeeId || null]);
    fileIds.push(fr.id);
  }

  // 1. Goods sent back (minus lines): one supplier return for the bill.
  let returnId = null;
  const sentBack = plan.planned.filter((x) => x.isReturn);
  if (sentBack.length) {
    const { rows: [ret] } = await client.query(
      `INSERT INTO supplier_returns (supplier_id, employee_id, outlet_id, reason, total_value, reference_number, status)
       VALUES ($1,$2,$3,$4,$5,$6,'Completed') RETURNING id`,
      [sup.id, ctx.employeeId || null, outlet.id, `Sent back on ${refNo}`, plan.returnValue, billNo]);
    returnId = ret.id;
    for (const x of sentBack) {
      for (const t of x.toys) {
        const q = -t.qty;
        if (!q) continue;
        await client.query(
          `INSERT INTO supplier_return_items (supplier_return_id, product_id, quantity, unit_price, reason)
           VALUES ($1,$2,$3,$4,$5)`, [returnId, t.product_id, q, x.unitCost, x.src.description || null]);
        await stockLedger.decrementStock(client, {
          productId: t.product_id, outletId: outlet.id, qty: q, movementType: "adjust", refType: "supplier_return", refId: returnId,
        });
      }
    }
    await productHistory.tagChanges(client, {
      kind: "supplier_return", refType: "supplier_bill", refId: bill.id, refNo, employeeId: ctx.employeeId || null,
    });
  }

  // 2. Goods in: delivery note (no PO), stock, cost.
  const { rows: [grn] } = await client.query(
    `INSERT INTO goods_received_notes (grn_number, outlet_id, received_by, notes, supplier_id, supplier_bill_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [`GRN-${Date.now()}-${bill.id}`, outlet.id, ctx.employeeId || null, refNo, sup.id, bill.id]);
  const stockChanges = [];
  for (const [i, x] of plan.planned.entries()) {
    const firstToy = x.toys[0];
    const { rows: [ln] } = await client.query(
      `INSERT INTO supplier_bill_lines (bill_id, sort_order, line_no, page, file_id, supplier_code, description, product_id,
                                        billed_qty, received_qty, rate, discount_pct, discount_amount, amount, split_into,
                                        unit_cost, sale_price, is_new_product, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [bill.id, i + 1, x.src.line_no ?? String(i + 1), x.src.page ?? null, fileIds[Number(x.src.file_index) || 0] ?? null,
        x.src.supplier_code || null, x.src.description || null, firstToy?.product_id ?? null,
        x.billed, x.received, num(x.src.rate), x.pct, r2(num(x.src.amount) * x.pct / 100), num(x.src.amount), x.split,
        x.unitCost, firstToy ? (newPriceOf(x, firstToy.product_id) ?? Number(prod.get(firstToy.product_id).price)) : null,
        !!x.src.was_new, x.src.note || null]);
    for (const t of x.toys) {
      const before = Number(prod.get(t.product_id).cost_price);
      await client.query(
        `INSERT INTO supplier_bill_line_toys (line_id, product_id, qty, extra_qty, unit_cost, previous_cost)
         VALUES ($1,$2,$3,$4,$5,$6)`, [ln.id, t.product_id, t.qty, t.extra_qty, x.unitCost, before]);
      if (x.isReturn || t.qty <= 0) continue;
      await client.query(
        `INSERT INTO grn_items (grn_id, product_id, qty_ordered, qty_received, cost_price) VALUES ($1,$2,$3,$4,$5)`,
        [grn.id, t.product_id, Math.round(t.billed_qty), Math.round(t.qty), x.unitCost]);
      await stockLedger.incrementStock(client, { productId: t.product_id, outletId: outlet.id, qty: t.qty, refType: "supplier_bill", refId: bill.id });
      await client.query("UPDATE products SET cost_price = $1 WHERE id = $2", [r2(x.unitCost), t.product_id]);
      stockChanges.push({ product_id: t.product_id, outlet_id: outlet.id, delta: t.qty });
      if (t.extra_qty > 0) {
        await client.query(
          `INSERT INTO supplier_waiting_items (supplier_id, product_id, qty, unit_cost, received_bill_id, grn_id, note, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [sup.id, t.product_id, t.extra_qty, x.unitCost, bill.id, grn.id, `Extra on ${refNo}, ${x.label.toLowerCase()}`, ctx.employeeId || null]);
      }
    }
    // (f) 6/6: the waiting extras this line bills become Billed (a row billed
    // in part is split: the rest keeps waiting).
    for (const w of x.waiting) {
      const row = waitingRows.get(w.id);
      if (w.qty >= Number(row.qty) - 1e-9) {
        await client.query(
          `UPDATE supplier_waiting_items SET status = 'billed', matched_bill_id = $1, matched_line_id = $2, matched_by = $3, matched_at = NOW()
            WHERE id = $4`, [bill.id, ln.id, ctx.employeeId || null, w.id]);
      } else {
        await client.query("UPDATE supplier_waiting_items SET qty = qty - $1 WHERE id = $2", [w.qty, w.id]);
        await client.query(
          `INSERT INTO supplier_waiting_items (supplier_id, product_id, qty, unit_cost, received_bill_id, grn_id, status,
                                              matched_bill_id, matched_line_id, matched_by, matched_at, note, created_by, created_at)
           SELECT supplier_id, product_id, $1, unit_cost, received_bill_id, grn_id, 'billed', $2, $3, $4, NOW(), note, created_by, created_at
             FROM supplier_waiting_items WHERE id = $5`, [w.qty, bill.id, ln.id, ctx.employeeId || null, w.id]);
      }
      // The latest bill sets the cost, as for pieces arriving now.
      await client.query("UPDATE products SET cost_price = $1 WHERE id = $2", [r2(x.unitCost), row.product_id]);
    }
    // Learn the supplier's code for every toy on the line.
    const code = String(x.src.supplier_code || "").trim();
    if (code) {
      for (const t of x.toys) {
        await client.query(
          `INSERT INTO supplier_item_codes (supplier_id, product_id, code, split_into, last_cost, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (supplier_id, LOWER(code), product_id)
           DO UPDATE SET split_into = EXCLUDED.split_into, last_cost = EXCLUDED.last_cost, confirmed = true, updated_at = NOW()`,
          [sup.id, t.product_id, code, x.split, x.unitCost, ctx.employeeId || null]);
      }
    }
  }
  // Step (d): a new selling price only where the check screen says so (the
  // label_reprints trigger lists it for a new tag).
  const labels = [...fresh.created];
  const priced = new Set();
  for (const x of plan.planned) {
    for (const t of x.toys) {
      const np = newPriceOf(x, t.product_id);
      const old = Number(prod.get(t.product_id).price);
      if (np == null || priced.has(t.product_id) || x.src.was_new || np === old) continue;
      priced.add(t.product_id);
      const { rows: [u] } = await client.query("UPDATE products SET price = $1 WHERE id = $2 RETURNING sku, name", [np, t.product_id]);
      labels.push({ product_id: t.product_id, sku: u.sku, name: u.name, price: np, old_price: old, is_new: false });
    }
  }
  await productHistory.tagChanges(client, {
    kind: "delivery", refType: "supplier_bill", refId: bill.id, refNo, employeeId: ctx.employeeId || null,
  });

  // 3. Money: the bill, Not received.
  const dueDate = sup.payment_terms === "credit" && Number(sup.credit_days) > 0 ? await addDays(client, billDate, Number(sup.credit_days)) : null;
  const { rows: [inv] } = await client.query(
    `INSERT INTO supplier_invoices (supplier_id, grn_id, invoice_number, amount, due_date, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [sup.id, grn.id, billNo || `SB-${bill.id}`, plan.invoiceAmount, dueDate, `Supplier bill #${bill.id}`]);
  for (const x of plan.planned) {
    if (x.notReceivedValue > 0) {
      await client.query(
        `INSERT INTO supplier_account_entries (supplier_id, kind, amount, entry_date, supplier_bill_id, note, employee_id)
         VALUES ($1,'not_received',$2,$3,$4,$5,$6)`,
        [sup.id, -x.notReceivedValue, ctx.today, bill.id,
          `${x.label}: ${x.billed - x.received} of ${x.billed} not received ${x.src.description || ""}`.trim(), ctx.employeeId || null]);
    }
  }

  // 4. Paid now.
  let paymentId = null;
  let payoutId = null;
  const pn = p.paid_now && p.paid_now.method ? p.paid_now : null;
  if (pn) {
    const amount = r2(num(pn.amount));
    if (!(amount > 0)) throw fail(400, "Enter the amount paid now");
    if (pn.method === "till_cash") {
      let shiftId = Number(pn.shift_id) || null;
      if (!shiftId) {
        const { rows: [s] } = await client.query(
          "SELECT id FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' ORDER BY id DESC LIMIT 1", [outlet.id]);
        if (!s) throw fail(409, "No open shift at this branch: open the till first, or pay by cheque / bank transfer");
        shiftId = s.id;
      }
      const po = await payouts.createPayout(client,
        { shift_id: shiftId, kind: "supplier", amount, supplier_id: sup.id, note: `Paid on ${refNo}` },
        { employeeId: ctx.employeeId, employeeName: ctx.employeeName, today: ctx.today });
      payoutId = po.id;
      paymentId = po.supplier_payment_id;
      await client.query("UPDATE supplier_payments SET supplier_invoice_id = $1 WHERE id = $2", [inv.id, paymentId]);
    } else if (pn.method === "cheque" || pn.method === "bank_transfer") {
      const ref = String(pn.reference || "").trim();
      if (pn.method === "cheque" && !ref) throw fail(400, "Write the cheque number and bank");
      const { rows: [sp] } = await client.query(
        `INSERT INTO supplier_payments (supplier_invoice_id, supplier_id, amount, payment_method, reference, paid_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [inv.id, sup.id, amount, pn.method === "cheque" ? "Cheque" : "Bank Transfer", ref || null, ctx.employeeName || null, `Paid on ${refNo}`]);
      paymentId = sp.id;
    } else {
      throw fail(400, "Paid now: till cash, cheque or bank transfer");
    }
    await client.query(
      "UPDATE supplier_invoices SET status = CASE WHEN $1::numeric >= amount THEN 'paid' ELSE 'partial' END WHERE id = $2",
      [amount, inv.id]);
  }

  const { rows: [saved] } = await client.query(
    `UPDATE supplier_bills SET grn_id = $1, supplier_invoice_id = $2, supplier_return_id = $3, supplier_payment_id = $4,
            till_payout_id = $5, paid_now_method = $6, paid_now_amount = $7, paid_now_reference = $8, updated_at = NOW()
      WHERE id = $9 RETURNING *`,
    [grn.id, inv.id, returnId, paymentId, payoutId, pn ? pn.method : null, pn ? r2(num(pn.amount)) : null,
      pn ? String(pn.reference || "").trim() || null : null, bill.id]);
  for (const x of sentBack) for (const t of x.toys) stockChanges.push({ product_id: t.product_id, outlet_id: outlet.id, delta: t.qty });
  return { bill: saved, stockChanges, plan, labels };
}

/**
 * (f) 6/6: lock and check the waiting extras the lines bill: still waiting,
 * this supplier's, a toy on that line, and not more pieces than are waiting.
 */
async function lockWaiting(client, plan, supplierId) {
  const ids = [...new Set(plan.planned.flatMap((x) => x.waiting.map((w) => w.id)))];
  const rows = new Map();
  if (!ids.length) return rows;
  const { rows: found } = await client.query(
    "SELECT * FROM supplier_waiting_items WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE", [ids]);
  for (const r of found) rows.set(r.id, r);
  const used = new Map();
  for (const x of plan.planned) {
    const toyIds = new Set(x.toys.map((t) => t.product_id));
    for (const w of x.waiting) {
      const r = rows.get(w.id);
      if (!r || r.supplier_id !== supplierId) throw fail(400, `${x.label}: those extra pieces are not waiting for this supplier's bill`);
      if (r.status !== "waiting") throw fail(409, `${x.label}: those extra pieces were already ${r.status === "free" ? "marked free" : "billed"}`);
      if (!toyIds.has(r.product_id)) throw fail(400, `${x.label}: the extra pieces are a different toy`);
      const total = (used.get(w.id) || 0) + w.qty;
      if (total > Number(r.qty) + 1e-9) throw fail(400, `${x.label}: only ${Number(r.qty)} extra pieces are waiting`);
      used.set(w.id, total);
    }
  }
  return rows;
}

/** The new selling price the check screen gave a toy on this line, if any. */
function newPriceOf(x, productId) {
  const t = (x.src.toys || []).find((y) => Number(y.product_id) === productId);
  const v = t && t.new_price !== "" && t.new_price != null ? r2(num(t.new_price)) : null;
  if (v != null && !(v > 0)) throw fail(400, `${x.label}: the new price must be more than 0`);
  return v;
}

module.exports = { planBill, saveSupplierBill, earlierBillsWithNumber };
