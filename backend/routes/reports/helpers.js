const {
  fetchEnrichedCategories,
  getDescendantLeafIds,
} = require("../../category-tree");
const { toUtcStart, toUtcEnd } = require("../../utils/tz");

/**
 * Shared helpers for report route modules
 */
module.exports = function (db) {
  async function buildCategoryMetaMap() {
    const categories = await fetchEnrichedCategories(db);
    return new Map(categories.map((row) => [Number(row.id), row]));
  }

  function withCategoryPaths(rows, categoryMeta, sourceKey = "category_id") {
    return (rows || []).map((row) => {
      const categoryId = row[sourceKey] == null ? null : Number(row[sourceKey]);
      const category = categoryId != null ? categoryMeta.get(categoryId) : null;
      return {
        ...row,
        category: category?.path_label || row.category || "Uncategorized",
        category_path_label:
          category?.path_label || row.category || "Uncategorized",
      };
    });
  }

  async function buildReportFilterParts(req, aliases = {}) {
    const {
      sale = "s",
      product = "p",
      item = "si",
      outlet = "o",
      employee = "e",
    } = aliases;
    const { date_from, date_to, outlet_id, employee_id, category_id } =
      req.query || {};
    const tz = req.company?.timezone || "UTC";
    const where = [];
    const params = [];

    if (sale) where.push(`${sale}.voided = 0`);
    if (date_from && sale) {
      where.push(`${sale}.timestamp >= ?`);
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to && sale) {
      where.push(`${sale}.timestamp < ?`);
      params.push(toUtcEnd(date_to, tz));
    }
    if (outlet_id) {
      if (sale) {
        where.push(`${sale}.outlet_id = ?`);
      } else if (outlet) {
        where.push(`${outlet}.id = ?`);
      }
      params.push(outlet_id);
    }
    if (employee_id && sale && employee) {
      where.push(`${sale}.employee_id = ?`);
      params.push(employee_id);
    }
    if (category_id && product) {
      const leafIds = await getDescendantLeafIds(db, Number(category_id));
      if (!leafIds.length) {
        where.push("1 = 0");
      } else if (leafIds.length === 1) {
        where.push(`${product}.category_id = ?`);
        params.push(Number(leafIds[0]));
      } else {
        where.push(
          `${product}.category_id IN (${leafIds.map(() => "?").join(",")})`,
        );
        params.push(...leafIds.map(Number));
      }
    }
    if (item) where.push(`${item}.quantity > 0`);

    return { where, params };
  }

  function parsePaging(req) {
    const limit = Math.max(
      1,
      Math.min(500, parseInt(req.query.limit || 100, 10)),
    );
    const offset = Math.max(0, parseInt(req.query.offset || 0, 10));
    return { limit, offset };
  }

  function parseJsonObject(raw) {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed;
      return {};
    } catch {
      return {};
    }
  }

  function nextRunAtIso(
    frequency,
    runHour = 6,
    runMinute = 0,
    fromDate = new Date(),
  ) {
    const next = new Date(fromDate);
    next.setSeconds(0, 0);
    next.setHours(Number(runHour) || 6, Number(runMinute) || 0, 0, 0);
    if (next <= fromDate) {
      next.setDate(next.getDate() + 1);
    }
    if (String(frequency || "daily").toLowerCase() === "weekly") {
      next.setDate(next.getDate() + 6);
    }
    return next.toISOString().slice(0, 19).replace("T", " ");
  }

  function toCsvLines(rows, columns, meta = {}) {
    const lines = [];
    lines.push(`# generated_at: ${new Date().toISOString()}`);
    lines.push(`# data_as_of: ${new Date().toISOString()}`);
    lines.push(`# currency: PKR`);
    lines.push(`# filters_applied: ${JSON.stringify(meta)}`);
    lines.push(columns.map((c) => c.header).join(","));
    (rows || []).forEach((row) => {
      lines.push(
        columns
          .map(
            (c) =>
              `"${String(row[c.key] == null ? "" : row[c.key]).replace(/"/g, '""')}"`,
          )
          .join(","),
      );
    });
    return lines.join("\n");
  }

  return {
    buildCategoryMetaMap,
    withCategoryPaths,
    buildReportFilterParts,
    parsePaging,
    parseJsonObject,
    nextRunAtIso,
    toCsvLines,
    getDescendantLeafIds: (id) => getDescendantLeafIds(db, id),
  };
};
