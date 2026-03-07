const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'sanopos.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
        return;
    }
    console.log('Connected to the SQLite database.');

    db.serialize(() => {
        // 1. Create outlet_stock table
        db.run(`CREATE TABLE IF NOT EXISTS outlet_stock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id),
            outlet_id INTEGER NOT NULL REFERENCES outlets(id),
            quantity INTEGER NOT NULL DEFAULT 0,
            UNIQUE(product_id, outlet_id)
        )`, (err) => {
            if (err) console.error("Error creating outlet_stock:", err.message);
            else console.log("outlet_stock table created/verified.");
        });

        // 2. Fetch the default outlet ID (or create one if it doesn't exist)
        db.get("SELECT id FROM outlets ORDER BY id ASC LIMIT 1", (err, outlet) => {
            if (err) {
                console.error("Error fetching default outlet:", err.message);
                return;
            }

            if (!outlet) {
                 console.log("No outlets found. Setting up a default 'Main Store'.");
                 db.run("INSERT INTO outlets (name, address, phone) VALUES ('Main Store', '123 Main St', '555-0100')", function(err) {
                     if (err) {
                         console.error("Error creating default outlet:", err.message);
                         return;
                     }
                     const defaultOutletId = this.lastID;
                     migrateStock(defaultOutletId);
                 });
            } else {
                 migrateStock(outlet.id);
            }
        });
        
        function migrateStock(outletId) {
             console.log(`Migrating existing stock to Outlet ID: ${outletId}...`);
             
             // 3. Migrate data: Read existing stock from products and insert into outlet_stock connecting it to the default outlet.
             db.all("SELECT id, stock FROM products", (err, products) => {
                 if (err) {
                     console.error("Error fetching existing products:", err.message);
                     return;
                 }
                 
                 let processed = 0;
                 if (products.length === 0) {
                     console.log("No existing products to migrate.");
                     db.close();
                     return;
                 }

                 const stmt = db.prepare("INSERT OR IGNORE INTO outlet_stock (product_id, outlet_id, quantity) VALUES (?, ?, ?)");
                 
                 products.forEach(p => {
                     stmt.run([p.id, outletId, p.stock], (err) => {
                         if (err) console.error(`Error migrating product ${p.id}:`, err.message);
                         processed++;
                         if (processed === products.length) {
                             stmt.finalize();
                             console.log("Stock migration complete.");
                             console.log("Closing connection...");
                             db.close();
                         }
                     });
                 });
             });
        }
    });
});
