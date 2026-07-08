async function dbAllAsync(db, sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows || [];
}

async function dbGetAsync(db, sql, params = []) {
  const result = await db.query(sql, params);
  return (result.rows && result.rows[0]) || null;
}

function normalizeCategoryRow(row) {
  return {
    id: Number(row.id),
    name: row.name || "",
    description: row.description || "",
    parent_id: row.parent_id == null ? null : Number(row.parent_id),
    sort_order: Number(row.sort_order || 0),
    is_active: Number(row.is_active == null ? 1 : row.is_active),
    tax_id: row.tax_id == null ? null : Number(row.tax_id),
    hs_code: row.hs_code || null,
    default_margin_percent:
      row.default_margin_percent == null ? null : Number(row.default_margin_percent),
  };
}

function buildCategoryIndexes(rows) {
  const normalized = rows.map(normalizeCategoryRow);
  const byId = new Map();
  const childrenByParent = new Map();

  normalized.forEach((row) => {
    byId.set(row.id, row);
    const key = row.parent_id == null ? null : row.parent_id;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(row);
  });

  for (const list of childrenByParent.values()) {
    list.sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        String(a.name).localeCompare(String(b.name)) ||
        a.id - b.id,
    );
  }

  return { rows: normalized, byId, childrenByParent };
}

function getAncestorIds(byId, categoryId) {
  const ids = [];
  let cursor = byId.get(Number(categoryId));
  const seen = new Set();
  while (cursor && cursor.parent_id != null && !seen.has(cursor.parent_id)) {
    seen.add(cursor.parent_id);
    ids.unshift(cursor.parent_id);
    cursor = byId.get(cursor.parent_id);
  }
  return ids;
}

function getDescendantIds(childrenByParent, categoryId) {
  const rootId = Number(categoryId);
  const ids = [];
  const queue = [...(childrenByParent.get(rootId) || [])];
  while (queue.length) {
    const node = queue.shift();
    ids.push(node.id);
    queue.push(...(childrenByParent.get(node.id) || []));
  }
  return ids;
}

function getDescendantLeafIdsFromIndexes(indexes, categoryId) {
  const rootId = Number(categoryId);
  if (!indexes.byId.has(rootId)) return [];
  const ids = [];
  const queue = [rootId];
  while (queue.length) {
    const currentId = queue.shift();
    const children = indexes.childrenByParent.get(currentId) || [];
    if (!children.length) {
      ids.push(currentId);
      continue;
    }
    children.forEach((child) => queue.push(child.id));
  }
  return ids;
}

function isLeafCategoryFromIndexes(indexes, categoryId) {
  return (indexes.childrenByParent.get(Number(categoryId)) || []).length === 0;
}

function wouldCreateCycle(indexes, categoryId, nextParentId) {
  const nodeId = Number(categoryId);
  if (nextParentId == null) return false;
  const parentId = Number(nextParentId);
  if (nodeId === parentId) return true;
  return getDescendantIds(indexes.childrenByParent, nodeId).includes(parentId);
}

function enrichCategories(rows, directProductCounts = {}) {
  const indexes = buildCategoryIndexes(rows);
  const rollupCounts = new Map();

  function computeRollup(categoryId) {
    if (rollupCounts.has(categoryId)) return rollupCounts.get(categoryId);
    const direct = Number(directProductCounts[categoryId] || 0);
    const children = indexes.childrenByParent.get(categoryId) || [];
    const total =
      direct + children.reduce((sum, child) => sum + computeRollup(child.id), 0);
    rollupCounts.set(categoryId, total);
    return total;
  }

  indexes.rows.forEach((row) => computeRollup(row.id));

  return indexes.rows.map((row) => {
    const ancestorIds = getAncestorIds(indexes.byId, row.id);
    const pathIds = [...ancestorIds, row.id];
    const pathNames = pathIds
      .map((id) => indexes.byId.get(id)?.name)
      .filter(Boolean);
    const children = indexes.childrenByParent.get(row.id) || [];
    return {
      ...row,
      depth: ancestorIds.length,
      path_ids: pathIds,
      path_names: pathNames,
      path_label: pathNames.join(" > "),
      child_count: children.length,
      product_count_direct: Number(directProductCounts[row.id] || 0),
      product_count_rollup: Number(rollupCounts.get(row.id) || 0),
      is_leaf: children.length === 0,
    };
  });
}

async function fetchCategoryRows(db) {
  return dbAllAsync(
    db,
    `SELECT id, name, description, parent_id, sort_order, is_active, tax_id, hs_code, default_margin_percent
     FROM categories
     ORDER BY sort_order ASC, name ASC, id ASC`,
  );
}

async function fetchDirectProductCounts(db) {
  const rows = await dbAllAsync(
    db,
    `SELECT category_id, COUNT(*) AS product_count
     FROM products
     WHERE category_id IS NOT NULL
     GROUP BY category_id`,
  );
  return rows.reduce((acc, row) => {
    acc[Number(row.category_id)] = Number(row.product_count || 0);
    return acc;
  }, {});
}

async function fetchEnrichedCategories(db) {
  const [rows, productCounts] = await Promise.all([
    fetchCategoryRows(db),
    fetchDirectProductCounts(db),
  ]);
  return enrichCategories(rows, productCounts);
}

async function fetchCategoryIndexes(db) {
  const rows = await fetchCategoryRows(db);
  return buildCategoryIndexes(rows);
}

function resolveInheritedField(byId, categoryId, fieldName) {
  let current = categoryId;
  while (current) {
    const cat = byId.get(current);
    if (!cat) break;
    if (cat[fieldName] != null) return cat[fieldName];
    current = cat.parent_id;
  }
  return null;
}

async function getCategoryById(db, categoryId) {
  if (!categoryId) return null;
  return dbGetAsync(
    db,
    `SELECT id, name, description, parent_id, sort_order, is_active, tax_id, hs_code, default_margin_percent
     FROM categories WHERE id = $1`,
    [Number(categoryId)],
  );
}

async function getDescendantLeafIds(db, categoryId) {
  const indexes = await fetchCategoryIndexes(db);
  return getDescendantLeafIdsFromIndexes(indexes, categoryId);
}

async function isLeafCategory(db, categoryId) {
  const indexes = await fetchCategoryIndexes(db);
  return isLeafCategoryFromIndexes(indexes, categoryId);
}

module.exports = {
  dbAllAsync,
  dbGetAsync,
  fetchCategoryRows,
  fetchDirectProductCounts,
  fetchEnrichedCategories,
  fetchCategoryIndexes,
  getCategoryById,
  getAncestorIds,
  getDescendantIds,
  getDescendantLeafIds,
  getDescendantLeafIdsFromIndexes,
  isLeafCategory,
  isLeafCategoryFromIndexes,
  wouldCreateCycle,
  enrichCategories,
  buildCategoryIndexes,
  resolveInheritedField,
};
