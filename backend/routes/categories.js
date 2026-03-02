const {
  dbAllAsync,
  dbGetAsync,
  fetchEnrichedCategories,
  fetchCategoryIndexes,
  getCategoryById,
  getDescendantIds,
  getDescendantLeafIds,
  getDescendantLeafIdsFromIndexes,
  wouldCreateCycle,
} = require("../category-tree");

module.exports = function registerCategoryRoutes(app, deps) {
  const { db } = deps;

  async function sendCategories(res) {
    const categories = await fetchEnrichedCategories(db);
    res.json({ categories });
  }

  async function ensureSiblingNameAvailable(name, parentId, excludeId = null) {
    const rows = await dbAllAsync(
      db,
      `SELECT id, parent_id
       FROM categories
       WHERE lower(name) = lower(?)
         AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)`,
      [name, parentId, parentId],
    );
    return !(rows || []).some((row) => Number(row.id) !== Number(excludeId));
  }

  async function getDirectProductCount(categoryId) {
    const row = await dbGetAsync(
      db,
      `SELECT COUNT(*) AS count FROM products WHERE category_id = ?`,
      [Number(categoryId)],
    );
    return Number(row?.count || 0);
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

  app.post("/api/categories", async (req, res) => {
    try {
      const {
        name,
        description = null,
        parent_id = null,
        sort_order = 0,
        is_active = 1,
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
      db.run(
        `INSERT INTO categories (name, description, parent_id, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?)`,
        [
          String(name).trim(),
          description || null,
          normalizedParentId,
          Number(sort_order || 0),
          Number(is_active) === 0 ? 0 : 1,
        ],
        async function (err) {
          if (err) return res.status(500).json({ error: err.message });
          const category = await dbGetAsync(
            db,
            `SELECT id, name, description, parent_id, sort_order, is_active
             FROM categories WHERE id = ?`,
            [this.lastID],
          );
          res.json(category);
        },
      );
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/categories/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await dbGetAsync(
        db,
        `SELECT id, name, description, parent_id, sort_order, is_active
         FROM categories WHERE id = ?`,
        [id],
      );
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
        const assignedProducts = await dbGetAsync(
          db,
          `SELECT COUNT(*) AS count FROM products WHERE category_id = ?`,
          [Number(id)],
        );
        if (Number(assignedProducts?.count || 0) > 0) {
          return res.status(400).json({
            error: "Category with assigned products cannot become a parent",
          });
        }
      }

      db.run(
        `UPDATE categories
         SET name = ?, description = ?, parent_id = ?, sort_order = ?, is_active = ?
         WHERE id = ?`,
        [
          String(nextName).trim(),
          nextDescription || null,
          nextParentId == null || nextParentId === ""
            ? null
            : Number(nextParentId),
          Number(nextSortOrder || 0),
          Number(nextIsActive) === 0 ? 0 : 1,
          id,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0) {
            return res.status(404).json({ error: "Category not found" });
          }
          res.json({ message: "Category updated successfully" });
        },
      );
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/categories/create-child-and-move", async (req, res) => {
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

      const parent = await getCategoryById(db, normalizedParentId);
      if (!parent) {
        return res.status(404).json({ error: "Parent category not found" });
      }

      const directProductCount = await getDirectProductCount(normalizedParentId);

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        db.run(
          `INSERT INTO categories (name, description, parent_id, sort_order, is_active)
           VALUES (?, ?, ?, ?, ?)`,
          [
            String(name).trim(),
            description || null,
            normalizedParentId,
            Number(sort_order || 0),
            Number(is_active) === 0 ? 0 : 1,
          ],
          function (insertErr) {
            if (insertErr) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: insertErr.message });
            }
            const childId = this.lastID;
            db.run(
              `UPDATE products
               SET category_id = ?
               WHERE category_id = ?`,
              [childId, normalizedParentId],
              async function (moveErr) {
                if (moveErr) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: moveErr.message });
                }
                const moved_products = Number(this.changes || 0);
                db.run("COMMIT", async (commitErr) => {
                  if (commitErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: commitErr.message });
                  }
                  const category = await dbGetAsync(
                    db,
                    `SELECT id, name, description, parent_id, sort_order, is_active
                     FROM categories WHERE id = ?`,
                    [childId],
                  );
                  res.json({
                    category,
                    moved_products,
                    parent_direct_products_before: directProductCount,
                  });
                });
              },
            );
          },
        );
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/categories/:id/move-products", async (req, res) => {
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

      const [source, target, indexes] = await Promise.all([
        getCategoryById(db, sourceId),
        getCategoryById(db, targetId),
        fetchCategoryIndexes(db),
      ]);
      if (!source) return res.status(404).json({ error: "Source category not found" });
      if (!target) return res.status(404).json({ error: "Target category not found" });

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

      db.run(
        `UPDATE products
         SET category_id = ?
         WHERE category_id = ?`,
        [targetId, sourceId],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            message: "Products moved successfully",
            moved_products: Number(this.changes || 0),
          });
        },
      );
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/categories/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const childRow = await dbGetAsync(
        db,
        `SELECT COUNT(*) AS count FROM categories WHERE parent_id = ?`,
        [id],
      );
      if (Number(childRow?.count || 0) > 0) {
        return res.status(400).json({
          error: "Cannot delete category with child categories.",
        });
      }
      const productRow = await dbGetAsync(
        db,
        `SELECT COUNT(*) AS count FROM products WHERE category_id = ?`,
        [id],
      );
      if (Number(productRow?.count || 0) > 0) {
        return res.status(400).json({
          error: "Cannot delete category with assigned products.",
        });
      }
      db.run("DELETE FROM categories WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) {
          return res.status(404).json({ error: "Category not found" });
        }
        res.json({ message: "Category deleted" });
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
