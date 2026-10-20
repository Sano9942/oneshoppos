// One Toy Store F9 (d) + F10: the shop's price rules (PHASE-F-PLAN F9, the
// owner's margin sheets, confirmed 2026-10-03 00:15; F10 2026-10-20: the rules
// live in the database, GET /api/price-rules, and the owner edits them on
// Settings → Price rules). % added on cost (cost 1,000 + 150 % = 2,500),
// rounded to the nearest 10 / 50 / 100; first match wins. The shop can always
// choose another rule or type a higher price. A rule change only changes
// future suggestions: no toy is repriced.
//
// Rules shape (backend/services/price-rules.js keeps the same defaults):
//   rounding: 10 | 50 | 100
//   big:        { pct, high_from_cost, high_pct, groups: [{ supplier_ids, words }, …] }
//   bbtt:       { pct, supplier_ids, words }          (non-brand toys only)
//   stationery: { pct, supplier_ids, brand_ids, brand_names }
//   brand / nonbrand: { bands: [[cost below, %], …, [null, %]] }

/** Whole words; "high chair" also matches "HIGHCHAIR"; an s / es on the end still counts. */
const BIG_WORDS = [
  "tori car", "tricycle", "bicycle", "cycle", "stroller", "strolle", "pram", "slide", "walker", "trampoline", "riding horse",
  "swing", "study table", "high chair", "bouncer", "scooter", "scooty", "scooties", "jumpoline", "r/o", "ride on",
];
// "R/O" / "ride on" = a ride-on (owner 2026-10-03: like tori cars); NOT the
// word "bike" alone: R/C motor bikes, metal bikes, pull-back bikes are small toys.
const SCOOTY_WORDS = ["scooter", "scooty", "scooties"];
const BBTT_WORDS = ["skate board", "skate shoe", "skates", "air animal", "jumping ball", "jumping air ball", "net ball"];

/** The owner's sheet, before any supplier is ticked (the server ticks the live shop's). */
export const DEFAULT_RULES = Object.freeze({
  rounding: 10,
  // Group 1 = Baby Land's big items; group 2 = T&T's scooty.
  big: { pct: 80, high_from_cost: 10000, high_pct: 65, groups: [{ supplier_ids: [], words: BIG_WORDS }, { supplier_ids: [], words: SCOOTY_WORDS }] },
  bbtt: { pct: 110, supplier_ids: [], words: BBTT_WORDS },
  stationery: { pct: 140, supplier_ids: [], brand_ids: [], brand_names: [] },
  brand: { bands: [[500, 130], [1000, 120], [2000, 110], [3000, 100], [5000, 95], [null, 85]] },
  nonbrand: { bands: [[500, 185], [1000, 175], [1500, 165], [2000, 155], [3000, 145], [null, 135]] },
});

export const RULE_KEYS = ["big", "bbtt", "stationery", "brand", "nonbrand"];
export const ROUNDING_STEPS = [10, 50, 100];
export const SAMPLE_COSTS = [200, 800, 2500, 12000];
export const PCT_MIN = 30;
export const PCT_MAX = 300;

const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export function wordsMatch(words, name) {
  const list = (words || []).map((w) => String(w).trim().toLowerCase()).filter(Boolean);
  if (!list.length) return false;
  const alt = list.map((w) => `${escape(w).replace(/\s+/g, " ?")}(?:e?s)?`).join("|");
  return new RegExp(`(?:^|[^a-z0-9])(?:${alt})(?![a-z0-9])`, "i").test(String(name || ""));
}

export const roundPrice = (n, step = 10) => Math.round(Number(n) / step) * step;

const has = (ids, id) => id != null && (ids || []).map(Number).includes(Number(id));
const band = (bands, cost) => (bands.find(([below]) => below == null || cost < Number(below)) || bands[bands.length - 1])[1];

function pctFor(rule, cost, rules) {
  if (rule === "big") return cost >= Number(rules.big.high_from_cost) ? Number(rules.big.high_pct) : Number(rules.big.pct);
  if (rule === "bbtt") return Number(rules.bbtt.pct);
  if (rule === "stationery") return Number(rules.stationery.pct);
  return Number(band(rules[rule].bands, cost));
}

/** Which rule applies, first match wins. */
export function findRule({ supplierId, name, isBrand, brandId, brandName }, rules = DEFAULT_RULES) {
  if (rules.big.groups.some((g) => has(g.supplier_ids, supplierId) && wordsMatch(g.words, name))) return "big";
  if (!isBrand && has(rules.bbtt.supplier_ids, supplierId) && wordsMatch(rules.bbtt.words, name)) return "bbtt";
  const st = rules.stationery;
  if (has(st.supplier_ids, supplierId)) return "stationery";
  if (isBrand && (has(st.brand_ids, brandId) || (brandName && (st.brand_names || []).some((n) => key(n) === key(brandName))))) return "stationery";
  return isBrand ? "brand" : "nonbrand";
}

/** The picker's rules, labelled with the shop's own %. */
export function rulesList(rules = DEFAULT_RULES) {
  return [
    { key: "big", label: `Big item ${rules.big.pct} % / ${rules.big.high_pct} %` },
    { key: "bbtt", label: `B.B Land & T&T list ${rules.bbtt.pct} %` },
    { key: "stationery", label: `Stuff & stationery ${rules.stationery.pct} %` },
    { key: "brand", label: "Brand, by cost" },
    { key: "nonbrand", label: "Non-brand, by cost" },
  ];
}

/** { key, label, pct, price } for one piece costing `cost`; `rule` = the shop's own choice. */
export function priceRule({ cost, supplierId, name, isBrand, brandId, brandName, rule }, rules = DEFAULT_RULES) {
  const k = rule || findRule({ supplierId, name, isBrand, brandId, brandName }, rules);
  const c = Number(cost) || 0;
  const pct = pctFor(k, c, rules);
  return {
    key: k, label: rulesList(rules).find((r) => r.key === k).label, pct,
    price: c > 0 ? roundPrice(c * (1 + pct / 100), Number(rules.rounding) || 10) : 0,
  };
}

const LABEL = { big: "Big item", bbtt: "B.B Land & T&T list", stationery: "Stuff & stationery", brand: "Brand, by cost", nonbrand: "Non-brand, by cost" };
const okPct = (v) => v !== "" && v != null && Number.isFinite(Number(v)) && Number(v) >= PCT_MIN && Number(v) <= PCT_MAX;
const between = `between ${PCT_MIN} and ${PCT_MAX}`;

/** Plain-English problems that stop a Save (same checks as the server). */
export function validateRules(rules) {
  const e = [];
  if (!ROUNDING_STEPS.includes(Number(rules.rounding))) e.push("Rounding must be to the nearest 10, 50 or 100.");
  if (!okPct(rules.big.pct)) e.push(`Big item: the % must be ${between}.`);
  if (!okPct(rules.big.high_pct)) e.push(`Big item: the % from the higher cost must be ${between}.`);
  if (!(Number(rules.big.high_from_cost) > 0)) e.push("Big item: the cost where the lower % starts must be above 0.");
  for (const k of ["bbtt", "stationery"]) if (!okPct(rules[k].pct)) e.push(`${LABEL[k]}: the % must be ${between}.`);
  for (const k of ["brand", "nonbrand"]) {
    const bands = rules[k].bands || [];
    if (!bands.length) { e.push(`${LABEL[k]}: needs at least one row.`); continue; }
    bands.forEach(([below, pct], i) => {
      const last = i === bands.length - 1;
      if (!okPct(pct)) e.push(`${LABEL[k]}: row ${i + 1}'s % must be ${between}.`);
      if (last) {
        if (below != null && below !== "") e.push(`${LABEL[k]}: the last row must be "and above".`);
      } else if (!(Number(below) > 0)) {
        e.push(`${LABEL[k]}: row ${i + 1} needs a cost above 0.`);
      } else if (i > 0 && !(Number(below) > Number(bands[i - 1][0]))) {
        e.push(`${LABEL[k]}: row ${i + 1}'s cost must be higher than row ${i}'s.`);
      }
    });
  }
  return e;
}

/** Old vs new price of each rule at the sample costs, for the page's preview. */
export function previewRows(oldRules, newRules) {
  const priceAt = (rules, rule, cost) => roundPrice(cost * (1 + pctFor(rule, cost, rules) / 100), Number(rules.rounding) || 10);
  const labels = rulesList(newRules);
  return RULE_KEYS.map((k) => ({
    key: k,
    label: labels.find((l) => l.key === k).label,
    cells: SAMPLE_COSTS.map((cost) => {
      const o = priceAt(oldRules, k, cost);
      const n = priceAt(newRules, k, cost);
      return { cost, old: o, new: n, changed: o !== n };
    }),
  }));
}

/** The Brand list for a new toy = Catalog → Brands (F10: one brand list), sorted. */
export function brandChoices(existing = []) {
  return [...new Set(existing.map((b) => b.name))].sort((a, b) => a.localeCompare(b));
}
