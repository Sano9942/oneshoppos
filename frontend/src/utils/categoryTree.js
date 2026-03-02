export function sortCategories(rows) {
  return [...(rows || [])].sort((a, b) => {
    const sortDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
    if (sortDiff !== 0) return sortDiff;
    return String(a.path_label || a.name || "").localeCompare(
      String(b.path_label || b.name || ""),
    );
  });
}

export function leafCategories(rows) {
  return sortCategories(rows).filter((row) => Boolean(row.is_leaf));
}

export function parentOptions(rows, currentId = null) {
  const current = rows.find((row) => Number(row.id) === Number(currentId));
  const blockedIds = new Set([currentId].filter(Boolean));
  if (current?.path_ids?.length) {
    rows.forEach((row) => {
      if ((row.path_ids || []).includes(Number(currentId))) blockedIds.add(row.id);
    });
  }
  return sortCategories(rows).filter((row) => !blockedIds.has(row.id));
}

export function indentLabel(row) {
  const depth = Number(row.depth || 0);
  return `${"  ".repeat(depth)}${row.path_label || row.name || ""}`;
}
