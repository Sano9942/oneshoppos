const sqlite3 = require("sqlite3").verbose();

const BRANDS = [
  { name: "LEGO", description: "Building blocks and construction toys" },
  { name: "Hot Wheels", description: "Die-cast vehicles and playsets" },
  { name: "Barbie", description: "Fashion dolls and accessories" },
  { name: "Hasbro", description: "Games, action figures, and family toys" },
  { name: "Nerf", description: "Foam blasters and action play toys" },
  { name: "Fisher-Price", description: "Baby, toddler, and preschool toys" },
  { name: "Melissa & Doug", description: "Wooden toys, puzzles, and pretend play" },
  { name: "Play-Doh", description: "Creative dough and arts play" },
  { name: "Funko", description: "Collectibles and pop culture figures" },
  { name: "VTech", description: "Educational electronics and STEM toys" },
  { name: "Little Tikes", description: "Ride-ons and outdoor toys" },
];

const SAMPLE_PRODUCTS = [
  {
    id: 1,
    name: "Building Blocks Starter Set",
    categoryPath: "Toys & Games > Building & Construction > Blocks",
    brandName: "LEGO",
    productType: "Building Blocks Set",
    tags: "Age 5+,STEM,Building,Indoor,Best Seller",
  },
  {
    id: 2,
    name: "Die-Cast Car Twin Pack",
    categoryPath: "Toys & Games > Vehicles & Remote Control > Die-Cast Cars",
    brandName: "Hot Wheels",
    productType: "Die-Cast Toy Vehicle",
    tags: "Age 3+,Vehicles,Collectible,Gift,Best Seller",
  },
  {
    id: 3,
    name: "Junior Robotics Explorer Kit",
    categoryPath: "Toys & Games > Educational & STEM > Robotics Kits",
    brandName: "VTech",
    productType: "STEM Robotics Kit",
    tags: "Age 8+,STEM,Educational,Learning,Gift",
  },
  {
    id: 4,
    name: "Adventure Jigsaw Puzzle",
    categoryPath: "Toys & Games > Board Games & Puzzles > Jigsaw Puzzles",
    brandName: "Melissa & Doug",
    productType: "Jigsaw Puzzle",
    tags: "Age 6+,Puzzle,Brain Teaser,Indoor,Family",
  },
  {
    id: 5,
    name: "Plush Buddy Bear",
    categoryPath: "Toys & Games > Plush & Soft Toys > Teddy Bears",
    brandName: "Fisher-Price",
    productType: "Plush Teddy Bear",
    tags: "Age 3+,Plush,Soft Toy,Gift,Comfort",
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
      resolve({ lastID: this.lastID, changes: this.changes || 0 });
    });
  });
}

async function ensureBrand(db, brand) {
  const existing = await dbGet(
    db,
    `SELECT id FROM brands WHERE lower(name) = lower(?)`,
    [brand.name],
  );
  if (existing) {
    await dbRun(
      db,
      `UPDATE brands
       SET description = COALESCE(description, ?)
       WHERE id = ?`,
      [brand.description || null, existing.id],
    );
    return existing.id;
  }
  const result = await dbRun(
    db,
    `INSERT INTO brands (name, description) VALUES (?, ?)`,
    [brand.name, brand.description || null],
  );
  return result.lastID;
}

async function getCategoryIdByPath(db, pathLabel) {
  const names = pathLabel.split(">").map((part) => part.trim()).filter(Boolean);
  let parentId = null;
  let currentId = null;
  for (const name of names) {
    const row = await dbGet(
      db,
      `SELECT id
       FROM categories
       WHERE lower(name) = lower(?)
         AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)`,
      [name, parentId, parentId],
    );
    if (!row) {
      throw new Error(`Category path not found: ${pathLabel}`);
    }
    currentId = row.id;
    parentId = row.id;
  }
  return currentId;
}

async function main() {
  const db = new sqlite3.Database("sanopos.db");
  try {
    await dbRun(db, "BEGIN TRANSACTION");

    const brandIds = {};
    for (const brand of BRANDS) {
      brandIds[brand.name] = await ensureBrand(db, brand);
    }

    const updatedProducts = [];
    for (const sample of SAMPLE_PRODUCTS) {
      const categoryId = await getCategoryIdByPath(db, sample.categoryPath);
      const brandId = brandIds[sample.brandName] || null;
      const result = await dbRun(
        db,
        `UPDATE products
         SET name = ?,
             category_id = ?,
             brand_id = ?,
             product_type = ?,
             vendor = COALESCE(vendor, ?),
             tags = ?
         WHERE id = ?`,
        [
          sample.name,
          categoryId,
          brandId,
          sample.productType,
          sample.brandName,
          sample.tags,
          sample.id,
        ],
      );
      updatedProducts.push({
        id: sample.id,
        name: sample.name,
        category_id: categoryId,
        brand_id: brandId,
        updated: result.changes,
      });
    }

    await dbRun(db, "COMMIT");
    const brandCount = await dbGet(db, `SELECT COUNT(*) AS count FROM brands`);
    console.log(
      JSON.stringify(
        {
          message: "Toy-store brands and sample product defaults applied successfully",
          total_brands: Number(brandCount?.count || 0),
          updated_products: updatedProducts,
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
