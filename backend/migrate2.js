const db = require('./db');

db.serialize(() => {
    db.run("ALTER TABLE sale_items ADD COLUMN cost_price_at_sale REAL DEFAULT 0.0", (err) => {
        if(err) console.log("Info: " + err.message);
        else console.log("Added cost_price_at_sale to sale_items");
    });
});
