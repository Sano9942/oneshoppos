/**
 * One Toy Store F9 (f) 5/6: corrections after a supplier bill is saved
 * (PHASE-F-PLAN F9; owner decision 2026-10-16: all four kinds, one "Correct
 * this bill" box, a note always required).
 *
 *   pieces  (a)  pieces received changed on a line: stock ±, Not received
 *                money ± (missing pieces), extra pieces waiting ±
 *   rate    (c)  wrong rate: cost per piece (where nobody changed it since)
 *                and the supplier's account ± for the pieces billed and received
 *   money   (d)  money only: ± on the supplier's account
 *   toy     (b)  wrong toy: pieces move from one toy to another; the cost and
 *                the supplier's code follow
 *
 * The line carries the corrected figures; supplier_bill_corrections keeps the
 * line before and after with the note; the change in what we owe is a
 * "correction" entry on the supplier's account. Stock moves through
 * services/stock-ledger.js with no stock gate (a correction is what really
 * happened, even when the toys were sold since). History tags it
 * "bill_corrected". Lines sent back are corrected with money only.
 */
const stockLedger = require("./stock-ledger");
const productHistory = require("./product-history");

const fail = (status, msg) => Object.assign(new Error(msg), { statusCode: status });
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const r4 = (n) => Math.round(Number(n) * 10000) / 10000;
const KINDS = ["pieces", "rate", "money", "toy"];
const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 });

/** Which pieces of the new quantities are billed and which are extra (toy order, as on save). */
function shareExtra(toys, received, billed, split, matched = 0) {
  let billedPieces = Math.max(0, Math.max(0, Math.min(received, billed)) * split - matched);
  return toys.map((t) => {
    const b = Math.min(t.qty, billedPieces);
    billedPieces -= b;
    return { ...t, extra_qty: t.qty - b };
  });
}

async function moveStock(client, productId, outletId, delta, billId) {
  if (!delta) return;
  if (delta > 0) {
    await stockLedger.incrementStock(client, { productId, outletId, qty: delta, refType: "supplier_bill_correction", refId: billId });
  } else {
    await stockLedger.decrementStock(client, {
      productId, outletId, qty: -delta, gate: false, movementType: "adjust", refType: "supplier_bill_correction", refId: billId,
    });
  }
}

/** Extra pieces waiting for the supplier's bill: add, or take away (newest first). */
async function changeWaiting(client, bill, line, productId, delta, ctx, refNo) {
  if (delta > 0) {
    await client.query(
      `INSERT INTO supplier_waiting_items (supplier_id, product_id, qty, unit_cost, received_bill_id, grn_id, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [bill.supplier_id, productId, delta, line.unit_cost || 0, bill.id, bill.grn_id,
        `Extra on ${refNo}, line ${line.line_no} (correction)`, ctx.employeeId || null]);
    return;
  }
  let left = -delta;
  const { rows } = await client.query(
    `SELECT id, qty FROM supplier_waiting_items
      WHERE received_bill_id = $1 AND product_id = $2 AND status = 'waiting' ORDER BY id DESC FOR UPDATE`, [bill.id, productId]);
  for (const w of rows) {
    if (left <= 0) break;
    const take = Math.min(left, Number(w.qty));
    if (take >= Number(w.qty)) await client.query("DELETE FROM supplier_waiting_items WHERE id = $1", [w.id]);
    else await client.query("UPDATE supplier_waiting_items SET qty = qty - $1 WHERE id = $2", [take, w.id]);
    left -= take;
  }
  if (left > 1e-9) throw fail(409, "Extra pieces from this line were already matched to a later bill: correct that bill instead");
}

async function loadLine(client, bill, lineId) {
  const { rows: [line] } = await client.query(
    "SELECT * FROM supplier_bill_lines WHERE id = $1 AND bill_id = $2 FOR UPDATE", [Number(lineId) || 0, bill.id]);
  if (!line) throw fail(400, "Choose the line to correct");
  if (Number(line.billed_qty) < 0) throw fail(400, "A line sent back can't be corrected here: use a money-only correction");
  const { rows: toys } = await client.query(
    `SELECT lt.*, p.name FROM supplier_bill_line_toys lt JOIN products p ON p.id = lt.product_id
      WHERE lt.line_id = $1 ORDER BY lt.id FOR UPDATE OF lt`, [line.id]);
  return { line, toys };
}

const toyState = (toys) => toys.map((t) => ({ product_id: t.product_id, name: t.name, qty: Number(t.qty), extra_qty: Number(t.extra_qty) }));

// (a) pieces received changed.
async function correctPieces(client, bill, body, ctx, refNo) {
  const { line, toys } = await loadLine(client, bill, body.line_id);
  const received = Number(body.received_qty);
  if (!Number.isFinite(received) || received < 0) throw fail(400, "How many were received?");
  const oldReceived = Number(line.received_qty);
  if (received === oldReceived) throw fail(400, `Line ${line.line_no} already says ${fmt(received)} received`);
  const billed = Number(line.billed_qty);
  const split = Number(line.split_into) || 1;
  // (f) 6/6: waiting extras this line billed are counted as received, not stock now.
  const { rows: [{ m }] } = await client.query(
    "SELECT COALESCE(SUM(qty), 0)::float AS m FROM supplier_waiting_items WHERE matched_line_id = $1 AND status = 'billed'", [line.id]);
  const pieces = received * split - m;
  if (pieces < 0) throw fail(400, `${fmt(m)} pieces of this line were extras already in the shop: received can't be less than that`);

  let wanted;
  if (Array.isArray(body.toys) && body.toys.length) {
    wanted = toys.map((t) => {
      const w = body.toys.find((x) => Number(x.product_id) === t.product_id);
      return { ...t, newQty: w ? Number(w.qty) || 0 : 0 };
    });
    const strange = body.toys.find((x) => !toys.some((t) => t.product_id === Number(x.product_id)));
    if (strange) throw fail(400, "That toy is not on this line: use a wrong-toy correction");
  } else if (toys.length === 1) {
    wanted = [{ ...toys[0], newQty: pieces }];
  } else {
    throw fail(400, `Line ${line.line_no} has ${toys.length} toys: say which toy the pieces changed on`);
  }
  if (wanted.some((t) => t.newQty < 0)) throw fail(400, "Pieces can't be minus");
  const shared = wanted.reduce((a, t) => a + t.newQty, 0);
  if (Math.abs(shared - pieces) > 1e-6) throw fail(400, `${fmt(shared)} of ${fmt(pieces)} pieces shared out between the toys: say which toy`);

  const before = { received_qty: oldReceived, toys: toyState(toys) };
  const next = shareExtra(wanted.map((t) => ({ ...t, qty: t.newQty })), received, billed, split, m);
  const stockChanges = [];
  for (const t of next) {
    const old = toys.find((x) => x.id === t.id);
    const delta = t.qty - Number(old.qty);
    await moveStock(client, t.product_id, bill.outlet_id, delta, bill.id);
    if (delta) stockChanges.push({ product_id: t.product_id, outlet_id: bill.outlet_id, delta });
    const extraDelta = t.extra_qty - Number(old.extra_qty);
    if (extraDelta) await changeWaiting(client, bill, line, t.product_id, extraDelta, ctx, refNo);
    await client.query("UPDATE supplier_bill_line_toys SET qty = $1, extra_qty = $2 WHERE id = $3", [t.qty, t.extra_qty, t.id]);
  }
  await client.query("UPDATE supplier_bill_lines SET received_qty = $1 WHERE id = $2", [received, line.id]);

  const missing = (r) => (billed > 0 && r < billed ? billed - r : 0);
  const amount = r2((missing(oldReceived) - missing(received)) * Number(line.unit_cost || 0) * split);
  return {
    line, amount, stockChanges, before,
    after: { received_qty: received, toys: toyState(next) },
    entryNote: `Line ${line.line_no}: received ${fmt(oldReceived)} → ${fmt(received)} of ${fmt(billed)}`,
  };
}

// (c) wrong rate.
async function correctRate(client, bill, body, ctx) {
  const { line, toys } = await loadLine(client, bill, body.line_id);
  const rate = Number(body.rate);
  if (!Number.isFinite(rate) || rate < 0) throw fail(400, "Type the right rate");
  const oldRate = Number(line.rate);
  if (rate === oldRate) throw fail(400, `Line ${line.line_no} already has rate ${fmt(rate)}`);
  const split = Number(line.split_into) || 1;
  const keep = 1 - Number(line.discount_pct) / 100;
  const oldCost = Number(line.unit_cost || 0);
  // The bill discount's share stays as it was on the line: new cost = old cost × new rate ÷ old rate.
  const oldBase = (oldRate * keep) / split;
  const ratio = oldBase > 0 ? oldCost / oldBase : 1;
  const newCost = r4(((rate * keep) / split) * ratio);
  const billed = Number(line.billed_qty);
  const amountNew = r2(rate * billed);

  await client.query(
    "UPDATE supplier_bill_lines SET rate = $1, amount = $2, discount_amount = $3, unit_cost = $4 WHERE id = $5",
    [rate, amountNew, r2((amountNew * Number(line.discount_pct)) / 100), newCost, line.id]);
  await client.query("UPDATE supplier_bill_line_toys SET unit_cost = $1 WHERE line_id = $2", [newCost, line.id]);
  for (const t of toys) {
    await client.query("UPDATE products SET cost_price = $1 WHERE id = $2 AND cost_price = $3", [r2(newCost), t.product_id, r2(oldCost)]);
    await client.query(
      "UPDATE supplier_waiting_items SET unit_cost = $1 WHERE received_bill_id = $2 AND product_id = $3 AND status = 'waiting'",
      [newCost, bill.id, t.product_id]);
    if (line.supplier_code) {
      await client.query(
        `UPDATE supplier_item_codes SET last_cost = $1, updated_at = NOW()
          WHERE supplier_id = $2 AND LOWER(code) = LOWER($3) AND product_id = $4 AND last_cost = $5`,
        [newCost, bill.supplier_id, line.supplier_code, t.product_id, oldCost]);
    }
  }
  const paidFor = Math.max(0, Math.min(Number(line.received_qty), billed)) * split;
  return {
    line, amount: r2(paidFor * (newCost - oldCost)), stockChanges: [],
    before: { rate: oldRate, amount: Number(line.amount), unit_cost: oldCost },
    after: { rate, amount: amountNew, unit_cost: newCost },
    entryNote: `Line ${line.line_no}: rate ${fmt(oldRate)} → ${fmt(rate)}`,
  };
}

// (d) money only.
async function correctMoney(client, bill, body) {
  const amount = r2(Number(body.amount));
  if (!Number.isFinite(amount) || amount === 0) throw fail(400, "Type the amount: plus = we owe more, minus = we owe less");
  return { line: null, amount, stockChanges: [], before: null, after: { amount }, entryNote: "Money correction" };
}

// (b) wrong toy.
async function correctToy(client, bill, body, ctx, refNo) {
  const { line, toys } = await loadLine(client, bill, body.line_id);
  const fromId = Number(body.from_product_id) || 0;
  const toId = Number(body.to_product_id) || 0;
  const from = toys.find((t) => t.product_id === fromId && Number(t.qty) > 0);
  if (!from) throw fail(400, `That toy has no pieces on line ${line.line_no}`);
  if (!toId || toId === fromId) throw fail(400, "Choose the right toy (a different one)");
  const { rows: [to] } = await client.query(
    "SELECT id, name, cost_price FROM products WHERE id = $1 AND deleted_at IS NULL", [toId]);
  if (!to) throw fail(400, "The right toy was not found");
  const fromQty = Number(from.qty);
  const qty = body.qty === "" || body.qty == null ? fromQty : Number(body.qty);
  if (!(qty > 0) || qty > fromQty) throw fail(400, `Move 1 to ${fmt(fromQty)} pieces`);
  const movedExtra = Math.max(0, qty - (fromQty - Number(from.extra_qty)));
  const before = { toys: toyState(toys) };
  const cost = r4(Number(line.unit_cost || 0));

  await moveStock(client, fromId, bill.outlet_id, -qty, bill.id);
  await moveStock(client, toId, bill.outlet_id, qty, bill.id);
  if (movedExtra > 0) {
    await changeWaiting(client, bill, line, fromId, -movedExtra, ctx, refNo);
    await changeWaiting(client, bill, line, toId, movedExtra, ctx, refNo);
  }
  const all = qty === fromQty;
  if (all) await client.query("DELETE FROM supplier_bill_line_toys WHERE id = $1", [from.id]);
  else await client.query("UPDATE supplier_bill_line_toys SET qty = qty - $1, extra_qty = extra_qty - $2 WHERE id = $3", [qty, movedExtra, from.id]);
  const there = toys.find((t) => t.product_id === toId);
  if (there) {
    await client.query("UPDATE supplier_bill_line_toys SET qty = qty + $1, extra_qty = extra_qty + $2 WHERE id = $3", [qty, movedExtra, there.id]);
  } else {
    await client.query(
      `INSERT INTO supplier_bill_line_toys (line_id, product_id, qty, extra_qty, unit_cost, previous_cost)
       VALUES ($1,$2,$3,$4,$5,$6)`, [line.id, toId, qty, movedExtra, cost, to.cost_price]);
  }
  // Cost follows the pieces: the right toy takes the bill's cost (latest bill
  // replaces the cost); the wrong toy, when none of its pieces stay, gets its
  // cost from before the bill back (only if nobody changed it since).
  await client.query("UPDATE products SET cost_price = $1 WHERE id = $2", [r2(cost), toId]);
  if (all && from.previous_cost != null) {
    await client.query("UPDATE products SET cost_price = $1 WHERE id = $2 AND cost_price = $3", [from.previous_cost, fromId, r2(cost)]);
  }
  const { rows: [first] } = await client.query(
    "SELECT product_id FROM supplier_bill_line_toys WHERE line_id = $1 ORDER BY id LIMIT 1", [line.id]);
  await client.query("UPDATE supplier_bill_lines SET product_id = $1 WHERE id = $2", [first ? first.product_id : null, line.id]);

  // The supplier's code learned for the wrong toy now points to the right one.
  const code = String(line.supplier_code || "").trim();
  if (code) {
    if (all) {
      await client.query(
        "DELETE FROM supplier_item_codes WHERE supplier_id = $1 AND LOWER(code) = LOWER($2) AND product_id = $3",
        [bill.supplier_id, code, fromId]);
    }
    await client.query(
      `INSERT INTO supplier_item_codes (supplier_id, product_id, code, split_into, last_cost, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (supplier_id, LOWER(code), product_id)
       DO UPDATE SET split_into = EXCLUDED.split_into, last_cost = EXCLUDED.last_cost, confirmed = true, updated_at = NOW()`,
      [bill.supplier_id, toId, code, Number(line.split_into) || 1, cost, ctx.employeeId || null]);
  }
  const { rows: after } = await client.query(
    `SELECT lt.*, p.name FROM supplier_bill_line_toys lt JOIN products p ON p.id = lt.product_id WHERE lt.line_id = $1 ORDER BY lt.id`, [line.id]);
  return {
    line, amount: 0,
    stockChanges: [
      { product_id: fromId, outlet_id: bill.outlet_id, delta: -qty },
      { product_id: toId, outlet_id: bill.outlet_id, delta: qty },
    ],
    before, after: { toys: toyState(after) },
    entryNote: `Line ${line.line_no}: ${fmt(qty)} pcs ${from.name} → ${to.name}`,
  };
}

/** ctx: { employeeId, today (YYYY-MM-DD shop date) }. Runs inside the caller's transaction. */
async function correctSupplierBill(client, billId, body, ctx) {
  const kind = String(body?.kind || "");
  if (!KINDS.includes(kind)) throw fail(400, "Choose what to correct: pieces received, rate, money or toy");
  const note = String(body.note || "").trim();
  if (!note) throw fail(400, "Write a note: why is the bill corrected?");
  const { rows: [bill] } = await client.query(
    `SELECT b.*, s.name AS supplier_name FROM supplier_bills b JOIN suppliers s ON s.id = b.supplier_id
      WHERE b.id = $1 FOR UPDATE OF b`, [Number(billId) || 0]);
  if (!bill || bill.status === "draft") throw fail(404, "No such bill");
  if (bill.status !== "saved") throw fail(409, "This bill was undone: it can't be corrected");
  const refNo = `${bill.supplier_name} bill ${bill.bill_number || "(no number)"}`;

  const done = kind === "pieces" ? await correctPieces(client, bill, body, ctx, refNo)
    : kind === "rate" ? await correctRate(client, bill, body, ctx)
      : kind === "money" ? await correctMoney(client, bill, body)
        : await correctToy(client, bill, body, ctx, refNo);

  let entryId = null;
  if (done.amount) {
    const { rows: [e] } = await client.query(
      `INSERT INTO supplier_account_entries (supplier_id, kind, amount, entry_date, supplier_bill_id, note, employee_id)
       VALUES ($1,'correction',$2,$3,$4,$5,$6) RETURNING id`,
      [bill.supplier_id, done.amount, ctx.today, bill.id, `${done.entryNote}: ${note}`, ctx.employeeId || null]);
    entryId = e.id;
  }
  const { rows: [correction] } = await client.query(
    `INSERT INTO supplier_bill_corrections (bill_id, line_id, kind, note, before, after, amount, account_entry_id, employee_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [bill.id, done.line ? done.line.id : null, kind, note, done.before ? JSON.stringify(done.before) : null,
      JSON.stringify(done.after), done.amount, entryId, ctx.employeeId || null]);
  await client.query("UPDATE supplier_bills SET updated_at = NOW() WHERE id = $1", [bill.id]);
  await productHistory.tagChanges(client, {
    kind: "bill_corrected", refType: "supplier_bill", refId: bill.id, refNo: `${refNo} corrected`, note, employeeId: ctx.employeeId || null,
  });
  return { correction, stockChanges: done.stockChanges, bill };
}

/** A bill's corrections, oldest first, with the line number and who made each. */
async function correctionsOf(db, billId) {
  const { rows } = await db.query(
    `SELECT c.id, c.kind, c.line_id, l.line_no, c.note, c.before, c.after, c.amount, c.created_at, e.name AS employee_name
       FROM supplier_bill_corrections c
       LEFT JOIN supplier_bill_lines l ON l.id = c.line_id LEFT JOIN employees e ON e.id = c.employee_id
      WHERE c.bill_id = $1 ORDER BY c.id`, [Number(billId) || 0]);
  return rows;
}

module.exports = { correctSupplierBill, correctionsOf, KINDS };
