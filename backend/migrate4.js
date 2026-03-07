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
        // Create sale_payments table
        db.run(`CREATE TABLE IF NOT EXISTS sale_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER,
            payment_method TEXT NOT NULL,
            amount REAL NOT NULL,
            FOREIGN KEY(sale_id) REFERENCES sales(id)
        )`, (err) => {
            if (err) {
                console.error("Error creating sale_payments table:", err.message);
            } else {
                console.log("sale_payments table created or already exists.");
            }
        });

        console.log("Closing connection...");
        db.close((err) => {
            if (err) {
                console.error("Error closing database:", err.message);
            } else {
                console.log("Database connection closed.");
            }
        });
    });
});
