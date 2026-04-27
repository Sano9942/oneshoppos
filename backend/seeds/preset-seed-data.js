"use strict";

/**
 * preset-seed-data.js — Seed categories + sample products per industry preset
 *
 * Called during setup wizard after outlet creation. All samples are clearly
 * labeled "(Sample)" so tenants know they can delete them.
 *
 * Guard: skips if products already exist (prevents re-seeding on retry).
 */

const SEED_DATA = {
  general_retail: {
    categories: ["Electronics", "Clothing", "Accessories"],
    products: [
      { name: "T-Shirt (Sample)", price: 1500, category: "Clothing" },
      { name: "Phone Case (Sample)", price: 800, category: "Accessories" },
      { name: "Headphones (Sample)", price: 3500, category: "Electronics" },
      { name: "Watch (Sample)", price: 5000, category: "Accessories" },
      { name: "Backpack (Sample)", price: 2500, category: "Accessories" },
    ],
  },
  grocery: {
    categories: ["Produce", "Dairy", "Snacks"],
    products: [
      { name: "Apples (Sample)", price: 250, category: "Produce" },
      { name: "Milk (Sample)", price: 200, category: "Dairy" },
      { name: "Bread (Sample)", price: 150, category: "Produce" },
      { name: "Chips (Sample)", price: 100, category: "Snacks" },
      { name: "Juice (Sample)", price: 180, category: "Snacks" },
    ],
  },
  wholesale: {
    categories: ["Bulk Items", "Clearance"],
    products: [
      { name: "Bulk Product A (Sample)", price: 10000, category: "Bulk Items" },
      { name: "Bulk Product B (Sample)", price: 15000, category: "Bulk Items" },
      { name: "Clearance Item (Sample)", price: 2000, category: "Clearance" },
    ],
  },
  restaurant: {
    categories: ["Appetizers", "Main Course", "Beverages", "Desserts"],
    products: [
      { name: "Caesar Salad (Sample)", price: 650, category: "Appetizers" },
      { name: "Grilled Chicken (Sample)", price: 1200, category: "Main Course" },
      { name: "Iced Tea (Sample)", price: 300, category: "Beverages" },
      { name: "Chocolate Cake (Sample)", price: 500, category: "Desserts" },
      { name: "Garlic Bread (Sample)", price: 350, category: "Appetizers" },
    ],
  },
  cafe: {
    categories: ["Hot Drinks", "Cold Drinks", "Bakery"],
    products: [
      { name: "Espresso (Sample)", price: 350, category: "Hot Drinks" },
      { name: "Cappuccino (Sample)", price: 450, category: "Hot Drinks" },
      { name: "Iced Latte (Sample)", price: 500, category: "Cold Drinks" },
      { name: "Croissant (Sample)", price: 300, category: "Bakery" },
      { name: "Sandwich (Sample)", price: 600, category: "Bakery" },
    ],
  },
  salon: {
    categories: ["Hair", "Skin", "Nails"],
    products: [
      { name: "Haircut - Men (Sample)", price: 500, category: "Hair" },
      { name: "Haircut - Women (Sample)", price: 1000, category: "Hair" },
      { name: "Hair Coloring (Sample)", price: 3000, category: "Hair" },
      { name: "Facial (Sample)", price: 2000, category: "Skin" },
      { name: "Manicure (Sample)", price: 800, category: "Nails" },
    ],
  },
  clinic: {
    categories: ["Consultation", "Treatment", "Lab Tests"],
    products: [
      { name: "General Checkup (Sample)", price: 2000, category: "Consultation" },
      { name: "Follow-up Visit (Sample)", price: 1000, category: "Consultation" },
      { name: "Blood Test (Sample)", price: 1500, category: "Lab Tests" },
      { name: "X-Ray (Sample)", price: 3000, category: "Lab Tests" },
      { name: "Prescription (Sample)", price: 500, category: "Treatment" },
    ],
  },
  repair_shop: {
    categories: ["Screen Repair", "Battery", "Software"],
    products: [
      { name: "Screen Replacement (Sample)", price: 5000, category: "Screen Repair" },
      { name: "Battery Replacement (Sample)", price: 2000, category: "Battery" },
      { name: "Software Update (Sample)", price: 1000, category: "Software" },
      { name: "Data Recovery (Sample)", price: 3000, category: "Software" },
    ],
  },
  gym: {
    categories: ["Memberships", "Classes"],
    products: [
      { name: "Monthly Basic (Sample)", price: 3000, category: "Memberships" },
      { name: "Monthly Premium (Sample)", price: 5000, category: "Memberships" },
      { name: "Annual Pass (Sample)", price: 30000, category: "Memberships" },
      { name: "Yoga Class (Sample)", price: 800, category: "Classes" },
      { name: "HIIT Class (Sample)", price: 1000, category: "Classes" },
    ],
  },
  photography_studio: {
    categories: ["Packages", "Add-ons"],
    products: [
      { name: "Portrait Session (Sample)", price: 5000, category: "Packages" },
      { name: "Wedding Package (Sample)", price: 50000, category: "Packages" },
      { name: "Event Coverage (Sample)", price: 25000, category: "Packages" },
      { name: "Album Add-on (Sample)", price: 8000, category: "Add-ons" },
    ],
  },
};

/**
 * Seed categories and sample products for a new tenant.
 *
 * @param {object} client - Transaction client (inside db.transaction)
 * @param {string} industryType - One of VALID_INDUSTRY_TYPES
 * @param {number} outletId - The outlet ID to stock products in
 */
async function seedPresetData(client, industryType, outletId) {
  const seed = SEED_DATA[industryType];
  if (!seed) return;

  // Guard: skip if products already exist
  const { rows: [{ count }] } = await client.query("SELECT COUNT(*)::int AS count FROM products");
  if (count > 0) return;

  // Create categories and build name → id map
  const catMap = {};
  for (const catName of seed.categories) {
    const { rows: [cat] } = await client.query(
      "INSERT INTO categories (name) VALUES ($1) RETURNING id",
      [catName]
    );
    catMap[catName] = cat.id;
  }

  // Create products with stock
  for (const item of seed.products) {
    const categoryId = catMap[item.category] || null;
    const { rows: [product] } = await client.query(
      `INSERT INTO products (name, price, category_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [item.name, item.price, categoryId]
    );

    // Seed initial stock at the outlet
    await client.query(
      `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
       VALUES ($1, $2, 100)
       ON CONFLICT (product_id, outlet_id) DO NOTHING`,
      [product.id, outletId]
    );
  }
}

module.exports = { seedPresetData, SEED_DATA };
