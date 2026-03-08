/**
 * seed-60days.js
 *
 * Generates 60 days of realistic store operations data directly into sanopos.db.
 * Backdates all timestamps to simulate Jan 8 – Mar 8, 2026.
 *
 * What it creates:
 *   - 4 new employees (2 per branch: 1 manager + 1 cashier each)
 *   - 6 new suppliers across different categories
 *   - 40+ new products across 8 category trees
 *   - 10 new customers (+ walk-ins)
 *   - 60 days × 2 outlets of: shifts, attendance, 8–18 sales/day, occasional returns
 *   - Weekly purchase orders → GRNs → supplier invoices → payments
 *   - Monthly payroll periods + payroll lines + salary payments
 *   - Leave requests (approved + rejected)
 *   - Stock adjustments (shrinkage, damage, found stock)
 *   - Inter-outlet transfers (bi-weekly)
 *   - Daily expenses (rent, utilities, supplies, etc.)
 *
 * Usage: node backend/seed-60days.js
 * Safe to run once — checks for seed marker before inserting.
 */

'use strict';

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.resolve(__dirname, 'sanopos.db');
const db = new sqlite3.Database(DB_PATH);

// ─── helpers ────────────────────────────────────────────────────────────────

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function serialize(fn) {
  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      try { resolve(await fn()); }
      catch (e) { reject(e); }
    });
  });
}

/** Returns 'YYYY-MM-DD HH:MM:SS' string offset from START_DATE */
const START_DATE = new Date('2026-01-08T00:00:00');

function ts(dayOffset, hour = 9, minute = 0, second = 0) {
  const d = new Date(START_DATE);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, second, 0);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function dateStr(dayOffset) {
  return ts(dayOffset, 0, 0, 0).slice(0, 10);
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  await run('PRAGMA foreign_keys = OFF');
  await run('PRAGMA journal_mode = WAL');

  // ── Guard: don't run twice ──────────────────────────────────────────────
  const marker = await get("SELECT 1 FROM employees WHERE name = 'Zara Khan' LIMIT 1");
  if (marker) {
    console.log('⚠️  Seed already applied (Zara Khan exists). Aborting to prevent duplicates.');
    db.close();
    return;
  }

  console.log('🌱 Starting 60-day data seed...\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: MASTER DATA
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 1A: New Employees ────────────────────────────────────────────────────
  console.log('👥 Creating employees...');

  // Main Store (outlet 1): Manager + Cashier
  const empZara = await run(
    `INSERT INTO employees (name, role, pin_code, role_id, salary_type, monthly_salary, joining_date, department, work_hours_per_day, monthly_leave_allowance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['Zara Khan', 'Manager', '4444', 2, 'monthly', 55000, '2025-06-01', 'Retail', 8, 12]
  );
  const empKamran = await run(
    `INSERT INTO employees (name, role, pin_code, role_id, salary_type, monthly_salary, joining_date, department, work_hours_per_day, monthly_leave_allowance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['Kamran Malik', 'Cashier', '5555', 3, 'monthly', 35000, '2025-08-15', 'Retail', 8, 10]
  );

  // Branch 2 (outlet 2): Manager + Cashier
  const empNadia = await run(
    `INSERT INTO employees (name, role, pin_code, role_id, salary_type, monthly_salary, joining_date, department, work_hours_per_day, monthly_leave_allowance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['Nadia Hussain', 'Manager', '6666', 2, 'monthly', 52000, '2025-07-01', 'Retail', 8, 12]
  );
  const empBilal = await run(
    `INSERT INTO employees (name, role, pin_code, role_id, salary_type, monthly_salary, joining_date, department, work_hours_per_day, monthly_leave_allowance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['Bilal Ahmed', 'Cashier', '7777', 3, 'monthly', 33000, '2025-09-01', 'Retail', 8, 10]
  );

  // Update existing Sara + Ali salaries (they were created without)
  await run(`UPDATE employees SET salary_type='monthly', monthly_salary=30000, work_hours_per_day=8, monthly_leave_allowance=10, joining_date='2025-05-01' WHERE id=2`);
  await run(`UPDATE employees SET salary_type='monthly', monthly_salary=30000, work_hours_per_day=8, monthly_leave_allowance=10, joining_date='2025-05-01' WHERE id=3`);

  // Assign outlets
  // Main Store: Hassan(1), Sara(2), Ali(3), Zara(new), Kamran(new)
  await run(`INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES (?, 1, 1)`, [empZara]);
  await run(`INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES (?, 1, 1)`, [empKamran]);
  // Branch 2: Nadia, Bilal
  await run(`INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES (?, 2, 1)`, [empNadia]);
  await run(`INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES (?, 2, 1)`, [empBilal]);
  // Update Ali to Branch 2 primary
  await run(`UPDATE employee_outlets SET outlet_id=2 WHERE employee_id=3`);

  console.log(`   ✓ Created employees: Zara Khan(${empZara}), Kamran Malik(${empKamran}), Nadia Hussain(${empNadia}), Bilal Ahmed(${empBilal})`);

  // ── 1B: Categories ───────────────────────────────────────────────────────
  console.log('🗂️  Creating categories...');

  // New root categories
  const catFashion    = await run(`INSERT INTO categories (name, parent_id) VALUES ('Fashion', NULL)`);
  const catHomeLiving = await run(`INSERT INTO categories (name, parent_id) VALUES ('Home & Living', NULL)`);
  const catBeauty     = await run(`INSERT INTO categories (name, parent_id) VALUES ('Beauty & Personal Care', NULL)`);
  const catSports     = await run(`INSERT INTO categories (name, parent_id) VALUES ('Sports & Fitness', NULL)`);
  const catFood       = await run(`INSERT INTO categories (name, parent_id) VALUES ('Food & Beverages', NULL)`);

  // Fashion children
  const catMensWear   = await run(`INSERT INTO categories (name, parent_id) VALUES ('Men''s Wear', ?)`, [catFashion]);
  const catWomensWear = await run(`INSERT INTO categories (name, parent_id) VALUES ('Women''s Wear', ?)`, [catFashion]);
  const catFootwear   = await run(`INSERT INTO categories (name, parent_id) VALUES ('Footwear', ?)`, [catFashion]);

  // Home & Living children
  const catKitchen    = await run(`INSERT INTO categories (name, parent_id) VALUES ('Kitchen', ?)`, [catHomeLiving]);
  const catBedding    = await run(`INSERT INTO categories (name, parent_id) VALUES ('Bedding', ?)`, [catHomeLiving]);
  const catDecor      = await run(`INSERT INTO categories (name, parent_id) VALUES ('Decor', ?)`, [catHomeLiving]);

  // Beauty children
  const catSkinCare   = await run(`INSERT INTO categories (name, parent_id) VALUES ('Skin Care', ?)`, [catBeauty]);
  const catHairCare   = await run(`INSERT INTO categories (name, parent_id) VALUES ('Hair Care', ?)`, [catBeauty]);
  const catFragrance  = await run(`INSERT INTO categories (name, parent_id) VALUES ('Fragrance', ?)`, [catBeauty]);

  // Sports children
  const catOutdoor    = await run(`INSERT INTO categories (name, parent_id) VALUES ('Outdoor', ?)`, [catSports]);
  const catGym        = await run(`INSERT INTO categories (name, parent_id) VALUES ('Gym Equipment', ?)`, [catSports]);

  // Food children
  const catDairy      = await run(`INSERT INTO categories (name, parent_id) VALUES ('Dairy', ?)`, [catFood]);
  const catBeverages  = await run(`INSERT INTO categories (name, parent_id) VALUES ('Beverages', ?)`, [catFood]);
  const catBakery     = await run(`INSERT INTO categories (name, parent_id) VALUES ('Bakery', ?)`, [catFood]);

  // Electronics children (add to existing cat 2)
  const catLaptops    = await run(`INSERT INTO categories (name, parent_id) VALUES ('Laptops', 2)`);
  const catAudio      = await run(`INSERT INTO categories (name, parent_id) VALUES ('Audio', 2)`);
  const catWearables  = await run(`INSERT INTO categories (name, parent_id) VALUES ('Wearables', 2)`);

  console.log('   ✓ Categories created');

  // ── 1C: Brands ───────────────────────────────────────────────────────────
  console.log('🏷️  Creating brands...');
  const brandNike     = await run(`INSERT INTO brands (name) VALUES ('Nike')`);
  const brandAdidas   = await run(`INSERT INTO brands (name) VALUES ('Adidas')`);
  const brandDell     = await run(`INSERT INTO brands (name) VALUES ('Dell')`);
  const brandSony     = await run(`INSERT INTO brands (name) VALUES ('Sony')`);
  const brandLGElec   = await run(`INSERT INTO brands (name) VALUES ('LG')`);
  const brandNestle   = await run(`INSERT INTO brands (name) VALUES ('Nestle')`);
  const brandUnilever = await run(`INSERT INTO brands (name) VALUES ('Unilever')`);
  const brandPG       = await run(`INSERT INTO brands (name) VALUES ('P&G')`);
  const brandGulAhmed = await run(`INSERT INTO brands (name) VALUES ('Gul Ahmed')`);
  const brandJShoppe  = await run(`INSERT INTO brands (name) VALUES ('J.')`);
  console.log('   ✓ Brands created');

  // ── 1D: Suppliers ────────────────────────────────────────────────────────
  console.log('🚚 Creating suppliers...');
  const supFashionHub  = await run(
    `INSERT INTO suppliers (name, contact_person, phone, email, payment_terms, credit_days, credit_limit)
     VALUES ('Fashion Hub Wholesale', 'Amjad Raza', '0321-1234567', 'amjad@fashionhub.pk', 'credit', 30, 200000)`
  );
  const supHomeDeco    = await run(
    `INSERT INTO suppliers (name, contact_person, phone, email, payment_terms, credit_days, credit_limit)
     VALUES ('HomeDecor Traders', 'Sana Mirza', '0333-9876543', 'sana@homedeco.pk', 'credit', 15, 150000)`
  );
  const supBeautyWorld = await run(
    `INSERT INTO suppliers (name, contact_person, phone, email, payment_terms, credit_days, credit_limit)
     VALUES ('BeautyWorld Distributors', 'Farrukh Ali', '0311-5556677', 'farrukh@beautyworld.pk', 'cash', 0, 0)`
  );
  const supSportZone   = await run(
    `INSERT INTO suppliers (name, contact_person, phone, email, payment_terms, credit_days, credit_limit)
     VALUES ('SportZone Supply Co.', 'Omar Sheikh', '0345-2223344', 'omar@sportzone.pk', 'credit', 30, 120000)`
  );
  const supFoodExpress = await run(
    `INSERT INTO suppliers (name, contact_person, phone, email, payment_terms, credit_days, credit_limit)
     VALUES ('Food Express Distributors', 'Rabia Noor', '0312-8889900', 'rabia@foodexpress.pk', 'cash', 0, 50000)`
  );
  const supEliteElec   = await run(
    `INSERT INTO suppliers (name, contact_person, phone, email, payment_terms, credit_days, credit_limit)
     VALUES ('Elite Electronics Wholesale', 'Tariq Mahmood', '0300-1112233', 'tariq@eliteelec.pk', 'credit', 45, 500000)`
  );
  console.log('   ✓ Suppliers created');

  // ── 1E: Products ─────────────────────────────────────────────────────────
  console.log('📦 Creating products...');

  const taxGST17 = 3; // existing GST 17%
  const taxGST18 = 2; // existing Standard GST 18%
  const taxExempt = 1; // existing Exempt

  // Helper to insert product + outlet_stock for both outlets
  async function addProduct(name, sku, barcode, price, cost, catId, brandId, suppId, taxId, stockMain, stockBranch) {
    const pid = await run(
      `INSERT INTO products (name, sku, barcode, price, cost_price, category_id, brand_id, supplier_id, tax_id, stock, status, has_variants, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, 'pcs')`,
      [name, sku, barcode, price, cost, catId, brandId, suppId, taxId, stockMain + stockBranch]
    );
    // outlet stock
    await run(`INSERT OR REPLACE INTO outlet_stock (product_id, outlet_id, quantity) VALUES (?, 1, ?)`, [pid, stockMain]);
    await run(`INSERT OR REPLACE INTO outlet_stock (product_id, outlet_id, quantity) VALUES (?, 2, ?)`, [pid, stockBranch]);
    return pid;
  }

  // Fashion – Men's Wear
  const pKurtaWhite  = await addProduct('White Kurta (Men)', 'KRT-WHT-M', '5901234123457', 1800, 900, catMensWear, brandGulAhmed, supFashionHub, taxExempt, 40, 30);
  const pShalwarSuit = await addProduct('Shalwar Suit (Men)', 'SHW-BLU-M', '5901234123458', 3200, 1600, catMensWear, brandJShoppe, supFashionHub, taxExempt, 25, 20);
  const pJeansMen    = await addProduct('Slim Fit Jeans (Men)', 'JNS-BLK-M', '5901234123459', 2500, 1200, catMensWear, brandAdidas, supFashionHub, taxExempt, 30, 25);

  // Fashion – Women's Wear
  const pKurtaWomen  = await addProduct('Printed Lawn Kurta (Women)', 'KRT-LWN-W', '5901234123460', 2200, 1100, catWomensWear, brandGulAhmed, supFashionHub, taxExempt, 35, 30);
  const pAbaya       = await addProduct('Classic Abaya', 'ABY-BLK-W', '5901234123461', 4500, 2200, catWomensWear, brandGulAhmed, supFashionHub, taxExempt, 20, 15);

  // Fashion – Footwear
  const pNikeShoe    = await addProduct('Nike Air Max (Men)', 'NIK-AIR-43', '5901234123462', 12000, 7500, catFootwear, brandNike, supFashionHub, taxGST17, 15, 10);
  const pAdidasShoe  = await addProduct('Adidas Ultraboost (Women)', 'ADI-ULT-38', '5901234123463', 14000, 8800, catFootwear, brandAdidas, supFashionHub, taxGST17, 12, 8);

  // Home & Living – Kitchen
  const pNonstickPan = await addProduct('Non-Stick Frying Pan 28cm', 'NSP-28CM', '5901234123464', 2800, 1400, catKitchen, brandLGElec, supHomeDeco, taxGST17, 20, 15);
  const pKnifeSet    = await addProduct('Stainless Steel Knife Set (5pc)', 'KNF-SET-5', '5901234123465', 1800, 900, catKitchen, brandLGElec, supHomeDeco, taxGST17, 25, 20);
  const pMug         = await addProduct('Ceramic Coffee Mug 350ml', 'MUG-CRM-350', '5901234123466', 350, 150, catKitchen, brandLGElec, supHomeDeco, taxExempt, 60, 50);

  // Home & Living – Bedding
  const pBedSheet    = await addProduct('King Size Bed Sheet (Cotton)', 'BDS-KNG-CTN', '5901234123467', 3500, 1800, catBedding, brandGulAhmed, supHomeDeco, taxExempt, 20, 15);
  const pPillow      = await addProduct('Microfiber Pillow (Pair)', 'PLW-MFB-2', '5901234123468', 1200, 600, catBedding, brandGulAhmed, supHomeDeco, taxExempt, 30, 25);

  // Home & Living – Decor
  const pWallClock   = await addProduct('Wooden Wall Clock 30cm', 'WCK-WD-30', '5901234123469', 2200, 1100, catDecor, brandLGElec, supHomeDeco, taxGST17, 15, 12);

  // Beauty – Skin Care
  const pFaceWash    = await addProduct('Himalaya Face Wash 150ml', 'FCW-HIM-150', '5901234123470', 380, 200, catSkinCare, brandPG, supBeautyWorld, taxExempt, 50, 40);
  const pMoisturizer = await addProduct('Nivea Daily Moisturizer 100ml', 'MST-NIV-100', '5901234123471', 750, 400, catSkinCare, brandUnilever, supBeautyWorld, taxExempt, 40, 35);
  const pSunscreen   = await addProduct('SPF 50+ Sunscreen 75ml', 'SUN-SPF50-75', '5901234123472', 1200, 650, catSkinCare, brandPG, supBeautyWorld, taxExempt, 30, 25);

  // Beauty – Hair Care
  const pShampoo     = await addProduct('Sunsilk Shampoo 350ml', 'SHP-SNL-350', '5901234123473', 450, 250, catHairCare, brandUnilever, supBeautyWorld, taxExempt, 60, 50);
  const pConditioner = await addProduct('TRESemmé Conditioner 200ml', 'CDT-TRS-200', '5901234123474', 550, 300, catHairCare, brandUnilever, supBeautyWorld, taxExempt, 50, 40);

  // Beauty – Fragrance
  const pPerfume     = await addProduct('Lattafa Oud Perfume 100ml', 'PRF-LAT-100', '5901234123475', 3500, 1800, catFragrance, brandPG, supBeautyWorld, taxGST17, 20, 15);

  // Sports – Outdoor
  const pFootball    = await addProduct('Adidas Football (Size 5)', 'FBL-ADI-5', '5901234123476', 3500, 1800, catOutdoor, brandAdidas, supSportZone, taxExempt, 20, 15);
  const pCricketBat  = await addProduct('Cricket Bat (Hardball)', 'CKT-BAT-HB', '5901234123477', 6500, 3500, catOutdoor, brandNike, supSportZone, taxExempt, 15, 10);
  const pSportsKit   = await addProduct('Sports Kit Bag', 'SPK-BAG-L', '5901234123478', 2800, 1400, catOutdoor, brandNike, supSportZone, taxGST17, 12, 8);

  // Sports – Gym
  const pDumbbell    = await addProduct('Dumbbell Set 5kg Pair', 'DMB-5KG-PR', '5901234123479', 4500, 2500, catGym, brandAdidas, supSportZone, taxGST17, 10, 8);
  const pYogaMat     = await addProduct('Yoga Mat Non-Slip 6mm', 'YGM-NSL-6MM', '5901234123480', 1800, 900, catGym, brandNike, supSportZone, taxGST17, 15, 12);

  // Food – Dairy
  const pMilk        = await addProduct('Nestle Milk Pack 1L', 'MLK-NST-1L', '5901234123481', 220, 160, catDairy, brandNestle, supFoodExpress, taxExempt, 80, 60);
  const pYogurt      = await addProduct('Nestle Plain Yogurt 400g', 'YGT-NST-400', '5901234123482', 180, 130, catDairy, brandNestle, supFoodExpress, taxExempt, 60, 50);
  const pCheese      = await addProduct('Adams Cheddar Cheese 200g', 'CHS-ADM-200', '5901234123483', 450, 320, catDairy, brandNestle, supFoodExpress, taxExempt, 40, 30);

  // Food – Beverages
  const pJuice       = await addProduct('Nestle Fruita Vitals Mango 200ml', 'JCE-FRV-200', '5901234123484', 90, 55, catBeverages, brandNestle, supFoodExpress, taxExempt, 120, 100);
  const pCoke        = await addProduct('Coca-Cola 1.5L', 'CCL-1500ML', '5901234123485', 200, 130, catBeverages, brandNestle, supFoodExpress, taxExempt, 100, 80);
  const pGreenTea    = await addProduct('Lipton Green Tea 25 bags', 'TEA-LPT-25', '5901234123486', 280, 180, catBeverages, brandUnilever, supFoodExpress, taxExempt, 50, 40);

  // Food – Bakery
  const pBread       = await addProduct('English Bread Loaf 400g', 'BRD-ENG-400', '5901234123487', 120, 80, catBakery, brandNestle, supFoodExpress, taxExempt, 60, 50);
  const pCookies     = await addProduct('LU Prince Cookies 100g', 'CKE-LU-100', '5901234123488', 80, 50, catBakery, brandNestle, supFoodExpress, taxExempt, 100, 80);

  // Electronics – Laptops
  const pDellLaptop  = await addProduct('Dell Inspiron 15 (Core i5)', 'DLL-INS-I5', '5901234123489', 120000, 95000, catLaptops, brandDell, supEliteElec, taxGST17, 8, 5);

  // Electronics – Audio
  const pSonyBT      = await addProduct('Sony WH-1000XM5 Headphones', 'SNY-WH-1000', '5901234123490', 55000, 38000, catAudio, brandSony, supEliteElec, taxGST17, 10, 6);
  const pJBLSpeaker  = await addProduct('JBL Flip 6 Portable Speaker', 'JBL-FLP-6', '5901234123491', 18000, 11000, catAudio, brandSony, supEliteElec, taxGST17, 12, 8);

  // Electronics – Wearables
  const pSmartWatch  = await addProduct('Samsung Galaxy Watch 6', 'SMG-WCH-6', '5901234123492', 45000, 32000, catWearables, brandNike, supEliteElec, taxGST17, 8, 5);
  const pFitnessBand = await addProduct('Xiaomi Mi Band 8', 'XMI-MBD-8', '5901234123493', 6500, 4000, catWearables, brandSony, supEliteElec, taxGST17, 15, 10);

  console.log('   ✓ 35+ products created');

  // ── 1F: Customers ────────────────────────────────────────────────────────
  console.log('👤 Creating customers...');
  const customers = [];
  const custData = [
    ['Ahmed Raza', '0300-1111111', 'ahmed@email.com'],
    ['Fatima Malik', '0321-2222222', 'fatima@email.com'],
    ['Usman Ali', '0333-3333333', 'usman@email.com'],
    ['Ayesha Khan', '0345-4444444', 'ayesha@email.com'],
    ['Bilal Chaudhry', '0311-5555555', 'bilal@email.com'],
    ['Sobia Tariq', '0312-6666666', 'sobia@email.com'],
    ['Hamza Iqbal', '0316-7777777', 'hamza@email.com'],
    ['Maria Sheikh', '0317-8888888', 'maria@email.com'],
    ['Tariq Bashir', '0318-9999999', 'tariq@email.com'],
    ['Hina Javed', '0319-0000000', 'hina@email.com'],
  ];
  for (const [name, mobile, email] of custData) {
    const cid = await run(
      `INSERT INTO customers (name, mobile, email, created_at) VALUES (?, ?, ?, ?)`,
      [name, mobile, email, ts(0, 9, 0, 0)]
    );
    customers.push(cid);
  }
  console.log('   ✓ 10 customers created');

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: REFERENCE DATA
  // ═══════════════════════════════════════════════════════════════════════════

  // All products with price/cost for sale generation
  const allProducts = await all(`
    SELECT p.id, p.name, p.price, p.cost_price, p.has_variants, p.tax_id
    FROM products p
    WHERE p.status = 'active' AND p.has_variants = 0
  `);

  // Product variants for T-shirt
  const tshirtVariants = await all(`SELECT id, price, cost_price FROM product_variants WHERE product_id = 8 LIMIT 6`);

  // Per-outlet product pools (only products with outlet_stock > 0)
  async function getOutletProducts(outletId) {
    return await all(`
      SELECT p.id, p.name, p.price, p.cost_price, p.has_variants, p.tax_id,
             os.quantity as stock
      FROM products p
      JOIN outlet_stock os ON os.product_id = p.id AND os.outlet_id = ?
      WHERE p.status = 'active' AND p.has_variants = 0 AND os.quantity > 0
    `, [outletId]);
  }

  // ── Outlet configurations ─────────────────────────────────────────────────
  const outlets = [
    {
      id: 1,
      name: 'Main Store',
      employees: [
        { id: 1, name: 'Hassan', role: 'admin' },
        { id: empZara, name: 'Zara Khan', role: 'manager' },
        { id: empKamran, name: 'Kamran Malik', role: 'cashier' },
        { id: 2, name: 'Sara', role: 'cashier' },
      ],
      cashiers: [empKamran, 2, empZara],  // who opens shifts
      allStaff: [1, empZara, empKamran, 2],
    },
    {
      id: 2,
      name: 'Branch 2',
      employees: [
        { id: empNadia, name: 'Nadia Hussain', role: 'manager' },
        { id: empBilal, name: 'Bilal Ahmed', role: 'cashier' },
        { id: 3, name: 'Ali', role: 'cashier' },
      ],
      cashiers: [empNadia, empBilal, 3],
      allStaff: [empNadia, empBilal, 3],
    },
  ];

  // ── Utility: get/ensure outlet_stock ──────────────────────────────────────
  async function getStock(productId, outletId) {
    const row = await get(`SELECT quantity FROM outlet_stock WHERE product_id=? AND outlet_id=?`, [productId, outletId]);
    return row ? row.quantity : 0;
  }

  async function adjustStock(productId, outletId, delta) {
    const existing = await get(`SELECT id FROM outlet_stock WHERE product_id=? AND outlet_id=?`, [productId, outletId]);
    if (existing) {
      await run(`UPDATE outlet_stock SET quantity = MAX(0, quantity + ?) WHERE product_id=? AND outlet_id=?`, [delta, productId, outletId]);
    } else if (delta > 0) {
      await run(`INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (?, ?, ?)`, [productId, outletId, delta]);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: 60-DAY OPERATIONS LOOP
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n📅 Generating 60 days of operations (Jan 8 – Mar 8, 2026)...\n');

  const DAYS = 60;
  // Sunday = 0. Fridays (5) are half-days, stores close earlier.
  // Store is closed every Sunday.

  const paymentMethods = ['cash', 'card', 'split'];
  const denominations = [10, 20, 50, 100, 500, 1000, 5000];

  function makeDenominations(targetAmount) {
    // Build a realistic denomination breakdown
    const result = [];
    let remaining = targetAmount;
    for (const denom of [5000, 1000, 500, 100, 50, 20, 10].filter(d => d <= targetAmount || d === 10)) {
      const count = Math.min(Math.floor(remaining / denom), rand(1, 8));
      if (count > 0) {
        result.push({ denomination: denom, count });
        remaining -= denom * count;
      }
      if (remaining <= 0) break;
    }
    return result;
  }

  let invoiceCounter = 1000;
  let grnCounter = 1000;
  let poCounter = 100;

  // Track weekly PO suppliers to cycle through
  const poSuppliers = [
    { id: 1, name: 'Tech Distributors', productIds: [1, 2, 4, 6] },
    { id: supFashionHub, name: 'Fashion Hub', productIds: [pKurtaWhite, pShalwarSuit, pJeansMen, pKurtaWomen, pAbaya] },
    { id: supHomeDeco, name: 'HomeDecor', productIds: [pNonstickPan, pBedSheet, pPillow, pWallClock] },
    { id: supBeautyWorld, name: 'BeautyWorld', productIds: [pFaceWash, pMoisturizer, pShampoo, pConditioner, pPerfume] },
    { id: supSportZone, name: 'SportZone', productIds: [pFootball, pCricketBat, pDumbbell, pYogaMat] },
    { id: supFoodExpress, name: 'FoodExpress', productIds: [pMilk, pYogurt, pJuice, pCoke, pBread, pCookies] },
    { id: supEliteElec, name: 'EliteElec', productIds: [pDellLaptop, pSonyBT, pSmartWatch, pFitnessBand] },
  ];

  // Leave requests — a few per month
  const leaveRequests = [
    { empId: empKamran, type: 'annual', startDay: 5, endDay: 6, reason: 'Family event', status: 'approved', approvedBy: empZara },
    { empId: 2, type: 'sick', startDay: 10, endDay: 10, reason: 'Fever and cold', status: 'approved', approvedBy: 1 },
    { empId: empBilal, type: 'annual', startDay: 18, endDay: 19, reason: 'Personal trip', status: 'approved', approvedBy: empNadia },
    { empId: 3, type: 'sick', startDay: 25, endDay: 25, reason: 'Food poisoning', status: 'approved', approvedBy: empNadia },
    { empId: empZara, type: 'annual', startDay: 33, endDay: 35, reason: 'Wedding', status: 'approved', approvedBy: 1 },
    { empId: empKamran, type: 'annual', startDay: 40, endDay: 42, reason: 'Vacation', status: 'rejected', approvedBy: empZara, rejectionNote: 'Peak season — cannot approve' },
    { empId: empNadia, type: 'sick', startDay: 50, endDay: 50, reason: 'Migraine', status: 'approved', approvedBy: 1 },
    { empId: empBilal, type: 'annual', startDay: 55, endDay: 56, reason: 'Family function', status: 'approved', approvedBy: empNadia },
  ];

  // Insert leave requests
  for (const lr of leaveRequests) {
    const days = lr.endDay - lr.startDay + 1;
    await run(
      `INSERT INTO leave_requests (employee_id, type, start_date, end_date, days, reason, status, approved_by, approved_at, rejection_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lr.empId, lr.type,
        dateStr(lr.startDay), dateStr(lr.endDay),
        days, lr.reason, lr.status,
        lr.approvedBy,
        lr.status !== 'pending' ? ts(lr.startDay - 1, 17, 0, 0) : null,
        lr.rejectionNote || null,
        ts(lr.startDay - 2, 10, 0, 0),
      ]
    );
  }
  console.log(`   ✓ Leave requests inserted`);

  // Days employees are on approved leave (to skip attendance)
  const onLeave = {};
  for (const lr of leaveRequests) {
    if (lr.status === 'approved') {
      for (let d = lr.startDay; d <= lr.endDay; d++) {
        if (!onLeave[d]) onLeave[d] = new Set();
        onLeave[d].add(lr.empId);
      }
    }
  }

  // ── Main day loop ─────────────────────────────────────────────────────────
  for (let day = 0; day < DAYS; day++) {
    const date = new Date(START_DATE);
    date.setDate(date.getDate() + day);
    const dayOfWeek = date.getDay(); // 0=Sun
    const isSunday = dayOfWeek === 0;
    const isFriday = dayOfWeek === 5;

    if (isSunday) continue; // store closed

    const closeHour = isFriday ? 14 : 21; // Friday half-day
    const openHour = 9;

    process.stdout.write(`  Day ${String(day).padStart(2)} (${dateStr(day)}): `);

    // ── PO: every 8 days, create a PO for one supplier ─────────────────────
    if (day > 0 && day % 8 === 0) {
      const supplier = poSuppliers[Math.floor(day / 8) % poSuppliers.length];
      const items = shuffle(supplier.productIds).slice(0, rand(2, 4));
      let totalCost = 0;
      const poItems = [];
      for (const pid of items) {
        const qty = rand(10, 30);
        const prod = await get(`SELECT cost_price FROM products WHERE id=?`, [pid]);
        if (!prod) continue;
        const cost = prod.cost_price;
        totalCost += cost * qty;
        poItems.push({ pid, qty, cost });
      }

      poCounter++;
      const poId = await run(
        `INSERT INTO purchase_orders (supplier_id, status, total_cost, created_at, due_date)
         VALUES (?, 'received', ?, ?, ?)`,
        [supplier.id, totalCost, ts(day, 10, 0, 0), dateStr(day + 14)]
      );

      for (const item of poItems) {
        await run(
          `INSERT INTO purchase_order_items (po_id, product_id, quantity, cost_price) VALUES (?, ?, ?, ?)`,
          [poId, item.pid, item.qty, item.cost]
        );
      }

      // GRN (received 2 days after PO)
      grnCounter++;
      const grnId = await run(
        `INSERT INTO goods_received_notes (grn_number, po_id, outlet_id, received_by, received_at, notes)
         VALUES (?, ?, 1, 1, ?, 'Auto-received via purchase order')`,
        [`GRN-${grnCounter}`, poId, ts(day + 2, 11, 0, 0)]
      );

      for (const item of poItems) {
        await run(
          `INSERT INTO grn_items (grn_id, product_id, qty_ordered, qty_received, cost_price)
           VALUES (?, ?, ?, ?, ?)`,
          [grnId, item.pid, item.qty, item.qty, item.cost]
        );
        // Increase stock in main outlet
        await adjustStock(item.pid, 1, item.qty);
      }

      // Supplier invoice
      invoiceCounter++;
      const invId = await run(
        `INSERT INTO supplier_invoices (supplier_id, po_id, grn_id, invoice_number, amount, status, due_date, created_at)
         VALUES (?, ?, ?, ?, ?, 'paid', ?, ?)`,
        [supplier.id, poId, grnId, `INV-${invoiceCounter}`, totalCost, dateStr(day + 14), ts(day + 2, 12, 0, 0)]
      );

      // Payment (paid within 7 days)
      await run(
        `INSERT INTO supplier_payments (supplier_invoice_id, supplier_id, amount, payment_method, reference, paid_by, paid_at, notes)
         VALUES (?, ?, ?, 'bank_transfer', ?, 1, ?, 'Payment via bank transfer')`,
        [invId, supplier.id, totalCost, `PAY-${invoiceCounter}`, ts(day + 7, 14, 0, 0)]
      );
    }

    // ── Inter-outlet transfer every 14 days ──────────────────────────────
    if (day > 0 && day % 14 === 0) {
      // Transfer some fast-moving items from main to branch
      const transferItems = [pMilk, pCoke, pBread, pCookies, 3]; // snacks + dairy
      for (const pid of transferItems.slice(0, 3)) {
        const stock = await getStock(pid, 1);
        if (stock >= 20) {
          const qty = rand(5, 15);
          await run(
            `INSERT INTO inventory_transfers (product_id, from_outlet_id, to_outlet_id, quantity, employee_id, note, timestamp, status)
             VALUES (?, 1, 2, ?, 1, 'Replenish Branch 2', ?, 'completed')`,
            [pid, qty, ts(day, 10, 30, 0)]
          );
          await adjustStock(pid, 1, -qty);
          await adjustStock(pid, 2, qty);
        }
      }
    }

    // ── Stock adjustments (monthly, simulating shrinkage/damage) ──────────
    if (day > 0 && day % 30 === 0) {
      const shrinkItems = [pMilk, pYogurt, pBread, 3]; // perishables
      for (const pid of shrinkItems) {
        const qty = rand(2, 8);
        await run(
          `INSERT INTO stock_adjustments (product_id, outlet_id, employee_id, quantity_change, reason, timestamp)
           VALUES (?, 1, 1, ?, 'Expired/damaged goods written off', ?)`,
          [pid, -qty, ts(day, 9, 30, 0)]
        );
        await adjustStock(pid, 1, -qty);
      }
    }

    // ── Per-outlet operations ────────────────────────────────────────────
    for (const outlet of outlets) {
      const outletProds = await getOutletProducts(outlet.id);
      if (outletProds.length === 0) continue;

      // Who is working today (exclude those on leave)
      const workingStaff = outlet.allStaff.filter(eid => !(onLeave[day] && onLeave[day].has(eid)));
      const workingCashiers = outlet.cashiers.filter(eid => workingStaff.includes(eid));

      if (workingCashiers.length === 0) continue;

      const shiftOpener = workingCashiers[0];
      const openingFloat = rand(10000, 20000);

      // ── Open shift ───────────────────────────────────────────────────
      const shiftId = await run(
        `INSERT INTO cash_shifts (outlet_id, employee_id, opening_float, status, opened_at)
         VALUES (?, ?, ?, 'closed', ?)`,
        [outlet.id, shiftOpener, openingFloat, ts(day, openHour, rand(0, 15), 0)]
      );

      // Opening denominations
      const openDenoms = makeDenominations(openingFloat);
      for (const d of openDenoms) {
        await run(
          `INSERT INTO shift_denominations (shift_id, denomination, count, stage) VALUES (?, ?, ?, 'opening')`,
          [shiftId, d.denomination, d.count]
        );
      }

      // ── Attendance clock-in ─────────────────────────────────────────
      const attendIds = {};
      for (const empId of workingStaff) {
        const clockInMin = rand(0, 20);
        const attId = await run(
          `INSERT INTO employee_attendance (employee_id, outlet_id, check_in, status)
           VALUES (?, ?, ?, 'present')`,
          [empId, outlet.id, ts(day, openHour, clockInMin, 0)]
        );
        attendIds[empId] = attId;

        // Attendance session
        await run(
          `INSERT INTO attendance_sessions (attendance_id, employee_id, outlet_id, session_type, session_start)
           VALUES (?, ?, ?, 'clock_in', ?)`,
          [attId, empId, outlet.id, ts(day, openHour, clockInMin, 0)]
        );
      }

      // ── Sales for the day ────────────────────────────────────────────
      const salesCount = isFriday ? rand(5, 10) : rand(8, 18);
      let cashInFromSales = 0;

      for (let s = 0; s < salesCount; s++) {
        const saleHour = rand(openHour + 1, closeHour - 1);
        const saleMin = rand(0, 59);
        const saleCashier = pick(workingCashiers);

        // Pick 1-4 random products
        const cartSize = rand(1, 4);
        const cartProds = shuffle(outletProds).slice(0, cartSize);
        if (cartProds.length === 0) continue;

        let saleTotal = 0;
        const saleItemsData = [];

        for (const prod of cartProds) {
          const qty = rand(1, 3);
          const stock = await getStock(prod.id, outlet.id);
          if (stock < qty) continue;
          saleTotal += prod.price * qty;
          saleItemsData.push({ prod, qty });
        }

        if (saleItemsData.length === 0 || saleTotal === 0) continue;

        // Random discount sometimes
        const discountApplied = Math.random() < 0.15;
        const discountAmt = discountApplied ? Math.round(saleTotal * 0.05) : 0;
        const finalTotal = saleTotal - discountAmt;

        // Payment method
        let payMethod = pick(paymentMethods);
        if (finalTotal > 50000) payMethod = 'card'; // large purchases on card

        invoiceCounter++;
        const custId = Math.random() < 0.3 ? pick(customers) : null;

        const saleId = await run(
          `INSERT INTO sales (total_amount, payment_method, timestamp, outlet_id, employee_id, voided, customer_id, discount_amount, discount_type, invoice_number, shift_id)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
          [
            finalTotal, payMethod, ts(day, saleHour, saleMin, rand(0, 59)),
            outlet.id, saleCashier, custId,
            discountAmt, discountApplied ? 'percentage' : null,
            `INV-${invoiceCounter}`, shiftId,
          ]
        );

        // Sale items + stock deduction
        for (const { prod, qty } of saleItemsData) {
          await run(
            `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, cost_price_at_sale)
             VALUES (?, ?, ?, ?, ?)`,
            [saleId, prod.id, qty, prod.price, prod.cost_price]
          );
          await adjustStock(prod.id, outlet.id, -qty);
        }

        // Sale payments
        if (payMethod === 'split') {
          const cashPart = Math.round(finalTotal * 0.5);
          const cardPart = finalTotal - cashPart;
          await run(`INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES (?, 'cash', ?)`, [saleId, cashPart]);
          await run(`INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES (?, 'card', ?)`, [saleId, cardPart]);
          cashInFromSales += cashPart;
        } else {
          await run(`INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES (?, ?, ?)`, [saleId, payMethod, finalTotal]);
          if (payMethod === 'cash') cashInFromSales += finalTotal;
        }
      }

      // ── Occasional return (1 per week per outlet) ────────────────────
      if (day % 7 === 3 && outletProds.length > 0) {
        // Find the most recent sale with items for this outlet
        const recentSale = await get(
          `SELECT s.id, s.employee_id, s.customer_id, s.shift_id FROM sales s
           WHERE s.outlet_id=? AND s.voided=0
           ORDER BY s.timestamp DESC LIMIT 1`,
          [outlet.id]
        );
        if (recentSale) {
          const returnItem = await get(
            `SELECT si.product_id, si.price_at_sale, si.cost_price_at_sale FROM sale_items si
             WHERE si.sale_id=? LIMIT 1`,
            [recentSale.id]
          );
          if (returnItem) {
            const retQty = 1;
            const refundAmt = returnItem.price_at_sale * retQty;
            const returnId = await run(
              `INSERT INTO returns (original_sale_id, outlet_id, employee_id, customer_id, total_refund, refund_method, reason, timestamp, shift_id)
               VALUES (?, ?, ?, ?, ?, 'cash', 'Customer changed mind', ?, ?)`,
              [recentSale.id, outlet.id, pick(workingCashiers), recentSale.customer_id,
               refundAmt, ts(day, rand(11, 16), rand(0, 59), 0), shiftId]
            );
            await run(
              `INSERT INTO return_items (return_id, product_id, quantity, refund_price) VALUES (?, ?, ?, ?)`,
              [returnId, returnItem.product_id, retQty, returnItem.price_at_sale]
            );
            await adjustStock(returnItem.product_id, outlet.id, retQty);
          }
        }
      }

      // ── Daily expenses ───────────────────────────────────────────────
      // Rent: first of every month (day 0, 30)
      if (day % 30 < 2) {
        await run(
          `INSERT INTO expenses (category_id, outlet_id, shift_id, employee_id, amount, description, expense_date, created_at)
           VALUES (1, ?, ?, 1, ?, 'Monthly rent payment', ?, ?)`,
          [outlet.id, shiftId, outlet.id === 1 ? 80000 : 55000, dateStr(day), ts(day, 10, 0, 0)]
        );
      }

      // Utilities: weekly
      if (day % 7 === 1) {
        await run(
          `INSERT INTO expenses (category_id, outlet_id, shift_id, employee_id, amount, description, expense_date, created_at)
           VALUES (2, ?, ?, ?, ?, 'Electricity & internet bill', ?, ?)`,
          [outlet.id, shiftId, pick(workingStaff), rand(8000, 15000), dateStr(day), ts(day, 11, 0, 0)]
        );
      }

      // Supplies: random days
      if (Math.random() < 0.25) {
        await run(
          `INSERT INTO expenses (category_id, outlet_id, shift_id, employee_id, amount, description, expense_date, created_at)
           VALUES (5, ?, ?, ?, ?, 'Packaging and stationery', ?, ?)`,
          [outlet.id, shiftId, pick(workingStaff), rand(1500, 4000), dateStr(day), ts(day, 14, 0, 0)]
        );
      }

      // Marketing: bi-weekly
      if (day % 14 === 6 && outlet.id === 1) {
        await run(
          `INSERT INTO expenses (category_id, outlet_id, shift_id, employee_id, amount, description, expense_date, created_at)
           VALUES (4, ?, ?, 1, ?, 'Social media promotion and flyers', ?, ?)`,
          [outlet.id, shiftId, rand(5000, 12000), dateStr(day), ts(day, 15, 0, 0)]
        );
      }

      // ── Clock out ────────────────────────────────────────────────────
      for (const empId of workingStaff) {
        const clockOutMin = rand(0, 30);
        // Update attendance
        const hoursWorked = closeHour - openHour + (clockOutMin / 60) - 0.25;
        await run(
          `UPDATE employee_attendance SET check_out=?, hours=?, status='present' WHERE id=?`,
          [ts(day, closeHour, clockOutMin, 0), Math.round(hoursWorked * 10) / 10, attendIds[empId]]
        );
        // Close attendance session
        await run(
          `UPDATE attendance_sessions SET session_end=?, duration_hours=?
           WHERE employee_id=? AND outlet_id=? AND session_end IS NULL`,
          [ts(day, closeHour, clockOutMin, 0), Math.round(hoursWorked * 10) / 10, empId, outlet.id]
        );
      }

      // ── Close shift ──────────────────────────────────────────────────
      const closingCash = openingFloat + cashInFromSales - rand(0, 2000);
      const expectedCash = openingFloat + cashInFromSales;
      const variance = closingCash - expectedCash;
      const closeDenomsData = makeDenominations(Math.max(closingCash, 0));

      await run(
        `UPDATE cash_shifts SET closing_cash=?, expected_cash=?, variance=?, status='closed', closed_at=?
         WHERE id=?`,
        [closingCash, expectedCash, variance, ts(day, closeHour, rand(30, 59), 0), shiftId]
      );

      for (const d of closeDenomsData) {
        await run(
          `INSERT INTO shift_denominations (shift_id, denomination, count, stage) VALUES (?, ?, ?, 'closing')`,
          [shiftId, d.denomination, d.count]
        );
      }
    } // end outlet loop

    process.stdout.write(`✓\n`);
  } // end day loop

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: PAYROLL (2 months)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n💰 Creating payroll periods...');

  const allEmployees = await all(`SELECT id, name, salary_type, monthly_salary FROM employees`);

  const payrollMonths = [
    { name: 'January 2026', start: '2026-01-08', end: '2026-01-31', dayCount: 24 },
    { name: 'February 2026', start: '2026-02-01', end: '2026-02-28', dayCount: 24 },
  ];

  for (const month of payrollMonths) {
    const periodId = await run(
      `INSERT INTO payroll_periods (period_name, start_date, end_date, status, created_by, finalized_at, created_at)
       VALUES (?, ?, ?, 'finalized', 1, ?, ?)`,
      [month.name, month.start, month.end, ts(29, 16, 0, 0), ts(29, 16, 0, 0)]
    );

    for (const emp of allEmployees) {
      if (!emp.monthly_salary) continue;

      // Find leave days in this month
      const leaveDays = leaveRequests.filter(lr =>
        lr.empId === emp.id && lr.status === 'approved'
      ).reduce((acc, lr) => acc + (lr.endDay - lr.startDay + 1), 0);

      const perDayRate = emp.monthly_salary / 26;
      const grossPay = emp.monthly_salary;
      const deductLeave = leaveDays > 2 ? perDayRate * (leaveDays - 2) : 0; // 2 days grace
      const netPay = grossPay - deductLeave;

      await run(
        `INSERT INTO payroll_lines (period_id, employee_id, salary_type, base_rate, total_hours, total_days, leave_days, gross_pay, deductions, net_pay, notes)
         VALUES (?, ?, 'monthly', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          periodId, emp.id, emp.monthly_salary,
          month.dayCount * 8, month.dayCount,
          leaveDays, grossPay, Math.round(deductLeave), Math.round(netPay),
          leaveDays > 2 ? `${leaveDays - 2} excess leave day(s) deducted` : 'Full salary',
        ]
      );

      // Salary expense
      await run(
        `INSERT INTO expenses (category_id, outlet_id, employee_id, amount, description, expense_date, created_at)
         VALUES (3, 1, 1, ?, ?, ?, ?)`,
        [Math.round(netPay), `Salary payment: ${emp.name} (${month.name})`, month.end, `${month.end} 17:00:00`]
      );
    }
  }

  console.log('   ✓ Payroll periods + lines + salary expenses created');

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: VOID A FEW SALES (realistic)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n🗑️  Voiding a few sales...');
  const salesToVoid = await all(`SELECT id FROM sales WHERE voided=0 ORDER BY RANDOM() LIMIT 5`);
  for (const s of salesToVoid) {
    await run(`UPDATE sales SET voided=1, void_reason='Entered by mistake — void requested by manager' WHERE id=?`, [s.id]);
  }
  console.log(`   ✓ Voided ${salesToVoid.length} sales`);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6: APPROVAL REQUESTS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n✅ Creating approval requests...');

  const approvalScenarios = [
    { reqBy: empZara, type: 'discount_override', subject: 'Discount override for bulk order', approvedBy: 1, status: 'approved', day: 5 },
    { reqBy: empNadia, type: 'void_sale', subject: 'Void sale #5 — duplicate entry', approvedBy: 1, status: 'approved', day: 12 },
    { reqBy: empKamran, type: 'stock_adjustment', subject: 'Write off 10 damaged chips packets', approvedBy: empZara, status: 'approved', day: 20 },
    { reqBy: empBilal, type: 'discount_override', subject: 'Special discount for loyal customer', approvedBy: empNadia, status: 'rejected', day: 28 },
    { reqBy: 2, type: 'refund_override', subject: 'Refund after 7-day window — customer complaint', approvedBy: 1, status: 'approved', day: 35 },
    { reqBy: 3, type: 'stock_adjustment', subject: 'Adjust stock after stocktake discrepancy', approvedBy: empNadia, status: 'pending', day: 55 },
  ];

  for (const req of approvalScenarios) {
    const reqId = await run(
      `INSERT INTO approval_requests (requested_by, type, subject, status, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [req.reqBy, req.type, req.subject, req.status, ts(req.day, 11, 0, 0)]
    );
    if (req.status !== 'pending') {
      await run(
        `INSERT INTO approval_actions (request_id, action_by, action, note, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [reqId, req.approvedBy, req.status, req.status === 'approved' ? 'Approved as requested' : 'Not within policy', ts(req.day, 14, 0, 0)]
      );
    }
  }
  console.log('   ✓ Approval requests created');

  // ═══════════════════════════════════════════════════════════════════════════
  // DONE
  // ═══════════════════════════════════════════════════════════════════════════
  await run('PRAGMA foreign_keys = ON');

  const totalSales = await get(`SELECT COUNT(*) as c, SUM(total_amount) as t FROM sales WHERE voided=0`);
  const totalShifts = await get(`SELECT COUNT(*) as c FROM cash_shifts`);
  const totalReturns = await get(`SELECT COUNT(*) as c FROM returns`);
  const totalPOs = await get(`SELECT COUNT(*) as c FROM purchase_orders`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ 60-DAY SEED COMPLETE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Sales:          ${totalSales.c} (Total: Rs. ${Number(totalSales.t||0).toLocaleString()})`);
  console.log(`  Shifts:         ${totalShifts.c}`);
  console.log(`  Returns:        ${totalReturns.c}`);
  console.log(`  Purchase Orders:${totalPOs.c}`);
  console.log(`  Employees:      ${allEmployees.length}`);
  console.log(`  Customers:      10`);
  console.log(`  Date range:     Jan 8 – Mar 8, 2026`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  db.close();
}

main().catch(err => {
  console.error('❌ Seed failed:', err);
  db.close();
  process.exit(1);
});
