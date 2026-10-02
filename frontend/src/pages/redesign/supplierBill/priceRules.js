// One Toy Store F9 (d): the shop's price rules (PHASE-F-PLAN F9, the owner's
// margin sheets, confirmed 2026-10-03 00:15). % added on cost (cost 1,000
// + 150 % = 2,500), rounded to the nearest 10; first match wins. The shop can
// always choose another rule or type a higher price.

/** [cost below, % added] */
const NON_BRAND_BANDS = [[500, 185], [1000, 175], [1500, 165], [2000, 155], [3000, 145], [Infinity, 135]];
const BRAND_BANDS = [[500, 130], [1000, 120], [2000, 110], [3000, 100], [5000, 95], [Infinity, 85]];

// Whole words only: "SLIDER PUZZLE" is not a slide.
const BIG_ITEMS = /\b(tori ?cars?|tricycles?|bicycles?|cycles?|strollers?|strolle|prams?|slides?|walkers?|trampolines?|riding horses?|swings?|study tables?|high ?chairs?|bouncers?|scooters?|scooty|scooties|jumpolines?)\b/i;
const SCOOTY = /\b(scooters?|scooty|scooties)\b/i;
const BBTT_ITEMS = /\b(skate ?boards?|skate ?shoes?|skates|air animals?|jumping (air )?balls?|net ?balls?)\b/i;

const isBabyLand = (s) => /BABY ?LAND|B\.? ?B\.? ?LAND/i.test(s || "");
const isToysAndToys = (s) => /TOYS AND TOYS|T ?& ?T\b/i.test(s || "");
// The owner's sheet (Zaki = Al Hassan Traders, Amir Stationers, Saad, Amir
// Birthday, Tooba, Rehman) + Akbar, Aqeel, Azmat, Jahangir Books, Rabia Books (owner 2026-10-03).
const STATIONERY_SUPPLIERS = /AL HASSAN|ZAKI|AMIR STATION|AMIR BIRTHDAY|SAAD|TOOBA|REHMAN|AKBAR|AQEEL|AZMAT|JAHANGIR BOOK|RABIA BOOK/i;
const STATIONERY_BRANDS = new Set(["yalong", "deli", "pelikan"]);
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export const RULES = [
  { key: "big", label: "Big item 80 % / 65 %" }, // Baby Land big items & T&T scooty; 65 % from cost 10,000
  { key: "bbtt", label: "B.B Land & T&T list 110 %" },
  { key: "stationery", label: "Stuff & stationery 140 %" },
  { key: "brand", label: "Brand, by cost" },
  { key: "nonbrand", label: "Non-brand, by cost" },
];

export const roundTo10 = (n) => Math.round(Number(n) / 10) * 10;

const band = (bands, cost) => bands.find(([below]) => cost < below)[1];

function pctFor(rule, cost) {
  if (rule === "big") return cost >= 10000 ? 65 : 80;
  if (rule === "bbtt") return 110;
  if (rule === "stationery") return 140;
  if (rule === "brand") return band(BRAND_BANDS, cost);
  return band(NON_BRAND_BANDS, cost);
}

/** Which rule applies, first match wins. */
export function findRule({ supplierName, name, isBrand, brandName }) {
  const bl = isBabyLand(supplierName);
  const tt = isToysAndToys(supplierName);
  if ((bl && BIG_ITEMS.test(name || "")) || (tt && SCOOTY.test(name || ""))) return "big";
  if (!isBrand && (bl || tt) && BBTT_ITEMS.test(name || "")) return "bbtt";
  if (STATIONERY_SUPPLIERS.test(supplierName || "") || (isBrand && STATIONERY_BRANDS.has(key(brandName)))) return "stationery";
  return isBrand ? "brand" : "nonbrand";
}

/** { key, label, pct, price } for one piece costing `cost`; `rule` = the shop's own choice. */
export function priceRule({ cost, supplierName, name, isBrand, brandName, rule }) {
  const k = rule || findRule({ supplierName, name, isBrand, brandName });
  const c = Number(cost) || 0;
  const pct = pctFor(k, c);
  return { key: k, label: RULES.find((r) => r.key === k).label, pct, price: c > 0 ? roundTo10(c * (1 + pct / 100)) : 0 };
}

// What counts as a brand: the onetoystore.com Brands menu (owner's
// screenshots) + Graco and Bestway (owner).
const WEBSITE_BRANDS = [
  "Avengers", "Babyganics", "Baby Magic", "Barbie", "Bburago", "B-Kids", "Bright Starts", "Caterpillar", "Chicco", "Ching Ching",
  "Colorland", "Crayola", "Cra-Z-Art", "Cussons", "DC", "Dede", "Disney", "Dolu", "Duytan", "Edu-Play", "Evenflo", "Farlin",
  "Fisher Price", "Fun Time", "FunWorld", "Hasbro", "Hot Wheels", "Huggies", "Infantes", "Ingenuity", "Intex", "Japlo",
  "Johnson's Baby", "Kids Dough", "Ladybird", "Leapfrog", "LEGO", "LEPIN", "Lion Star", "Lisciani", "Little Pony", "Little Tikes",
  "Maisto", "Mattel", "Mastela", "Matchbox", "Medela", "Mega Blocks", "Mothercare", "Mustela", "National Geographic", "Nerf", "Nuby",
  "NUK", "Pampers", "Paw Patrol", "Philips AVENT", "Pigeon", "Play-Doh", "Playgo", "Polesie", "Rubies Costume Co.",
  "Thomas & Friends", "Tigex", "Tinnies", "Tommee Tippee", "Usborne", "Weeler", "WinFun", "Graco", "Bestway",
];
// Same brand, other spelling (matches backend services/supplier-bill-new-toys.js brandKey).
const ALIASES = { bburago: "burago" };
const brandKey = (s) => ALIASES[key(s)] || key(s);

/** The Brand list for a new toy: SanoPOS's own brands (their spelling) + the website's menu. */
export function brandChoices(existing = []) {
  const byKey = new Map();
  for (const b of existing) byKey.set(brandKey(b.name), b.name);
  for (const n of WEBSITE_BRANDS) if (!byKey.has(brandKey(n))) byKey.set(brandKey(n), n);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}
