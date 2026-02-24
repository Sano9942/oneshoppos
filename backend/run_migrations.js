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
  "migrate21.js",
  "migrate22.js",
  "migrate23.js",
  "migrate24.js",
  "migrate25.js",
  "migrate26.js",
  "migrate27.js",
  "migrate28.js",
  "migrate29.js",
  "migrate30.js",
  "migrate31.js",
  "migrate32.js",
  "migrate33.js",
  "migrate34.js",
  "migrate35.js",
];

for (const m of migrations) {
  console.log(`Running ${m}...`);
  try {
    execSync(`node ${m}`, { stdio: "inherit" });
  } catch (e) {
    console.error(`Failed on ${m}`);
  }
}
