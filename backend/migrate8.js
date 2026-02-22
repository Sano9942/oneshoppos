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
        // Create Brands table
        db.run(`CREATE TABLE IF NOT EXISTS brands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT
        )`, (err) => {
            if (err) console.error("Error creating brands:", err.message);
            else console.log("Brands table created/verified.");
        });

        // Insert Default Brand
        db.run(`INSERT OR IGNORE INTO brands (name, description) VALUES ('Generic', 'Unbranded products')`);

        console.log("Closing connection...");
        db.close();
    });
});
