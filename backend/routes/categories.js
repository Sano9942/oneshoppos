const {
  fetchEnrichedCategories,
  fetchCategoryIndexes,
  getCategoryById,
  getDescendantIds,
  getDescendantLeafIds,
  getDescendantLeafIdsFromIndexes,
  wouldCreateCycle,
} = require("../category-tree");

module.exports = function registerCategoryRoutes(app, deps) {
  const { db, requirePerm } = deps;


  async function sendCategories(res) {
    const categories = await fetchEnrichedCategories(db);
    res.json({ categories });
  }

  async function ensureSiblingNameAvailable(name, parentId, excludeId = null) {
    const { rows } = await db.query(
      `SELECT id, parent_id
       FROM categories
       WHERE lower(name) = lower($1)
         AND ((parent_id IS NULL AND $2::INTEGER IS NULL) OR parent_id = $2)`,
      [name, parentId],
    );
    return !(rows || []).some((row) => Number(row.id) !== Number(excludeId));
  }

  async function getDirectProductCount(categoryId) {
    const { rows } = await db.query(
      `SELECT COUNT(*) AS count FROM products WHERE category_id = $1`,
      [Number(categoryId)],
    );
    return Number(rows[0]?.count || 0);
  }

  function formatValidationError(error) {
    return typeof error === "string" ? { error } : error;
  }

  async function validateParentConstraints({
    categoryId = null,
    parentId = null,
    categoryName,
    allowParentWithProducts = false,
  }) {
    const trimmedName = String(categoryName || "").trim();
    if (!trimmedName) return "Category name is required";

    const normalizedParentId =
      parentId == null || parentId === "" ? null : Number(parentId);
    if (normalizedParentId != null && !Number.isInteger(normalizedParentId)) {
      return "Invalid parent category";
    }

    const indexes = await fetchCategoryIndexes(db);
    if (normalizedParentId != null && !indexes.byId.has(normalizedParentId)) {
      return "Parent category not found";
    }
    if (categoryId != null) {
      const id = Number(categoryId);
      if (!indexes.byId.has(id)) return "Category not found";
      if (wouldCreateCycle(indexes, id, normalizedParentId)) {
        return "Category cannot be moved into itself or one of its descendants";
      }
    }

    const nameAvailable = await ensureSiblingNameAvailable(
      trimmedName,
      normalizedParentId,
      categoryId,
    );
    if (!nameAvailable) {
      return "A sibling category with this name already exists";
    }

    if (normalizedParentId != null && !allowParentWithProducts) {
      const directProductCount = await getDirectProductCount(normalizedParentId);
      if (directProductCount > 0) {
        return {
          error: "Category with assigned products cannot become a parent",
          code: "parent_has_products",
          parent_id: normalizedParentId,
          direct_product_count: directProductCount,
        };
      }
    }

    return null;
  }

  app.get("/api/categories", async (req, res) => {
    try {
      await sendCategories(res);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/categories", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const {
        name,
        description = null,
        parent_id = null,
        sort_order = 0,
        is_active = 1,
        tax_id = null,
        hs_code = null,
        default_margin_percent = null,
      } = req.body || {};
      const validationError = await validateParentConstraints({
        parentId: parent_id,
        categoryName: name,
      });
      if (validationError) {
        return res.status(400).json(formatValidationError(validationError));
      }

      const normalizedParentId =
        parent_id == null || parent_id === "" ? null : Number(parent_id);

      const { rows } = await db.query(
        `INSERT INTO categories (name, description, parent_id, sort_order, is_active, tax_id, hs_code, default_margin_percent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, description, parent_id, sort_order, is_active, tax_id, hs_code, default_margin_percent`,
        [
          String(name).trim(),
          description || null,
          normalizedParentId,
          Number(sort_order || 0),
          Number(is_active) === 0 ? false : true,
          tax_id || null,
          hs_code || null,
          default_margin_percent === "" || default_margin_percent == null
            ? null
            : Number(default_margin_percent),
        ],
      );
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/categories/:id", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: existRows } = await db.query(
        `SELECT id, name, description, parent_id, sort_order, is_active, tax_id, hs_code, default_margin_percent
         FROM categories WHERE id = $1`,
        [id],
      );
      const existing = existRows[0] || null;
      if (!existing) {
        return res.status(404).json({ error: "Category not found" });
      }

      const nextName =
        req.body?.name !== undefined ? req.body.name : existing.name;
      const nextDescription =
        req.body?.description !== undefined
          ? req.body.description
          : existing.description;
      const nextParentId =
        req.body && Object.prototype.hasOwnProperty.call(req.body, "parent_id")
          ? req.body.parent_id
          : existing.parent_id;
      const nextSortOrder =
        req.body && Object.prototype.hasOwnProperty.call(req.body, "sort_order")
          ? req.body.sort_order
          : existing.sort_order;
      const nextIsActive =
        req.body && Object.prototype.hasOwnProperty.call(req.body, "is_active")
          ? req.body.is_active
          : existing.is_active;
      const nextTaxId =
        req.body && Object.prototype.hasOwnProperty.call(req.body, "tax_id")
          ? req.body.tax_id
          : existing.tax_id;
      const nextHsCode =
        req.body && Object.prototype.hasOwnProperty.call(req.body, "hs_code")
          ? req.body.hs_code
          : existing.hs_code;
      const nextMargin =
        req.body && Object.prototype.hasOwnProperty.call(req.body, "default_margin_percent")
          ? req.body.default_margin_percent
          : existing.default_margin_percent;

      const validationError = await validateParentConstraints({
        categoryId: id,
        parentId: nextParentId,
        categoryName: nextName,
      });
      if (validationError) {
        return res.status(400).json(formatValidationError(validationError));
      }

      const descendantIds = getDescendantIds(
        (await fetchCategoryIndexes(db)).childrenByParent,
        Number(id),
      );
      if (descendantIds.length) {
        const { rows: prodRows } = await db.query(
          `SELECT COUNT(*) AS count FROM products WHERE category_id = $1`,
          [Number(id)],
        );
        if (Number(prodRows[0]?.count || 0) > 0) {
          return res.status(400).json({
            error: "Category with assigned products cannot become a parent",
          });
        }
      }

      const { rowCount } = await db.query(
        `UPDATE categories
         SET name = $1, description = $2, parent_id = $3, sort_order = $4, is_active = $5, tax_id = $6, hs_code = $7, default_margin_percent = $8
         WHERE id = $9`,
        [
          String(nextName).trim(),
          nextDescription || null,
          nextParentId == null || nextParentId === ""
            ? null
            : Number(nextParentId),
          Number(nextSortOrder || 0),
          Number(nextIsActive) === 0 ? false : true,
          nextTaxId || null,
          nextHsCode || null,
          nextMargin === "" || nextMargin == null ? null : Number(nextMargin),
          id,
        ],
      );
      if (rowCount === 0) {
        return res.status(404).json({ error: "Category not found" });
      }
      res.json({ message: "Category updated successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/categories/create-child-and-move", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const {
        name,
        description = null,
        parent_id = null,
        sort_order = 0,
        is_active = 1,
      } = req.body || {};

      const normalizedParentId =
        parent_id == null || parent_id === "" ? null : Number(parent_id);
      if (normalizedParentId == null) {
        return res.status(400).json({
          error: "Parent category is required for guided conversion",
        });
      }

      const validationError = await validateParentConstraints({
        parentId: normalizedParentId,
        categoryName: name,
        allowParentWithProducts: true,
      });
      if (validationError) {
        return res.status(400).json(formatValidationError(validationError));
      }

      const { rows: parentRows } = await db.query(
        "SELECT id, name, description, parent_id, sort_order, is_active FROM categories WHERE id = $1",
        [normalizedParentId],
      );
      if (!parentRows.length) {
        return res.status(404).json({ error: "Parent category not found" });
      }

      const directProductCount = await getDirectProductCount(normalizedParentId);

      const result = await db.transaction(async (client) => {
        const { rows: insertRows } = await client.query(
          `INSERT INTO categories (name, description, parent_id, sort_order, is_active)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            String(name).trim(),
            description || null,
            normalizedParentId,
            Number(sort_order || 0),
            Number(is_active) === 0 ? false : true,
          ],
        );
        const childId = insertRows[0].id;
        const { rowCount } = await client.query(
          `UPDATE products SET category_id = $1 WHERE category_id = $2`,
          [childId, normalizedParentId],
        );
        return { childId, moved_products: rowCount };
      });

      const { rows: catRows } = await db.query(
        `SELECT id, name, description, parent_id, sort_order, is_active
         FROM categories WHERE id = $1`,
        [result.childId],
      );
      res.json({
        category: catRows[0],
        moved_products: result.moved_products,
        parent_direct_products_before: directProductCount,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/categories/:id/move-products", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const sourceId = Number(req.params.id);
      const targetId = Number(req.body?.target_category_id);
      if (!sourceId || !targetId) {
        return res.status(400).json({
          error: "Source and target categories are required",
        });
      }
      if (sourceId === targetId) {
        return res.status(400).json({
          error: "Source and target categories must be different",
        });
      }

      const [sourceRows, targetRows, indexes] = await Promise.all([
        db.query("SELECT id, name, description, parent_id, sort_order, is_active FROM categories WHERE id = $1", [sourceId]),
        db.query("SELECT id, name, description, parent_id, sort_order, is_active FROM categories WHERE id = $1", [targetId]),
        fetchCategoryIndexes(db),
      ]);
      if (!sourceRows.rows.length) return res.status(404).json({ error: "Source category not found" });
      if (!targetRows.rows.length) return res.status(404).json({ error: "Target category not found" });

      const targetLeafIds = await getDescendantLeafIds(db, targetId);
      if (targetLeafIds.length !== 1 || Number(targetLeafIds[0]) !== Number(targetId)) {
        return res.status(400).json({
          error: "Products can only be moved to a leaf category",
        });
      }

      const sourceChildren = indexes.childrenByParent.get(sourceId) || [];
      const descendantLeafIds = getDescendantLeafIdsFromIndexes(indexes, sourceId);
      if (sourceChildren.length > 0 && !descendantLeafIds.includes(targetId)) {
        return res.status(400).json({
          error: "When moving from a parent category, target must be one of its leaf children",
        });
      }

      const { rowCount } = await db.query(
        `UPDATE products SET category_id = $1 WHERE category_id = $2`,
        [targetId, sourceId],
      );
      res.json({
        message: "Products moved successfully",
        moved_products: rowCount,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/categories/:id", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: childRows } = await db.query(
        `SELECT COUNT(*) AS count FROM categories WHERE parent_id = $1`,
        [id],
      );
      if (Number(childRows[0]?.count || 0) > 0) {
        return res.status(400).json({
          error: "Cannot delete category with child categories.",
        });
      }
      const { rows: productRows } = await db.query(
        `SELECT COUNT(*) AS count FROM products WHERE category_id = $1`,
        [id],
      );
      if (Number(productRows[0]?.count || 0) > 0) {
        return res.status(400).json({
          error: "Cannot delete category with assigned products.",
        });
      }
      const { rowCount } = await db.query("DELETE FROM categories WHERE id = $1", [id]);
      if (rowCount === 0) {
        return res.status(404).json({ error: "Category not found" });
      }
      res.json({ message: "Category deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
