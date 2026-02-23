const express = require("express");
const cors = require("cors");
const db = require("./db");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json()); // Parse JSON bodies

// --- ROUTES: TAXES ---

// Get all taxes
app.get("/api/taxes", (req, res) => {
  db.all("SELECT * FROM taxes ORDER BY name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ taxes: rows });
  });
});

// Add a new tax
app.post("/api/taxes", (req, res) => {
  const { name, rate, is_default } = req.body;
  db.run(
    "INSERT INTO taxes (name, rate, is_default) VALUES (?, ?, ?)",
    [name, rate, is_default ? 1 : 0],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, rate, is_default });
    },
  );
});

// Update a tax
app.put("/api/taxes/:id", (req, res) => {
  const { id } = req.params;
  const { name, rate, is_default } = req.body;
  db.run(
    "UPDATE taxes SET name = COALESCE(?, name), rate = COALESCE(?, rate), is_default = COALESCE(?, is_default) WHERE id = ?",
    [name, rate, is_default ? 1 : 0, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Tax not found" });
      res.json({ message: "Tax updated successfully" });
    },
  );
});

// Delete a tax
app.delete("/api/taxes/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM taxes WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0)
      return res.status(404).json({ error: "Tax not found" });
    res.json({ message: "Tax deleted" });
  });
});

// --- ROUTES: CATEGORIES ---

// Get all categories
app.get("/api/categories", (req, res) => {
  db.all("SELECT * FROM categories ORDER BY name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ categories: rows });
  });
});

// Add a new category
app.post("/api/categories", (req, res) => {
  const { name, description } = req.body;
  db.run(
    "INSERT INTO categories (name, description) VALUES (?, ?)",
    [name, description],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, description });
    },
  );
});

// Update a category
app.put("/api/categories/:id", (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  db.run(
    "UPDATE categories SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?",
    [name, description, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Category not found" });
      res.json({ message: "Category updated successfully" });
    },
  );
});

// Delete a category
app.delete("/api/categories/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM categories WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0)
      return res.status(404).json({ error: "Category not found" });
    res.json({ message: "Category deleted" });
  });
});

// --- ROUTES: OUTLETS ---

// Get all outlets
app.get("/api/outlets", (req, res) => {
  db.all("SELECT * FROM outlets ORDER BY name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ outlets: rows });
  });
});

// Add a new outlet
app.post("/api/outlets", (req, res) => {
  const { name, address, phone } = req.body;
  db.run(
    "INSERT INTO outlets (name, address, phone) VALUES (?, ?, ?)",
    [name, address, phone],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, address, phone });
    },
  );
});

// Update an outlet
app.put("/api/outlets/:id", (req, res) => {
  const { id } = req.params;
  const { name, address, phone } = req.body;
  db.run(
    "UPDATE outlets SET name = COALESCE(?, name), address = COALESCE(?, address), phone = COALESCE(?, phone) WHERE id = ?",
    [name, address, phone, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Outlet not found" });
      res.json({ message: "Outlet updated successfully" });
    },
  );
});

// Delete an outlet
app.delete("/api/outlets/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM outlets WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0)
      return res.status(404).json({ error: "Outlet not found" });
    res.json({ message: "Outlet deleted" });
  });
});

// --- ROUTES: EMPLOYEES ---

// Get all employees
app.get("/api/employees", (req, res) => {
  db.all(
    "SELECT e.id, e.name, e.pin_code, r.name as role, e.role_id FROM employees e LEFT JOIN roles r ON e.role_id = r.id ORDER BY e.name ASC",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ employees: rows });
    },
  );
});

// Validate PIN (For POS Login)
app.post("/api/employees/validate-pin", (req, res) => {
  const { pin_code } = req.body;
  db.get(
    "SELECT e.id, e.name, r.name as role FROM employees e LEFT JOIN roles r ON e.role_id = r.id WHERE e.pin_code = ?",
    [pin_code],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(401).json({ error: "Invalid PIN" });
      res.json({ employee: row });
    },
  );
});

// Add a new employee
app.post("/api/employees", (req, res) => {
  const { name, role_id, pin_code } = req.body;
  db.run(
    "INSERT INTO employees (name, role_id, pin_code) VALUES (?, ?, ?)",
    [name, role_id || 3, pin_code],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(400).json({ error: "PIN code must be unique" });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, name, role_id });
    },
  );
});

// Update an employee
app.put("/api/employees/:id", (req, res) => {
  const { id } = req.params;
  const { name, role_id, pin_code } = req.body;

  // Allow updating PIN only if it's provided, otherwise keep existing
  let query =
    "UPDATE employees SET name = COALESCE(?, name), role_id = COALESCE(?, role_id)";
  let params = [name, role_id];

  if (pin_code !== undefined && pin_code !== "") {
    query += ", pin_code = ?";
    params.push(pin_code);
  }

  query += " WHERE id = ?";
  params.push(id);

  db.run(query, params, function (err) {
    if (err) {
      if (err.message.includes("UNIQUE constraint failed")) {
        return res.status(400).json({ error: "PIN code must be unique" });
      }
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0)
      return res.status(404).json({ error: "Employee not found" });
    res.json({ message: "Employee updated successfully" });
  });
});

// Delete an employee
app.delete("/api/employees/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM employees WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0)
      return res.status(404).json({ error: "Employee not found" });
    res.json({ message: "Employee deleted" });
  });
});

// --- ROUTES: ROLES AND PERMISSIONS ---

// Get all roles
app.get("/api/roles", (req, res) => {
  db.all("SELECT * FROM roles ORDER BY id ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ roles: rows });
  });
});

// Add a new role
app.post("/api/roles", (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "Role name is required" });

  db.run(
    "INSERT INTO roles (name, description) VALUES (?, ?)",
    [name, description],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(400).json({ error: "Role name already exists" });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, name, description });
    },
  );
});

// Update a role
app.put("/api/roles/:id", (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  db.run(
    "UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?",
    [name, description, id],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(400).json({ error: "Role name already exists" });
        }
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0)
        return res.status(404).json({ error: "Role not found" });
      res.json({ message: "Role updated successfully" });
    },
  );
});

// Delete a role
app.delete("/api/roles/:id", (req, res) => {
  const { id } = req.params;

  // Prevent deleting default roles (id 1, 2, 3)
  if (["1", "2", "3"].includes(id.toString())) {
    return res.status(400).json({
      error:
        "Cannot delete default system roles. You can only edit their names or permissions.",
    });
  }

  // Check if role is used by employees
  db.get(
    "SELECT COUNT(*) as count FROM employees WHERE role_id = ?",
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (row.count > 0)
        return res.status(400).json({
          error: `Cannot delete role. It is currently assigned to ${row.count} employee(s).`,
        });

      db.run("DELETE FROM role_permissions WHERE role_id = ?", [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        db.run("DELETE FROM roles WHERE id = ?", [id], function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0)
            return res.status(404).json({ error: "Role not found" });
          res.json({ message: "Role deleted" });
        });
      });
    },
  );
});

// Get permissions for a specific role
app.get("/api/roles/:id/permissions", (req, res) => {
  const { id } = req.params;
  db.all(
    "SELECT permission FROM role_permissions WHERE role_id = ?",
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      // Transform rows array of objects into simple array of strings
      const permissions = rows.map((r) => r.permission);
      res.json({ permissions });
    },
  );
});

// Update permissions for a specific role
app.put("/api/roles/:id/permissions", (req, res) => {
  const { id } = req.params;
  const { permissions } = req.body; // expected to be an array of permission strings

  if (!Array.isArray(permissions)) {
    return res
      .status(400)
      .json({ error: "Permissions must be an array of strings" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    // Clear old permissions
    db.run("DELETE FROM role_permissions WHERE role_id = ?", [id], (err) => {
      if (err) {
        db.run("ROLLBACK");
        return res.status(500).json({ error: err.message });
      }
    });

    if (permissions.length > 0) {
      // Create new permissions
      const placeholders = permissions.map(() => "(?, ?)").join(", ");
      const values = permissions.reduce(
        (acc, perm) => acc.concat([id, perm]),
        [],
      );

      db.run(
        `INSERT INTO role_permissions (role_id, permission) VALUES ${placeholders}`,
        values,
        (err) => {
          if (err) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err.message });
          }
          db.run("COMMIT");
          return res.json({ message: "Permissions updated successfully" });
        },
      );
    } else {
      db.run("COMMIT");
      return res.json({ message: "Permissions cleared successfully" });
    }
  });
});

// --- ROUTES: BRANDS ---

// Get all brands
app.get("/api/brands", (req, res) => {
  db.all("SELECT * FROM brands ORDER BY name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ brands: rows });
  });
});

// Add a new brand
app.post("/api/brands", (req, res) => {
  const { name, description } = req.body;
  db.run(
    "INSERT INTO brands (name, description) VALUES (?, ?)",
    [name, description],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(400).json({ error: "Brand name must be unique" });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, name, description });
    },
  );
});

// Update a brand
app.put("/api/brands/:id", (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  db.run(
    "UPDATE brands SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?",
    [name, description, id],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(400).json({ error: "Brand name must be unique" });
        }
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0)
        return res.status(404).json({ error: "Brand not found" });
      res.json({ message: "Brand updated successfully" });
    },
  );
});

// Delete a brand
app.delete("/api/brands/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM brands WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0)
      return res.status(404).json({ error: "Brand not found" });
    res.json({ message: "Brand deleted" });
  });
});

// --- ROUTES: PRODUCTS (INVENTORY) ---

// Get all products (with aggregated stock)
app.get("/api/products", (req, res) => {
  db.all(
    `
        SELECT p.*, 
               c.name as category_name, 
               t.name as tax_name, t.rate as tax_rate,
               s.name as supplier_name,
               b.name as brand_name,
               (COALESCE(os_sum.total, 0) + COALESCE(pv_sum.total, 0)) as total_stock
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN taxes t ON p.tax_id = t.id
        LEFT JOIN suppliers s ON p.supplier_id = s.id
        LEFT JOIN brands b ON p.brand_id = b.id
        LEFT JOIN (
            SELECT product_id, SUM(quantity) as total FROM outlet_stock GROUP BY product_id
        ) os_sum ON p.id = os_sum.product_id
        LEFT JOIN (
            SELECT product_id, SUM(stock) as total FROM product_variants GROUP BY product_id
        ) pv_sum ON p.id = pv_sum.product_id
        ORDER BY p.name ASC
    `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ products: rows });
    },
  );
});

// Get variants for a specific product
app.get("/api/products/:id/variants", (req, res) => {
  const { id } = req.params;

  db.all(
    `SELECT pv.*, 
            json_group_array(
               json_object('attribute_name', a.name, 'option_value', ao.value)
            ) as options_json
     FROM product_variants pv
     LEFT JOIN variant_option_values vov ON pv.id = vov.variant_id
     LEFT JOIN attributes a ON vov.attribute_id = a.id
     LEFT JOIN attribute_options ao ON vov.attribute_option_id = ao.id
     WHERE pv.product_id = ?
     GROUP BY pv.id`,
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      const variants = rows.map((r) => ({
        ...r,
        options: r.options_json
          ? JSON.parse(r.options_json).filter((o) => o.attribute_name !== null)
          : [],
      }));
      res.json({ variants });
    },
  );
});

// Get individual product stock across all outlets
app.get("/api/products/:id/stock", (req, res) => {
  const { id } = req.params;
  db.all(
    `
        SELECT os.outlet_id, o.name as outlet_name, os.quantity 
        FROM outlet_stock os
        JOIN outlets o ON os.outlet_id = o.id
        WHERE os.product_id = ?
    `,
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ stock: rows });
    },
  );
});

// Search products by name or barcode (for autocomplete and search)
app.get("/api/products/search", (req, res) => {
  const { query, outlet_id } = req.query;

  if (!query) return res.json({ products: [] });

  const searchQuery = `%${query}%`;

  let sql = `
        SELECT p.*, t.rate as tax_rate, t.name as tax_name,
               COALESCE(SUM(os.quantity), 0) as local_stock
        FROM products p
        LEFT JOIN taxes t ON p.tax_id = t.id
        LEFT JOIN outlet_stock os ON p.id = os.product_id ${outlet_id ? `AND os.outlet_id = ${outlet_id}` : ""}
        WHERE p.name LIKE ? OR p.barcode LIKE ?
        GROUP BY p.id
        ORDER BY p.name ASC
        LIMIT 50
    `;

  db.all(sql, [searchQuery, searchQuery], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    // Normalize Tax Output for the POS Terminal
    const productsWithTax = rows.map((row) => {
      const effectiveTaxRate =
        row.tax_rate !== null ? row.tax_rate : row.gst !== null ? row.gst : 0;
      const effectiveTaxName =
        row.tax_name || (row.gst !== null ? "GST" : "No Tax");
      return {
        ...row,
        effectiveTaxRate,
        effectiveTaxName,
      };
    });

    res.json({ products: productsWithTax });
  });
});

// Scan/Find a product by barcode (Crucial for POS speed)
app.get("/api/products/scan/:barcode", (req, res) => {
  const { barcode } = req.params;
  const outlet_id = req.query.outlet_id; // Pass outlet ID from POS to get local stock

  let query = `
        SELECT p.*, t.rate as tax_rate, t.name as tax_name,
               COALESCE(SUM(os.quantity), 0) as local_stock
        FROM products p
        LEFT JOIN taxes t ON p.tax_id = t.id
        LEFT JOIN outlet_stock os ON p.id = os.product_id ${outlet_id ? `AND os.outlet_id = ${outlet_id}` : ""}
        WHERE p.barcode = ?
        GROUP BY p.id
    `;

  db.get(query, [barcode], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Product not found" });

    // Normalize Tax Output for the POS Terminal
    // If it has a tax profile, use it. Otherwise fallback to legacy GST.
    const effectiveTaxRate =
      row.tax_rate !== null ? row.tax_rate : row.gst !== null ? row.gst : 0;
    const effectiveTaxName =
      row.tax_name || (row.gst !== null ? "GST" : "No Tax");

    const productWithTax = {
      ...row,
      effectiveTaxRate,
      effectiveTaxName,
    };

    res.json({ product: productWithTax });
  });
});

// Add a new product (and optionally set initial stock for a specific outlet)
app.post("/api/products", (req, res) => {
  const {
    barcode,
    name,
    price,
    cost_price,
    gst,
    category_id,
    tax_id,
    brand_id,
    outlet_id,
    initial_stock,
    has_variants,
    attribute_set_id,
    variants, // Array of variant objects if has_variants is true
  } = req.body;

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    db.run(
      "INSERT INTO products (barcode, name, price, cost_price, gst, stock, category_id, tax_id, brand_id, has_variants, attribute_set_id) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)",
      [
        barcode,
        name,
        price,
        cost_price || 0,
        gst === "" ? null : gst,
        category_id || null,
        tax_id || null,
        brand_id || null,
        has_variants ? 1 : 0,
        attribute_set_id || null,
      ],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          if (err.message.includes("UNIQUE constraint failed")) {
            return res.status(400).json({ error: "Barcode already exists" });
          }
          return res.status(500).json({ error: err.message });
        }
        const newProductId = this.lastID;

        // Helper function to successfully terminate the request
        const finishCreation = () => {
          db.run("COMMIT");
          res.json({ id: newProductId, barcode, name, has_variants });
        };

        // 1. If it has variants, process them
        if (has_variants && variants && variants.length > 0) {
          let pendingVariants = variants.length;
          let hasError = false;

          variants.forEach((variant) => {
            if (hasError) return;

            db.run(
              "INSERT INTO product_variants (product_id, sku, price, cost_price, stock) VALUES (?, ?, ?, ?, 0)",
              [
                newProductId,
                variant.sku,
                variant.price || price,
                variant.cost_price || cost_price,
              ],
              function (vErr) {
                if (vErr) {
                  hasError = true;
                  db.run("ROLLBACK");
                  return res.status(500).json({
                    error: "Variant SKU constraint failed: " + vErr.message,
                  });
                }
                const variantId = this.lastID;

                // Insert Outlet stock for variant if provided
                if (outlet_id && variant.initial_stock) {
                  // TODO: Variant stock should probably be tracked in a outlet_variant_stock table in the future.
                  // For now we'll put it in the base variant table's stock column.
                  db.run("UPDATE product_variants SET stock = ? WHERE id = ?", [
                    variant.initial_stock,
                    variantId,
                  ]);
                }

                const options = variant.options || [];
                if (options.length === 0) {
                  pendingVariants--;
                  if (pendingVariants === 0 && !hasError) finishCreation();
                  return;
                }

                let pendingOptions = options.length;
                options.forEach((opt) => {
                  if (hasError) return;
                  db.run(
                    "INSERT INTO variant_option_values (variant_id, attribute_id, attribute_option_id) VALUES (?, ?, ?)",
                    [variantId, opt.attribute_id, opt.attribute_option_id],
                    function (oErr) {
                      if (oErr) {
                        hasError = true;
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: oErr.message });
                      }
                      pendingOptions--;
                      if (pendingOptions === 0) {
                        pendingVariants--;
                        if (pendingVariants === 0 && !hasError)
                          finishCreation();
                      }
                    },
                  );
                });
              },
            );
          });
        } else {
          // 2. Simple product stock initialization
          if (outlet_id && initial_stock) {
            db.run(
              "INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (?, ?, ?)",
              [newProductId, outlet_id, initial_stock],
              function (stockErr) {
                if (stockErr) {
                  db.run("ROLLBACK");
                  return res.status(500).json({
                    error:
                      "Failed to initialize outlet stock: " + stockErr.message,
                  });
                }
                finishCreation();
              },
            );
          } else {
            finishCreation();
          }
        }
      },
    );
  });
});

// Update a product (Prices, Names, Categories... NOT Stock. Stock is handled via Adjustments/Transfers)
app.put("/api/products/:id", (req, res) => {
  const { id } = req.params;
  const {
    name,
    price,
    cost_price,
    gst,
    barcode,
    category_id,
    tax_id,
    brand_id,
  } = req.body;

  // Simple dynamic update
  db.run(
    "UPDATE products SET name = COALESCE(?, name), price = COALESCE(?, price), cost_price = COALESCE(?, cost_price), gst = ?, barcode = COALESCE(?, barcode), category_id = COALESCE(?, category_id), tax_id = COALESCE(?, tax_id), brand_id = COALESCE(?, brand_id) WHERE id = ?",
    [
      name,
      price,
      cost_price,
      gst === "" ? null : gst,
      barcode,
      category_id || null,
      tax_id || null,
      brand_id || null,
      id,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Product not found" });
      res.json({ message: "Product updated successfully" });
    },
  );
});

// Delete a product
app.delete("/api/products/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM products WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0)
      return res.status(404).json({ error: "Product not found" });
    res.json({ message: "Product deleted" });
  });
});

// --- ROUTES: SUPPLIERS ---

// Get all suppliers
app.get("/api/suppliers", (req, res) => {
  db.all("SELECT * FROM suppliers ORDER BY name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ suppliers: rows });
  });
});

// Add a new supplier
app.post("/api/suppliers", (req, res) => {
  const { name, contact_person, phone, email, address } = req.body;
  db.run(
    "INSERT INTO suppliers (name, contact_person, phone, email, address) VALUES (?, ?, ?, ?, ?)",
    [name, contact_person, phone, email, address],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        id: this.lastID,
        name,
        contact_person,
        phone,
        email,
        address,
      });
    },
  );
});

// Update a supplier
app.put("/api/suppliers/:id", (req, res) => {
  const { id } = req.params;
  const { name, contact_person, phone, email, address } = req.body;

  db.run(
    "UPDATE suppliers SET name = COALESCE(?, name), contact_person = COALESCE(?, contact_person), phone = COALESCE(?, phone), email = COALESCE(?, email), address = COALESCE(?, address) WHERE id = ?",
    [name, contact_person, phone, email, address, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Supplier not found" });
      res.json({ message: "Supplier updated successfully" });
    },
  );
});

// Delete a supplier
app.delete("/api/suppliers/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM suppliers WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0)
      return res.status(404).json({ error: "Supplier not found" });
    res.json({ message: "Supplier deleted" });
  });
});

// --- ROUTES: PURCHASE ORDERS ---

// Get all purchase orders (with supplier names)
app.get("/api/purchase-orders", (req, res) => {
  db.all(
    `
        SELECT po.*, s.name as supplier_name 
        FROM purchase_orders po
        JOIN suppliers s ON po.supplier_id = s.id
        ORDER BY po.created_at DESC
    `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ purchaseOrders: rows });
    },
  );
});

// Get a single purchase order with its items
app.get("/api/purchase-orders/:id", (req, res) => {
  const { id } = req.params;
  db.get(
    `
        SELECT po.*, s.name as supplier_name 
        FROM purchase_orders po
        JOIN suppliers s ON po.supplier_id = s.id
        WHERE po.id = ?
    `,
    [id],
    (err, po) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!po)
        return res.status(404).json({ error: "Purchase order not found" });

      db.all(
        `
            SELECT poi.*, p.name, p.barcode
            FROM purchase_order_items poi
            JOIN products p ON poi.product_id = p.id
            WHERE poi.po_id = ?
        `,
        [id],
        (err, items) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ purchaseOrder: po, items });
        },
      );
    },
  );
});

// Create a new purchase order
app.post("/api/purchase-orders", (req, res) => {
  const { supplier_id, total_cost, items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: "Purchase order must have items" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    db.run(
      "INSERT INTO purchase_orders (supplier_id, total_cost, status) VALUES (?, ?, 'Draft')",
      [supplier_id, total_cost],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: "Failed to create PO" });
        }

        const poId = this.lastID;
        const stmt = db.prepare(
          "INSERT INTO purchase_order_items (po_id, product_id, quantity, cost_price) VALUES (?, ?, ?, ?)",
        );
        let hasError = false;

        items.forEach((item) => {
          stmt.run(
            poId,
            item.product_id,
            item.quantity,
            item.cost_price,
            (err) => {
              if (err) hasError = true;
            },
          );
        });

        stmt.finalize();

        if (hasError) {
          db.run("ROLLBACK");
          return res
            .status(500)
            .json({ error: "Transaction failed while adding items" });
        }

        db.run("COMMIT", (err) => {
          if (err)
            return res.status(500).json({ error: "Failed to commit PO" });
          res.json({ message: "Purchase order created", id: poId });
        });
      },
    );
  });
});

// Receive a purchase order (Updates Inventory Stock & Cost Price)
app.post("/api/purchase-orders/:id/receive", (req, res) => {
  const { id } = req.params;
  const { outlet_id, received_by, items: receivedItems, notes } = req.body;

  if (!outlet_id) {
    return res
      .status(400)
      .json({ error: "Outlet ID is required to receive PO" });
  }

  db.get("SELECT * FROM purchase_orders WHERE id = ?", [id], (err, po) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!po) return res.status(404).json({ error: "PO not found" });
    if (po.status === "Received")
      return res.status(400).json({ error: "PO already received" });

    db.all(
      "SELECT poi.*, p.name as product_name FROM purchase_order_items poi JOIN products p ON poi.product_id = p.id WHERE poi.po_id = ?",
      [id],
      (err, poItems) => {
        if (err) return res.status(500).json({ error: err.message });

        // Build a map of qty_received: use provided items or default to full quantity
        const receivedMap = {};
        if (receivedItems && Array.isArray(receivedItems)) {
          receivedItems.forEach((ri) => {
            receivedMap[ri.product_id] = parseFloat(ri.qty_received) || 0;
          });
        }

        const grnNumber = `GRN-${Date.now()}`;

        db.serialize(() => {
          db.run("BEGIN TRANSACTION");

          // 1. Update PO status
          db.run(
            "UPDATE purchase_orders SET status = 'Received' WHERE id = ?",
            [id],
          );

          // 2. Create GRN header
          db.run(
            "INSERT INTO goods_received_notes (grn_number, po_id, outlet_id, received_by, notes) VALUES (?, ?, ?, ?, ?)",
            [grnNumber, id, outlet_id, received_by || null, notes || null],
            function (err) {
              if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
              }

              const grnId = this.lastID;
              const grnItemStmt = db.prepare(
                "INSERT INTO grn_items (grn_id, product_id, qty_ordered, qty_received, cost_price) VALUES (?, ?, ?, ?, ?)",
              );
              const updateCostStmt = db.prepare(
                "UPDATE products SET cost_price = ? WHERE id = ?",
              );
              const updateStockStmt = db.prepare(`
                INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                VALUES (?, ?, ?)
                ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?
              `);

              poItems.forEach((item) => {
                const qtyReceived =
                  receivedMap[item.product_id] ?? item.quantity;
                grnItemStmt.run(
                  grnId,
                  item.product_id,
                  item.quantity,
                  qtyReceived,
                  item.cost_price,
                );
                updateCostStmt.run(item.cost_price, item.product_id);
                updateStockStmt.run(
                  item.product_id,
                  outlet_id,
                  qtyReceived,
                  qtyReceived,
                );
              });

              grnItemStmt.finalize();
              updateCostStmt.finalize();
              updateStockStmt.finalize();

              db.run("COMMIT", (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({
                  message: "PO received. GRN created.",
                  grn_number: grnNumber,
                  grn_id: grnId,
                });
              });
            },
          );
        });
      },
    );
  });
});

// --- GRN (Goods Received Notes) ---

app.get("/api/grn", (req, res) => {
  const { date_from, date_to } = req.query;
  const where = [];
  const params = [];
  if (date_from) {
    where.push("date(g.received_at,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(g.received_at,'localtime') <= ?");
    params.push(date_to);
  }
  const sql = `
    SELECT g.id, g.grn_number, g.received_at, g.notes,
           ('PO-' || printf('%04d', po.id)) as po_number, s.name as supplier_name,
           o.name as outlet_name,
           e.name as received_by_name,
           COUNT(gi.id) as line_count
    FROM goods_received_notes g
    LEFT JOIN purchase_orders po ON g.po_id = po.id
    LEFT JOIN suppliers s ON po.supplier_id = s.id
    LEFT JOIN outlets o ON g.outlet_id = o.id
    LEFT JOIN employees e ON g.received_by = e.id
    LEFT JOIN grn_items gi ON g.id = gi.grn_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    GROUP BY g.id
    ORDER BY g.received_at DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ grns: rows });
  });
});

app.get("/api/grn/:id", (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT g.*, ('PO-' || printf('%04d', po.id)) as po_number, s.name as supplier_name, o.name as outlet_name, e.name as received_by_name
     FROM goods_received_notes g
     LEFT JOIN purchase_orders po ON g.po_id = po.id
     LEFT JOIN suppliers s ON po.supplier_id = s.id
     LEFT JOIN outlets o ON g.outlet_id = o.id
     LEFT JOIN employees e ON g.received_by = e.id
     WHERE g.id = ?`,
    [id],
    (err, grn) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!grn) return res.status(404).json({ error: "GRN not found" });
      db.all(
        `SELECT gi.*, p.name as product_name, p.barcode
         FROM grn_items gi JOIN products p ON gi.product_id = p.id
         WHERE gi.grn_id = ?`,
        [id],
        (err, items) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ grn, items });
        },
      );
    },
  );
});

// Delete a purchase order
app.delete("/api/purchase-orders/:id", (req, res) => {
  const { id } = req.params;

  db.get("SELECT status FROM purchase_orders WHERE id = ?", [id], (err, po) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!po) return res.status(404).json({ error: "PO not found" });
    if (po.status === "Received")
      return res.status(400).json({ error: "Cannot delete a received PO" });

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(
        "DELETE FROM purchase_order_items WHERE po_id = ?",
        [id],
        function (err) {
          if (err) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err.message });
          }
        },
      );
      db.run("DELETE FROM purchase_orders WHERE id = ?", [id], function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: err.message });
        }
      });
      db.run("COMMIT", (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Purchase order deleted" });
      });
    });
  });
});

// --- FOR CHECKOUT (POINT OF SALE) ---

// --- CUSTOMERS ---

// GET all customers (with total order count and spend)
app.get("/api/customers", (req, res) => {
  const { search = "" } = req.query;
  let query = `
    SELECT c.*,
           COUNT(s.id) as order_count,
           COALESCE(SUM(s.total_amount), 0) as total_spent
    FROM customers c
    LEFT JOIN sales s ON c.id = s.customer_id AND s.voided = 0
  `;
  const params = [];
  if (search) {
    query += " WHERE c.name LIKE ? OR c.mobile LIKE ? OR c.email LIKE ?";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  query += " GROUP BY c.id ORDER BY c.name ASC";
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ customers: rows });
  });
});

// GET single customer's sales history
app.get("/api/customers/:id/sales", (req, res) => {
  const { id } = req.params;
  db.all(
    `SELECT s.*, o.name as outlet_name, e.name as employee_name,
            COUNT(si.id) as item_count
     FROM sales s
     LEFT JOIN outlets o ON s.outlet_id = o.id
     LEFT JOIN employees e ON s.employee_id = e.id
     LEFT JOIN sale_items si ON s.id = si.sale_id
     WHERE s.customer_id = ?
     GROUP BY s.id
     ORDER BY s.timestamp DESC`,
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ sales: rows });
    },
  );
});

// POST create customer
app.post("/api/customers", (req, res) => {
  const { name, mobile, email, address } = req.body;
  if (!name)
    return res.status(400).json({ error: "Customer name is required" });
  db.run(
    "INSERT INTO customers (name, mobile, email, address) VALUES (?, ?, ?, ?)",
    [name, mobile || null, email || null, address || null],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        id: this.lastID,
        name,
        mobile,
        email,
        address,
        order_count: 0,
        total_spent: 0,
      });
    },
  );
});

// PUT update customer
app.put("/api/customers/:id", (req, res) => {
  const { id } = req.params;
  const { name, mobile, email, address } = req.body;
  if (!name)
    return res.status(400).json({ error: "Customer name is required" });
  db.run(
    "UPDATE customers SET name = ?, mobile = ?, email = ?, address = ? WHERE id = ?",
    [name, mobile || null, email || null, address || null, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Customer not found" });
      res.json({ message: "Customer updated" });
    },
  );
});

// PUT update customer points manually
app.put("/api/customers/:id/points", (req, res) => {
  const { id } = req.params;
  const { points } = req.body;
  if (points === undefined || isNaN(points))
    return res.status(400).json({ error: "Points value is required" });

  db.run(
    "UPDATE customers SET loyalty_points = ? WHERE id = ?",
    [parseInt(points), id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Customer not found" });
      res.json({ message: "Customer points updated" });
    },
  );
});

// DELETE customer (only if no linked sales)
app.delete("/api/customers/:id", (req, res) => {
  const { id } = req.params;
  db.get(
    "SELECT COUNT(*) as count FROM sales WHERE customer_id = ?",
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (row.count > 0) {
        return res.status(400).json({
          error: `Cannot delete — this customer has ${row.count} linked sale(s).`,
        });
      }
      db.run("DELETE FROM customers WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Customer deleted" });
      });
    },
  );
});

// --- CUSTOMER REPORTS ---

// Customer Details report
app.get("/api/reports/customer-details", (req, res) => {
  const { search = "" } = req.query;
  let query = `
    SELECT c.id, c.name, c.mobile, c.email, c.created_at,
           COUNT(s.id) as order_count,
           COALESCE(SUM(s.total_amount), 0) as total_spent
    FROM customers c
    LEFT JOIN sales s ON c.id = s.customer_id AND s.voided = 0
  `;
  const params = [];
  if (search) {
    query += " WHERE c.name LIKE ? OR c.mobile LIKE ?";
    params.push(`%${search}%`, `%${search}%`);
  }
  query += " GROUP BY c.id ORDER BY total_spent DESC";
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ customers: rows });
  });
});

// Customer Wise report (summary)
app.get("/api/reports/customer-wise", (req, res) => {
  db.all(
    `SELECT c.name as customer, COUNT(s.id) as order_count,
            COALESCE(SUM(s.total_amount), 0) as total_amount
     FROM customers c
     LEFT JOIN sales s ON c.id = s.customer_id AND s.voided = 0
     GROUP BY c.id
     ORDER BY total_amount DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ data: rows });
    },
  );
});

// Order Wise report
app.get("/api/reports/order-wise", (req, res) => {
  const { date_from = "", date_to = "", search = "" } = req.query;
  let conditions = ["1=1"];
  const params = [];

  if (search) {
    conditions.push("(CAST(s.id AS TEXT) LIKE ? OR c.name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  if (date_from) {
    conditions.push("date(s.timestamp, 'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    conditions.push("date(s.timestamp, 'localtime') <= ?");
    params.push(date_to);
  }
  conditions.push("s.voided = 0");

  const where = conditions.join(" AND ");
  db.all(
    `SELECT s.id, s.timestamp, s.total_amount, s.payment_method,
            COALESCE(s.discount_amount, 0) as discount_amount,
            COALESCE(c.name, 'Walk-in Customer') as customer_name,
            o.name as outlet_name,
            COALESCE(SUM(si.price_at_sale * si.quantity), 0) as sale_excl_tax
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     LEFT JOIN outlets o ON s.outlet_id = o.id
     LEFT JOIN sale_items si ON s.id = si.sale_id
     WHERE ${where}
     GROUP BY s.id
     ORDER BY s.timestamp DESC`,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ orders: rows });
    },
  );
});

// --- SALES HISTORY ROUTES ---

// GET all sales (paginated, filterable)
app.get("/api/sales", (req, res) => {
  const {
    page = 1,
    limit = 50,
    search = "",
    date_from = "",
    date_to = "",
  } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let conditions = ["1=1"];
  let params = [];

  if (search) {
    conditions.push(
      "(CAST(s.id AS TEXT) LIKE ? OR e.name LIKE ? OR o.name LIKE ?)",
    );
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (date_from) {
    conditions.push("date(s.timestamp, 'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    conditions.push("date(s.timestamp, 'localtime') <= ?");
    params.push(date_to);
  }

  const where = conditions.join(" AND ");

  const countQuery = `SELECT COUNT(*) as total FROM sales s
    LEFT JOIN outlets o ON s.outlet_id = o.id
    LEFT JOIN employees e ON s.employee_id = e.id
    WHERE ${where}`;

  db.get(countQuery, params, (err, countRow) => {
    if (err) return res.status(500).json({ error: err.message });

    const total = countRow?.total || 0;
    const listParams = [...params, parseInt(limit), offset];

    const listQuery = `
      SELECT s.id, s.timestamp, s.total_amount, s.payment_method, s.voided, s.void_reason,
             COALESCE(s.discount_amount, 0) as discount_amount,
             o.name as outlet_name, e.name as employee_name,
             COUNT(si.id) as item_count
      FROM sales s
      LEFT JOIN outlets o ON s.outlet_id = o.id
      LEFT JOIN employees e ON s.employee_id = e.id
      LEFT JOIN sale_items si ON s.id = si.sale_id
      WHERE ${where}
      GROUP BY s.id
      ORDER BY s.timestamp DESC
      LIMIT ? OFFSET ?`;

    db.all(listQuery, listParams, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        sales: rows,
        total,
        pages: Math.ceil(total / parseInt(limit)),
        page: parseInt(page),
      });
    });
  });
});

// GET a single sale with full line items and payments
app.get("/api/sales/:id", (req, res) => {
  const { id } = req.params;

  db.get(
    `SELECT s.*, o.name as outlet_name, e.name as employee_name
     FROM sales s
     LEFT JOIN outlets o ON s.outlet_id = o.id
     LEFT JOIN employees e ON s.employee_id = e.id
     WHERE s.id = ?`,
    [id],
    (err, sale) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!sale) return res.status(404).json({ error: "Sale not found" });

      db.all(
        `SELECT si.*, p.name as product_name, p.barcode
         FROM sale_items si JOIN products p ON si.product_id = p.id
         WHERE si.sale_id = ?`,
        [id],
        (err, items) => {
          if (err) return res.status(500).json({ error: err.message });

          db.all(
            "SELECT * FROM sale_payments WHERE sale_id = ?",
            [id],
            (err, payments) => {
              if (err) return res.status(500).json({ error: err.message });
              res.json({ sale, items, payments });
            },
          );
        },
      );
    },
  );
});

// VOID a sale — marks as voided and restores stock to outlet
app.put("/api/sales/:id/void", (req, res) => {
  const { id } = req.params;
  const { void_reason } = req.body;

  if (!void_reason)
    return res.status(400).json({ error: "void_reason is required" });

  // Fetch the sale first to check it exists and isn't already voided
  db.get("SELECT * FROM sales WHERE id = ?", [id], (err, sale) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!sale) return res.status(404).json({ error: "Sale not found" });
    if (sale.voided)
      return res.status(400).json({ error: "Sale is already voided" });
    if (!sale.outlet_id)
      return res
        .status(400)
        .json({ error: "Cannot void sales without outlet attribution" });

    // Fetch line items to restore stock
    db.all("SELECT * FROM sale_items WHERE sale_id = ?", [id], (err, items) => {
      if (err) return res.status(500).json({ error: err.message });

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // Mark the sale as voided
        db.run(
          "UPDATE sales SET voided = 1, void_reason = ? WHERE id = ?",
          [void_reason, id],
          function (err) {
            if (err) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: "Failed to void sale" });
            }
          },
        );

        // Restore stock for each item back to the outlet
        const restoreStmt = db.prepare(
          `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (?, ?, ?)
           ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?`,
        );
        items.forEach((item) => {
          restoreStmt.run(
            item.product_id,
            sale.outlet_id,
            item.quantity,
            item.quantity,
          );
        });
        restoreStmt.finalize();

        db.run("COMMIT", (err) => {
          if (err)
            return res
              .status(500)
              .json({ error: "Failed to commit void transaction" });
          res.json({
            message: "Sale voided successfully. Stock has been restored.",
          });
        });
      });
    });
  });
});

// Process a Sale (Cart Checkout)
app.post("/api/sales", (req, res) => {
  const {
    cartItems,
    paymentMethod,
    payments,
    outlet_id,
    employee_id,
    customer_id,
    discount_amount = 0,
    discount_type = "fixed",
    points_earned = 0,
    points_redeemed = 0,
  } = req.body;

  // Validation
  if (!cartItems || cartItems.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }
  if (!outlet_id) {
    return res
      .status(400)
      .json({ error: "Outlet ID is required for checkout" });
  }

  // 1. Calculate Expected Total (subtotal minus discount)
  const subtotal = cartItems.reduce(
    (acc, item) => acc + item.price * item.quantity,
    0,
  );
  const discountValue =
    discount_type === "percent"
      ? (subtotal * parseFloat(discount_amount || 0)) / 100
      : parseFloat(discount_amount || 0);
  const totalAmount = subtotal - discountValue;

  // Determine the actual payments to record
  let finalPayments = payments;
  let mainPaymentMethod = paymentMethod || "Cash";

  if (!finalPayments || finalPayments.length === 0) {
    finalPayments = [{ method: mainPaymentMethod, amount: totalAmount }];
  } else if (finalPayments.length > 1) {
    mainPaymentMethod = "Split";
  } else if (finalPayments.length === 1) {
    mainPaymentMethod = finalPayments[0].method;
  }

  // Start Transaction Logic
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    // 2. Insert into Sales Table (outlet_id + employee_id + customer_id + discount + points)
    db.run(
      "INSERT INTO sales (total_amount, payment_method, outlet_id, employee_id, customer_id, discount_amount, discount_type, points_earned, points_redeemed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        totalAmount,
        mainPaymentMethod,
        outlet_id,
        employee_id || null,
        customer_id || null,
        discountValue,
        discount_type,
        points_earned,
        points_redeemed,
      ],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res
            .status(500)
            .json({ error: "Failed to create sale record" });
        }

        const saleId = this.lastID;
        const itemsStmt = db.prepare(
          "INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, price_at_sale, cost_price_at_sale) VALUES (?, ?, ?, ?, ?, ?)",
        );
        const stockStmt = db.prepare(`
                    UPDATE outlet_stock 
                    SET quantity = quantity - ? 
                    WHERE product_id = ? AND outlet_id = ?
                `);
        const variantStockStmt = db.prepare(`
                    UPDATE product_variants 
                    SET stock = stock - ? 
                    WHERE id = ?
                `);
        const paymentsStmt = db.prepare(
          "INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES (?, ?, ?)",
        );

        let hasError = false;

        // 3. Loop through cart to insert Line Items AND deduct stock
        cartItems.forEach((item) => {
          itemsStmt.run(
            saleId,
            item.original_product_id || item.id,
            item.variant_id || null,
            item.quantity,
            item.price,
            item.cost_price || 0,
            (err) => {
              if (err) hasError = true;
            },
          );

          if (item.variant_id) {
            variantStockStmt.run(item.quantity, item.variant_id, (err) => {
              if (err) hasError = true;
            });
          } else {
            stockStmt.run(item.quantity, item.id, outlet_id, (err) => {
              if (err) hasError = true;
            });
          }
        });

        // 4. Insert Payments
        finalPayments.forEach((payment) => {
          paymentsStmt.run(saleId, payment.method, payment.amount, (err) => {
            if (err) hasError = true;
          });
        });

        itemsStmt.finalize();
        stockStmt.finalize();
        variantStockStmt.finalize();
        paymentsStmt.finalize();

        // Update customer points if applicable
        if (customer_id && (points_earned > 0 || points_redeemed > 0)) {
          db.run(
            "UPDATE customers SET loyalty_points = loyalty_points + ? - ? WHERE id = ?",
            [points_earned, points_redeemed, customer_id],
            (err) => {
              if (err) hasError = true;
            },
          );
        }

        // 5. Commit or Rollback
        if (hasError) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: "Transaction failed" });
        }

        db.run("COMMIT", (err) => {
          if (err)
            return res.status(500).json({ error: "Failed to commit sale" });
          res.json({
            message: "Sale completed successfully",
            saleId,
            totalAmount,
            payments: finalPayments,
          });
        });
      },
    );
  });
});

// --- INVENTORY TRANSFERS ---

// Get all transfers (with product, outlet, employee names)
app.get("/api/transfers", (req, res) => {
  const query = `
        SELECT it.*,
               p.name as product_name, p.barcode,
               fo.name as from_outlet_name,
               to_o.name as to_outlet_name,
               e.name as employee_name
        FROM inventory_transfers it
        JOIN products p ON it.product_id = p.id
        JOIN outlets fo ON it.from_outlet_id = fo.id
        JOIN outlets to_o ON it.to_outlet_id = to_o.id
        LEFT JOIN employees e ON it.employee_id = e.id
        ORDER BY it.timestamp DESC
    `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ transfers: rows });
  });
});

// Create a new inventory transfer (atomically moves stock between outlets)
app.post("/api/transfers", (req, res) => {
  const {
    product_id,
    from_outlet_id,
    to_outlet_id,
    quantity,
    employee_id,
    note,
  } = req.body;

  if (!product_id || !from_outlet_id || !to_outlet_id || !quantity) {
    return res.status(400).json({
      error:
        "product_id, from_outlet_id, to_outlet_id, and quantity are required",
    });
  }
  if (from_outlet_id === to_outlet_id) {
    return res
      .status(400)
      .json({ error: "Source and destination outlets must be different" });
  }
  if (quantity <= 0) {
    return res
      .status(400)
      .json({ error: "Quantity must be greater than zero" });
  }

  // First: validate sufficient stock in source outlet
  db.get(
    "SELECT quantity FROM outlet_stock WHERE product_id = ? AND outlet_id = ?",
    [product_id, from_outlet_id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      const currentStock = row ? row.quantity : 0;
      if (currentStock < quantity) {
        return res.status(400).json({
          error: `Insufficient stock. Only ${currentStock} available at source outlet.`,
        });
      }

      // All valid — perform atomic transfer
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // 1. Record the transfer
        db.run(
          `INSERT INTO inventory_transfers (product_id, from_outlet_id, to_outlet_id, quantity, employee_id, note)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            product_id,
            from_outlet_id,
            to_outlet_id,
            quantity,
            employee_id || null,
            note || null,
          ],
          function (err) {
            if (err) {
              db.run("ROLLBACK");
              return res
                .status(500)
                .json({ error: "Failed to record transfer" });
            }
          },
        );

        // 2. Deduct from source outlet
        db.run(
          "UPDATE outlet_stock SET quantity = quantity - ? WHERE product_id = ? AND outlet_id = ?",
          [quantity, product_id, from_outlet_id],
          function (err) {
            if (err) {
              db.run("ROLLBACK");
              return res
                .status(500)
                .json({ error: "Failed to deduct stock from source outlet" });
            }
          },
        );

        // 3. Add to destination outlet (upsert)
        db.run(
          `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
           VALUES (?, ?, ?)
           ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?`,
          [product_id, to_outlet_id, quantity, quantity],
          function (err) {
            if (err) {
              db.run("ROLLBACK");
              return res
                .status(500)
                .json({ error: "Failed to add stock to destination outlet" });
            }
          },
        );

        // 4. Commit
        db.run("COMMIT", (err) => {
          if (err)
            return res
              .status(500)
              .json({ error: "Failed to commit transfer transaction" });
          res.json({ message: "Transfer completed successfully" });
        });
      });
    },
  );
});

// --- STOCK ADJUSTMENTS ---

app.get("/api/adjustments", (req, res) => {
  const query = `
        SELECT sa.*, p.name as product_name, p.barcode, o.name as outlet_name, e.name as employee_name
        FROM stock_adjustments sa
        JOIN products p ON sa.product_id = p.id
        JOIN outlets o ON sa.outlet_id = o.id
        LEFT JOIN employees e ON sa.employee_id = e.id
        ORDER BY sa.timestamp DESC
    `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/adjustments", (req, res) => {
  const { product_id, outlet_id, employee_id, quantity_change, reason } =
    req.body;

  if (!product_id || !outlet_id || quantity_change === undefined || !reason) {
    return res
      .status(400)
      .json({ error: "Missing required fields for stock adjustment" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    // Insert adjustment record
    db.run(
      `INSERT INTO stock_adjustments (product_id, outlet_id, employee_id, quantity_change, reason)
             VALUES (?, ?, ?, ?, ?)`,
      [product_id, outlet_id, employee_id || null, quantity_change, reason],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: "Failed to record adjustment" });
        }

        // Upsert outlet_stock
        db.run(
          `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                     VALUES (?, ?, ?)
                     ON CONFLICT(product_id, outlet_id) 
                     DO UPDATE SET quantity = quantity + ?`,
          [product_id, outlet_id, quantity_change, quantity_change],
          function (err) {
            if (err) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: "Failed to update stock" });
            }

            db.run("COMMIT", (err) => {
              if (err)
                return res
                  .status(500)
                  .json({ error: "Failed to commit adjustment transaction" });
              res.json({ message: "Stock adjusted successfully" });
            });
          },
        );
      },
    );
  });
});

// --- REPORTS DASHBOARD ---

app.get("/api/reports/dashboard", async (req, res) => {
  try {
    const getQuery = (query, params = []) =>
      new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) =>
          err ? reject(err) : resolve(rows),
        );
      });

    // 1. Z-Report: Today's Revenue by Payment Method (handles split tenders & backward compatibility)
    const zReport = await getQuery(`
            SELECT COALESCE(sp.payment_method, s.payment_method) as payment_method, 
                   SUM(COALESCE(sp.amount, s.total_amount)) as total
            FROM sales s
            LEFT JOIN sale_payments sp ON s.id = sp.sale_id
            WHERE date(s.timestamp, 'localtime') = date('now', 'localtime')
            GROUP BY COALESCE(sp.payment_method, s.payment_method)
        `);
    const totalRevenueToday = zReport.reduce((sum, row) => sum + row.total, 0);

    // Calculate Tax Exclusive Revenue vs Inclusive
    // We calculate this mathematically based on the products sold today and their live GST profile (or the stored gst)
    const revenueMetrics = await getQuery(`
            SELECT 
                SUM(si.quantity * si.price_at_sale) as tax_inclusive,
                SUM(
                  CASE 
                    WHEN p.tax_id IS NOT NULL THEN (si.quantity * si.price_at_sale) / (1 + (t.rate / 100))
                    ELSE (si.quantity * si.price_at_sale) / (1 + (COALESCE(p.gst, 0) / 100))
                  END
                ) as tax_exclusive,
                SUM(si.quantity * si.cost_price_at_sale) as total_cost
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            LEFT JOIN taxes t ON p.tax_id = t.id
            WHERE date(s.timestamp, 'localtime') = date('now', 'localtime')
        `);

    const taxInclusive = revenueMetrics[0]?.tax_inclusive || 0;
    const taxExclusive = revenueMetrics[0]?.tax_exclusive || 0;
    const totalCost = revenueMetrics[0]?.total_cost || 0;
    const todayProfit = taxExclusive - totalCost; // Profit is on exclusive revenue

    // Count of sales today
    const saleCountRow = await getQuery(
      `SELECT COUNT(id) as count FROM sales WHERE date(timestamp, 'localtime') = date('now', 'localtime')`,
    );
    const saleCount = saleCountRow[0]?.count || 0;

    // 3. Top Selling Items (All time)
    const topSelling = await getQuery(`
            SELECT p.name, SUM(si.quantity) as total_sold
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            GROUP BY p.name
            ORDER BY total_sold DESC
            LIMIT 5
        `);

    // 4. Low Stock Alert (Threshold: 10 or less) — using outlet_stock as source of truth
    const lowStock = await getQuery(`
            SELECT p.name, p.barcode, p.price, p.cost_price, COALESCE(SUM(os.quantity), 0) as stock
            FROM products p
            LEFT JOIN outlet_stock os ON p.id = os.product_id
            GROUP BY p.id
            HAVING stock <= 10
            ORDER BY stock ASC
        `);

    // 5. Estimated Inventory Value — using outlet_stock as source of truth
    const inventoryValueRow = await getQuery(`
            SELECT 
                SUM(os.quantity * p.price) as retail_value,
                SUM(os.quantity * p.cost_price) as cost_value
            FROM outlet_stock os
            JOIN products p ON os.product_id = p.id
            WHERE os.quantity > 0
        `);

    res.json({
      zReport,
      totalRevenueToday,
      taxInclusive,
      taxExclusive,
      todayProfit,
      saleCount,
      topSelling,
      lowStock,
      inventoryValue: inventoryValueRow[0] || {
        retail_value: 0,
        cost_value: 0,
      },
    });
  } catch (err) {
    console.error("Report Error:", err);
    res.status(500).json({ error: "Failed to generate reports" });
  }
});

// --- CASH MANAGEMENT ---

// GET all shifts (newest first, with outlet + employee names)
app.get("/api/shifts", (req, res) => {
  const { outlet_id } = req.query;
  let query = `
    SELECT cs.*, o.name as outlet_name, e.name as employee_name
    FROM cash_shifts cs
    JOIN outlets o ON cs.outlet_id = o.id
    LEFT JOIN employees e ON cs.employee_id = e.id
  `;
  const params = [];
  if (outlet_id) {
    query += " WHERE cs.outlet_id = ?";
    params.push(outlet_id);
  }
  query += " ORDER BY cs.opened_at DESC";

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ shifts: rows });
  });
});

// GET active shift for an outlet (used by POS to check before checkout)
app.get("/api/shifts/active", (req, res) => {
  const { outlet_id } = req.query;
  if (!outlet_id)
    return res.status(400).json({ error: "outlet_id is required" });

  db.get(
    `SELECT cs.*, o.name as outlet_name, e.name as employee_name
     FROM cash_shifts cs
     JOIN outlets o ON cs.outlet_id = o.id
     LEFT JOIN employees e ON cs.employee_id = e.id
     WHERE cs.outlet_id = ? AND cs.status = 'open'
     ORDER BY cs.opened_at DESC LIMIT 1`,
    [outlet_id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ shift: row || null });
    },
  );
});

// POST open a new shift
app.post("/api/shifts/open", (req, res) => {
  const { outlet_id, employee_id, opening_float } = req.body;

  if (!outlet_id || opening_float === undefined) {
    return res
      .status(400)
      .json({ error: "outlet_id and opening_float are required" });
  }

  // Check if there's already an open shift for this outlet
  db.get(
    "SELECT id FROM cash_shifts WHERE outlet_id = ? AND status = 'open'",
    [outlet_id],
    (err, existing) => {
      if (err) return res.status(500).json({ error: err.message });
      if (existing) {
        return res.status(400).json({
          error: "A shift is already open for this outlet. Close it first.",
        });
      }

      db.run(
        "INSERT INTO cash_shifts (outlet_id, employee_id, opening_float) VALUES (?, ?, ?)",
        [outlet_id, employee_id || null, opening_float],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            message: "Shift opened successfully",
            shift_id: this.lastID,
          });
        },
      );
    },
  );
});

// POST close a shift — auto-calculates expected cash from cash sales during shift period
app.post("/api/shifts/:id/close", (req, res) => {
  const { id } = req.params;
  const { closing_cash, notes } = req.body;

  if (closing_cash === undefined) {
    return res.status(400).json({ error: "closing_cash is required" });
  }

  // Get the shift first
  db.get(
    "SELECT * FROM cash_shifts WHERE id = ? AND status = 'open'",
    [id],
    (err, shift) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!shift)
        return res.status(404).json({ error: "Open shift not found" });

      // Sum all cash payments for this outlet during this shift period
      db.get(
        `SELECT COALESCE(SUM(sp.amount), 0) as cash_sales
       FROM sale_payments sp
       JOIN sales s ON sp.sale_id = s.id
       WHERE s.outlet_id = ?
         AND s.voided = 0
         AND sp.payment_method = 'Cash'
         AND s.timestamp >= ?`,
        [shift.outlet_id, shift.opened_at],
        (err, row) => {
          if (err) return res.status(500).json({ error: err.message });

          const cashSales = row?.cash_sales || 0;

          db.get(
            `SELECT COALESCE(SUM(total_refund), 0) as cash_refunds
             FROM returns
             WHERE outlet_id = ?
               AND refund_method = 'Cash'
               AND timestamp >= ?`,
            [shift.outlet_id, shift.opened_at],
            (err, refundRow) => {
              if (err) return res.status(500).json({ error: err.message });

              const cashRefunds = refundRow?.cash_refunds || 0;
              const netCashSales = cashSales - cashRefunds;
              const expectedCash =
                parseFloat(shift.opening_float) + netCashSales;
              const variance = parseFloat(closing_cash) - expectedCash;
              const closedAt = new Date()
                .toISOString()
                .replace("T", " ")
                .slice(0, 19);

              db.run(
                `UPDATE cash_shifts
               SET status = 'closed', closing_cash = ?, expected_cash = ?, variance = ?,
                   closed_at = ?, notes = ?
               WHERE id = ?`,
                [
                  closing_cash,
                  expectedCash,
                  variance,
                  closedAt,
                  notes || null,
                  id,
                ],
                function (err) {
                  if (err) return res.status(500).json({ error: err.message });
                  res.json({
                    message: "Shift closed successfully",
                    opening_float: shift.opening_float,
                    cash_sales: cashSales,
                    cash_refunds: cashRefunds,
                    net_cash_sales: netCashSales,
                    expected_cash: expectedCash,
                    closing_cash,
                    variance,
                  });
                },
              );
            },
          );
        },
      );
    },
  );
});

// --- EMPLOYEE ATTENDANCE ---

app.get("/api/attendance", (req, res) => {
  const { date_from, date_to, employee_id } = req.query;
  const where = [];
  const params = [];
  if (date_from) {
    where.push("date(ea.check_in,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(ea.check_in,'localtime') <= ?");
    params.push(date_to);
  }
  if (employee_id) {
    where.push("ea.employee_id = ?");
    params.push(employee_id);
  }
  const sql = `
    SELECT ea.*, e.name AS employee_name, e.role, o.name AS outlet_name
    FROM employee_attendance ea
    JOIN employees e ON ea.employee_id = e.id
    JOIN outlets o ON ea.outlet_id = o.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ea.check_in DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ records: rows });
  });
});

app.post("/api/attendance/checkin", (req, res) => {
  const { employee_id, outlet_id } = req.body;
  if (!employee_id || !outlet_id)
    return res
      .status(400)
      .json({ error: "employee_id and outlet_id are required" });
  db.run(
    "INSERT INTO employee_attendance (employee_id, outlet_id, status) VALUES (?, ?, 'present')",
    [employee_id, outlet_id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      db.get(
        "SELECT * FROM employee_attendance WHERE id = ?",
        [this.lastID],
        (err2, row) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ attendance: row });
        },
      );
    },
  );
});

app.post("/api/attendance/:id/checkout", (req, res) => {
  const { id } = req.params;
  db.get(
    "SELECT * FROM employee_attendance WHERE id = ?",
    [id],
    (err, record) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!record)
        return res.status(404).json({ error: "Attendance record not found" });
      if (record.check_out)
        return res.status(400).json({ error: "Already clocked out" });
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      const hours = parseFloat(
        ((new Date() - new Date(record.check_in)) / 3600000).toFixed(2),
      );
      db.run(
        "UPDATE employee_attendance SET check_out = ?, hours = ? WHERE id = ?",
        [now, hours, id],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({
            message: "Clocked out successfully",
            hours,
            check_out: now,
          });
        },
      );
    },
  );
});

// --- EXTENDED REPORTS ---

// Sales Summary: per-sale header with outlet, employee, customer, payment methods
app.get("/api/reports/sales-summary", (req, res) => {
  const { date_from, date_to, search } = req.query;
  let where = ["s.voided = 0"];
  const params = [];
  if (date_from) {
    where.push("date(s.timestamp,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(s.timestamp,'localtime') <= ?");
    params.push(date_to);
  }
  if (search) {
    where.push("(CAST(s.id AS TEXT) LIKE ? OR COALESCE(c.name,'') LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const sql = `
    SELECT s.id, s.timestamp, s.total_amount,
           COALESCE(c.name,'Walk-in') AS customer_name,
           COALESCE(e.name,'—') AS employee_name,
           COALESCE(o.name,'—') AS outlet_name,
           GROUP_CONCAT(DISTINCT COALESCE(sp.payment_method, s.payment_method)) AS payment_methods
    FROM sales s
    LEFT JOIN customers c ON s.customer_id = c.id
    LEFT JOIN employees e ON s.employee_id = e.id
    LEFT JOIN outlets o ON s.outlet_id = o.id
    LEFT JOIN sale_payments sp ON s.id = sp.sale_id
    WHERE ${where.join(" AND ")}
    GROUP BY s.id
    ORDER BY s.timestamp DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ sales: rows });
  });
});

// Sales Detail: flat line-item list with parent sale info
app.get("/api/reports/sales-detail", (req, res) => {
  const { date_from, date_to, search } = req.query;
  let where = ["s.voided = 0"];
  const params = [];
  if (date_from) {
    where.push("date(s.timestamp,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(s.timestamp,'localtime') <= ?");
    params.push(date_to);
  }
  if (search) {
    where.push("(p.name LIKE ? OR CAST(s.id AS TEXT) LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const sql = `
    SELECT s.id AS sale_id, s.timestamp, COALESCE(c.name,'Walk-in') AS customer_name,
           p.name AS product_name, p.barcode,
           si.quantity, si.price_at_sale, si.cost_price_at_sale,
           (si.quantity * si.price_at_sale) AS line_total
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    JOIN products p ON si.product_id = p.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE ${where.join(" AND ")}
    ORDER BY s.timestamp DESC, si.id ASC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ items: rows });
  });
});

// Sales & Stock: product with all-time sales + current stock
app.get("/api/reports/sales-stock", (req, res) => {
  const sql = `
    SELECT p.id, p.name, p.barcode, COALESCE(cat.name,'—') AS category,
           COALESCE(SUM(DISTINCT os.quantity),0) AS total_stock,
           COALESCE(SUM(si.quantity),0) AS units_sold,
           COALESCE(SUM(si.quantity * si.price_at_sale),0) AS revenue
    FROM products p
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN outlet_stock os ON p.id = os.product_id
    LEFT JOIN sale_items si ON p.id = si.product_id
    GROUP BY p.id
    ORDER BY units_sold DESC`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// Inventory Dump: stock per product per outlet with full product info
app.get("/api/reports/inventory-dump", (req, res) => {
  const { outlet_id } = req.query;
  let where = [];
  const params = [];
  if (outlet_id) {
    where.push("os.outlet_id = ?");
    params.push(outlet_id);
  }
  const sql = `
    SELECT o.name AS outlet_name, p.name AS product_name, p.barcode,
           COALESCE(cat.name,'—') AS category, COALESCE(b.name,'—') AS brand,
           p.price, p.cost_price, os.quantity,
           (os.quantity * p.price) AS retail_value,
           (os.quantity * p.cost_price) AS cost_value
    FROM outlet_stock os
    JOIN products p ON os.product_id = p.id
    JOIN outlets o ON os.outlet_id = o.id
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN brands b ON p.brand_id = b.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY o.name, p.name`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// Category Wise: sales grouped by product category
app.get("/api/reports/category-wise", (req, res) => {
  const { date_from, date_to } = req.query;
  let where = ["s.voided = 0"];
  const params = [];
  if (date_from) {
    where.push("date(s.timestamp,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(s.timestamp,'localtime') <= ?");
    params.push(date_to);
  }
  const sql = `
    SELECT COALESCE(cat.name,'Uncategorized') AS category,
           SUM(si.quantity) AS units_sold,
           SUM(si.quantity * si.price_at_sale) AS revenue,
           SUM(si.quantity * si.cost_price_at_sale) AS cost,
           SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale) AS profit
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    LEFT JOIN categories cat ON p.category_id = cat.id
    WHERE ${where.join(" AND ")}
    GROUP BY cat.id
    ORDER BY revenue DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const total = rows.reduce((s, r) => s + r.revenue, 0);
    const data = rows.map((r) => ({
      ...r,
      pct: total > 0 ? ((r.revenue / total) * 100).toFixed(1) : "0.0",
    }));
    res.json({ data });
  });
});

// Product Specification: full product table with all FK names
app.get("/api/reports/product-spec", (req, res) => {
  const { search } = req.query;
  let where = [];
  const params = [];
  if (search) {
    where.push("(p.name LIKE ? OR p.barcode LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const sql = `
    SELECT p.id, p.barcode, p.name, p.price, p.cost_price,
           COALESCE(cat.name,'—') AS category, COALESCE(b.name,'—') AS brand,
           COALESCE(sup.name,'—') AS supplier,
           COALESCE(t.name,'—') AS tax_name, COALESCE(t.rate, p.gst, 0) AS tax_rate
    FROM products p
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN suppliers sup ON p.supplier_id = sup.id
    LEFT JOIN taxes t ON p.tax_id = t.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY p.name`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// On Hand Inventory: current stock per product per outlet
app.get("/api/reports/on-hand", (req, res) => {
  const { outlet_id } = req.query;
  let where = [];
  const params = [];
  if (outlet_id) {
    where.push("os.outlet_id = ?");
    params.push(outlet_id);
  }
  const sql = `
    SELECT p.name AS product_name, p.barcode, o.name AS outlet_name,
           os.quantity, p.price, p.cost_price,
           (os.quantity * p.price) AS retail_value,
           (os.quantity * p.cost_price) AS cost_value
    FROM outlet_stock os
    JOIN products p ON os.product_id = p.id
    JOIN outlets o ON os.outlet_id = o.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY p.name, o.name`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// Item Wise: sales grouped by product
app.get("/api/reports/item-wise", (req, res) => {
  const { date_from, date_to } = req.query;
  let where = ["s.voided = 0"];
  const params = [];
  if (date_from) {
    where.push("date(s.timestamp,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(s.timestamp,'localtime') <= ?");
    params.push(date_to);
  }
  const sql = `
    SELECT p.id, p.name AS product_name, p.barcode,
           SUM(si.quantity) AS units_sold,
           SUM(si.quantity * si.price_at_sale) AS revenue,
           SUM(si.quantity * si.cost_price_at_sale) AS total_cost,
           SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale) AS gross_profit
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    WHERE ${where.join(" AND ")}
    GROUP BY p.id
    ORDER BY units_sold DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// Product Performance: same as item-wise but sorted by margin %
app.get("/api/reports/product-performance", (req, res) => {
  const { date_from, date_to } = req.query;
  let where = ["s.voided = 0"];
  const params = [];
  if (date_from) {
    where.push("date(s.timestamp,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(s.timestamp,'localtime') <= ?");
    params.push(date_to);
  }
  const sql = `
    SELECT p.id, p.name AS product_name, p.barcode,
           SUM(si.quantity) AS units_sold,
           SUM(si.quantity * si.price_at_sale) AS revenue,
           SUM(si.quantity * si.cost_price_at_sale) AS total_cost,
           SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale) AS gross_profit,
           CASE WHEN SUM(si.quantity * si.price_at_sale) > 0
                THEN ROUND(((SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale))
                     / SUM(si.quantity * si.price_at_sale)) * 100, 1)
                ELSE 0 END AS margin_pct
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    WHERE ${where.join(" AND ")}
    GROUP BY p.id
    ORDER BY margin_pct DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// Inventory Loss: stock adjustments with negative quantity
app.get("/api/reports/inventory-loss", (req, res) => {
  const { date_from, date_to } = req.query;
  let where = ["sa.quantity_change < 0"];
  const params = [];
  if (date_from) {
    where.push("date(sa.timestamp,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(sa.timestamp,'localtime') <= ?");
    params.push(date_to);
  }
  const sql = `
    SELECT sa.timestamp, p.name AS product_name, p.barcode,
           o.name AS outlet_name, COALESCE(e.name,'—') AS employee_name,
           sa.quantity_change, sa.reason
    FROM stock_adjustments sa
    JOIN products p ON sa.product_id = p.id
    JOIN outlets o ON sa.outlet_id = o.id
    LEFT JOIN employees e ON sa.employee_id = e.id
    WHERE ${where.join(" AND ")}
    ORDER BY sa.timestamp DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// Wastage: stock adjustments for Damaged or Expired reasons
app.get("/api/reports/wastage", (req, res) => {
  const { date_from, date_to } = req.query;
  let where = ["sa.reason IN ('Damaged','Expired')"];
  const params = [];
  if (date_from) {
    where.push("date(sa.timestamp,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(sa.timestamp,'localtime') <= ?");
    params.push(date_to);
  }
  const sql = `
    SELECT sa.timestamp, p.name AS product_name, p.barcode,
           o.name AS outlet_name, COALESCE(e.name,'—') AS employee_name,
           sa.quantity_change, sa.reason
    FROM stock_adjustments sa
    JOIN products p ON sa.product_id = p.id
    JOIN outlets o ON sa.outlet_id = o.id
    LEFT JOIN employees e ON sa.employee_id = e.id
    WHERE ${where.join(" AND ")}
    ORDER BY sa.timestamp DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// Replenishment: products at or below threshold per outlet
app.get("/api/reports/replenishment", (req, res) => {
  const threshold = parseInt(req.query.threshold) || 10;
  const sql = `
    SELECT p.name AS product_name, p.barcode,
           o.name AS outlet_name, os.quantity
    FROM outlet_stock os
    JOIN products p ON os.product_id = p.id
    JOIN outlets o ON os.outlet_id = o.id
    WHERE os.quantity <= ?
    ORDER BY os.quantity ASC, p.name ASC`;
  db.all(sql, [threshold], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows, threshold });
  });
});

// Supplier Wise: PO spending aggregated per supplier
app.get("/api/reports/supplier-wise", (req, res) => {
  const sql = `
    SELECT s.id, s.name AS supplier_name, s.contact_person, s.phone,
           COUNT(DISTINCT po.id) AS total_pos,
           COALESCE(SUM(poi.quantity),0) AS total_items,
           COALESCE(SUM(poi.quantity * poi.cost_price),0) AS total_cost
    FROM suppliers s
    LEFT JOIN purchase_orders po ON s.id = po.supplier_id
    LEFT JOIN purchase_order_items poi ON po.id = poi.po_id
    GROUP BY s.id
    ORDER BY total_cost DESC`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// --- ROUTES: RETURNS ---

// Create a new return
app.post("/api/returns", (req, res) => {
  const {
    original_sale_id,
    outlet_id,
    employee_id,
    customer_id,
    total_refund,
    refund_method,
    reason,
    items,
  } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: "Return must have items" });
  }
  if (!outlet_id) {
    return res
      .status(400)
      .json({ error: "Outlet ID is required for restocking" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    db.run(
      "INSERT INTO returns (original_sale_id, outlet_id, employee_id, customer_id, total_refund, refund_method, reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        original_sale_id || null,
        outlet_id,
        employee_id || null,
        customer_id || null,
        total_refund,
        refund_method,
        reason || null,
      ],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res
            .status(500)
            .json({ error: "Failed to create return: " + err.message });
        }

        const returnId = this.lastID;
        const insertItemStmt = db.prepare(
          "INSERT INTO return_items (return_id, product_id, quantity, refund_price) VALUES (?, ?, ?, ?)",
        );
        const updateStockStmt = db.prepare(`
          INSERT INTO outlet_stock (product_id, outlet_id, quantity)
          VALUES (?, ?, ?)
          ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?
        `);

        let hasError = false;

        items.forEach((item) => {
          insertItemStmt.run(
            returnId,
            item.product_id,
            item.quantity,
            item.refund_price,
            (err) => {
              if (err) hasError = true;
            },
          );
          // Restock the returned items
          updateStockStmt.run(
            item.product_id,
            outlet_id,
            item.quantity,
            item.quantity,
            (err) => {
              if (err) hasError = true;
            },
          );
        });

        insertItemStmt.finalize();
        updateStockStmt.finalize();

        if (hasError) {
          db.run("ROLLBACK");
          return res.status(500).json({
            error: "Transaction failed while processing return items",
          });
        }

        db.run("COMMIT", (err) => {
          if (err)
            return res
              .status(500)
              .json({ error: "Failed to commit return transaction" });
          res.json({ message: "Return processed successfully", id: returnId });
        });
      },
    );
  });
});

// Get all returns (with details)
app.get("/api/returns", (req, res) => {
  const { date_from, date_to } = req.query;
  const where = [];
  const params = [];

  if (date_from) {
    where.push("date(r.timestamp, 'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(r.timestamp, 'localtime') <= ?");
    params.push(date_to);
  }

  const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

  const sql = `
    SELECT r.*,
           o.name as outlet_name,
           e.name as employee_name,
           c.name as customer_name,
           COUNT(ri.id) as item_count
    FROM returns r
    LEFT JOIN outlets o ON r.outlet_id = o.id
    LEFT JOIN employees e ON r.employee_id = e.id
    LEFT JOIN customers c ON r.customer_id = c.id
    LEFT JOIN return_items ri ON r.id = ri.return_id
    ${whereClause}
    GROUP BY r.id
    ORDER BY r.timestamp DESC
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ returns: rows });
  });
});

// Get a single return with items
app.get("/api/returns/:id", (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT r.*, o.name as outlet_name, e.name as employee_name, c.name as customer_name
    FROM returns r
    LEFT JOIN outlets o ON r.outlet_id = o.id
    LEFT JOIN employees e ON r.employee_id = e.id
    LEFT JOIN customers c ON r.customer_id = c.id
    WHERE r.id = ?
  `;

  db.get(sql, [id], (err, returnRow) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!returnRow) return res.status(404).json({ error: "Return not found" });

    db.all(
      `SELECT ri.*, p.name as product_name, p.barcode
       FROM return_items ri
       JOIN products p ON ri.product_id = p.id
       WHERE ri.return_id = ?`,
      [id],
      (err, items) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ returnData: returnRow, items });
      },
    );
  });
});

// --- ROUTES: ATTRIBUTE SETS ---

// Get all attribute sets with nested attributes and options
app.get("/api/attribute-sets", (req, res) => {
  db.all("SELECT * FROM attribute_sets ORDER BY name ASC", [], (err, sets) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!sets || sets.length === 0) return res.json({ attributeSets: [] });

    db.all("SELECT * FROM attributes", [], (err, attributes) => {
      if (err) return res.status(500).json({ error: err.message });

      db.all("SELECT * FROM attribute_options", [], (err, options) => {
        if (err) return res.status(500).json({ error: err.message });

        // Build nested structure
        const enrichedSets = sets.map((s) => {
          const setAttrs = attributes.filter(
            (a) => a.attribute_set_id === s.id,
          );
          const enrichedAttrs = setAttrs.map((a) => {
            return {
              ...a,
              options: options.filter((o) => o.attribute_id === a.id),
            };
          });
          return { ...s, attributes: enrichedAttrs };
        });

        res.json({ attributeSets: enrichedSets });
      });
    });
  });
});

// Create an attribute set with its attributes and options
app.post("/api/attribute-sets", (req, res) => {
  const { name, description, attributes } = req.body;

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    db.run(
      "INSERT INTO attribute_sets (name, description) VALUES (?, ?)",
      [name, description],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: err.message });
        }

        const setId = this.lastID;

        if (!attributes || attributes.length === 0) {
          db.run("COMMIT");
          return res.json({ id: setId, name, description, attributes: [] });
        }

        let pendingAttributes = attributes.length;
        let hasError = false;

        attributes.forEach((attr) => {
          if (hasError) return;

          db.run(
            "INSERT INTO attributes (name, attribute_set_id) VALUES (?, ?)",
            [attr.name, setId],
            function (err2) {
              if (err2) {
                hasError = true;
                db.run("ROLLBACK");
                return res.status(500).json({ error: err2.message });
              }

              const attrId = this.lastID;
              const options = attr.options || [];

              if (options.length === 0) {
                pendingAttributes--;
                if (pendingAttributes === 0 && !hasError) {
                  db.run("COMMIT");
                  res.json({ message: "Attribute set created", id: setId });
                }
                return;
              }

              let pendingOptions = options.length;
              options.forEach((opt) => {
                if (hasError) return;
                const optValue = typeof opt === "string" ? opt : opt.value;
                db.run(
                  "INSERT INTO attribute_options (attribute_id, value) VALUES (?, ?)",
                  [attrId, optValue],
                  function (err3) {
                    if (err3) {
                      hasError = true;
                      db.run("ROLLBACK");
                      return res.status(500).json({ error: err3.message });
                    }
                    pendingOptions--;
                    if (pendingOptions === 0) {
                      pendingAttributes--;
                      if (pendingAttributes === 0 && !hasError) {
                        db.run("COMMIT");
                        res.json({
                          message: "Attribute set created",
                          id: setId,
                        });
                      }
                    }
                  },
                );
              });
            },
          );
        });
      },
    );
  });
});

// Delete attribute set
app.delete("/api/attribute-sets/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM attribute_sets WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Deleted successfully" });
  });
});

// --- ACTION HISTORY ---

app.post("/api/action-history", (req, res) => {
  const { user_name, action_type, description } = req.body;
  if (!action_type || !description) {
    return res.status(400).json({ error: "Missing action details" });
  }

  db.run(
    "INSERT INTO action_history (user_name, action_type, description) VALUES (?, ?, ?)",
    [user_name || "System", action_type, description],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message: "Action logged" });
    },
  );
});

app.get("/api/action-history", (req, res) => {
  const { search } = req.query;
  let where = "";
  let params = [];

  if (search) {
    where =
      "WHERE user_name LIKE ? OR action_type LIKE ? OR description LIKE ?";
    params = [`%${search}%`, `%${search}%`, `%${search}%`];
  }

  db.all(
    `SELECT * FROM action_history ${where} ORDER BY timestamp DESC LIMIT 500`,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ logs: rows });
    },
  );
});

// --- SUPPLIER RETURNS (RMA) ---

app.get("/api/supplier-returns", (req, res) => {
  db.all(
    `SELECT sr.*, s.name as supplier_name, o.name as outlet_name, e.name as employee_name, (SELECT COUNT(id) FROM supplier_return_items WHERE supplier_return_id = sr.id) as item_count 
     FROM supplier_returns sr
     LEFT JOIN suppliers s ON sr.supplier_id = s.id
     LEFT JOIN outlets o ON sr.outlet_id = o.id
     LEFT JOIN employees e ON sr.employee_id = e.id
     ORDER BY sr.return_date DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ returns: rows });
    },
  );
});

app.get("/api/supplier-returns/:id", (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT sr.*, s.name as supplier_name, o.name as outlet_name, e.name as employee_name 
     FROM supplier_returns sr 
     LEFT JOIN suppliers s ON sr.supplier_id = s.id
     LEFT JOIN outlets o ON sr.outlet_id = o.id
     LEFT JOIN employees e ON sr.employee_id = e.id
     WHERE sr.id = ?`,
    [id],
    (err, returnRow) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!returnRow) return res.status(404).json({ error: "RMA not found" });

      db.all(
        `SELECT sri.*, p.name as product_name, p.barcode 
         FROM supplier_return_items sri 
         JOIN products p ON sri.product_id = p.id 
         WHERE sri.supplier_return_id = ?`,
        [id],
        (err, items) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ returnData: returnRow, items });
        },
      );
    },
  );
});

app.post("/api/supplier-returns", (req, res) => {
  const {
    supplier_id,
    employee_id,
    outlet_id,
    reason,
    reference_number,
    items,
  } = req.body;
  if (!supplier_id || !outlet_id || !items || items.length === 0) {
    return res.status(400).json({ error: "Missing required return payload" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    const totalValue = items.reduce(
      (sum, item) => sum + item.quantity * (item.unit_price || 0),
      0,
    );

    db.run(
      "INSERT INTO supplier_returns (supplier_id, employee_id, outlet_id, reason, total_value, reference_number, status) VALUES (?, ?, ?, ?, ?, ?, 'Completed')",
      [
        supplier_id,
        employee_id || null,
        outlet_id,
        reason || null,
        totalValue,
        reference_number || null,
      ],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: err.message });
        }

        const returnId = this.lastID;
        const itemsStmt = db.prepare(
          "INSERT INTO supplier_return_items (supplier_return_id, product_id, variant_id, quantity, unit_price, reason) VALUES (?, ?, ?, ?, ?, ?)",
        );
        const stockStmt = db.prepare(
          "UPDATE outlet_stock SET quantity = quantity - ? WHERE product_id = ? AND outlet_id = ?",
        );
        const variantStockStmt = db.prepare(
          "UPDATE product_variants SET stock = stock - ? WHERE id = ?",
        );

        let hasError = false;

        items.forEach((item) => {
          itemsStmt.run(
            returnId,
            item.product_id || item.id,
            item.variant_id || null,
            item.quantity,
            item.unit_price || item.cost_price || 0,
            item.reason || null,
            (err) => {
              if (err) hasError = true;
            },
          );

          if (item.variant_id) {
            variantStockStmt.run(item.quantity, item.variant_id, (err) => {
              if (err) hasError = true;
            });
          } else {
            stockStmt.run(
              item.quantity,
              item.product_id || item.id,
              outlet_id,
              (err) => {
                if (err) hasError = true;
              },
            );
          }
        });

        itemsStmt.finalize();
        stockStmt.finalize();
        variantStockStmt.finalize();

        if (hasError) {
          db.run("ROLLBACK");
          return res
            .status(500)
            .json({ error: "Transaction processed with failures" });
        }

        db.run("COMMIT", (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Supplier return processed", id: returnId });
        });
      },
    );
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
