const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'oneshop.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
        return;
    }
    console.log('Connected to the SQLite database.');

    db.serialize(() => {
        // Add brand_id to products if it doesn't exist
        db.all("PRAGMA table_info(products)", (err, rows) => {
            if (err) {
                console.error("Error checking products table schema:", err.message);
                return;
            }
            
            const hasBrandId = rows.some(r => r.name === 'brand_id');
            if (!hasBrandId) {
                db.run("ALTER TABLE products ADD COLUMN brand_id INTEGER REFERENCES brands(id)", (err) => {
                    if (err) console.error("Error adding brand_id to products:", err.message);
                    else console.log("Added brand_id column to products table.");
                });
            } else {
                console.log("products table already has brand_id column.");
            }
        });

        console.log("Migration complete (closing in background).");
    });
});
