const sqlite3 = require("sqlite3").verbose();

const TOY_TREE = [
  {
    name: "Toys & Games",
    sort_order: -10,
    description: "Primary toy-store category tree for OneShopPOS",
    children: [
      {
        name: "Baby & Toddler",
        children: [
          "Rattles",
          "Teethers",
          "Soft Toys",
          "Stacking Toys",
          "Musical Toys",
          "Activity Walkers",
        ],
      },
      {
        name: "Preschool Toys",
        children: [
          "Learning Toys",
          "Shape Sorters",
          "Alphabet & Numbers",
          "Pretend Play",
          "Building Toys",
        ],
      },
      {
        name: "Action Figures & Collectibles",
        children: [
          "Superheroes",
          "Anime Figures",
          "Movie Characters",
          "Collectible Sets",
        ],
      },
      {
        name: "Dolls & Accessories",
        children: [
          "Fashion Dolls",
          "Baby Dolls",
          "Doll Houses",
          "Doll Accessories",
        ],
      },
      {
        name: "Vehicles & Remote Control",
        children: [
          "Die-Cast Cars",
          "RC Cars",
          "RC Bikes",
          "Construction Vehicles",
          "Train Sets",
        ],
      },
      {
        name: "Building & Construction",
        children: [
          "Blocks",
          "Magnetic Tiles",
          "Brick Sets",
          "Engineering Sets",
        ],
      },
      {
        name: "Educational & STEM",
        children: [
          "Science Kits",
          "Robotics Kits",
          "Coding Toys",
          "Math Learning",
          "Puzzle Learning",
        ],
      },
      {
        name: "Arts & Crafts",
        children: [
          "Coloring Sets",
          "Clay & Dough",
          "DIY Craft Kits",
          "Painting Sets",
          "Beads & Jewelry Kits",
        ],
      },
      {
        name: "Board Games & Puzzles",
        children: [
          "Family Board Games",
          "Card Games",
          "Jigsaw Puzzles",
          "Brain Teasers",
        ],
      },
      {
        name: "Outdoor & Sports Toys",
        children: [
          "Ride-Ons",
          "Scooters",
          "Ball Games",
          "Bubble Toys",
          "Water Play",
        ],
      },
      {
        name: "Plush & Soft Toys",
        children: ["Teddy Bears", "Character Plush", "Animal Plush"],
      },
      {
        name: "Seasonal & Gift Sets",
        children: [
          "Birthday Gifts",
          "Eid Gifts",
          "Return Gifts",
          "Holiday Specials",
        ],
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
      resolve({ lastID: this.lastID, changes: this.changes || 0 });
    });
  });
}

async function upsertCategory(db, node, parentId, fallbackSortOrder) {
  const name = node.name;
  const description = node.description || null;
  const sortOrder =
    node.sort_order != null ? Number(node.sort_order) : Number(fallbackSortOrder || 0);

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
    const node = typeof nodes[index] === "string" ? { name: nodes[index] } : nodes[index];
    const categoryId = await upsertCategory(db, node, parentId, index);
    if (Array.isArray(node.children) && node.children.length) {
      await insertTree(db, node.children, categoryId);
    }
  }
}

async function main() {
  const db = new sqlite3.Database("oneshop.db");
  try {
    await dbRun(db, "BEGIN TRANSACTION");
    await insertTree(db, TOY_TREE, null);
    await dbRun(db, "COMMIT");

    const root = await dbGet(
      db,
      `SELECT id, name, sort_order
       FROM categories
       WHERE name = 'Toys & Games' AND parent_id IS NULL`,
    );
    const children = await dbGet(
      db,
      `SELECT COUNT(*) AS count FROM categories WHERE parent_id = ?`,
      [root?.id || 0],
    );
    console.log(
      JSON.stringify(
        {
          message: "Toy-store category tree imported successfully",
          root_category: root,
          branch_count: Number(children?.count || 0),
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
