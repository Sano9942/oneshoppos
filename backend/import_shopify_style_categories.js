const sqlite3 = require("sqlite3").verbose();

const TREE = [
  {
    name: "Apparel & Accessories",
    children: [
      {
        name: "Men",
        children: [
          "T-Shirts",
          "Shirts",
          "Jeans",
          "Trousers",
          "Hoodies",
          "Jackets",
          "Shoes",
          "Sandals",
          "Wallets",
          "Belts",
        ],
      },
      {
        name: "Women",
        children: [
          "Dresses",
          "Tops",
          "Kurtis",
          "Jeans",
          "Trousers",
          "Abayas",
          "Hijabs",
          "Handbags",
          "Shoes",
        ],
      },
      {
        name: "Kids",
        children: [
          "Boys Clothing",
          "Girls Clothing",
          "Baby Clothing",
          "School Shoes",
          "Toys",
        ],
      },
      {
        name: "Jewelry",
        children: ["Rings", "Necklaces", "Earrings", "Bracelets"],
      },
      {
        name: "Watches",
        children: ["Men Watches", "Women Watches", "Smart Watches"],
      },
    ],
  },
  {
    name: "Beauty & Personal Care",
    children: [
      {
        name: "Skin Care",
        children: ["Face Wash", "Moisturizers", "Serums", "Sunscreen"],
      },
      {
        name: "Hair Care",
        children: ["Shampoo", "Conditioner", "Hair Oil", "Hair Color"],
      },
      {
        name: "Makeup",
        children: ["Foundation", "Lipstick", "Mascara"],
      },
      {
        name: "Fragrance",
        children: ["Perfumes", "Body Sprays"],
      },
      {
        name: "Personal Care",
        children: ["Soaps", "Deodorants", "Shaving"],
      },
    ],
  },
  {
    name: "Electronics",
    children: [
      {
        name: "Phones",
        children: ["Android Phones", "iPhones", "Feature Phones"],
      },
      {
        name: "Computers",
        children: ["Laptops", "Desktops", "Monitors", "Keyboards", "Mouse"],
      },
      {
        name: "Audio",
        children: ["Earbuds", "Headphones", "Speakers"],
      },
      {
        name: "Accessories",
        children: ["Chargers", "Cables", "Power Banks", "Phone Covers", "Screen Protectors"],
      },
      {
        name: "Smart Devices",
        children: ["Smart Watches", "Smart Home"],
      },
    ],
  },
  {
    name: "Home & Living",
    children: [
      {
        name: "Kitchen",
        children: ["Cookware", "Dinnerware", "Storage Containers", "Small Appliances"],
      },
      {
        name: "Home Decor",
        children: ["Clocks", "Frames", "Lamps", "Curtains"],
      },
      {
        name: "Bedding",
        children: ["Bedsheets", "Blankets", "Pillows"],
      },
      {
        name: "Cleaning",
        children: ["Detergents", "Surface Cleaners", "Cleaning Tools"],
      },
    ],
  },
  {
    name: "Food & Beverage",
    children: [
      {
        name: "Snacks",
        children: ["Chips", "Biscuits", "Chocolates"],
      },
      {
        name: "Beverages",
        children: ["Soft Drinks", "Juices", "Tea", "Coffee"],
      },
      {
        name: "Grocery",
        children: ["Rice", "Flour", "Cooking Oil", "Spices"],
      },
      {
        name: "Frozen",
        children: ["Frozen Snacks", "Frozen Meat"],
      },
    ],
  },
  {
    name: "Health",
    children: [
      {
        name: "Vitamins & Supplements",
        children: ["Multivitamins", "Protein", "Herbal Supplements"],
      },
      {
        name: "Medical Supplies",
        children: ["Masks", "Gloves", "Thermometers"],
      },
      {
        name: "Pharmacy",
        children: ["OTC Medicines"],
      },
    ],
  },
  {
    name: "Office & School",
    children: [
      {
        name: "Stationery",
        children: ["Pens", "Notebooks", "Markers"],
      },
      {
        name: "Office Supplies",
        children: ["Printer Paper", "Files", "Toners"],
      },
      {
        name: "School Bags",
        children: ["Backpacks", "Lunch Boxes"],
      },
    ],
  },
  {
    name: "Automotive",
    children: [
      {
        name: "Car Care",
        children: ["Polish", "Cleaners"],
      },
      {
        name: "Parts",
        children: ["Batteries", "Oils", "Filters"],
      },
      {
        name: "Accessories",
        children: ["Seat Covers", "Mobile Holders"],
      },
    ],
  },
];

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

async function upsertCategory(db, { name, description = null }, parentId, sortOrder) {
  const row = await dbGet(
    db,
    `SELECT id
     FROM categories
     WHERE lower(name) = lower(?)
       AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)`,
    [name, parentId, parentId],
  );

  if (row) {
    await dbRun(
      db,
      `UPDATE categories
       SET description = COALESCE(description, ?),
           sort_order = ?,
           is_active = 1
       WHERE id = ?`,
      [description, sortOrder, row.id],
    );
    return row.id;
  }

  const result = await dbRun(
    db,
    `INSERT INTO categories (name, description, parent_id, sort_order, is_active)
     VALUES (?, ?, ?, ?, 1)`,
    [name, description, parentId, sortOrder],
  );
  return result.lastID;
}

async function insertTree(db, nodes, parentId = null) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const normalized = typeof node === "string" ? { name: node } : node;
    const categoryId = await upsertCategory(db, normalized, parentId, index);
    if (Array.isArray(normalized.children) && normalized.children.length) {
      await insertTree(db, normalized.children, categoryId);
    }
  }
}

async function main() {
  const db = new sqlite3.Database("oneshop.db");
  try {
    await dbRun(db, "BEGIN TRANSACTION");
    await insertTree(db, TREE, null);
    await dbRun(db, "COMMIT");

    const count = await dbGet(db, "SELECT COUNT(*) AS count FROM categories");
    const topLevels = await dbGet(
      db,
      "SELECT COUNT(*) AS count FROM categories WHERE parent_id IS NULL",
    );
    console.log(
      JSON.stringify(
        {
          message: "Shopify-style internal category tree imported successfully",
          total_categories: Number(count?.count || 0),
          top_level_categories: Number(topLevels?.count || 0),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    try {
      await dbRun(db, "ROLLBACK");
    } catch (_) {
      // Ignore rollback failure after a failed transaction.
    }
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();
