const db = require('./db');

db.serialize(() => {
    db.run("ALTER TABLE products ADD COLUMN cost_price REAL DEFAULT 0.0", (err) => {
        if(err) console.log("Info: " + err.message);
        else console.log("Added cost_price to products");
    });
    db.run("ALTER TABLE products ADD COLUMN gst REAL", (err) => {
        if(err) console.log("Info: " + err.message);
        else console.log("Added gst to products");
    });
});
