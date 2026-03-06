const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const { seedData } = require("./tests/helpers/seedData");

const dbPath = path.resolve(__dirname, "sanopos.db");
const db = new sqlite3.Database(dbPath, async (err) => {
  if (err) {
    console.error("Error opening database", err.message);
    process.exit(1);
  } else {
    console.log("Connected to the SQLite database for seeding.");
    try {
      // Clear tables first (optional but good for consistency)
      const tables = [
        "employees",
        "outlets",
        "roles",
        "role_permissions",
        "categories",
        "taxes",
        "brands",
        "suppliers",
        "products",
        "outlet_stock",
        "customers",
        "feature_flags",
        "company_profile",
      ];

      for (const table of tables) {
        await new Promise((resolve) =>
          db.run(`DELETE FROM ${table}`, [], () => resolve()),
        );
      }

      await seedData(db);
      console.log("Seed data inserted successfully.");
      db.close();
    } catch (err) {
      console.error("Seeding failed", err);
      process.exit(1);
    }
  }
});
