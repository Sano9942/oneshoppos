const express = require('express');
const cors = require('cors');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json()); // Parse JSON bodies

// --- ROUTES: TAXES ---

// Get all taxes
app.get('/api/taxes', (req, res) => {
    db.all("SELECT * FROM taxes ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ taxes: rows });
    });
});

// Add a new tax
app.post('/api/taxes', (req, res) => {
    const { name, rate, is_default } = req.body;
    db.run(
        "INSERT INTO taxes (name, rate, is_default) VALUES (?, ?, ?)",
        [name, rate, is_default ? 1 : 0],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name, rate, is_default });
        }
    );
});

// Update a tax
app.put('/api/taxes/:id', (req, res) => {
    const { id } = req.params;
    const { name, rate, is_default } = req.body;
    db.run(
        "UPDATE taxes SET name = COALESCE(?, name), rate = COALESCE(?, rate), is_default = COALESCE(?, is_default) WHERE id = ?",
        [name, rate, is_default ? 1 : 0, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: "Tax not found" });
            res.json({ message: "Tax updated successfully" });
        }
    );
});

// Delete a tax
app.delete('/api/taxes/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM taxes WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Tax not found" });
        res.json({ message: "Tax deleted" });
    });
});


// --- ROUTES: CATEGORIES ---

// Get all categories
app.get('/api/categories', (req, res) => {
    db.all("SELECT * FROM categories ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ categories: rows });
    });
});

// Add a new category
app.post('/api/categories', (req, res) => {
    const { name, description } = req.body;
    db.run(
        "INSERT INTO categories (name, description) VALUES (?, ?)",
        [name, description],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name, description });
        }
    );
});

// Update a category
app.put('/api/categories/:id', (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    db.run(
        "UPDATE categories SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?",
        [name, description, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: "Category not found" });
            res.json({ message: "Category updated successfully" });
        }
    );
});

// Delete a category
app.delete('/api/categories/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM categories WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Category not found" });
        res.json({ message: "Category deleted" });
    });
});


// --- ROUTES: OUTLETS ---

// Get all outlets
app.get('/api/outlets', (req, res) => {
    db.all("SELECT * FROM outlets ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ outlets: rows });
    });
});

// Add a new outlet
app.post('/api/outlets', (req, res) => {
    const { name, address, phone } = req.body;
    db.run(
        "INSERT INTO outlets (name, address, phone) VALUES (?, ?, ?)",
        [name, address, phone],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name, address, phone });
        }
    );
});

// Update an outlet
app.put('/api/outlets/:id', (req, res) => {
    const { id } = req.params;
    const { name, address, phone } = req.body;
    db.run(
        "UPDATE outlets SET name = COALESCE(?, name), address = COALESCE(?, address), phone = COALESCE(?, phone) WHERE id = ?",
        [name, address, phone, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: "Outlet not found" });
            res.json({ message: "Outlet updated successfully" });
        }
    );
});

// Delete an outlet
app.delete('/api/outlets/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM outlets WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Outlet not found" });
        res.json({ message: "Outlet deleted" });
    });
});


// --- ROUTES: EMPLOYEES ---

// Get all employees
app.get('/api/employees', (req, res) => {
    db.all("SELECT id, name, role FROM employees ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ employees: rows });
    });
});

// Validate PIN (For POS Login)
app.post('/api/employees/validate-pin', (req, res) => {
    const { pin_code } = req.body;
    db.get("SELECT id, name, role FROM employees WHERE pin_code = ?", [pin_code], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(401).json({ error: "Invalid PIN" });
        res.json({ employee: row });
    });
});

// Add a new employee
app.post('/api/employees', (req, res) => {
    const { name, role, pin_code } = req.body;
    db.run(
        "INSERT INTO employees (name, role, pin_code) VALUES (?, ?, ?)",
        [name, role, pin_code],
        function (err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: "PIN code must be unique" });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ id: this.lastID, name, role });
        }
    );
});

// Update an employee
app.put('/api/employees/:id', (req, res) => {
    const { id } = req.params;
    const { name, role, pin_code } = req.body;
    
    // Allow updating PIN only if it's provided, otherwise keep existing
    let query = "UPDATE employees SET name = COALESCE(?, name), role = COALESCE(?, role)";
    let params = [name, role];
    
    if (pin_code !== undefined && pin_code !== '') {
        query += ", pin_code = ?";
        params.push(pin_code);
    }
    
    query += " WHERE id = ?";
    params.push(id);

    db.run(query, params, function (err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: "PIN code must be unique" });
                }
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) return res.status(404).json({ error: "Employee not found" });
            res.json({ message: "Employee updated successfully" });
        }
    );
});

// Delete an employee
app.delete('/api/employees/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM employees WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Employee not found" });
        res.json({ message: "Employee deleted" });
    });
});


// --- ROUTES: BRANDS ---

// Get all brands
app.get('/api/brands', (req, res) => {
    db.all("SELECT * FROM brands ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ brands: rows });
    });
});

// Add a new brand
app.post('/api/brands', (req, res) => {
    const { name, description } = req.body;
    db.run(
        "INSERT INTO brands (name, description) VALUES (?, ?)",
        [name, description],
        function (err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: "Brand name must be unique" });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ id: this.lastID, name, description });
        }
    );
});

// Update a brand
app.put('/api/brands/:id', (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    db.run(
        "UPDATE brands SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?",
        [name, description, id],
        function (err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: "Brand name must be unique" });
                }
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) return res.status(404).json({ error: "Brand not found" });
            res.json({ message: "Brand updated successfully" });
        }
    );
});

// Delete a brand
app.delete('/api/brands/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM brands WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Brand not found" });
        res.json({ message: "Brand deleted" });
    });
});


// --- ROUTES: PRODUCTS (INVENTORY) ---

// Get all products (with aggregated stock)
app.get('/api/products', (req, res) => {
    db.all(`
        SELECT p.*, 
               c.name as category_name, 
               t.name as tax_name, t.rate as tax_rate,
               s.name as supplier_name,
               b.name as brand_name,
               COALESCE(SUM(os.quantity), 0) as total_stock
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN taxes t ON p.tax_id = t.id
        LEFT JOIN suppliers s ON p.supplier_id = s.id
        LEFT JOIN brands b ON p.brand_id = b.id
        LEFT JOIN outlet_stock os ON p.id = os.product_id
        GROUP BY p.id
        ORDER BY p.name ASC
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ products: rows });
    });
});

// Get individual product stock across all outlets
app.get('/api/products/:id/stock', (req, res) => {
    const { id } = req.params;
    db.all(`
        SELECT os.outlet_id, o.name as outlet_name, os.quantity 
        FROM outlet_stock os
        JOIN outlets o ON os.outlet_id = o.id
        WHERE os.product_id = ?
    `, [id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ stock: rows });
    });
});

// Scan/Find a product by barcode (Crucial for POS speed)
app.get('/api/products/scan/:barcode', (req, res) => {
    const { barcode } = req.params;
    const outlet_id = req.query.outlet_id; // Pass outlet ID from POS to get local stock
    
    let query = `
        SELECT p.*, t.rate as tax_rate, t.name as tax_name,
               COALESCE(SUM(os.quantity), 0) as local_stock
        FROM products p
        LEFT JOIN taxes t ON p.tax_id = t.id
        LEFT JOIN outlet_stock os ON p.id = os.product_id ${outlet_id ? `AND os.outlet_id = ${outlet_id}` : ''}
        WHERE p.barcode = ?
        GROUP BY p.id
    `;

    db.get(query, [barcode], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Product not found" });

        // Normalize Tax Output for the POS Terminal
        // If it has a tax profile, use it. Otherwise fallback to legacy GST.
        const effectiveTaxRate = row.tax_rate !== null ? row.tax_rate : (row.gst !== null ? row.gst : 0);
        const effectiveTaxName = row.tax_name || (row.gst !== null ? 'GST' : 'No Tax');

        const productWithTax = {
            ...row,
            effectiveTaxRate,
            effectiveTaxName
        };

        res.json({ product: productWithTax });
    });
});

// Add a new product (and optionally set initial stock for a specific outlet)
app.post('/api/products', (req, res) => {
    const { barcode, name, price, cost_price, gst, category_id, tax_id, brand_id, outlet_id, initial_stock } = req.body;
    
    // We start a transaction because we need to insert into products, and then optionally into outlet_stock.
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(
            "INSERT INTO products (barcode, name, price, cost_price, gst, stock, category_id, tax_id, brand_id) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)",
            [barcode, name, price, cost_price || 0, gst === '' ? null : gst, category_id || null, tax_id || null, brand_id || null],
            function (err) {
                if (err) {
                    db.run('ROLLBACK');
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: "Barcode already exists" });
                    }
                    return res.status(500).json({ error: err.message });
                }
                const newProductId = this.lastID;

                // If outlet_id and initial_stock are provided, initialize stock for that outlet.
                if (outlet_id && initial_stock) {
                    db.run(
                        "INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (?, ?, ?)",
                        [newProductId, outlet_id, initial_stock],
                        function(stockErr) {
                            if (stockErr) {
                                db.run('ROLLBACK');
                                return res.status(500).json({ error: "Failed to initialize outlet stock: " + stockErr.message });
                            }
                            db.run('COMMIT');
                            res.json({ id: newProductId, barcode, name, price, cost_price, gst, category_id, tax_id, brand_id, initial_stock, outlet_id });
                        }
                    );
                } else {
                    db.run('COMMIT');
                    res.json({ id: newProductId, barcode, name, price, cost_price, gst, category_id, tax_id, brand_id });
                }
            }
        );
    });
});

// Update a product (Prices, Names, Categories... NOT Stock. Stock is handled via Adjustments/Transfers)
app.put('/api/products/:id', (req, res) => {
    const { id } = req.params;
    const { name, price, cost_price, gst, barcode, category_id, tax_id, brand_id } = req.body;
    
    // Simple dynamic update
    db.run(
        "UPDATE products SET name = COALESCE(?, name), price = COALESCE(?, price), cost_price = COALESCE(?, cost_price), gst = ?, barcode = COALESCE(?, barcode), category_id = COALESCE(?, category_id), tax_id = COALESCE(?, tax_id), brand_id = COALESCE(?, brand_id) WHERE id = ?",
        [name, price, cost_price, gst === '' ? null : gst, barcode, category_id || null, tax_id || null, brand_id || null, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: "Product not found" });
            res.json({ message: "Product updated successfully" });
        }
    );
});

// Delete a product
app.delete('/api/products/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM products WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Product not found" });
        res.json({ message: "Product deleted" });
    });
});


// --- ROUTES: SUPPLIERS ---

// Get all suppliers
app.get('/api/suppliers', (req, res) => {
    db.all("SELECT * FROM suppliers ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ suppliers: rows });
    });
});

// Add a new supplier
app.post('/api/suppliers', (req, res) => {
    const { name, contact_person, phone, email, address } = req.body;
    db.run(
        "INSERT INTO suppliers (name, contact_person, phone, email, address) VALUES (?, ?, ?, ?, ?)",
        [name, contact_person, phone, email, address],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name, contact_person, phone, email, address });
        }
    );
});

// Update a supplier
app.put('/api/suppliers/:id', (req, res) => {
    const { id } = req.params;
    const { name, contact_person, phone, email, address } = req.body;
    
    db.run(
        "UPDATE suppliers SET name = COALESCE(?, name), contact_person = COALESCE(?, contact_person), phone = COALESCE(?, phone), email = COALESCE(?, email), address = COALESCE(?, address) WHERE id = ?",
        [name, contact_person, phone, email, address, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: "Supplier not found" });
            res.json({ message: "Supplier updated successfully" });
        }
    );
});

// Delete a supplier
app.delete('/api/suppliers/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM suppliers WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Supplier not found" });
        res.json({ message: "Supplier deleted" });
    });
});


// --- ROUTES: PURCHASE ORDERS ---

// Get all purchase orders (with supplier names)
app.get('/api/purchase-orders', (req, res) => {
    db.all(`
        SELECT po.*, s.name as supplier_name 
        FROM purchase_orders po
        JOIN suppliers s ON po.supplier_id = s.id
        ORDER BY po.created_at DESC
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ purchaseOrders: rows });
    });
});

// Get a single purchase order with its items
app.get('/api/purchase-orders/:id', (req, res) => {
    const { id } = req.params;
    db.get(`
        SELECT po.*, s.name as supplier_name 
        FROM purchase_orders po
        JOIN suppliers s ON po.supplier_id = s.id
        WHERE po.id = ?
    `, [id], (err, po) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!po) return res.status(404).json({ error: "Purchase order not found" });

        db.all(`
            SELECT poi.*, p.name, p.barcode
            FROM purchase_order_items poi
            JOIN products p ON poi.product_id = p.id
            WHERE poi.po_id = ?
        `, [id], (err, items) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ purchaseOrder: po, items });
        });
    });
});

// Create a new purchase order
app.post('/api/purchase-orders', (req, res) => {
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
                const stmt = db.prepare("INSERT INTO purchase_order_items (po_id, product_id, quantity, cost_price) VALUES (?, ?, ?, ?)");
                let hasError = false;

                items.forEach(item => {
                    stmt.run(poId, item.product_id, item.quantity, item.cost_price, (err) => {
                        if (err) hasError = true;
                    });
                });

                stmt.finalize();

                if (hasError) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: "Transaction failed while adding items" });
                }

                db.run("COMMIT", (err) => {
                    if (err) return res.status(500).json({ error: "Failed to commit PO" });
                    res.json({ message: "Purchase order created", id: poId });
                });
            }
        );
    });
});

// Receive a purchase order (Updates Inventory Stock & Cost Price)
app.post('/api/purchase-orders/:id/receive', (req, res) => {
    const { id } = req.params;
    const { outlet_id } = req.body; // Outlet ID where the stock should go

    if (!outlet_id) {
        return res.status(400).json({ error: "Outlet ID is required to receive PO" });
    }

    db.get("SELECT status FROM purchase_orders WHERE id = ?", [id], (err, po) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!po) return res.status(404).json({ error: "PO not found" });
        if (po.status === 'Received') return res.status(400).json({ error: "PO already received" });

        db.all("SELECT product_id, quantity, cost_price FROM purchase_order_items WHERE po_id = ?", [id], (err, items) => {
            if (err) return res.status(500).json({ error: err.message });

            db.serialize(() => {
                db.run("BEGIN TRANSACTION");

                // Update PO status
                db.run("UPDATE purchase_orders SET status = 'Received' WHERE id = ?", [id]);

                // Update Products cost_price
                const updateCostStmt = db.prepare("UPDATE products SET cost_price = ? WHERE id = ?");
                // Update or Insert into Outlet Stock
                const updateStockStmt = db.prepare(`
                    INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                    VALUES (?, ?, ?)
                    ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?
                `);
                
                let hasError = false;

                items.forEach(item => {
                    updateCostStmt.run(item.cost_price, item.product_id, (err) => {
                        if (err) {
                            console.error("Cost Update Error", err);
                            hasError = true;
                        }
                    });
                    
                    updateStockStmt.run(item.product_id, outlet_id, item.quantity, item.quantity, (err) => {
                        if (err) {
                            console.error("Stock Update Error", err);
                            hasError = true;
                        }
                    });
                });

                updateCostStmt.finalize();
                updateStockStmt.finalize();

                if (hasError) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: "Failed to update inventory" });
                }

                db.run("COMMIT", (err) => {
                    if (err) return res.status(500).json({ error: "Failed to commit inventory changes" });
                    res.json({ message: "PO received and inventory updated" });
                });
            });
        });
    });
});


// Delete a purchase order
app.delete('/api/purchase-orders/:id', (req, res) => {
    const { id } = req.params;

    db.get("SELECT status FROM purchase_orders WHERE id = ?", [id], (err, po) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!po) return res.status(404).json({ error: "PO not found" });
        if (po.status === 'Received') return res.status(400).json({ error: "Cannot delete a received PO" });

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run("DELETE FROM purchase_order_items WHERE po_id = ?", [id], function(err) {
                if(err) { db.run("ROLLBACK"); return res.status(500).json({error: err.message}); }
            });
            db.run("DELETE FROM purchase_orders WHERE id = ?", [id], function(err) {
                if(err) { db.run("ROLLBACK"); return res.status(500).json({error: err.message}); }
            });
            db.run("COMMIT", err => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "Purchase order deleted" });
            });
        });
    });
});


// --- FOR CHECKOUT (POINT OF SALE) ---

// Process a Sale (Cart Checkout)
app.post('/api/sales', (req, res) => {
    const { cartItems, paymentMethod, payments, outlet_id } = req.body;
    
    // Validation
    if (!cartItems || cartItems.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
    }
    if (!outlet_id) {
        return res.status(400).json({ error: "Outlet ID is required for checkout" });
    }

    // 1. Calculate Expected Total
    const totalAmount = cartItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    
    // Determine the actual payments to record
    let finalPayments = payments;
    let mainPaymentMethod = paymentMethod || 'Cash';
    
    if (!finalPayments || finalPayments.length === 0) {
        finalPayments = [{ method: mainPaymentMethod, amount: totalAmount }];
    } else if (finalPayments.length > 1) {
        mainPaymentMethod = 'Split';
    } else if (finalPayments.length === 1) {
        mainPaymentMethod = finalPayments[0].method;
    }

    // Start Transaction Logic
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // 2. Insert into Sales Table
        db.run(
            "INSERT INTO sales (total_amount, payment_method) VALUES (?, ?)",
            [totalAmount, mainPaymentMethod],
            function (err) {
                if (err) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: "Failed to create sale record" });
                }

                const saleId = this.lastID;
                const itemsStmt = db.prepare("INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, cost_price_at_sale) VALUES (?, ?, ?, ?, ?)");
                const stockStmt = db.prepare(`
                    UPDATE outlet_stock 
                    SET quantity = quantity - ? 
                    WHERE product_id = ? AND outlet_id = ?
                `);
                const paymentsStmt = db.prepare("INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES (?, ?, ?)");
                
                let hasError = false;

                // 3. Loop through cart to insert Line Items AND deduct stock
                cartItems.forEach(item => {
                    itemsStmt.run(saleId, item.id, item.quantity, item.price, item.cost_price || 0, (err) => {
                        if (err) hasError = true;
                    });
                    
                    stockStmt.run(item.quantity, item.id, outlet_id, (err) => {
                        if (err) hasError = true;
                    });
                });

                // 4. Insert Payments
                finalPayments.forEach(payment => {
                    paymentsStmt.run(saleId, payment.method, payment.amount, (err) => {
                        if (err) hasError = true;
                    });
                });

                itemsStmt.finalize();
                stockStmt.finalize();
                paymentsStmt.finalize();

                // 5. Commit or Rollback
                if (hasError) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: "Transaction failed" });
                }

                db.run("COMMIT", (err) => {
                    if (err) return res.status(500).json({ error: "Failed to commit sale" });
                    res.json({ message: "Sale completed successfully", saleId, totalAmount, payments: finalPayments });
                });
            }
        );
    });
});


// --- REPORTS DASHBOARD ---

app.get('/api/reports/dashboard', async (req, res) => {
    try {
        const getQuery = (query, params = []) => new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows));
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
        const saleCountRow = await getQuery(`SELECT COUNT(id) as count FROM sales WHERE date(timestamp, 'localtime') = date('now', 'localtime')`);
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

        // 4. Low Stock Alert (Threshold: 10 or less)
        const lowStock = await getQuery(`
            SELECT name, stock, barcode, price, cost_price
            FROM products
            WHERE stock <= 10
            ORDER BY stock ASC
        `);

        // 5. Estimated Inventory Value
        const inventoryValueRow = await getQuery(`
            SELECT 
                SUM(stock * price) as retail_value,
                SUM(stock * cost_price) as cost_value
            FROM products
            WHERE stock > 0
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
            inventoryValue: inventoryValueRow[0] || { retail_value: 0, cost_value: 0 }
        });

    } catch (err) {
        console.error("Report Error:", err);
        res.status(500).json({ error: "Failed to generate reports" });
    }
});


// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
