const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'sanopos.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
        process.exit(1);
    }
    console.log('Connected to the SQLite database.');

    db.serialize(() => {
        // Create stock_adjustments table
        db.run(`CREATE TABLE IF NOT EXISTS stock_adjustments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id),
            outlet_id INTEGER NOT NULL REFERENCES outlets(id),
            employee_id INTEGER REFERENCES employees(id),
            quantity_change INTEGER NOT NULL,
            reason TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, function(err) {
            if (err) {
                console.error("Error creating stock_adjustments table:", err.message);
            } else {
                console.log("stock_adjustments table created/verified.");
            }
        });
    });

    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Closing connection...');
    });
});
