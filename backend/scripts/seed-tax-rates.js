#!/usr/bin/env node
/**
 * Seed tax_rate_reference in public schema with common Pakistani retail HS codes.
 * Run: node backend/scripts/seed-tax-rates.js
 * Requires DATABASE_URL env var.
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { Pool } = require("pg");

const RATES = [
  // Grocery — essential food items (exempt under SRO 551(I)/2008)
  { hs_code: "0201", en: "Meat (fresh/chilled)", ur: "گوشت (تازہ/ٹھنڈا)", gst: 0, notes: "Exempt under SRO 551(I)/2008 — unprocessed food" },
  { hs_code: "0401", en: "Milk and cream", ur: "دودھ اور کریم", gst: 0, notes: "Exempt — essential dairy" },
  { hs_code: "0407", en: "Eggs", ur: "انڈے", gst: 0, notes: "Exempt — unprocessed food" },
  { hs_code: "0701", en: "Potatoes", ur: "آلو", gst: 0, notes: "Exempt — fresh vegetables" },
  { hs_code: "0702", en: "Tomatoes", ur: "ٹماٹر", gst: 0, notes: "Exempt — fresh vegetables" },
  { hs_code: "0703", en: "Onions, garlic, leeks", ur: "پیاز، لہسن", gst: 0, notes: "Exempt — fresh vegetables" },
  { hs_code: "0713", en: "Pulses and lentils", ur: "دالیں", gst: 0, notes: "Exempt — unprocessed food" },
  { hs_code: "0901", en: "Tea", ur: "چائے", gst: 0, notes: "Exempt — essential commodity" },
  { hs_code: "1001", en: "Wheat", ur: "گندم", gst: 0, notes: "Exempt — staple grain" },
  { hs_code: "1006", en: "Rice", ur: "چاول", gst: 0, notes: "Exempt — staple grain" },
  { hs_code: "1101", en: "Wheat flour (atta)", ur: "آٹا", gst: 0, notes: "Exempt — essential commodity" },
  { hs_code: "1507", en: "Cooking oil (soybean)", ur: "کھانا پکانے کا تیل", gst: 0, notes: "Exempt — essential commodity" },
  { hs_code: "1701", en: "Sugar", ur: "چینی", gst: 0, notes: "Exempt — essential commodity" },
  { hs_code: "2501", en: "Salt", ur: "نمک", gst: 0, notes: "Exempt — essential commodity" },

  // Packaged food (standard 18% GST)
  { hs_code: "1704", en: "Confectionery / sweets", ur: "مٹھائیاں", gst: 18 },
  { hs_code: "1806", en: "Chocolate and cocoa products", ur: "چاکلیٹ", gst: 18 },
  { hs_code: "1905", en: "Bread, biscuits, cakes", ur: "روٹی، بسکٹ، کیک", gst: 18 },
  { hs_code: "2005", en: "Canned vegetables / pickles", ur: "ڈبہ بند سبزیاں / اچار", gst: 18 },
  { hs_code: "2106", en: "Packaged food preparations", ur: "پیکڈ کھانے", gst: 18 },
  { hs_code: "2103", en: "Sauces, ketchup, condiments", ur: "چٹنی، کیچپ", gst: 18 },
  { hs_code: "1902", en: "Pasta, noodles, instant noodles", ur: "پاستا، نوڈلز", gst: 18 },
  { hs_code: "2104", en: "Soups, broths", ur: "شوربے", gst: 18 },

  // Beverages
  { hs_code: "2201", en: "Mineral / bottled water", ur: "بوتل بند پانی", gst: 18 },
  { hs_code: "2202", en: "Soft drinks, juices (sweetened)", ur: "مشروبات، جوس", gst: 18, notes: "Additional FED on sugary drinks" },
  { hs_code: "2009", en: "Fruit juices (unsweetened)", ur: "پھلوں کا رس", gst: 18 },

  // Textiles / clothing
  { hs_code: "6109", en: "T-shirts, vests (knitted)", ur: "ٹی شرٹ", gst: 18 },
  { hs_code: "6110", en: "Sweaters, pullovers", ur: "سویٹر", gst: 18 },
  { hs_code: "6203", en: "Men's suits, trousers", ur: "مردانہ سوٹ، پتلون", gst: 18 },
  { hs_code: "6204", en: "Women's suits, dresses", ur: "خواتین کے سوٹ", gst: 18 },
  { hs_code: "6205", en: "Men's shirts", ur: "مردانہ قمیض", gst: 18 },
  { hs_code: "6206", en: "Women's blouses", ur: "خواتین کی قمیض", gst: 18 },
  { hs_code: "6402", en: "Footwear (rubber/plastic)", ur: "جوتے (ربڑ/پلاسٹک)", gst: 18 },
  { hs_code: "6403", en: "Footwear (leather)", ur: "جوتے (چمڑا)", gst: 18 },
  { hs_code: "5208", en: "Cotton fabric (woven)", ur: "سوتی کپڑا", gst: 18 },
  { hs_code: "5209", en: "Denim fabric", ur: "ڈینم کپڑا", gst: 18 },
  { hs_code: "6302", en: "Bed linen, towels", ur: "بستر کی چادریں، تولیے", gst: 18 },

  // Electronics
  { hs_code: "8471", en: "Computers, laptops", ur: "کمپیوٹر، لیپ ٹاپ", gst: 18 },
  { hs_code: "8517", en: "Mobile phones, smartphones", ur: "موبائل فون", gst: 18 },
  { hs_code: "8528", en: "TVs, monitors", ur: "ٹی وی، مانیٹر", gst: 18 },
  { hs_code: "8516", en: "Electric heaters, kettles, irons", ur: "بجلی کے آلات", gst: 18 },
  { hs_code: "8418", en: "Refrigerators, freezers", ur: "فریج، فریزر", gst: 18 },
  { hs_code: "8450", en: "Washing machines", ur: "واشنگ مشین", gst: 18 },
  { hs_code: "8415", en: "Air conditioners", ur: "ائیرکنڈیشنر", gst: 18 },
  { hs_code: "8414", en: "Fans, air purifiers", ur: "پنکھے", gst: 18 },
  { hs_code: "8504", en: "UPS, inverters, chargers", ur: "یو پی ایس، انورٹر", gst: 18 },
  { hs_code: "8544", en: "Electrical cables, wires", ur: "بجلی کی تاریں", gst: 18 },

  // Books & stationery
  { hs_code: "4901", en: "Books, brochures, leaflets", ur: "کتابیں", gst: 0, notes: "Exempt — printed books" },
  { hs_code: "4802", en: "Paper (writing/printing)", ur: "کاغذ", gst: 18 },
  { hs_code: "4820", en: "Registers, notebooks", ur: "کاپیاں، رجسٹر", gst: 18 },
  { hs_code: "9608", en: "Pens, pencils", ur: "قلم، پنسلیں", gst: 18 },

  // Toys
  { hs_code: "9503", en: "Toys, dolls, puzzles", ur: "کھلونے", gst: 18 },
  { hs_code: "9504", en: "Video game consoles", ur: "ویڈیو گیم", gst: 18 },

  // Pharmaceuticals (exempt under 6th Schedule Part I)
  { hs_code: "3001", en: "Pharmaceutical preparations", ur: "ادویات", gst: 0, notes: "Exempt — 6th Schedule Part I" },
  { hs_code: "3003", en: "Medicaments (unmixed)", ur: "ادویات (غیر ملاوٹ)", gst: 0, notes: "Exempt — 6th Schedule Part I" },
  { hs_code: "3004", en: "Medicaments (dosed/packaged)", ur: "ادویات (پیک شدہ)", gst: 0, notes: "Exempt — 6th Schedule Part I" },
  { hs_code: "3005", en: "Bandages, first aid", ur: "پٹیاں، ابتدائی طبی امداد", gst: 0, notes: "Exempt — medical supplies" },

  // Cosmetics & toiletries
  { hs_code: "3301", en: "Essential oils, perfumes", ur: "عطر", gst: 18 },
  { hs_code: "3304", en: "Beauty / skincare products", ur: "حسن کی مصنوعات", gst: 18 },
  { hs_code: "3305", en: "Hair care products", ur: "بالوں کی مصنوعات", gst: 18 },
  { hs_code: "3306", en: "Oral hygiene (toothpaste)", ur: "ٹوتھ پیسٹ", gst: 18 },
  { hs_code: "3401", en: "Soap, detergent", ur: "صابن، ڈٹرجنٹ", gst: 18 },

  // Hardware & tools
  { hs_code: "7318", en: "Screws, bolts, nuts", ur: "پیچ، بولٹ", gst: 18 },
  { hs_code: "8205", en: "Hand tools (pliers, hammers)", ur: "ہاتھ کے اوزار", gst: 18 },
  { hs_code: "8211", en: "Knives", ur: "چاقو", gst: 18 },
  { hs_code: "7210", en: "Steel sheets (coated)", ur: "سٹیل شیٹ", gst: 18 },
  { hs_code: "7306", en: "Steel pipes", ur: "سٹیل پائپ", gst: 18 },
  { hs_code: "7604", en: "Aluminum bars/profiles", ur: "ایلومینیم", gst: 18 },

  // Furniture
  { hs_code: "9401", en: "Seats, chairs", ur: "کرسیاں", gst: 18 },
  { hs_code: "9403", en: "Furniture (wood/metal)", ur: "فرنیچر", gst: 18 },
  { hs_code: "9404", en: "Mattresses, cushions", ur: "گدے، تکیے", gst: 18 },

  // Automotive parts
  { hs_code: "8708", en: "Vehicle parts & accessories", ur: "گاڑی کے پرزے", gst: 18 },
  { hs_code: "4011", en: "Tyres (rubber)", ur: "ٹائر", gst: 18 },
  { hs_code: "8507", en: "Batteries (lead-acid)", ur: "بیٹریاں", gst: 18 },
  { hs_code: "2710", en: "Lubricating oils", ur: "موبل آئل", gst: 18 },

  // Sports goods
  { hs_code: "9506", en: "Sports equipment", ur: "کھیلوں کا سامان", gst: 18 },
  { hs_code: "9504.30", en: "Cricket bats, balls", ur: "کرکٹ بیٹ، گیند", gst: 18 },
  { hs_code: "4203", en: "Leather gloves (sports)", ur: "چمڑے کے دستانے", gst: 18 },

  // Jewelry
  { hs_code: "7113", en: "Gold / silver jewelry", ur: "سونے / چاندی کے زیورات", gst: 18 },
  { hs_code: "7117", en: "Imitation jewelry", ur: "نقلی زیورات", gst: 18 },

  // Tobacco (high rate + FED)
  { hs_code: "2402", en: "Cigarettes, cigars", ur: "سگریٹ", gst: 18, notes: "Plus FED (varying rates based on retail price tier)" },
  { hs_code: "2403", en: "Other tobacco products", ur: "دیگر تمباکو", gst: 18, notes: "Plus FED" },

  // Plastics & packaging
  { hs_code: "3923", en: "Plastic containers, bags", ur: "پلاسٹک کے ڈبے، تھیلے", gst: 18 },
  { hs_code: "3924", en: "Plastic household articles", ur: "پلاسٹک کے گھریلو سامان", gst: 18 },
  { hs_code: "4819", en: "Cartons, boxes (paper)", ur: "کارٹن، ڈبے", gst: 18 },

  // Ceramics & glassware
  { hs_code: "6911", en: "Ceramic tableware", ur: "چینی مٹی کے برتن", gst: 18 },
  { hs_code: "7013", en: "Glassware", ur: "شیشے کے برتن", gst: 18 },

  // Pet food
  { hs_code: "2309", en: "Pet food preparations", ur: "پالتو جانوروں کی خوراک", gst: 18 },

  // Baby products
  { hs_code: "9619", en: "Diapers, sanitary pads", ur: "ڈائپر، سینیٹری پیڈ", gst: 18 },
  { hs_code: "0402.10", en: "Baby formula / milk powder", ur: "بچوں کا فارمولا دودھ", gst: 0, notes: "Exempt — infant nutrition" },

  // Miscellaneous retail
  { hs_code: "9405", en: "Lamps, lighting fixtures", ur: "لیمپ، لائٹ فکسچر", gst: 18 },
  { hs_code: "8539", en: "LED bulbs, tubes", ur: "ایل ای ڈی بلب", gst: 18 },
  { hs_code: "9603", en: "Brooms, brushes", ur: "جھاڑو، برش", gst: 18 },
  { hs_code: "9617", en: "Vacuum flasks, thermos", ur: "تھرماس", gst: 18 },
  { hs_code: "4202", en: "Bags, suitcases, wallets", ur: "بیگ، سوٹ کیس", gst: 18 },
  { hs_code: "9101", en: "Watches (wrist)", ur: "کلائی گھڑیاں", gst: 18 },
  { hs_code: "9004", en: "Sunglasses, spectacles", ur: "دھوپ کے چشمے", gst: 18 },
];

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    console.log(`Seeding ${RATES.length} tax rate references...`);
    for (const r of RATES) {
      await pool.query(
        `INSERT INTO public.tax_rate_reference
         (hs_code, description_en, description_ur, federal_gst, punjab_pra, sindh_srb, kpk_kpra, balochistan_bra, exemption_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [
          r.hs_code,
          r.en,
          r.ur || null,
          r.gst || 0,
          r.punjab || 0,
          r.sindh || 0,
          r.kpk || 0,
          r.balochistan || 0,
          r.notes || null,
        ]
      );
    }
    console.log("Done. Seeded tax rate reference data.");
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
