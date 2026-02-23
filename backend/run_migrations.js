const { execSync } = require("child_process");

const migrations = [
  "migrate.js",
  "migrate2.js",
  "migrate3.js",
  "migrate4.js",
  "migrate5.js",
  "migrate6.js",
  "migrate7.js",
  "migrate8.js",
  "migrate9.js",
  "migrate10.js",
  "migrate11.js",
  "migrate12.js",
  "migrate13.js",
  "migrate14.js",
  "migrate15.js",
  "migrate16.js",
  "migrate17.js",
  "migrate18.js",
  "migrate19.js",
  "migrate20.js",
];

for (const m of migrations) {
  console.log(`Running ${m}...`);
  try {
    execSync(`node ${m}`, { stdio: "inherit" });
  } catch (e) {
    console.error(`Failed on ${m}`);
  }
}
