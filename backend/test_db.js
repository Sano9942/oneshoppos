const db = require('./db.js');
setTimeout(() => {
    db.get("SELECT * FROM products WHERE barcode='BR100'", (err, row) => {
        console.log(JSON.stringify(row, null, 2));
        process.exit(0);
    });
}, 1000);
