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
        // Create Employees table
        db.run(`CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'Cashier',
            pin_code TEXT UNIQUE NOT NULL
        )`, (err) => {
            if (err) console.error("Error creating employees:", err.message);
            else console.log("Employees table created/verified.");
        });

        // Insert Default Admin Employee
        db.run(`INSERT OR IGNORE INTO employees (name, role, pin_code) VALUES ('Admin User', 'Manager', '1234')`);

        console.log("Closing connection...");
        db.close();
    });
});
