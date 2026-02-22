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
        // Create Outlets table
        db.run(`CREATE TABLE IF NOT EXISTS outlets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            address TEXT,
            phone TEXT
        )`, (err) => {
            if (err) console.error("Error creating outlets:", err.message);
            else console.log("Outlets table created/verified.");
        });

        // Insert Default Outlet
        db.run(`INSERT OR IGNORE INTO outlets (name, address, phone) VALUES ('Main Store', '123 Main St', '555-0100')`);

        console.log("Closing connection...");
        db.close();
    });
});
