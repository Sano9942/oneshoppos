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
        // Create Categories table
        db.run(`CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT
        )`, (err) => {
            if (err) console.error("Error creating categories:", err.message);
            else console.log("Categories table created/verified.");
        });

        // Create Taxes table
        db.run(`CREATE TABLE IF NOT EXISTS taxes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            rate REAL NOT NULL,
            is_default BOOLEAN DEFAULT 0
        )`, (err) => {
            if (err) console.error("Error creating taxes:", err.message);
            else console.log("Taxes table created/verified.");
        });
        
        // Add foreign keys to products (if they do not exist)
        // SQLite ALTER TABLE cannot add foreign keys retroactively easily, so we add columns
        db.run(`ALTER TABLE products ADD COLUMN category_id INTEGER REFERENCES categories(id)`, (err) => {
            if (err && !err.message.includes("duplicate column name")) {
                console.error("Error adding category_id to products:", err.message);
            }
        });
        
        db.run(`ALTER TABLE products ADD COLUMN tax_id INTEGER REFERENCES taxes(id)`, (err) => {
            if (err && !err.message.includes("duplicate column name")) {
                console.error("Error adding tax_id to products:", err.message);
            }
        });

        // Insert Default Category
        db.run(`INSERT OR IGNORE INTO categories (name, description) VALUES ('General', 'Default category for items')`);
        
        // Insert Default Tax Rates
        db.run(`INSERT OR IGNORE INTO taxes (name, rate, is_default) VALUES ('Exempt / Zero Rated', 0.0, 1)`);
        db.run(`INSERT OR IGNORE INTO taxes (name, rate, is_default) VALUES ('Standard GST', 18.0, 0)`);

        console.log("Closing connection...");
        db.close();
    });
});
