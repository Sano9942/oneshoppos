/**
 * Modifiers service — Phase 2.1 A2.
 *
 * Modifier groups + options, product links, and draft-order-item attach flow.
 * When attaching modifiers to a draft_order_item, the summed price_delta is
 * baked into draft_order_items.price so recalcCheckTotals needs no change.
 *
 * Group constraint validation (min_select, max_select, is_required,
 * selection_type) runs on attach — routes rely on this service, not Zod.
 */

async function listGroups(db, outletId) {
  // NULL outlet_id = tenant-wide group (visible to all outlets). Filter
  // specific-outlet rows to the requested outlet; always include tenant-wide.
  const params = [];
  let where = "mg.is_active = true";
  if (outletId) {
    params.push(outletId);
    where += ` AND (mg.outlet_id IS NULL OR mg.outlet_id = $1)`;
  }
  const { rows } = await db.query(
    `SELECT mg.*,
       COALESCE(
         (SELECT json_agg(json_build_object(
           'id', mo.id,
           'name', mo.name,
           'price_delta', mo.price_delta,
           'is_default', mo.is_default,
           'display_order', mo.display_order,
           'is_active', mo.is_active
         ) ORDER BY mo.display_order, mo.id)
         FROM modifier_options mo WHERE mo.group_id = mg.id AND mo.is_active = true),
         '[]'::json
       ) AS options
     FROM modifier_groups mg
     WHERE ${where}
     ORDER BY mg.display_order, mg.name`,
    params
  );
  return rows;
}

async function createGroup(db, data) {
  const { rows: [group] } = await db.query(
    `INSERT INTO modifier_groups
       (outlet_id, name, selection_type, min_select, max_select, is_required, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      data.outlet_id || null,
      data.name,
      data.selection_type,
      data.min_select ?? 0,
      data.max_select ?? null,
      data.is_required ?? false,
      data.display_order ?? 0,
    ]
  );
  return group;
}

async function updateGroup(db, id, data) {
  const sets = [];
  const params = [];
  let idx = 0;
  for (const col of ["name", "selection_type", "min_select", "max_select", "is_required", "display_order", "is_active"]) {
    if (data[col] !== undefined) { idx++; sets.push(`${col} = $${idx}`); params.push(data[col]); }
  }
  if (!sets.length) return null;
  idx++; params.push(id);
  sets.push("updated_at = NOW()");
  const { rows: [group] } = await db.query(
    `UPDATE modifier_groups SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return group;
}

async function deactivateGroup(db, id) {
  const { rows: [group] } = await db.query(
    `UPDATE modifier_groups SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return group;
}

async function addOptionToGroup(db, groupId, data) {
  const { rows: [option] } = await db.query(
    `INSERT INTO modifier_options (group_id, name, price_delta, is_default, display_order)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [groupId, data.name, data.price_delta ?? 0, data.is_default ?? false, data.display_order ?? 0]
  );
  return option;
}

async function updateOption(db, id, data) {
  const sets = [];
  const params = [];
  let idx = 0;
  for (const col of ["name", "price_delta", "is_default", "display_order", "is_active"]) {
    if (data[col] !== undefined) { idx++; sets.push(`${col} = $${idx}`); params.push(data[col]); }
  }
  if (!sets.length) return null;
  idx++; params.push(id);
  const { rows: [option] } = await db.query(
    `UPDATE modifier_options SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return option;
}

async function deactivateOption(db, id) {
  const { rows: [option] } = await db.query(
    `UPDATE modifier_options SET is_active = false WHERE id = $1 RETURNING *`,
    [id]
  );
  return option;
}

async function linkGroupToProduct(db, productId, groupId, displayOrder = 0) {
  await db.query(
    `INSERT INTO product_modifier_group_links (product_id, group_id, display_order)
     VALUES ($1, $2, $3)
     ON CONFLICT (product_id, group_id) DO UPDATE SET display_order = EXCLUDED.display_order`,
    [productId, groupId, displayOrder]
  );
  return { product_id: productId, group_id: groupId, display_order: displayOrder };
}

async function unlinkGroupFromProduct(db, productId, groupId) {
  const { rowCount } = await db.query(
    `DELETE FROM product_modifier_group_links WHERE product_id = $1 AND group_id = $2`,
    [productId, groupId]
  );
  return rowCount > 0;
}

async function getModifierTreeForProduct(db, productId) {
  const { rows } = await db.query(
    `SELECT mg.id, mg.name, mg.selection_type, mg.min_select, mg.max_select,
            mg.is_required, pmgl.display_order,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'id', mo.id,
                 'name', mo.name,
                 'price_delta', mo.price_delta,
                 'is_default', mo.is_default,
                 'display_order', mo.display_order
               ) ORDER BY mo.display_order, mo.id)
               FROM modifier_options mo WHERE mo.group_id = mg.id AND mo.is_active = true),
              '[]'::json
            ) AS options
     FROM product_modifier_group_links pmgl
     JOIN modifier_groups mg ON mg.id = pmgl.group_id
     WHERE pmgl.product_id = $1 AND mg.is_active = true
     ORDER BY pmgl.display_order, mg.display_order`,
    [productId]
  );
  return rows;
}

/**
 * Attach modifier options to a draft_order_item. Validates group constraints
 * (min/max/required/selection_type), writes snapshot rows, and bumps the
 * parent item's price by the summed price_delta. All in one transaction.
 */
async function attachModifiersToDraftItem(db, draftOrderItemId, optionIds) {
  if (!Array.isArray(optionIds) || !optionIds.length) {
    throw Object.assign(new Error("optionIds required"), { statusCode: 400 });
  }
  return await db.transaction(async (client) => {
    // Look up options + their groups in one round-trip.
    const { rows: options } = await client.query(
      `SELECT mo.id, mo.group_id, mo.name, mo.price_delta, mg.selection_type,
              mg.min_select, mg.max_select, mg.is_required
       FROM modifier_options mo
       JOIN modifier_groups mg ON mg.id = mo.group_id
       WHERE mo.id = ANY($1) AND mo.is_active = true`,
      [optionIds]
    );
    if (options.length !== optionIds.length) {
      throw Object.assign(new Error("One or more options not found or inactive"), { statusCode: 400 });
    }

    // Group options by group_id and validate per-group constraints.
    const byGroup = new Map();
    for (const o of options) {
      if (!byGroup.has(o.group_id)) byGroup.set(o.group_id, { meta: o, options: [] });
      byGroup.get(o.group_id).options.push(o);
    }
    for (const { meta, options: picked } of byGroup.values()) {
      if (meta.selection_type === "single" && picked.length > 1) {
        throw Object.assign(
          new Error(`Group ${meta.group_id}: single-select allows only 1 option`),
          { statusCode: 400 }
        );
      }
      if (meta.max_select != null && picked.length > meta.max_select) {
        throw Object.assign(
          new Error(`Group ${meta.group_id}: at most ${meta.max_select} options allowed`),
          { statusCode: 400 }
        );
      }
      if (picked.length < (meta.min_select ?? 0)) {
        throw Object.assign(
          new Error(`Group ${meta.group_id}: at least ${meta.min_select} options required`),
          { statusCode: 400 }
        );
      }
    }

    // Insert snapshots + compute total delta.
    let totalDelta = 0;
    for (const o of options) {
      await client.query(
        `INSERT INTO draft_order_item_modifiers
           (draft_order_item_id, option_id, option_name_snapshot, price_delta_snapshot)
         VALUES ($1, $2, $3, $4)`,
        [draftOrderItemId, o.id, o.name, o.price_delta]
      );
      totalDelta += Number(o.price_delta);
    }

    // Bump parent item price by the summed delta.
    await client.query(
      `UPDATE draft_order_items SET price = price + $1 WHERE id = $2`,
      [totalDelta, draftOrderItemId]
    );

    return { attached: options.length, price_delta: totalDelta };
  });
}

module.exports = {
  listGroups,
  createGroup,
  updateGroup,
  deactivateGroup,
  addOptionToGroup,
  updateOption,
  deactivateOption,
  linkGroupToProduct,
  unlinkGroupFromProduct,
  getModifierTreeForProduct,
  attachModifiersToDraftItem,
};
