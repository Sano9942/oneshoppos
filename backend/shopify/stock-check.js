'use strict';

/**
 * Shopify stock check: compare SanoPOS shop counts with Shopify's, and set
 * Shopify to SanoPOS's counts. One Toy Store pilot blocker 2
 * (docs/onetoystore-pilot/PROGRESS.md, 2a–2f).
 *
 * SanoPOS is the source of truth. The everyday sync sends +/- changes; when a
 * change is lost the two drift forever. This module is the repair: it reads the
 * exact counts on both sides and sets Shopify's "available" to SanoPOS's number.
 *
 * Which number: SanoPOS takes stock off when an online order ARRIVES (Phase B
 * step 3), and Shopify's "available" is also reduced on arrival (on hand minus
 * committed). So SanoPOS's shop count and Shopify's "available" should be equal.
 * Negative SanoPOS stock is sent as 0 (never advertise stock you don't have);
 * part-units are rounded down.
 *
 * Races with the everyday sync are handled three ways:
 *   1. the queue of pending +/- changes is sent first;
 *   2. an item that still has a change waiting (pending/retry) is skipped and
 *      reported, never set, so the waiting change can't land on top of the new count;
 *   3. every set carries the count we read from Shopify, and Shopify refuses it
 *      if that count moved in between (an online order came in).
 * After a successful set, old failed changes for that item are marked
 * 'superseded' so "retry failed" can never replay them on top of the right count.
 *
 * All functions take the tenant `db` explicitly (usable from a request or a worker).
 */

const { toGid } = require('./client');

const OPEN_EVENT_STATUSES = ['pending', 'retry', 'processing'];
const SUPERSEDABLE_STATUSES = ['failed', 'dead_letter', 'failed_mapping'];
const SET_CHUNK = 50;

const keyOf = (productId, variantId, outletId) =>
  `${Number(productId)}_${variantId ? Number(variantId) : 0}_${Number(outletId)}`;

/** The number Shopify should show for a SanoPOS count. */
function targetFor(localQty) {
  const n = Math.floor(Number(localQty || 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Every mapped item × mapped location with SanoPOS's count for that shop.
 * A mapped variant compares against its own shop stock (variant_outlet_stock).
 * Only a variant with no per-shop rows anywhere (data from before per-shop
 * variant stock) falls back to the product_variants.stock rollup, as
 * services/stock-ledger.js does. A plain product compares against outlet_stock.
 */
async function loadMappedItems(db, { keys = null } = {}) {
  const { rows } = await db.query(
    `SELECT spm.product_id, spm.variant_id, spm.shopify_inventory_item_id,
            slm.outlet_id, slm.shopify_location_id,
            CASE
              WHEN spm.variant_id IS NOT NULL THEN
                COALESCE(
                  (SELECT vos.quantity FROM variant_outlet_stock vos
                    WHERE vos.variant_id = spm.variant_id AND vos.outlet_id = slm.outlet_id),
                  -- No per-shop rows at all for this variant (older data): the
                  -- rollup is its stock. If it has rows at other shops but not
                  -- this one, it has none here.
                  CASE WHEN NOT EXISTS (SELECT 1 FROM variant_outlet_stock vos2 WHERE vos2.variant_id = spm.variant_id)
                       THEN (SELECT pv.stock FROM product_variants pv WHERE pv.id = spm.variant_id) END,
                  0)
              ELSE
                COALESCE((SELECT SUM(os.quantity) FROM outlet_stock os
                           WHERE os.product_id = spm.product_id AND os.outlet_id = slm.outlet_id), 0)
            END AS local_qty
       FROM shopify_product_map spm
       JOIN shopify_location_map slm ON true
      WHERE spm.is_active = true
        AND COALESCE(spm.shopify_inventory_item_id, '') <> ''
      ORDER BY slm.shopify_location_id, spm.id`,
  );
  const items = rows.map((r) => ({
    product_id: Number(r.product_id),
    variant_id: r.variant_id ? Number(r.variant_id) : null,
    outlet_id: Number(r.outlet_id),
    inventory_item_id: toGid('InventoryItem', r.shopify_inventory_item_id),
    location_id: toGid('Location', r.shopify_location_id),
    local_qty: Number(r.local_qty || 0),
  }));
  if (!keys) return items;
  const wanted = new Set(keys);
  return items.filter((i) => wanted.has(keyOf(i.product_id, i.variant_id, i.outlet_id)));
}

/**
 * Compare SanoPOS with Shopify. Each row gets a status:
 *   matched          Shopify shows what SanoPOS says
 *   mismatch         Shopify shows a different number
 *   not_at_location  Shopify knows the item but doesn't stock it at that location
 *   not_found        Shopify doesn't know that item id (mapping is stale)
 *   error            Shopify couldn't be read (network, permissions)
 * shopify_qty is null unless Shopify actually gave a count: unreadable is
 * never reported as 0.
 */
async function compareCounts(db, conn, { fetchInventoryLevelsBatch }, opts = {}) {
  const items = await loadMappedItems(db, opts);
  const byLocation = new Map();
  for (const item of items) {
    if (!byLocation.has(item.location_id)) byLocation.set(item.location_id, []);
    byLocation.get(item.location_id).push(item);
  }

  const out = [];
  for (const [locationId, locItems] of byLocation) {
    let levels;
    try {
      levels = await fetchInventoryLevelsBatch(
        conn,
        locItems.map((i) => i.inventory_item_id),
        locationId,
      );
    } catch (err) {
      for (const item of locItems) {
        out.push({ ...item, shopify_qty: null, target_qty: targetFor(item.local_qty), status: 'error', note: String(err?.message || 'Shopify read failed') });
      }
      continue;
    }
    const byItem = new Map((levels || []).map((l) => [toGid('InventoryItem', l.inventory_item_id), l]));
    for (const item of locItems) {
      const level = byItem.get(item.inventory_item_id);
      const target = targetFor(item.local_qty);
      let status;
      let note = null;
      let shopifyQty = null;
      if (!level || level.found === false) {
        status = 'not_found';
        note = 'Shopify does not know this item. Re-link it on the Mappings tab.';
      } else if (level.stocked === false || level.available === null || level.available === undefined) {
        status = 'not_at_location';
        note = 'Shopify does not stock this item at this location.';
      } else {
        shopifyQty = Number(level.available);
        status = shopifyQty === target ? 'matched' : 'mismatch';
      }
      out.push({ ...item, shopify_qty: shopifyQty, target_qty: target, status, note });
    }
  }
  return out;
}

/** Replace the saved check with a fresh one, keeping "ignored" on rows that haven't changed. */
async function saveCheck(db, rows) {
  await db.transaction(async (client) => {
    const { rows: ignored } = await client.query(
      `SELECT product_id, variant_id, outlet_id, local_qty, external_qty, resolution_note, resolved_by, resolved_at
         FROM inventory_reconciliation WHERE resolution_status = 'ignored'`,
    );
    const ignoredByKey = new Map(ignored.map((r) => [keyOf(r.product_id, r.variant_id, r.outlet_id), r]));
    await client.query('DELETE FROM inventory_reconciliation');
    for (const r of rows) {
      const prev = ignoredByKey.get(keyOf(r.product_id, r.variant_id, r.outlet_id));
      const stillIgnored =
        prev && r.status !== 'matched' &&
        Number(prev.local_qty) === Number(r.local_qty) &&
        (prev.external_qty === null ? r.shopify_qty === null : Number(prev.external_qty) === Number(r.shopify_qty));
      await client.query(
        `INSERT INTO inventory_reconciliation (
           product_id, variant_id, outlet_id, external_location_id,
           local_qty, external_qty, diff, status, checked_at,
           resolution_status, resolution_note, resolved_by, resolved_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11, $12)`,
        [
          r.product_id, r.variant_id, r.outlet_id, r.location_id,
          r.local_qty, r.shopify_qty,
          r.shopify_qty === null ? null : r.target_qty - r.shopify_qty,
          r.status,
          stillIgnored ? 'ignored' : (r.status === 'matched' ? 'resolved' : 'open'),
          stillIgnored ? prev.resolution_note : r.note,
          stillIgnored ? prev.resolved_by : null,
          stillIgnored ? prev.resolved_at : null,
        ],
      );
    }
  });
}

function summarize(rows) {
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    checked: rows.length,
    matched: count('matched'),
    mismatch: count('mismatch'),
    not_at_location: count('not_at_location'),
    not_found: count('not_found'),
    errors: count('error'),
  };
}

/** Items that still have a +/- change waiting to go to Shopify. */
async function keysWithOpenEvents(db) {
  const { rows } = await db.query(
    `SELECT payload FROM external_sync_events
      WHERE direction = 'outbound' AND entity_type = 'inventory'
        AND status = ANY($1::text[])`,
    [OPEN_EVENT_STATUSES],
  );
  const keys = new Set();
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload || '{}');
      keys.add(keyOf(p.product_id, p.variant_id, p.outlet_id));
    } catch { /* unreadable payload: can't be tied to an item */ }
  }
  return keys;
}

async function supersedeFailedEvents(db, setKeys, runId) {
  if (setKeys.size === 0) return 0;
  const { rows } = await db.query(
    `SELECT id, payload FROM external_sync_events
      WHERE direction = 'outbound' AND entity_type = 'inventory'
        AND status = ANY($1::text[])`,
    [SUPERSEDABLE_STATUSES],
  );
  const ids = [];
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload || '{}');
      if (setKeys.has(keyOf(p.product_id, p.variant_id, p.outlet_id))) ids.push(r.id);
    } catch { /* skip */ }
  }
  if (ids.length === 0) return 0;
  await db.query(
    `UPDATE external_sync_events
        SET status = 'superseded', processed_at = NOW(),
            error_message = TRIM(COALESCE(error_message, '') || ' [superseded: Shopify set to SanoPOS count, run #' || $2 || ']')
      WHERE id = ANY($1::int[])`,
    [ids, String(runId)],
  );
  return ids.length;
}

const isChangedMeanwhile = (e) =>
  /compare|changeFrom|mismatch|does not match|stale/i.test(`${e?.code || ''} ${e?.message || ''}`);

async function sendSets(conn, setShopifyInventory, rows, runId) {
  const results = new Map(); // key -> { outcome, message }
  const send = (batch) => setShopifyInventory(
    conn,
    batch.map((r) => ({
      inventory_item_id: r.inventory_item_id,
      location_id: r.location_id,
      quantity: r.target_qty,
      expected: r.shopify_qty,
    })),
    { reason: 'correction', referenceDocumentUri: `gid://sanopos/StockCountSet/${runId}` },
  );
  const mark = (r, outcome, message = null) =>
    results.set(keyOf(r.product_id, r.variant_id, r.outlet_id), { outcome, message });

  for (let i = 0; i < rows.length; i += SET_CHUNK) {
    const chunk = rows.slice(i, i + SET_CHUNK);
    let res;
    try {
      res = await send(chunk);
    } catch (err) {
      chunk.forEach((r) => mark(r, 'failed', String(err?.message || 'Shopify set failed')));
      continue;
    }
    if (!(res.userErrors || []).length) {
      chunk.forEach((r) => mark(r, 'set'));
      continue;
    }
    // Shopify applies a set all-or-nothing, so one moved count blocks the
    // batch. Resend one at a time to find which items actually need attention.
    for (const r of chunk) {
      try {
        const one = await send([r]);
        const errs = one.userErrors || [];
        if (!errs.length) mark(r, 'set');
        else if (errs.some(isChangedMeanwhile)) mark(r, 'changed_meanwhile', errs.map((e) => e.message).join('; '));
        else mark(r, 'failed', errs.map((e) => e.message).join('; '));
      } catch (err) {
        mark(r, 'failed', String(err?.message || 'Shopify set failed'));
      }
    }
  }
  return results;
}

/**
 * Set Shopify to SanoPOS's counts. `reconIds` limits it to rows of the saved
 * check (the screen's "Set Shopify to SanoPOS" on selected rows); without it,
 * every mapped item is checked and the saved check is replaced.
 */
async function setShopifyToPos(db, conn, fns, { reconIds = null, processPending = null, employeeId = null } = {}) {
  const { rows: [run] } = await db.query(
    `INSERT INTO shopify_sync_runs (direction, run_type, status, notes)
     VALUES ('outbound', 'set_counts', 'running', $1) RETURNING id`,
    [reconIds ? `Set Shopify to SanoPOS counts for ${reconIds.length} row(s)` : 'Set Shopify to SanoPOS counts (all items)'],
  );
  const runId = run.id;

  try {
    // 1. Send the queue of waiting +/- changes first.
    if (typeof processPending === 'function') {
      try { await processPending(500); } catch { /* items left waiting are skipped below */ }
    }

    let keys = null;
    if (reconIds) {
      const { rows: recon } = await db.query(
        'SELECT product_id, variant_id, outlet_id FROM inventory_reconciliation WHERE id = ANY($1::int[])',
        [reconIds.map(Number)],
      );
      keys = recon.map((r) => keyOf(r.product_id, r.variant_id, r.outlet_id));
    }

    // 2. Fresh read of both sides.
    const rows = await compareCounts(db, conn, fns, { keys });

    // 3. Leave items alone while a change for them is still on its way.
    const busy = await keysWithOpenEvents(db);
    const toSet = [];
    for (const r of rows) {
      if (r.status !== 'mismatch') continue;
      if (busy.has(keyOf(r.product_id, r.variant_id, r.outlet_id))) {
        r.status = 'waiting';
        r.note = 'An earlier change for this item is still being sent to Shopify. Try again in a minute.';
      } else {
        toSet.push(r);
      }
    }

    // 4. Set, compare-and-set against the count we just read.
    const results = await sendSets(conn, fns.setShopifyInventory, toSet, runId);
    const setKeys = new Set();
    for (const r of toSet) {
      const k = keyOf(r.product_id, r.variant_id, r.outlet_id);
      const res = results.get(k) || { outcome: 'failed', message: 'No result' };
      if (res.outcome === 'set') {
        setKeys.add(k);
        r.previous_shopify_qty = r.shopify_qty;
        r.shopify_qty = r.target_qty;
        r.status = 'matched';
        r.fixed = true;
        r.note = `Shopify set to SanoPOS count (was ${r.previous_shopify_qty})`;
      } else if (res.outcome === 'changed_meanwhile') {
        r.status = 'mismatch';
        r.note = 'Shopify\'s count changed while fixing (probably an online order). Run again.';
      } else {
        r.status = 'mismatch';
        r.note = `Shopify refused: ${res.message}`;
      }
    }

    // 5. Old failed changes for fixed items must never be replayed.
    const superseded = await supersedeFailedEvents(db, setKeys, runId);

    // 6. Save what we found.
    if (!reconIds) {
      await saveCheck(db, rows);
    } else {
      for (const r of rows) {
        await db.query(
          `UPDATE inventory_reconciliation
              SET local_qty = $1, external_qty = $2,
                  diff = CASE WHEN $2::numeric IS NULL THEN NULL ELSE $3::numeric - $2::numeric END,
                  status = $4, checked_at = NOW(),
                  resolution_status = CASE WHEN $4 = 'matched' THEN 'resolved' ELSE resolution_status END,
                  resolution_note = $5,
                  resolved_by = CASE WHEN $4 = 'matched' THEN $9::int ELSE resolved_by END,
                  resolved_at = CASE WHEN $4 = 'matched' THEN NOW() ELSE resolved_at END
            WHERE product_id = $6 AND COALESCE(variant_id, 0) = $7 AND outlet_id = $8`,
          [r.local_qty, r.shopify_qty, r.target_qty, r.status, r.note,
            r.product_id, r.variant_id || 0, r.outlet_id, employeeId],
        );
      }
    }

    const summary = {
      run_id: runId,
      ...summarize(rows),
      set: setKeys.size,
      waiting: rows.filter((r) => r.status === 'waiting').length,
      changed_meanwhile: [...results.values()].filter((x) => x.outcome === 'changed_meanwhile').length,
      failed: [...results.values()].filter((x) => x.outcome === 'failed').length,
      superseded_events: superseded,
    };
    // After the set, "mismatch" means what is STILL different.
    summary.mismatch = rows.filter((r) => r.status === 'mismatch').length;

    await db.query(
      `UPDATE shopify_sync_runs
          SET finished_at = NOW(), status = $1, processed_count = $2, failed_count = $3, notes = COALESCE(notes, '') || $4
        WHERE id = $5`,
      [
        summary.failed + summary.changed_meanwhile > 0 ? 'completed_with_errors' : 'completed',
        summary.set,
        summary.failed + summary.changed_meanwhile,
        ` | set ${summary.set}, still different ${summary.mismatch}, waiting ${summary.waiting}`,
        runId,
      ],
    );
    return { ...summary, rows: rows.filter((r) => r.status !== 'matched' || r.fixed) };
  } catch (err) {
    await db.query(
      `UPDATE shopify_sync_runs SET finished_at = NOW(), status = 'failed', notes = COALESCE(notes, '') || $1 WHERE id = $2`,
      [` | ${String(err?.message || err)}`, runId],
    ).catch(() => {});
    throw err;
  }
}

/**
 * The daily check: compare, save, and tell the owner. Report only: it never
 * changes a count (owner decision 2026-09-26, for the 2-week parallel run).
 */
async function runDailyCheck(db, conn, fns) {
  const { rows: [run] } = await db.query(
    `INSERT INTO shopify_sync_runs (direction, run_type, status, notes)
     VALUES ('inbound', 'daily_stock_check', 'running', 'Daily SanoPOS vs Shopify stock check (report only)')
     RETURNING id`,
  );
  try {
    const rows = await compareCounts(db, conn, fns);
    await saveCheck(db, rows);
    const s = summarize(rows);
    const problems = s.mismatch + s.not_found + s.errors;
    if (problems > 0) {
      const parts = [];
      if (s.mismatch) parts.push(`${s.mismatch} item(s) show a different count on Shopify`);
      if (s.not_found) parts.push(`${s.not_found} linked item(s) Shopify doesn't recognise`);
      if (s.errors) parts.push(`${s.errors} item(s) couldn't be read from Shopify`);
      await db.query(
        'INSERT INTO notifications (type, title, message, link) VALUES ($1, $2, $3, $4)',
        [
          'shopify_stock_drift',
          'Shopify stock differs from SanoPOS',
          `${parts.join('; ')}. Open Shopify → Reconciliation to review, then "Set Shopify to SanoPOS counts".`,
          '/integrations/shopify',
        ],
      );
    }
    await db.query(
      `UPDATE shopify_sync_runs
          SET finished_at = NOW(), status = 'completed', processed_count = $1, failed_count = $2,
              notes = notes || $3
        WHERE id = $4`,
      [s.checked, problems, ` | matched ${s.matched}, different ${s.mismatch}, not at location ${s.not_at_location}, unknown ${s.not_found}, errors ${s.errors}`, run.id],
    );
    return { run_id: run.id, ...s };
  } catch (err) {
    await db.query(
      `UPDATE shopify_sync_runs SET finished_at = NOW(), status = 'failed', notes = notes || $1 WHERE id = $2`,
      [` | ${String(err?.message || err)}`, run.id],
    ).catch(() => {});
    throw err;
  }
}

/** True when no daily check has started in the last `hours` hours. */
async function dailyCheckDue(db, hours = 23) {
  const { rows: [r] } = await db.query(
    `SELECT 1 FROM shopify_sync_runs
      WHERE run_type = 'daily_stock_check' AND started_at > NOW() - make_interval(hours => $1)
      LIMIT 1`,
    [hours],
  );
  return !r;
}

module.exports = {
  compareCounts,
  saveCheck,
  setShopifyToPos,
  runDailyCheck,
  dailyCheckDue,
  targetFor,
  keyOf,
};
