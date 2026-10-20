/**
 * One Toy Store F10: the shop's price rules for toys from a supplier bill, kept
 * in the database and edited on Settings → Price rules
 * (docs/onetoystore-pilot/PHASE-F-PLAN.md F10, owner 2026-10-20).
 *
 * Every save is a new row of price_rule_versions; the newest row is the rules.
 * Before the first save the rules are the owner's sheet as it was written into
 * the program (frontend supplierBill/priceRules.js DEFAULT_RULES, same values),
 * with suppliers ticked from the old name patterns. The bill screen does the
 * pricing; this module stores, checks and serves the rules. A rule change
 * only changes future suggestions: no toy is repriced here.
 */

const PRICE_RULE_VERSIONS_DDL = `
CREATE TABLE IF NOT EXISTS price_rule_versions (
  id SERIAL PRIMARY KEY,
  config JSONB NOT NULL,
  saved_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_from INTEGER REFERENCES price_rule_versions(id) ON DELETE SET NULL
);
`;

const BIG_WORDS = [
  "tori car", "tricycle", "bicycle", "cycle", "stroller", "strolle", "pram", "slide", "walker", "trampoline", "riding horse",
  "swing", "study table", "high chair", "bouncer", "scooter", "scooty", "scooties", "jumpoline", "r/o", "ride on",
];
const SCOOTY_WORDS = ["scooter", "scooty", "scooties"];
const BBTT_WORDS = ["skate board", "skate shoe", "skates", "air animal", "jumping ball", "jumping air ball", "net ball"];

/** Same values as the frontend's DEFAULT_RULES (a unit test keeps them equal). */
const DEFAULT_RULES = Object.freeze({
  rounding: 10,
  big: { pct: 80, high_from_cost: 10000, high_pct: 65, groups: [{ supplier_ids: [], words: BIG_WORDS }, { supplier_ids: [], words: SCOOTY_WORDS }] },
  bbtt: { pct: 110, supplier_ids: [], words: BBTT_WORDS },
  stationery: { pct: 140, supplier_ids: [], brand_ids: [] },
  brand: { bands: [[500, 130], [1000, 120], [2000, 110], [3000, 100], [5000, 95], [null, 85]] },
  nonbrand: { bands: [[500, 185], [1000, 175], [1500, 165], [2000, 155], [3000, 145], [null, 135]] },
});

// The supplier-name patterns the program used before F10; only used to tick
// the starting boxes (owner 2026-10-20: "start exactly as shown").
const isBabyLand = (s) => /BABY ?LAND|B\.? ?B\.? ?LAND/i.test(s || "");
const isToysAndToys = (s) => /TOYS AND TOYS|T ?& ?T\b/i.test(s || "");
const STATIONERY_SUPPLIERS = /AL HASSAN|ZAKI|AMIR STATION|AMIR BIRTHDAY|SAAD|TOOBA|REHMAN|AKBAR|AQEEL|AZMAT|JAHANGIR BOOK|RABIA BOOK/i;
const STATIONERY_BRANDS = new Set(["yalong", "deli", "pelikan"]);

const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// "Fisher Price" = "Fisher-Price"; the website's "Bburago" = SanoPOS's "Burago"
// (same as services/supplier-bill-new-toys.js brandKey).
const BRAND_ALIASES = { bburago: "burago" };
const brandKey = (s) => BRAND_ALIASES[key(s)] || key(s);

const RULE_KEYS = ["big", "bbtt", "stationery", "brand", "nonbrand"];
const LABEL = { big: "Big item", bbtt: "B.B Land & T&T list", stationery: "Stuff & stationery", brand: "Brand, by cost", nonbrand: "Non-brand, by cost" };
const PCT_MIN = 30;
const PCT_MAX = 300;
const ROUNDING_STEPS = [10, 50, 100];

const clone = (o) => JSON.parse(JSON.stringify(o));

async function defaultRules(db) {
  const r = clone(DEFAULT_RULES);
  const { rows: sups } = await db.query("SELECT id, name FROM suppliers ORDER BY id");
  const ids = (test) => sups.filter((s) => test(s.name)).map((s) => s.id);
  r.big.groups[0].supplier_ids = ids(isBabyLand);
  r.big.groups[1].supplier_ids = ids(isToysAndToys);
  r.bbtt.supplier_ids = ids((n) => isBabyLand(n) || isToysAndToys(n));
  r.stationery.supplier_ids = ids((n) => STATIONERY_SUPPLIERS.test(n));
  const { rows: brands } = await db.query("SELECT id, name FROM brands ORDER BY id");
  r.stationery.brand_ids = brands.filter((b) => STATIONERY_BRANDS.has(key(b.name))).map((b) => b.id);
  return r;
}

/** brand_names (for a new toy whose brand is picked by name) is worked out, never stored. */
async function withBrandNames(db, rules) {
  const ids = rules.stationery.brand_ids || [];
  const { rows } = ids.length
    ? await db.query("SELECT name FROM brands WHERE id = ANY($1::int[]) ORDER BY name", [ids])
    : { rows: [] };
  return { ...rules, stationery: { ...rules.stationery, brand_names: rows.map((b) => b.name) } };
}

const VERSION_SQL = `
  SELECT v.id, v.config, v.saved_at, v.restored_from, e.name AS saved_by_name
  FROM price_rule_versions v LEFT JOIN employees e ON e.id = v.saved_by`;
const versionOut = (v) => ({ id: v.id, saved_at: v.saved_at, saved_by_name: v.saved_by_name || null, restored_from: v.restored_from });

/** { rules, version } — version null = never saved (the starting rules). */
async function currentRules(db) {
  const { rows } = await db.query(`${VERSION_SQL} ORDER BY v.id DESC LIMIT 1`);
  if (!rows.length) return { rules: await withBrandNames(db, await defaultRules(db)), version: null };
  return { rules: await withBrandNames(db, rows[0].config), version: versionOut(rows[0]) };
}

const okPct = (v) => v !== "" && v != null && typeof v !== "boolean" && Number.isFinite(Number(v)) && Number(v) >= PCT_MIN && Number(v) <= PCT_MAX;
const between = `between ${PCT_MIN} and ${PCT_MAX}`;
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const idList = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
const wordList = (v) => [...new Set((Array.isArray(v) ? v : []).map((w) => String(w ?? "").trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean))];

/**
 * Check and tidy rules from the page. { rules, errors }; errors = plain-English
 * problems (same wording as the page's own check), the shape is fixed (no rule
 * added or removed).
 */
async function checkRules(db, input) {
  if (!isObj(input) || !RULE_KEYS.every((k) => isObj(input[k])) || !Array.isArray(input.big.groups) || input.big.groups.length !== 2
    || !input.big.groups.every(isObj) || !Array.isArray(input.brand.bands) || !Array.isArray(input.nonbrand.bands)) {
    return { rules: null, errors: ["The rules are not in the expected shape: the five rules can be edited but not added or removed."] };
  }
  const e = [];
  if (!ROUNDING_STEPS.includes(Number(input.rounding))) e.push("Rounding must be to the nearest 10, 50 or 100.");
  if (!okPct(input.big.pct)) e.push(`Big item: the % must be ${between}.`);
  if (!okPct(input.big.high_pct)) e.push(`Big item: the % from the higher cost must be ${between}.`);
  if (!(Number(input.big.high_from_cost) > 0)) e.push("Big item: the cost where the lower % starts must be above 0.");
  for (const k of ["bbtt", "stationery"]) if (!okPct(input[k].pct)) e.push(`${LABEL[k]}: the % must be ${between}.`);
  const bands = {};
  for (const k of ["brand", "nonbrand"]) {
    const list = input[k].bands;
    if (!list.length) { e.push(`${LABEL[k]}: needs at least one row.`); continue; }
    bands[k] = list.map((row, i) => {
      const [below, pct] = Array.isArray(row) ? row : [];
      const last = i === list.length - 1;
      if (!okPct(pct)) e.push(`${LABEL[k]}: row ${i + 1}'s % must be ${between}.`);
      if (last) {
        if (below != null && below !== "") e.push(`${LABEL[k]}: the last row must be "and above".`);
      } else if (!(Number(below) > 0)) {
        e.push(`${LABEL[k]}: row ${i + 1} needs a cost above 0.`);
      } else if (i > 0 && !(Number(below) > Number(list[i - 1][0]))) {
        e.push(`${LABEL[k]}: row ${i + 1}'s cost must be higher than row ${i}'s.`);
      }
      return [last ? null : Number(below), Number(pct)];
    });
  }

  const rules = {
    rounding: Number(input.rounding),
    big: {
      pct: Number(input.big.pct), high_from_cost: Number(input.big.high_from_cost), high_pct: Number(input.big.high_pct),
      groups: input.big.groups.map((g) => ({ supplier_ids: idList(g.supplier_ids), words: wordList(g.words) })),
    },
    bbtt: { pct: Number(input.bbtt.pct), supplier_ids: idList(input.bbtt.supplier_ids), words: wordList(input.bbtt.words) },
    stationery: { pct: Number(input.stationery.pct), supplier_ids: idList(input.stationery.supplier_ids), brand_ids: idList(input.stationery.brand_ids) },
    brand: { bands: bands.brand || [] },
    nonbrand: { bands: bands.nonbrand || [] },
  };

  const { rows: sups } = await db.query("SELECT id FROM suppliers");
  const supIds = new Set(sups.map((s) => s.id));
  const gone = (ids) => ids.some((id) => !supIds.has(id));
  if (rules.big.groups.some((g) => gone(g.supplier_ids))) e.push("Big item: a ticked supplier doesn't exist any more.");
  if (gone(rules.bbtt.supplier_ids)) e.push("B.B Land & T&T list: a ticked supplier doesn't exist any more.");
  if (gone(rules.stationery.supplier_ids)) e.push("Stuff & stationery: a ticked supplier doesn't exist any more.");
  if (rules.stationery.brand_ids.length) {
    const { rows } = await db.query("SELECT id FROM brands WHERE id = ANY($1::int[])", [rules.stationery.brand_ids]);
    if (rows.length !== rules.stationery.brand_ids.length) e.push("Stuff & stationery: a ticked brand doesn't exist any more.");
  }
  return { rules: e.length ? null : rules, errors: e };
}

async function saveVersion(db, rules, employeeId, restoredFrom = null) {
  const { rows } = await db.query(
    "INSERT INTO price_rule_versions (config, saved_by, restored_from) VALUES ($1, $2, $3) RETURNING id",
    [JSON.stringify(rules), employeeId || null, restoredFrom]
  );
  const { rows: v } = await db.query(`${VERSION_SQL} WHERE v.id = $1`, [rows[0].id]);
  return versionOut(v[0]);
}

/** Every save, newest first, each with its rules (for "Go back to this version"). */
async function history(db) {
  const { rows } = await db.query(`${VERSION_SQL} ORDER BY v.id DESC LIMIT 200`);
  return Promise.all(rows.map(async (v) => ({ ...versionOut(v), rules: await withBrandNames(db, v.config) })));
}

/** "Go back to this version": saved again as the newest. null = no such version. */
async function restoreVersion(db, id, employeeId) {
  const { rows } = await db.query("SELECT config FROM price_rule_versions WHERE id = $1", [id]);
  if (!rows.length) return null;
  return saveVersion(db, rows[0].config, employeeId, Number(id));
}

// The onetoystore.com Brands menu (owner's screenshots) + Graco and Bestway
// (owner), moved here from the bill screen (F10 decision 5: one brand list =
// Catalog → Brands; this adds the missing ones once).
const WEBSITE_BRANDS = [
  "Avengers", "Babyganics", "Baby Magic", "Barbie", "Bburago", "B-Kids", "Bright Starts", "Caterpillar", "Chicco", "Ching Ching",
  "Colorland", "Crayola", "Cra-Z-Art", "Cussons", "DC", "Dede", "Disney", "Dolu", "Duytan", "Edu-Play", "Evenflo", "Farlin",
  "Fisher Price", "Fun Time", "FunWorld", "Hasbro", "Hot Wheels", "Huggies", "Infantes", "Ingenuity", "Intex", "Japlo",
  "Johnson's Baby", "Kids Dough", "Ladybird", "Leapfrog", "LEGO", "LEPIN", "Lion Star", "Lisciani", "Little Pony", "Little Tikes",
  "Maisto", "Mattel", "Mastela", "Matchbox", "Medela", "Mega Blocks", "Mothercare", "Mustela", "National Geographic", "Nerf", "Nuby",
  "NUK", "Pampers", "Paw Patrol", "Philips AVENT", "Pigeon", "Play-Doh", "Playgo", "Polesie", "Rubies Costume Co.",
  "Thomas & Friends", "Tigex", "Tinnies", "Tommee Tippee", "Usborne", "Weeler", "WinFun", "Graco", "Bestway",
];

/** Adds the website brands Catalog → Brands doesn't have (any spelling). Returns the names added. */
async function addWebsiteBrands(db) {
  const { rows } = await db.query("SELECT name FROM brands");
  const have = new Set(rows.map((b) => brandKey(b.name)));
  const added = [];
  for (const name of WEBSITE_BRANDS) {
    if (have.has(brandKey(name))) continue;
    await db.query("INSERT INTO brands (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [name]);
    have.add(brandKey(name));
    added.push(name);
  }
  return added;
}

module.exports = {
  PRICE_RULE_VERSIONS_DDL,
  DEFAULT_RULES,
  WEBSITE_BRANDS,
  currentRules,
  checkRules,
  saveVersion,
  history,
  restoreVersion,
  addWebsiteBrands,
};
