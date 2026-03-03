const fs = require("fs");
let content = fs.readFileSync("routes/reports.js", "utf8");
content = content.replace(/\\`/g, "`");
content = content.replace(/\\\$/g, "$");
fs.writeFileSync("routes/reports.js", content);
console.log("Fixed reports.js");
