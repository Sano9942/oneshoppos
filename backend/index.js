const express = require("express");
const cors = require("cors");
const db = require("./db");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const sqlite3 = require("sqlite3").verbose();
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json()); // Parse JSON bodies

// --- PERMISSION MIDDLEWARE SCAFFOLD ---
// Reads optional x-employee-id header, attaches permissions to req.
// Routes can call requirePerm(perm) to enforce access. No behavior change
// on routes that don't use it — existing flows are untouched.

function loadEmployeePerms(req, res, next) {
  const employeeId = req.headers["x-employee-id"];
  if (!employeeId) {
    req.employeePerms = [];
    return next();
  }
  db.get(
    "SELECT role_id FROM employees WHERE id = ?",
    [employeeId],
    (err, emp) => {
      if (err || !emp) {
        req.employeePerms = [];
        return next();
      }
      db.all(
        "SELECT permission FROM role_permissions WHERE role_id = ?",
        [emp.role_id],
        (err2, rows) => {
          req.employeePerms = err2 ? [] : rows.map((r) => r.permission);
          next();
        }
      );
    }
  );
}

function requirePerm(permission) {
  return (req, res, next) => {
    const perms = req.employeePerms || [];
    if (perms.includes("all_access") || perms.includes(permission)) {
      return next();
    }
    return res.status(403).json({ error: "Forbidden: insufficient permissions" });
  };
}

app.use(loadEmployeePerms);

let isRestoreInProgress = false;
app.use((req, res, next) => {
  if (isRestoreInProgress && req.method !== "GET" && req.method !== "OPTIONS") {
    return res.status(503).json({
      error: "Service temporarily unavailable: database restore in progress",
    });
  }
  next();
});

// --- ROUTES: TAXES ---

// Get all taxes
app.get("/api/taxes", (req, res) => {
  db.all("SELECT * FROM taxes ORDER BY name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ taxes: rows });
  });
});

// Add a new tax
app.post("/api/taxes", requirePerm("manage_inventory"), (req, res) => {
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
app.put("/api/taxes/:id", requirePerm("manage_inventory"), (req, res) => {
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
app.delete("/api/taxes/:id", requirePerm("manage_inventory"), (req, res) => {
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
app.post("/api/employees", requirePerm("manage_employees"), (req, res) => {
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
app.put("/api/employees/:id", requirePerm("manage_employees"), (req, res) => {
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
app.delete("/api/employees/:id", requirePerm("manage_employees"), (req, res) => {
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
app.post("/api/roles", requirePerm("manage_employees"), (req, res) => {
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
app.put("/api/roles/:id", requirePerm("manage_employees"), (req, res) => {
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
app.delete("/api/roles/:id", requirePerm("manage_employees"), (req, res) => {
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
app.put("/api/roles/:id/permissions", requirePerm("manage_employees"), (req, res) => {
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
    min_qty,
    max_qty,
    unit,
  } = req.body;

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    db.run(
      "INSERT INTO products (barcode, name, price, cost_price, gst, stock, category_id, tax_id, brand_id, has_variants, attribute_set_id, min_qty, max_qty, unit) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        min_qty || 0,
        max_qty || 0,
        unit || "pcs",
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

// Bulk import products from CSV rows (upsert by barcode)
app.post("/api/products/bulk-import", (req, res) => {
  const { rows } = req.body; // [{ barcode, name, price, cost_price, gst, stock, min_qty, max_qty, unit }]
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "No rows provided" });
  }

  const results = [];

  const processNext = (index) => {
    if (index >= rows.length) {
      return res.json({ results });
    }
    const row = rows[index];
    const { barcode, name, price, cost_price, gst, stock, min_qty, max_qty, unit } = row;

    if (!barcode || !name || !price) {
      results.push({ barcode: barcode || "?", status: "error", message: "barcode, name, and price are required" });
      return processNext(index + 1);
    }

    db.get(
      "SELECT id FROM products WHERE barcode = ?",
      [barcode],
      (findErr, existing) => {
        if (findErr) {
          results.push({ barcode, status: "error", message: findErr.message });
          return processNext(index + 1);
        }

        db.run(
          `INSERT INTO products (barcode, name, price, cost_price, gst, stock, min_qty, max_qty, unit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(barcode) DO UPDATE SET
             name = excluded.name,
             price = excluded.price,
             cost_price = excluded.cost_price,
             gst = excluded.gst,
             stock = excluded.stock,
             min_qty = excluded.min_qty,
             max_qty = excluded.max_qty,
             unit = excluded.unit`,
          [
            barcode,
            name,
            parseFloat(price) || 0,
            parseFloat(cost_price) || 0,
            gst !== "" && gst != null ? parseFloat(gst) : null,
            parseInt(stock) || 0,
            parseInt(min_qty) || 0,
            parseInt(max_qty) || 0,
            unit || "pcs",
          ],
          function (err) {
            if (err) {
              results.push({ barcode, status: "error", message: err.message });
            } else {
              results.push({
                barcode,
                name,
                status: existing ? "updated" : "inserted",
              });
            }
            processNext(index + 1);
          },
        );
      },
    );
  };

  processNext(0);
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
    min_qty,
    max_qty,
    unit,
  } = req.body;

  // Simple dynamic update
  db.run(
    "UPDATE products SET name = COALESCE(?, name), price = COALESCE(?, price), cost_price = COALESCE(?, cost_price), gst = ?, barcode = COALESCE(?, barcode), category_id = COALESCE(?, category_id), tax_id = COALESCE(?, tax_id), brand_id = COALESCE(?, brand_id), min_qty = COALESCE(?, min_qty), max_qty = COALESCE(?, max_qty), unit = COALESCE(?, unit) WHERE id = ?",
    [
      name,
      price,
      cost_price,
      gst === "" ? null : gst,
      barcode,
      category_id || null,
      tax_id || null,
      brand_id || null,
      min_qty !== undefined ? min_qty : null,
      max_qty !== undefined ? max_qty : null,
      unit || null,
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
app.post("/api/purchase-orders", requirePerm("manage_orders"), (req, res) => {
  const { supplier_id, total_cost, items, due_date } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: "Purchase order must have items" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    db.run(
      "INSERT INTO purchase_orders (supplier_id, total_cost, status, due_date) VALUES (?, ?, 'Draft', ?)",
      [supplier_id, total_cost, due_date || null],
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
app.post("/api/purchase-orders/:id/receive", requirePerm("manage_orders"), (req, res) => {
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
                // Auto-create supplier invoice for this GRN
                if (po.supplier_id && po.total_cost > 0) {
                  const invNumber = `INV-${grnNumber}`;
                  db.run(
                    "INSERT INTO supplier_invoices (supplier_id, po_id, grn_id, invoice_number, amount, due_date) VALUES (?, ?, ?, ?, ?, ?)",
                    [po.supplier_id, po.id, grnId, invNumber, po.total_cost, po.due_date || null],
                    () => {} // best-effort, don't fail the response
                  );
                }
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
app.delete("/api/purchase-orders/:id", requirePerm("manage_orders"), (req, res) => {
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

// --- SUPPLIER PAYABLES ---

// GET all supplier invoices (with supplier name, payment totals)
app.get("/api/supplier-invoices", (req, res) => {
  const { supplier_id, status } = req.query;
  let query = `
    SELECT si.*,
           s.name as supplier_name,
           COALESCE(SUM(sp.amount), 0) as amount_paid,
           si.amount - COALESCE(SUM(sp.amount), 0) as amount_due
    FROM supplier_invoices si
    JOIN suppliers s ON si.supplier_id = s.id
    LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
  `;
  const params = [];
  const wheres = [];
  if (supplier_id) { wheres.push("si.supplier_id = ?"); params.push(supplier_id); }
  if (status) { wheres.push("si.status = ?"); params.push(status); }
  if (wheres.length) query += " WHERE " + wheres.join(" AND ");
  query += " GROUP BY si.id ORDER BY si.created_at DESC";
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ invoices: rows });
  });
});

// GET single supplier invoice with its payments
app.get("/api/supplier-invoices/:id", (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT si.*, s.name as supplier_name FROM supplier_invoices si
     JOIN suppliers s ON si.supplier_id = s.id WHERE si.id = ?`,
    [id],
    (err, inv) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!inv) return res.status(404).json({ error: "Invoice not found" });
      db.all(
        "SELECT * FROM supplier_payments WHERE supplier_invoice_id = ? ORDER BY paid_at DESC",
        [id],
        (err2, payments) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ invoice: inv, payments: payments || [] });
        }
      );
    }
  );
});

// POST record a payment against a supplier invoice
app.post("/api/supplier-invoices/:id/pay", (req, res) => {
  const { id } = req.params;
  const { amount, payment_method = "Cash", reference, paid_by, notes } = req.body;
  if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
    return res.status(400).json({ error: "Valid amount is required" });

  db.get(
    `SELECT si.*, COALESCE(SUM(sp.amount), 0) as amount_paid
     FROM supplier_invoices si
     LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
     WHERE si.id = ?`,
    [id],
    (err, inv) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!inv) return res.status(404).json({ error: "Invoice not found" });
      if (inv.status === "paid") return res.status(400).json({ error: "Invoice already fully paid" });

      const amt = parseFloat(amount);
      const remaining = inv.amount - inv.amount_paid;
      if (amt > remaining + 0.001)
        return res.status(400).json({ error: `Payment exceeds outstanding amount (PKRs ${remaining.toFixed(2)})` });

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        db.run(
          "INSERT INTO supplier_payments (supplier_invoice_id, supplier_id, amount, payment_method, reference, paid_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [id, inv.supplier_id, amt, payment_method, reference || null, paid_by || null, notes || null],
          function (err) {
            if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
            // Update invoice status
            const newPaid = inv.amount_paid + amt;
            const newStatus = newPaid >= inv.amount - 0.001 ? "paid" : "partial";
            db.run(
              "UPDATE supplier_invoices SET status = ? WHERE id = ?",
              [newStatus, id],
              (err2) => {
                if (err2) { db.run("ROLLBACK"); return res.status(500).json({ error: err2.message }); }
                db.run("COMMIT", () => {
                  res.json({ message: "Payment recorded", status: newStatus });
                });
              }
            );
          }
        );
      });
    }
  );
});

// GET supplier aging summary — one row per supplier with total owed
app.get("/api/supplier-aging", (req, res) => {
  db.all(
    `SELECT s.id, s.name as supplier_name, s.phone,
            COUNT(DISTINCT si.id) as invoice_count,
            COALESCE(SUM(si.amount), 0) as total_invoiced,
            COALESCE(SUM(sp.amount), 0) as total_paid,
            COALESCE(SUM(si.amount), 0) - COALESCE(SUM(sp.amount), 0) as total_due
     FROM suppliers s
     LEFT JOIN supplier_invoices si ON si.supplier_id = s.id
     LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
     GROUP BY s.id
     HAVING total_invoiced > 0
     ORDER BY total_due DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ aging: rows });
    }
  );
});

// --- PROMOTIONS ENGINE ---

// GET all promotions
app.get("/api/promotions", (req, res) => {
  db.all("SELECT * FROM promotions ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ promotions: rows });
  });
});

// POST create promotion
app.post("/api/promotions", requirePerm("manage_inventory"), (req, res) => {
  const { name, type, value, min_order_amount = 0, buy_qty = 0, get_qty = 0,
          applies_to = "all", product_id, category_id, starts_at, ends_at } = req.body;
  if (!name || !type || value === undefined)
    return res.status(400).json({ error: "name, type, value are required" });
  db.run(
    `INSERT INTO promotions (name, type, value, min_order_amount, buy_qty, get_qty, applies_to, product_id, category_id, starts_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, type, value, min_order_amount, buy_qty, get_qty, applies_to,
     product_id || null, category_id || null, starts_at || null, ends_at || null],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Promotion created", id: this.lastID });
    }
  );
});

// PUT update promotion
app.put("/api/promotions/:id", requirePerm("manage_inventory"), (req, res) => {
  const { id } = req.params;
  const { name, type, value, min_order_amount = 0, buy_qty = 0, get_qty = 0,
          applies_to = "all", product_id, category_id, active, starts_at, ends_at } = req.body;
  db.run(
    `UPDATE promotions SET name=?, type=?, value=?, min_order_amount=?, buy_qty=?, get_qty=?,
     applies_to=?, product_id=?, category_id=?, active=?, starts_at=?, ends_at=? WHERE id=?`,
    [name, type, value, min_order_amount, buy_qty, get_qty, applies_to,
     product_id || null, category_id || null, active !== undefined ? active : 1,
     starts_at || null, ends_at || null, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Promotion not found" });
      res.json({ message: "Promotion updated" });
    }
  );
});

// DELETE promotion
app.delete("/api/promotions/:id", requirePerm("manage_inventory"), (req, res) => {
  db.run("DELETE FROM promotions WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Promotion not found" });
    res.json({ message: "Promotion deleted" });
  });
});

// POST /api/promotions/quote — evaluate active promotions against a cart
// Body: { items: [{product_id, category_id, quantity, price}], order_total }
app.post("/api/promotions/quote", (req, res) => {
  const { items = [], order_total = 0 } = req.body;
  const now = new Date().toISOString().slice(0, 10);

  db.all(
    `SELECT * FROM promotions WHERE active = 1
     AND (starts_at IS NULL OR starts_at <= ?)
     AND (ends_at IS NULL OR ends_at >= ?)
     ORDER BY id ASC`,
    [now, now],
    (err, promos) => {
      if (err) return res.status(500).json({ error: err.message });

      const applied = [];
      let totalDiscount = 0;

      for (const promo of promos) {
        const itemMatches = (item) => {
          if (promo.applies_to === "all") return true;
          if (promo.applies_to === "product" && promo.product_id)
            return item.product_id === promo.product_id;
          if (promo.applies_to === "category" && promo.category_id)
            return item.category_id === promo.category_id;
          return false;
        };

        const matchedItems = items.filter(itemMatches);
        const matchedTotal = matchedItems.reduce((s, i) => s + i.price * i.quantity, 0);
        let discount = 0;

        if (promo.type === "percent") {
          discount = matchedTotal * (promo.value / 100);
        } else if (promo.type === "fixed") {
          discount = Math.min(promo.value, matchedTotal);
        } else if (promo.type === "threshold_percent") {
          if (order_total >= promo.min_order_amount)
            discount = matchedTotal * (promo.value / 100);
        } else if (promo.type === "threshold_fixed") {
          if (order_total >= promo.min_order_amount)
            discount = Math.min(promo.value, matchedTotal);
        } else if (promo.type === "bxgy") {
          if (promo.buy_qty > 0 && promo.get_qty > 0) {
            matchedItems.forEach((item) => {
              const sets = Math.floor(item.quantity / (promo.buy_qty + promo.get_qty));
              discount += sets * promo.get_qty * item.price;
            });
          }
        }

        if (discount > 0) {
          totalDiscount += discount;
          applied.push({
            promotion_id: promo.id,
            name: promo.name,
            type: promo.type,
            discount: parseFloat(discount.toFixed(2)),
          });
        }
      }

      res.json({
        applied_promotions: applied,
        total_promotion_discount: parseFloat(totalDiscount.toFixed(2)),
      });
    }
  );
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
  const { name, mobile, email, address, cnic, occupation, balance } = req.body;
  if (!name)
    return res.status(400).json({ error: "Customer name is required" });
  db.run(
    "INSERT INTO customers (name, mobile, email, address, cnic, occupation, balance) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      name,
      mobile || null,
      email || null,
      address || null,
      cnic || null,
      occupation || null,
      balance || 0,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        id: this.lastID,
        name,
        mobile,
        email,
        address,
        cnic,
        occupation,
        balance: balance || 0,
        order_count: 0,
        total_spent: 0,
      });
    },
  );
});

// PUT update customer
app.put("/api/customers/:id", (req, res) => {
  const { id } = req.params;
  const { name, mobile, email, address, cnic, occupation, balance } = req.body;
  if (!name)
    return res.status(400).json({ error: "Customer name is required" });
  db.run(
    "UPDATE customers SET name = ?, mobile = ?, email = ?, address = ?, cnic = ?, occupation = ?, balance = COALESCE(?, balance) WHERE id = ?",
    [
      name,
      mobile || null,
      email || null,
      address || null,
      cnic || null,
      occupation || null,
      balance !== undefined ? balance : null,
      id,
    ],
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

// GET customer wallet balance + ledger
app.get("/api/customers/:id/wallet", (req, res) => {
  const { id } = req.params;
  db.get("SELECT balance FROM customers WHERE id = ?", [id], (err, customer) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    db.all(
      "SELECT * FROM customer_wallet_ledger WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50",
      [id],
      (err2, ledger) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ balance: customer.balance || 0, ledger: ledger || [] });
      }
    );
  });
});

// POST top-up customer wallet (credit)
app.post("/api/customers/:id/wallet/topup", (req, res) => {
  const { id } = req.params;
  const { amount, note } = req.body;
  if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
    return res.status(400).json({ error: "Valid amount is required" });

  const amt = parseFloat(amount);
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    db.run(
      "UPDATE customers SET balance = COALESCE(balance, 0) + ? WHERE id = ?",
      [amt, id],
      function (err) {
        if (err || this.changes === 0) {
          db.run("ROLLBACK");
          return res.status(err ? 500 : 404).json({ error: err ? err.message : "Customer not found" });
        }
        db.run(
          "INSERT INTO customer_wallet_ledger (customer_id, type, amount, reference_type, note) VALUES (?, 'credit', ?, 'topup', ?)",
          [id, amt, note || "Manual top-up"],
          (err2) => {
            if (err2) { db.run("ROLLBACK"); return res.status(500).json({ error: err2.message }); }
            db.run("COMMIT", () => {
              db.get("SELECT balance FROM customers WHERE id = ?", [id], (e, row) => {
                res.json({ message: "Wallet topped up", balance: row?.balance || 0 });
              });
            });
          }
        );
      }
    );
  });
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
app.put("/api/sales/:id/void", requirePerm("void_sales"), (req, res) => {
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
    notes = null,
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
  const totalAmount = subtotal - discountValue - parseFloat(points_redeemed || 0);

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
      "INSERT INTO sales (total_amount, payment_method, outlet_id, employee_id, customer_id, discount_amount, discount_type, points_earned, points_redeemed, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        notes || null,
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

        // Debit wallet for any Wallet payments
        const walletPayments = finalPayments.filter((p) => p.method === "Wallet");
        if (customer_id && walletPayments.length > 0) {
          const walletTotal = walletPayments.reduce((s, p) => s + p.amount, 0);
          db.run(
            "UPDATE customers SET balance = COALESCE(balance, 0) - ? WHERE id = ?",
            [walletTotal, customer_id],
            (err) => { if (err) hasError = true; }
          );
          db.run(
            "INSERT INTO customer_wallet_ledger (customer_id, type, amount, reference_type, reference_id, note) VALUES (?, 'debit', ?, 'sale', ?, ?)",
            [customer_id, walletTotal, saleId, `Debit for Sale #${saleId}`],
            (err) => { if (err) hasError = true; }
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
          assignInvoiceNumberToSale(saleId, 1, (invErr, invoiceNumber) => {
            if (invErr) {
              return res.status(500).json({
                error: "Sale committed but invoice finalization failed",
                saleId,
                details: invErr.message,
              });
            }
            res.json({
              message: "Sale completed successfully",
              saleId,
              totalAmount,
              invoiceNumber: invoiceNumber || null,
              payments: finalPayments,
            });
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
app.post("/api/transfers", requirePerm("manage_inventory"), (req, res) => {
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

app.post("/api/adjustments", requirePerm("manage_inventory"), (req, res) => {
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

    // 6. Last 7 days sales trend (for chart)
    const salesTrend = await getQuery(`
      SELECT date(timestamp,'localtime') as day,
             ROUND(SUM(total_amount),2) as revenue,
             COUNT(id) as sale_count
      FROM sales
      WHERE voided = 0
        AND date(timestamp,'localtime') >= date('now','-6 days','localtime')
      GROUP BY day
      ORDER BY day ASC
    `);

    // 7. Today's expenses total (deducted from net profit)
    const expenseRows = await getQuery(
      `SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE expense_date = date('now','localtime')`
    );
    const todayExpenses = expenseRows[0]?.total || 0;
    const netProfitToday = todayProfit - todayExpenses;

    res.json({
      zReport,
      totalRevenueToday,
      taxInclusive,
      taxExclusive,
      todayProfit: netProfitToday,
      todayGrossProfit: todayProfit,
      todayExpenses,
      saleCount,
      topSelling,
      lowStock,
      salesTrend,
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

// Top Salespeople report
app.get("/api/reports/top-salespeople", (req, res) => {
  const { date_from, date_to } = req.query;
  const where = ["s.voided = 0", "s.employee_id IS NOT NULL"];
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
    SELECT e.name AS employee_name,
           COUNT(DISTINCT s.id) AS transactions,
           ROUND(SUM(s.total_amount), 2) AS revenue,
           SUM(si.quantity) AS items_sold,
           ROUND(SUM(s.total_amount) / COUNT(DISTINCT s.id), 2) AS avg_basket
    FROM sales s
    JOIN employees e ON s.employee_id = e.id
    LEFT JOIN sale_items si ON s.id = si.sale_id
    WHERE ${where.join(" AND ")}
    GROUP BY s.employee_id
    ORDER BY revenue DESC
  `;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ salespeople: rows });
  });
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
  const { closing_cash, notes, variance_reason, variance_approved_by, denominations } = req.body;

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
                   closed_at = ?, notes = ?, variance_reason = ?, variance_approved_by = ?
               WHERE id = ?`,
                [
                  closing_cash,
                  expectedCash,
                  variance,
                  closedAt,
                  notes || null,
                  variance_reason || null,
                  variance_approved_by || null,
                  id,
                ],
                function (err) {
                  if (err) return res.status(500).json({ error: err.message });
                  // Store denomination breakdown if provided
                  if (denominations && denominations.length > 0) {
                    const stmt = db.prepare(
                      "INSERT INTO shift_denominations (shift_id, denomination, count) VALUES (?,?,?)"
                    );
                    denominations.forEach((d) => {
                      if (d.count > 0)
                        stmt.run([id, d.denomination, d.count]);
                    });
                    stmt.finalize();
                  }
                  res.json({
                    message: "Shift closed successfully",
                    opening_float: shift.opening_float,
                    cash_sales: cashSales,
                    cash_refunds: cashRefunds,
                    net_cash_sales: netCashSales,
                    expected_cash: expectedCash,
                    closing_cash,
                    variance,
                    variance_reason: variance_reason || null,
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

// GET denomination breakdown for a shift
app.get("/api/shifts/:id/denominations", (req, res) => {
  db.all(
    "SELECT denomination, count, subtotal FROM shift_denominations WHERE shift_id = ? ORDER BY denomination DESC",
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ denominations: rows });
    }
  );
});

// GET variance reason codes (static list)
app.get("/api/variance-reasons", (req, res) => {
  res.json({
    reasons: [
      "Counting error",
      "Till refund not recorded",
      "Change given incorrectly",
      "Currency denomination mix-up",
      "Tip/gratuity retained",
      "Manager override",
      "Other",
    ],
  });
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

// Update attribute set (full replace of attributes + options)
app.put("/api/attribute-sets/:id", (req, res) => {
  const { id } = req.params;
  const { name, description, attributes } = req.body;

  if (!name) return res.status(400).json({ error: "Name is required" });

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    db.run(
      "UPDATE attribute_sets SET name = ?, description = ? WHERE id = ?",
      [name, description || null, id],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          if (err.message.includes("UNIQUE constraint failed")) {
            return res.status(400).json({ error: "Attribute set name must be unique" });
          }
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
          db.run("ROLLBACK");
          return res.status(404).json({ error: "Attribute set not found" });
        }

        // Delete old attributes (CASCADE removes attribute_options too)
        db.run("DELETE FROM attributes WHERE attribute_set_id = ?", [id], (err2) => {
          if (err2) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err2.message });
          }

          if (!attributes || attributes.length === 0) {
            db.run("COMMIT");
            return res.json({ message: "Attribute set updated", id });
          }

          let pendingAttributes = attributes.length;
          let hasError = false;

          attributes.forEach((attr) => {
            if (hasError) return;

            db.run(
              "INSERT INTO attributes (name, attribute_set_id) VALUES (?, ?)",
              [attr.name, id],
              function (err3) {
                if (err3) {
                  hasError = true;
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: err3.message });
                }

                const attrId = this.lastID;
                const options = attr.options || [];

                if (options.length === 0) {
                  pendingAttributes--;
                  if (pendingAttributes === 0 && !hasError) {
                    db.run("COMMIT");
                    res.json({ message: "Attribute set updated", id });
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
                    function (err4) {
                      if (err4) {
                        hasError = true;
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: err4.message });
                      }
                      pendingOptions--;
                      if (pendingOptions === 0) {
                        pendingAttributes--;
                        if (pendingAttributes === 0 && !hasError) {
                          db.run("COMMIT");
                          res.json({
                            message: "Attribute set updated",
                            id,
                          });
                        }
                      }
                    },
                  );
                });
              },
            );
          });
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

// --- RECEIPT TEMPLATES ---

app.get("/api/receipt-templates", (req, res) => {
  db.all("SELECT * FROM receipt_templates ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ templates: rows });
  });
});

app.get("/api/receipt-templates/active", (req, res) => {
  db.get(
    "SELECT * FROM receipt_templates WHERE is_active = 1 ORDER BY id DESC LIMIT 1",
    [],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ template: row || null });
    },
  );
});

app.post("/api/receipt-templates", (req, res) => {
  const { name, header_text, footer_text, show_barcode, show_logo, is_active } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });
  db.serialize(() => {
    if (is_active) db.run("UPDATE receipt_templates SET is_active = 0");
    db.run(
      "INSERT INTO receipt_templates (name, header_text, footer_text, show_barcode, show_logo, is_active) VALUES (?, ?, ?, ?, ?, ?)",
      [name, header_text || "", footer_text || "", show_barcode ? 1 : 0, show_logo ? 1 : 0, is_active ? 1 : 0],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, message: "Template created" });
      },
    );
  });
});

app.put("/api/receipt-templates/:id", (req, res) => {
  const { id } = req.params;
  const { name, header_text, footer_text, show_barcode, show_logo, is_active } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });
  db.serialize(() => {
    if (is_active) db.run("UPDATE receipt_templates SET is_active = 0");
    db.run(
      "UPDATE receipt_templates SET name=?, header_text=?, footer_text=?, show_barcode=?, show_logo=?, is_active=? WHERE id=?",
      [name, header_text || "", footer_text || "", show_barcode ? 1 : 0, show_logo ? 1 : 0, is_active ? 1 : 0, id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Template not found" });
        res.json({ message: "Template updated" });
      },
    );
  });
});

app.delete("/api/receipt-templates/:id", (req, res) => {
  db.run("DELETE FROM receipt_templates WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Template not found" });
    res.json({ message: "Template deleted" });
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

// --- ROUTES: PARKED SALES (Phase 3) ---

// List all parked sales (with item count)
app.get("/api/parked-sales", (req, res) => {
  const { outlet_id } = req.query;
  let sql = `
    SELECT ps.*, e.name as employee_name, c.name as customer_name,
           COUNT(psi.id) as item_count
    FROM parked_sales ps
    LEFT JOIN employees e ON ps.employee_id = e.id
    LEFT JOIN customers c ON ps.customer_id = c.id
    LEFT JOIN parked_sale_items psi ON psi.parked_sale_id = ps.id
  `;
  const params = [];
  if (outlet_id) {
    sql += " WHERE ps.outlet_id = ?";
    params.push(outlet_id);
  }
  sql += " GROUP BY ps.id ORDER BY ps.parked_at DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ parkedSales: rows });
  });
});

// Get a single parked sale with all items
app.get("/api/parked-sales/:id", (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT ps.*, e.name as employee_name, c.name as customer_name
     FROM parked_sales ps
     LEFT JOIN employees e ON ps.employee_id = e.id
     LEFT JOIN customers c ON ps.customer_id = c.id
     WHERE ps.id = ?`,
    [id],
    (err, sale) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!sale) return res.status(404).json({ error: "Parked sale not found" });
      db.all(
        "SELECT * FROM parked_sale_items WHERE parked_sale_id = ?",
        [id],
        (err, items) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ parkedSale: sale, items });
        }
      );
    }
  );
});

// Park a sale (create)
app.post("/api/parked-sales", (req, res) => {
  const { employee_id, outlet_id, customer_id, label, notes, items } = req.body;
  if (!items || items.length === 0) {
    return res.status(400).json({ error: "Cannot park an empty cart" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    db.run(
      "INSERT INTO parked_sales (employee_id, outlet_id, customer_id, label, notes) VALUES (?, ?, ?, ?, ?)",
      [employee_id || null, outlet_id || null, customer_id || null, label || null, notes || null],
      function (err) {
        if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
        const parkedId = this.lastID;
        const stmt = db.prepare(
          "INSERT INTO parked_sale_items (parked_sale_id, product_id, variant_id, product_name, quantity, price, effective_tax_rate) VALUES (?, ?, ?, ?, ?, ?, ?)"
        );
        items.forEach((item) => {
          stmt.run(parkedId, item.product_id || null, item.variant_id || null,
            item.product_name || item.name || "", item.quantity, item.price, item.effective_tax_rate || 0);
        });
        stmt.finalize();
        db.run("COMMIT", (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Sale parked successfully", id: parkedId });
        });
      }
    );
  });
});

// Delete (unpark/restore) a parked sale
app.delete("/api/parked-sales/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM parked_sales WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Parked sale not found" });
    res.json({ message: "Parked sale removed" });
  });
});

// --- APPROVAL WORKFLOW TABLES (Phase 1) ---
// Ensure approval tables exist on startup (idempotent)
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS approval_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_type TEXT NOT NULL,
    reference_id INTEGER NOT NULL,
    reference_type TEXT NOT NULL,
    requested_by TEXT,
    status TEXT DEFAULT 'pending_approval',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS approval_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    approval_request_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    action_by TEXT,
    reason TEXT,
    actioned_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
});

// --- ROUTES: APPROVAL WORKFLOW ---

// List pending approvals (with context info)
app.get("/api/approvals", (req, res) => {
  const { status = "pending_approval" } = req.query;
  db.all(
    `SELECT * FROM approval_requests WHERE status = ? ORDER BY created_at DESC`,
    [status],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ approvals: rows });
    }
  );
});

// Submit a PO for approval
app.post("/api/purchase-orders/:id/submit", (req, res) => {
  const { id } = req.params;
  const { requested_by, notes } = req.body;

  db.get("SELECT * FROM purchase_orders WHERE id = ?", [id], (err, po) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!po) return res.status(404).json({ error: "PO not found" });
    if (po.status !== "Draft")
      return res.status(400).json({ error: "Only Draft POs can be submitted for approval" });

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(
        "UPDATE purchase_orders SET status = 'pending_approval' WHERE id = ?",
        [id],
        (err) => {
          if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
        }
      );
      db.run(
        "INSERT INTO approval_requests (request_type, reference_id, reference_type, requested_by, notes) VALUES ('po_approval', ?, 'purchase_order', ?, ?)",
        [id, requested_by || null, notes || null],
        function (err) {
          if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
          db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "PO submitted for approval", approval_request_id: this.lastID });
          });
        }
      );
    });
  });
});

// Approve or reject a PO
app.post("/api/purchase-orders/:id/approve", (req, res) => {
  const { id } = req.params;
  const { action, action_by, reason } = req.body; // action: 'approved' | 'rejected'

  if (!["approved", "rejected"].includes(action)) {
    return res.status(400).json({ error: "action must be 'approved' or 'rejected'" });
  }

  db.get("SELECT * FROM purchase_orders WHERE id = ?", [id], (err, po) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!po) return res.status(404).json({ error: "PO not found" });
    if (po.status !== "pending_approval")
      return res.status(400).json({ error: "Only POs pending approval can be approved/rejected" });

    db.get(
      "SELECT id FROM approval_requests WHERE reference_type = 'purchase_order' AND reference_id = ? AND status = 'pending_approval'",
      [id],
      (err, req_row) => {
        if (err) return res.status(500).json({ error: err.message });

        db.serialize(() => {
          db.run("BEGIN TRANSACTION");
          db.run(
            "UPDATE purchase_orders SET status = ? WHERE id = ?",
            [action === "approved" ? "Approved" : "Draft", id]
          );
          if (req_row) {
            db.run(
              "UPDATE approval_requests SET status = ? WHERE id = ?",
              [action, req_row.id]
            );
            db.run(
              "INSERT INTO approval_actions (approval_request_id, action, action_by, reason) VALUES (?, ?, ?, ?)",
              [req_row.id, action, action_by || null, reason || null]
            );
          }
          db.run(
            "INSERT INTO action_history (user_name, action_type, description) VALUES (?, 'po_approval', ?)",
            [action_by || "System", `PO #${id} ${action} by ${action_by || "manager"}. ${reason || ""}`]
          );
          db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: `PO ${action} successfully` });
          });
        });
      }
    );
  });
});

// Submit a transfer for approval
app.post("/api/transfers/:id/submit", (req, res) => {
  const { id } = req.params;
  const { requested_by, notes } = req.body;

  db.get("SELECT * FROM inventory_transfers WHERE id = ?", [id], (err, tr) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!tr) return res.status(404).json({ error: "Transfer not found" });
    if (tr.status !== "draft")
      return res.status(400).json({ error: "Only draft transfers can be submitted for approval" });

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(
        "UPDATE inventory_transfers SET status = 'pending_approval' WHERE id = ?",
        [id],
        (err) => {
          if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
        }
      );
      db.run(
        "INSERT INTO approval_requests (request_type, reference_id, reference_type, requested_by, notes) VALUES ('str_approval', ?, 'transfer', ?, ?)",
        [id, requested_by || null, notes || null],
        function (err) {
          if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
          db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Transfer submitted for approval", approval_request_id: this.lastID });
          });
        }
      );
    });
  });
});

// Approve or reject a transfer
app.post("/api/transfers/:id/approve", (req, res) => {
  const { id } = req.params;
  const { action, action_by, reason } = req.body;

  if (!["approved", "rejected"].includes(action)) {
    return res.status(400).json({ error: "action must be 'approved' or 'rejected'" });
  }

  db.get("SELECT * FROM inventory_transfers WHERE id = ?", [id], (err, tr) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!tr) return res.status(404).json({ error: "Transfer not found" });
    if (tr.status !== "pending_approval")
      return res.status(400).json({ error: "Only transfers pending approval can be approved/rejected" });

    db.get(
      "SELECT id FROM approval_requests WHERE reference_type = 'transfer' AND reference_id = ? AND status = 'pending_approval'",
      [id],
      (err, req_row) => {
        if (err) return res.status(500).json({ error: err.message });

        db.serialize(() => {
          db.run("BEGIN TRANSACTION");
          db.run(
            "UPDATE inventory_transfers SET status = ? WHERE id = ?",
            [action === "approved" ? "approved" : "draft", id]
          );
          if (req_row) {
            db.run("UPDATE approval_requests SET status = ? WHERE id = ?", [action, req_row.id]);
            db.run(
              "INSERT INTO approval_actions (approval_request_id, action, action_by, reason) VALUES (?, ?, ?, ?)",
              [req_row.id, action, action_by || null, reason || null]
            );
          }
          db.run(
            "INSERT INTO action_history (user_name, action_type, description) VALUES (?, 'str_approval', ?)",
            [action_by || "System", `Transfer #${id} ${action} by ${action_by || "manager"}. ${reason || ""}`]
          );
          db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: `Transfer ${action} successfully` });
          });
        });
      }
    );
  });
});

// --- BARCODE TEMPLATES ---

app.get("/api/barcode-templates", (req, res) => {
  db.all("SELECT * FROM barcode_templates ORDER BY is_default DESC, name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ templates: rows });
  });
});

app.post("/api/barcode-templates", requirePerm("manage_inventory"), (req, res) => {
  const { name, width_mm = 50, height_mm = 30, show_name = 1, show_price = 1, show_barcode = 1, show_sku = 0, show_brand = 0, font_size = 10, is_default = 0 } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  db.serialize(() => {
    if (is_default) db.run("UPDATE barcode_templates SET is_default = 0");
    db.run(
      "INSERT INTO barcode_templates (name, width_mm, height_mm, show_name, show_price, show_barcode, show_sku, show_brand, font_size, is_default) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [name, width_mm, height_mm, show_name ? 1 : 0, show_price ? 1 : 0, show_barcode ? 1 : 0, show_sku ? 1 : 0, show_brand ? 1 : 0, font_size, is_default ? 1 : 0],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
      }
    );
  });
});

app.put("/api/barcode-templates/:id", requirePerm("manage_inventory"), (req, res) => {
  const { id } = req.params;
  const { name, width_mm, height_mm, show_name, show_price, show_barcode, show_sku, show_brand, font_size, is_default } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  db.serialize(() => {
    if (is_default) db.run("UPDATE barcode_templates SET is_default = 0");
    db.run(
      "UPDATE barcode_templates SET name=?, width_mm=?, height_mm=?, show_name=?, show_price=?, show_barcode=?, show_sku=?, show_brand=?, font_size=?, is_default=? WHERE id=?",
      [name, width_mm, height_mm, show_name ? 1 : 0, show_price ? 1 : 0, show_barcode ? 1 : 0, show_sku ? 1 : 0, show_brand ? 1 : 0, font_size, is_default ? 1 : 0, id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: true });
      }
    );
  });
});

app.delete("/api/barcode-templates/:id", requirePerm("manage_inventory"), (req, res) => {
  db.run("DELETE FROM barcode_templates WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: true });
  });
});

// POST /api/barcode-print-jobs — log a batch print event
app.post("/api/barcode-print-jobs", (req, res) => {
  const { template_id, items = [] } = req.body;
  if (!items.length) return res.status(400).json({ error: "No items" });
  const stmt = db.prepare(
    "INSERT INTO barcode_print_jobs (template_id, product_id, product_name, barcode, price, copies) VALUES (?,?,?,?,?,?)"
  );
  for (const item of items) {
    stmt.run([template_id || null, item.product_id || null, item.name || "", item.barcode || "", item.price || 0, item.copies || 1]);
  }
  stmt.finalize((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ logged: items.length });
  });
});

// --- EXPENSES ---

// Expense categories CRUD
app.get("/api/expense-categories", (req, res) => {
  db.all("SELECT * FROM expense_categories ORDER BY name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ categories: rows });
  });
});

app.post("/api/expense-categories", requirePerm("manage_inventory"), (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  db.run("INSERT INTO expense_categories (name, description) VALUES (?,?)", [name, description || null], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

app.put("/api/expense-categories/:id", requirePerm("manage_inventory"), (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  db.run("UPDATE expense_categories SET name=?, description=? WHERE id=?", [name, description || null, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ updated: true });
  });
});

app.delete("/api/expense-categories/:id", requirePerm("manage_inventory"), (req, res) => {
  db.run("DELETE FROM expense_categories WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: true });
  });
});

// Expenses CRUD
app.get("/api/expenses", (req, res) => {
  const { outlet_id, category_id, from, to } = req.query;
  let where = "WHERE 1=1";
  const params = [];
  if (outlet_id) { where += " AND e.outlet_id=?"; params.push(outlet_id); }
  if (category_id) { where += " AND e.category_id=?"; params.push(category_id); }
  if (from) { where += " AND e.expense_date >= ?"; params.push(from); }
  if (to) { where += " AND e.expense_date <= ?"; params.push(to); }

  db.all(`
    SELECT e.*, ec.name as category_name, o.name as outlet_name,
           emp.name as employee_name
    FROM expenses e
    LEFT JOIN expense_categories ec ON e.category_id = ec.id
    LEFT JOIN outlets o ON e.outlet_id = o.id
    LEFT JOIN employees emp ON e.employee_id = emp.id
    ${where}
    ORDER BY e.expense_date DESC, e.created_at DESC
  `, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ expenses: rows });
  });
});

app.post("/api/expenses", (req, res) => {
  const { category_id, outlet_id, shift_id, employee_id, amount, description, reference, expense_date } = req.body;
  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
    return res.status(400).json({ error: "Valid amount required" });
  db.run(
    `INSERT INTO expenses (category_id, outlet_id, shift_id, employee_id, amount, description, reference, expense_date)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      category_id || null, outlet_id || null, shift_id || null, employee_id || null,
      parseFloat(amount), description || null, reference || null,
      expense_date || new Date().toISOString().slice(0, 10),
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

app.put("/api/expenses/:id", (req, res) => {
  const { category_id, outlet_id, shift_id, employee_id, amount, description, reference, expense_date } = req.body;
  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
    return res.status(400).json({ error: "Valid amount required" });
  db.run(
    `UPDATE expenses SET category_id=?, outlet_id=?, shift_id=?, employee_id=?, amount=?,
     description=?, reference=?, expense_date=? WHERE id=?`,
    [
      category_id || null, outlet_id || null, shift_id || null, employee_id || null,
      parseFloat(amount), description || null, reference || null,
      expense_date || new Date().toISOString().slice(0, 10), req.params.id,
    ],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: true });
    }
  );
});

app.delete("/api/expenses/:id", requirePerm("manage_inventory"), (req, res) => {
  db.run("DELETE FROM expenses WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: true });
  });
});

// Summary: expenses by category for a date range (used by reports/dashboard)
app.get("/api/expenses/summary", (req, res) => {
  const { from, to, outlet_id } = req.query;
  let where = "WHERE 1=1";
  const params = [];
  if (from) { where += " AND e.expense_date >= ?"; params.push(from); }
  if (to) { where += " AND e.expense_date <= ?"; params.push(to); }
  if (outlet_id) { where += " AND e.outlet_id = ?"; params.push(outlet_id); }

  db.all(`
    SELECT ec.name as category, SUM(e.amount) as total, COUNT(e.id) as count
    FROM expenses e
    LEFT JOIN expense_categories ec ON e.category_id = ec.id
    ${where}
    GROUP BY e.category_id
    ORDER BY total DESC
  `, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const grandTotal = rows.reduce((s, r) => s + r.total, 0);
    res.json({ summary: rows, grand_total: grandTotal });
  });
});

// ─── BACKUP / RESTORE ────────────────────────────────────────────────────────

const DB_PATH = path.resolve(__dirname, "oneshop.db");
const uploadDir = path.resolve(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const restoreStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `restore_${Date.now()}.db`),
});
const restoreUpload = multer({ storage: restoreStorage, limits: { fileSize: 500 * 1024 * 1024 } });

// GET /api/backup/download — stream the SQLite file
app.get("/api/backup/download", requirePerm("manage_employees"), (req, res) => {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `oneshop_backup_${ts}.db`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/octet-stream");
  const stream = fs.createReadStream(DB_PATH);
  stream.on("error", (err) => res.status(500).json({ error: err.message }));
  stream.pipe(res);
  // Log the backup event after streaming begins
  const { performed_by } = req.query;
  const size = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
  db.run(
    "INSERT INTO backup_log (action, filename, size_bytes, performed_by) VALUES ('backup', ?, ?, ?)",
    [filename, size, performed_by || null]
  );
});

// POST /api/backup/restore — upload a .db file and replace the live DB
app.post("/api/backup/restore", requirePerm("manage_employees"), restoreUpload.single("backup_file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  if (isRestoreInProgress) {
    return res.status(409).json({ error: "Restore already in progress" });
  }
  isRestoreInProgress = true;

  const uploadedPath = req.file.path;
  const { performed_by, note } = req.body;

  const cleanupAndFail = (status, message) => {
    try {
      if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
    } catch (_) {
      // ignore cleanup errors
    }
    isRestoreInProgress = false;
    return res.status(status).json({ error: message });
  };

  try {
    const header = Buffer.alloc(16);
    const fd = fs.openSync(uploadedPath, "r");
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    if (header.toString("ascii", 0, 6) !== "SQLite") {
      return cleanupAndFail(400, "Uploaded file is not a valid SQLite database");
    }
  } catch (err) {
    return cleanupAndFail(400, "Failed to read uploaded file: " + err.message);
  }

  const verifyDb = new sqlite3.Database(uploadedPath, sqlite3.OPEN_READONLY, (openErr) => {
    if (openErr) {
      return cleanupAndFail(400, "Failed to open uploaded database: " + openErr.message);
    }

    verifyDb.get("PRAGMA quick_check", [], (qcErr, qcRow) => {
      verifyDb.close(() => {});
      if (qcErr) return cleanupAndFail(400, "Failed SQLite integrity check: " + qcErr.message);
      const qc = qcRow ? Object.values(qcRow)[0] : null;
      if (String(qc).toLowerCase() !== "ok") {
        return cleanupAndFail(400, "Uploaded database failed integrity check");
      }

      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const snapshotPath = path.join(uploadDir, `oneshop_pre_restore_${ts}.db`);
      const stagedPath = path.join(uploadDir, `oneshop_restore_staged_${Date.now()}.db`);

      db.run("BEGIN IMMEDIATE", (lockErr) => {
        if (lockErr) return cleanupAndFail(503, "Could not acquire database lock for restore");

        try {
          fs.copyFileSync(DB_PATH, snapshotPath);
          fs.copyFileSync(uploadedPath, stagedPath);
          fs.copyFileSync(stagedPath, DB_PATH);
          fs.unlinkSync(uploadedPath);
          fs.unlinkSync(stagedPath);
        } catch (swapErr) {
          db.run("ROLLBACK");
          return cleanupAndFail(500, "Failed to replace database: " + swapErr.message);
        }

        db.run("ROLLBACK");
        db.run(
          "INSERT INTO backup_log (action, filename, size_bytes, performed_by, note) VALUES ('restore', ?, ?, ?, ?)",
          [req.file.originalname, req.file.size, performed_by || null, note || null],
          () => {
            // best-effort logging
          }
        );

        res.json({
          success: true,
          message:
            "Database restored successfully. Backend will restart now. If not supervised, restart it manually.",
        });
        res.on("finish", () => {
          setTimeout(() => process.exit(0), 300);
        });
      });
    });
  });
});

// GET /api/backup/log — backup/restore history
app.get("/api/backup/log", requirePerm("manage_employees"), (req, res) => {
  db.all("SELECT * FROM backup_log ORDER BY created_at DESC LIMIT 100", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ log: rows });
  });
});

// ─── E-INVOICING ─────────────────────────────────────────────────────────────

// Helper: generate next invoice number atomically (INV-YYYY-00001)
function generateInvoiceNumber(cb) {
  const year = new Date().getFullYear();
  db.serialize(() => {
    db.run(
      "INSERT INTO invoice_sequences (year, last_seq) VALUES (?, 1) ON CONFLICT(year) DO UPDATE SET last_seq = last_seq + 1",
      [year],
      function (err) {
        if (err) return cb(err);
        db.get("SELECT last_seq FROM invoice_sequences WHERE year = ?", [year], (err2, row) => {
          if (err2) return cb(err2);
          const seq = String(row.last_seq).padStart(5, "0");
          cb(null, `INV-${year}-${seq}`);
        });
      }
    );
  });
}

function assignInvoiceNumberToSale(saleId, retriesLeft, cb) {
  generateInvoiceNumber((invErr, invoiceNumber) => {
    if (invErr || !invoiceNumber) {
      if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
      return cb(invErr || new Error("Failed to generate invoice number"));
    }

    db.run(
      "UPDATE sales SET invoice_number = ? WHERE id = ? AND invoice_number IS NULL",
      [invoiceNumber, saleId],
      function (updateErr) {
        if (updateErr) {
          if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
          return cb(updateErr);
        }

        if (this.changes > 0) return cb(null, invoiceNumber);

        db.get("SELECT invoice_number FROM sales WHERE id = ?", [saleId], (rowErr, row) => {
          if (rowErr) {
            if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
            return cb(rowErr);
          }
          if (row && row.invoice_number) return cb(null, row.invoice_number);
          if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
          return cb(new Error("Invoice number update affected zero rows"));
        });
      }
    );
  });
}

function getInvoiceData(saleId, cb) {
  db.get(
    `SELECT s.*, o.name as outlet_name, o.address as outlet_address,
            e.name as employee_name,
            c.name as customer_name, c.phone as customer_phone, c.email as customer_email
     FROM sales s
     LEFT JOIN outlets o ON s.outlet_id = o.id
     LEFT JOIN employees e ON s.employee_id = e.id
     LEFT JOIN customers c ON s.customer_id = c.id
     WHERE s.id = ?`,
    [saleId],
    (err, sale) => {
      if (err) return cb(err);
      if (!sale) return cb(null, null);
      db.all(
        `SELECT si.*, p.name as product_name, p.barcode,
                t.name as tax_name, t.rate as tax_rate
         FROM sale_items si
         JOIN products p ON si.product_id = p.id
         LEFT JOIN taxes t ON p.tax_id = t.id
         WHERE si.sale_id = ?`,
        [saleId],
        (err2, items) => {
          if (err2) return cb(err2);
          db.all("SELECT * FROM sale_payments WHERE sale_id = ?", [saleId], (err3, payments) => {
            if (err3) return cb(err3);
            cb(null, { sale, items: items || [], payments: payments || [] });
          });
        }
      );
    }
  );
}

// GET /api/sales/:id/invoice — formal invoice data for a sale
app.get("/api/sales/:id/invoice", (req, res) => {
  const { id } = req.params;
  getInvoiceData(id, (err, payload) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!payload) return res.status(404).json({ error: "Sale not found" });
    return res.json(payload);
  });
});

// GET /api/sales/:id/invoice/export - normalized JSON export contract (v1.0)
app.get("/api/sales/:id/invoice/export", (req, res) => {
  const { id } = req.params;
  getInvoiceData(id, (err, payload) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!payload) return res.status(404).json({ error: "Sale not found" });

    const { sale, items, payments } = payload;
    const normalizedItems = items.map((item) => {
      const unitPrice = Number(item.price_at_sale || 0);
      const quantity = Number(item.quantity || 0);
      const taxRate = Number(item.tax_rate || 0);
      const lineSubtotal = Number((unitPrice * quantity).toFixed(2));
      const lineTax = Number(((lineSubtotal * taxRate) / 100).toFixed(2));
      return {
        product_id: item.product_id,
        product_name: item.product_name || null,
        barcode: item.barcode || null,
        quantity,
        unit_price: unitPrice,
        tax_name: item.tax_name || null,
        tax_rate: taxRate,
        line_subtotal: lineSubtotal,
        line_tax: lineTax,
        line_total: Number((lineSubtotal + lineTax).toFixed(2)),
      };
    });

    const subtotal = Number(
      normalizedItems.reduce((sum, row) => sum + row.line_subtotal, 0).toFixed(2)
    );
    const taxTotal = Number(
      normalizedItems.reduce((sum, row) => sum + row.line_tax, 0).toFixed(2)
    );
    const discountAmount = Number(sale.discount_amount || 0);
    const pointsRedeemed = Number(sale.points_redeemed || 0);
    const totalAmount = Number(sale.total_amount || 0);

    return res.json({
      version: "1.0",
      exported_at: new Date().toISOString(),
      invoice: {
        invoice_number: sale.invoice_number || `SALE-${sale.id}`,
        sale_id: sale.id,
        timestamp: sale.timestamp,
        status: sale.status || (sale.voided ? "voided" : "paid"),
        currency: "PKR",
        totals: {
          subtotal,
          tax_total: taxTotal,
          discount_amount: discountAmount,
          points_redeemed: pointsRedeemed,
          total_amount: totalAmount,
        },
      },
      seller: {
        outlet_id: sale.outlet_id || null,
        outlet_name: sale.outlet_name || null,
        outlet_address: sale.outlet_address || null,
      },
      buyer: sale.customer_id
        ? {
            customer_id: sale.customer_id,
            name: sale.customer_name || null,
            phone: sale.customer_phone || null,
            email: sale.customer_email || null,
          }
        : null,
      items: normalizedItems,
      payments: (payments || []).map((p) => ({
        payment_method: p.payment_method || null,
        amount: Number(p.amount || 0),
      })),
    });
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});


