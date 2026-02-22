const express = require('express');
const cors = require('cors');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json()); // Parse JSON bodies

// --- ROUTES: PRODUCTS (INVENTORY) ---

// Get all products
app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ products: rows });
    });
});

// Scan/Find a product by barcode (Crucial for POS speed)
app.get('/api/products/scan/:barcode', (req, res) => {
    const { barcode } = req.params;
    db.get("SELECT * FROM products WHERE barcode = ?", [barcode], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Product not found" });
        res.json({ product: row });
    });
});

// Add a new product
app.post('/api/products', (req, res) => {
    const { barcode, name, price, cost_price, gst, stock } = req.body;
    db.run(
        "INSERT INTO products (barcode, name, price, cost_price, gst, stock) VALUES (?, ?, ?, ?, ?, ?)",
        [barcode, name, price, cost_price || 0, gst === '' ? null : gst, stock || 0],
        function (err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: "Barcode already exists" });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ id: this.lastID, barcode, name, price, cost_price, gst, stock });
        }
    );
});

// Update a product (Stock/Price)
app.put('/api/products/:id', (req, res) => {
    const { id } = req.params;
    const { name, price, cost_price, gst, stock, barcode } = req.body;
    
    // Simple dynamic update
    db.run(
        "UPDATE products SET name = COALESCE(?, name), price = COALESCE(?, price), cost_price = COALESCE(?, cost_price), gst = ?, stock = COALESCE(?, stock), barcode = COALESCE(?, barcode) WHERE id = ?",
        [name, price, cost_price, gst === '' ? null : gst, stock, barcode, id],
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


// --- FOR CHECKOUT (POINT OF SALE) ---

// Process a Sale (Cart Checkout)
app.post('/api/sales', (req, res) => {
    const { cartItems, paymentMethod } = req.body;
    
    // Validation
    if (!cartItems || cartItems.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
    }

    // 1. Calculate Expected Total
    const totalAmount = cartItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    
    // Start Transaction Logic (SQLite doesn't natively group this easily without explicit BEGIN/COMMIT)
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // 2. Insert into Sales Table
        db.run(
            "INSERT INTO sales (total_amount, payment_method) VALUES (?, ?)",
            [totalAmount, paymentMethod || 'Cash'],
            function (err) {
                if (err) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: "Failed to create sale record" });
                }

                const saleId = this.lastID;
                const stmt = db.prepare("INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, cost_price_at_sale) VALUES (?, ?, ?, ?, ?)");
                const stockStmt = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?");

                let hasError = false;

                // 3. Loop through cart to insert Line Items AND deduct stock
                cartItems.forEach(item => {
                    stmt.run(saleId, item.id, item.quantity, item.price, item.cost_price || 0, (err) => {
                        if (err) hasError = true;
                    });
                    
                    stockStmt.run(item.quantity, item.id, (err) => {
                        if (err) hasError = true;
                    });
                });

                stmt.finalize();
                stockStmt.finalize();

                // 4. Commit or Rollback
                if (hasError) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: "Transaction failed" });
                }

                db.run("COMMIT", (err) => {
                    if (err) return res.status(500).json({ error: "Failed to commit sale" });
                    res.json({ message: "Sale completed successfully", saleId, totalAmount });
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

        // 1. Z-Report: Today's Revenue by Payment Method
        const zReport = await getQuery(`
            SELECT payment_method, SUM(total_amount) as total 
            FROM sales 
            WHERE date(timestamp, 'localtime') = date('now', 'localtime')
            GROUP BY payment_method
        `);
        const totalRevenueToday = zReport.reduce((sum, row) => sum + row.total, 0);

        // 2. Profit Margin Today
        const profitRow = await getQuery(`
            SELECT 
                SUM(si.quantity * si.price_at_sale) as total_sales,
                SUM(si.quantity * si.cost_price_at_sale) as total_cost
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE date(s.timestamp, 'localtime') = date('now', 'localtime')
        `);
        const todayProfit = (profitRow[0]?.total_sales || 0) - (profitRow[0]?.total_cost || 0);

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
            todayProfit,
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
