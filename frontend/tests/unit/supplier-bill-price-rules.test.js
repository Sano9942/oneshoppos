// One Toy Store F9 (d) + F10: the shop's price rules for a toy from a supplier
// bill (PHASE-F-PLAN F9, margin sheets confirmed by the owner 2026-10-03 00:15;
// F10, owner 2026-10-20: the rules live in the database and the owner edits
// them on Settings → Price rules). % added on cost; rounded (nearest 10 by
// default); first match wins:
//   1 Big item: ticked suppliers + item words (Baby Land: big items; T&T: only
//     scooty), 80 %, 65 % from cost 10,000
//   2 non-brand B.B Land & T&T list (skate board, air animals, net ball…): 110 %
//   3 stuff & stationery: ticked suppliers, and the ticked brands (Yalong /
//     Deli / Pelikan): 140 %
//   4 brand cost bands   5 non-brand cost bands
// Suppliers are ticked by id (F10 decision 6), not matched by name.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_RULES, SAMPLE_COSTS, brandChoices, previewRows, priceRule, roundPrice, rulesList, validateRules, wordsMatch,
} from "../../src/pages/redesign/supplierBill/priceRules";

// The live shop's supplier and brand ids (checked read-only 2026-10-20).
const SUP = {
  "A TO Z CONSUMERS": 1, "AKBAR & CO STATIONERS": 3, "AL HASSAN TRADERS": 4, "AMIR STATIONER": 5, "AQEEL STUFF TOYS": 6,
  "AZMAT STATIONERY RWP": 8, "BABY LAND LAHORE": 9, "JAHANGIR BOOKS LAHORE": 12, "RABIA BOOKS LAHORE": 16, "REHMAN STUFF TOYS": 17,
  "REHMAT TOYS RWP": 18, "SAAD STATIONER": 19, "SMART TOYS": 20, "TOOBA STUFF TOYS LAHORE": 21, "TOYS AND TOYS LAHORE": 22,
};
const STATIONERY = [3, 4, 5, 6, 8, 12, 16, 17, 19, 21];
const BRAND = { Barbie: 1, Chicco: 4, Deli: 6, LEGO: 12, Mattel: 17, Pelikan: 19, Yalong: 22, Disney: 40 };

/** The rules as the live shop starts (owner 2026-10-20: ticks exactly as today's patterns). */
const live = (over = {}) => {
  const r = structuredClone(DEFAULT_RULES);
  r.big.groups[0].supplier_ids = [9];
  r.big.groups[1].supplier_ids = [22];
  r.bbtt.supplier_ids = [9, 22];
  r.stationery.supplier_ids = STATIONERY;
  r.stationery.brand_ids = [6, 19, 22];
  r.stationery.brand_names = ["Deli", "Pelikan", "Yalong"];
  return { ...r, ...over };
};
const RULES = live();

const p = (over, rules = RULES) => {
  const { supplierName = "SMART TOYS", brandName = null, ...rest } = over || {};
  return priceRule({
    cost: 1000, supplierId: SUP[supplierName] ?? null, name: "ROBOT", isBrand: false,
    brandId: brandName ? BRAND[brandName] ?? null : null, brandName, ...rest,
  }, rules);
};

describe("roundPrice", () => {
  it("rounds to the nearest 10 (owner: 1,000 ÷ 6 = 166.67 → 170)", () => {
    expect(roundPrice(166.67, 10)).toBe(170);
    expect(roundPrice(1384, 10)).toBe(1380);
    expect(roundPrice(1385, 10)).toBe(1390);
  });
  it("or the nearest 50 / 100 (F10 decision 7)", () => {
    expect(roundPrice(1374, 50)).toBe(1350);
    expect(roundPrice(1375, 50)).toBe(1400);
    expect(roundPrice(1449, 100)).toBe(1400);
    expect(roundPrice(1450, 100)).toBe(1500);
  });
});

describe("same prices as the rules written into the program before F10", () => {
  // [supplier, name, isBrand, brand, cost, rule, %, price] = output of the old
  // priceRules.js (by supplier name) on 2026-10-20, before the rules moved.
  it.each([
    ["BABY LAND LAHORE", "BABY TRICYCLE RED", false, null, 4000, "big", 80, 7200],
    ["BABY LAND LAHORE", "BABY TRICYCLE RED", false, null, 12000, "big", 65, 19800],
    ["BABY LAND LAHORE", "SLIDER PUZZLE", false, null, 300, "nonbrand", 185, 860],
    ["BABY LAND LAHORE", "KIDS SLIDE 3 STEP", false, null, 9999, "big", 80, 18000],
    ["BABY LAND LAHORE", "HIGHCHAIR BABY", false, null, 6000, "big", 80, 10800],
    ["BABY LAND LAHORE", "R/O JEEP", false, null, 15000, "big", 65, 24750],
    ["BABY LAND LAHORE", "RIDE ON CAR", false, null, 8000, "big", 80, 14400],
    ["BABY LAND LAHORE", "R/C MOTOR BIKE", false, null, 2500, "nonbrand", 145, 6130],
    ["TOYS AND TOYS LAHORE", "KICK SCOOTER 3 WHEEL", false, null, 3000, "big", 80, 5400],
    ["TOYS AND TOYS LAHORE", "BABY TRICYCLE", false, null, 3000, "nonbrand", 135, 7050],
    ["TOYS AND TOYS LAHORE", "SKATE BOARD", false, null, 1200, "bbtt", 110, 2520],
    ["TOYS AND TOYS LAHORE", "SKATE BOARD", true, "Barbie", 1200, "brand", 110, 2520],
    ["BABY LAND LAHORE", "JUMPING AIR BALL", false, null, 600, "bbtt", 110, 1260],
    ["BABY LAND LAHORE", "NET BALL", false, null, 450, "bbtt", 110, 950],
    ["AL HASSAN TRADERS", "GEL PEN", false, null, 40, "stationery", 140, 100],
    ["AL HASSAN TRADERS", "GEL PEN", true, "Deli", 40, "stationery", 140, 100],
    ["A TO Z CONSUMERS", "PENCIL BOX", true, "Yalong", 200, "stationery", 140, 480],
    ["A TO Z CONSUMERS", "PENCIL BOX", true, "Pelikan", 800, "stationery", 140, 1920],
    ["A TO Z CONSUMERS", "CLAY 100G", false, null, 152, "nonbrand", 185, 430],
    ["A TO Z CONSUMERS", "CLAY 100G", false, null, 499, "nonbrand", 185, 1420],
    ["A TO Z CONSUMERS", "CLAY 100G", false, null, 500, "nonbrand", 175, 1380],
    ["A TO Z CONSUMERS", "X", false, null, 1000, "nonbrand", 165, 2650],
    ["A TO Z CONSUMERS", "X", false, null, 1499, "nonbrand", 165, 3970],
    ["A TO Z CONSUMERS", "X", false, null, 2000, "nonbrand", 145, 4900],
    ["A TO Z CONSUMERS", "X", false, null, 2999, "nonbrand", 145, 7350],
    ["A TO Z CONSUMERS", "X", false, null, 3000, "nonbrand", 135, 7050],
    ["A TO Z CONSUMERS", "X", false, null, 25000, "nonbrand", 135, 58750],
    ["A TO Z CONSUMERS", "LEGO SET", true, "LEGO", 499, "brand", 130, 1150],
    ["A TO Z CONSUMERS", "LEGO SET", true, "LEGO", 999, "brand", 120, 2200],
    ["A TO Z CONSUMERS", "LEGO SET", true, "LEGO", 1999, "brand", 110, 4200],
    ["A TO Z CONSUMERS", "LEGO SET", true, "LEGO", 2999, "brand", 100, 6000],
    ["A TO Z CONSUMERS", "LEGO SET", true, "LEGO", 4999, "brand", 95, 9750],
    ["A TO Z CONSUMERS", "LEGO SET", true, "LEGO", 5000, "brand", 85, 9250],
    ["A TO Z CONSUMERS", "LEGO SET", true, "LEGO", 137.75, "brand", 130, 320],
    ["TOOBA STUFF TOYS LAHORE", "TEDDY", false, null, 700, "stationery", 140, 1680],
    ["AMIR STATIONER", "COPY", false, null, 90, "stationery", 140, 220],
    ["SMART TOYS", "CAR", false, null, 0, "nonbrand", 185, 0],
  ])("%s · %s · brand %s %s · cost %d → %s +%d %% = %d", (supplierName, name, isBrand, brandName, cost, key, pct, price) => {
    expect(p({ supplierName, name, isBrand, brandName, cost })).toMatchObject({ key, pct, price });
  });
});

describe("non-brand cost bands", () => {
  it.each([
    [80, 185], [100, 185], [499, 185], [500, 175], [999, 175], [1000, 165], [1499, 165],
    [1500, 155], [1999, 155], [2000, 145], [2999, 145], [3000, 135], [20000, 135],
  ])("cost %d → +%d %%", (cost, pct) => {
    const r = p({ cost });
    expect(r).toMatchObject({ key: "nonbrand", pct });
    expect(r.price).toBe(roundPrice(cost * (1 + pct / 100), 10));
  });
  it("the owner's own example: cost 1,000 + 150 % = 2,500 → here 165 % = 2,650", () => {
    expect(p({ cost: 1000 }).price).toBe(2650);
  });
});

describe("brand cost bands", () => {
  it.each([[499, 130], [500, 120], [1000, 110], [1999, 110], [2000, 100], [3000, 95], [4999, 95], [5000, 85]])(
    "cost %d → +%d %%", (cost, pct) => {
      expect(p({ cost, isBrand: true, brandName: "Mattel" })).toMatchObject({ key: "brand", pct });
    });
});

describe("Baby Land big items and the T&T scooty", () => {
  it("Baby Land's big items: 80 %, 65 % from cost 10,000", () => {
    expect(p({ supplierName: "BABY LAND LAHORE", name: "TRICYCLE 3 WHEEL", cost: 5000 })).toMatchObject({ key: "big", pct: 80, price: 9000 });
    expect(p({ supplierName: "BABY LAND LAHORE", name: "BABY STROLLER DELUXE", cost: 10000 })).toMatchObject({ key: "big", pct: 65, price: 16500 });
    for (const name of ["TORI CAR", "BICYCLE 16\"", "SLIDE BIG", "BABY WALKER BOX", "TRAMPOLINE 6FT", "RIDING HORSE", "ELECTRIC SWING",
      "STUDY TABLE", "HIGH CHAIR", "BOUNCER", "SCOOTER 3 WHEEL", "JUMPOLINE"]) {
      expect(p({ supplierName: "BABY LAND LAHORE", name }).key).toBe("big");
    }
  });
  it("real Baby Land bill 47496: spelling on the bill ('TRI CYCLE', 'STROLLE') still counts", () => {
    expect(p({ supplierName: "BABY LAND LAHORE", name: "T-0651 TRI CYCLE COOL MUSIC LIGHT", cost: 4950 })).toMatchObject({ key: "big", price: 8910 });
    expect(p({ supplierName: "BABY LAND LAHORE", name: "STROLLE SMART FOLD KIDILO KHAKI", cost: 18500 })).toMatchObject({ key: "big", pct: 65, price: 30530 });
  });
  it("ride-ons count as big items (owner 2026-10-03); small bikes don't", () => {
    expect(p({ supplierName: "BABY LAND LAHORE", name: "MOTOR BIKE R/O 1B 1M LED LIGHT", cost: 13500 })).toMatchObject({ key: "big", pct: 65, price: 22280 });
    expect(p({ supplierName: "BABY LAND LAHORE", name: "KIDS RIDE ON JEEP" }).key).toBe("big");
    expect(p({ supplierName: "BABY LAND LAHORE", name: "KIDS RIDEON CAR" }).key).toBe("big");
    expect(p({ supplierName: "BABY LAND LAHORE", name: "R/C MOTER BIKE" }).key).toBe("nonbrand");
    expect(p({ supplierName: "BABY LAND LAHORE", name: "METAL BIKE SMAW" }).key).toBe("nonbrand");
    expect(p({ supplierName: "BABY LAND LAHORE", name: "CARRY COTT HANDLE +PAD" }).key).toBe("nonbrand");
  });
  it("a brand big item at Baby Land still uses the big-item rule (it comes first)", () => {
    expect(p({ supplierName: "BABY LAND LAHORE", name: "CHICCO STROLLER", isBrand: true, brandName: "Chicco" }).key).toBe("big");
  });
  it("T&T: only the scooty", () => {
    expect(p({ supplierName: "TOYS AND TOYS LAHORE", name: "KIDS SCOOTY PINK" }).key).toBe("big");
    expect(p({ supplierName: "TOYS AND TOYS LAHORE", name: "BABY WALKER" }).key).toBe("nonbrand");
  });
  it("a word inside another word doesn't count (SLIDER PUZZLE is not a slide)", () => {
    expect(p({ supplierName: "BABY LAND LAHORE", name: "SLIDER PUZZLE" }).key).toBe("nonbrand");
  });
  it("other suppliers' strollers are normal toys", () => {
    expect(p({ supplierName: "SMART TOYS", name: "BABY STROLLER" }).key).toBe("nonbrand");
  });
});

describe("non-brand B.B Land and T&T list: 110 %", () => {
  it.each(["SKATE BOARD", "SKATEBOARD LED", "SKATE SHOES", "AIR ANIMAL HORSE", "JUMPING AIR BALL", "NET BALL"])("%s", (name) => {
    expect(p({ supplierName: "TOYS AND TOYS LAHORE", name, cost: 800 })).toMatchObject({ key: "bbtt", pct: 110, price: 1680 });
    expect(p({ supplierName: "BABY LAND LAHORE", name }).key).toBe("bbtt");
  });
  it("only when non-brand", () => {
    expect(p({ supplierName: "TOYS AND TOYS LAHORE", name: "SKATE BOARD", isBrand: true, brandName: "Disney" }).key).toBe("brand");
  });
});

describe("stuff and stationery: 140 %", () => {
  it.each(["AL HASSAN TRADERS", "AMIR STATIONER", "SAAD STATIONER", "TOOBA STUFF TOYS LAHORE", "REHMAN STUFF TOYS",
    "AKBAR & CO STATIONERS", "AQEEL STUFF TOYS", "AZMAT STATIONERY RWP", "JAHANGIR BOOKS LAHORE", "RABIA BOOKS LAHORE"])(
    "supplier %s", (supplierName) => {
      expect(p({ supplierName, cost: 1000 })).toMatchObject({ key: "stationery", pct: 140, price: 2400 });
    });
  it("REHMAT TOYS RWP is not Rehman Stuff Toys", () => {
    expect(p({ supplierName: "REHMAT TOYS RWP" }).key).toBe("nonbrand");
  });
  it.each(["Yalong", "Deli", "Pelikan"])("brand %s counts as stationery (by brand id)", (brandName) => {
    expect(p({ isBrand: true, brandName }).key).toBe("stationery");
  });
  it("a new toy's brand chosen by name (no id yet) counts too, spelling ignored", () => {
    expect(priceRule({ cost: 100, supplierId: 20, name: "PEN", isBrand: true, brandId: null, brandName: "YA-LONG" }, RULES).key).toBe("stationery");
  });
});

describe("the owner's edits (F10)", () => {
  it("ticking a supplier moves it into the rule; unticking takes it out", () => {
    expect(p({ supplierName: "A TO Z CONSUMERS" }).key).toBe("nonbrand");
    const r = live();
    r.stationery.supplier_ids = [...STATIONERY, 1];
    expect(p({ supplierName: "A TO Z CONSUMERS", cost: 100 }, r)).toMatchObject({ key: "stationery", price: 240 });
    r.stationery.supplier_ids = [1];
    expect(p({ supplierName: "AL HASSAN TRADERS" }, r).key).toBe("nonbrand");
  });
  it("a changed % and a changed band are used", () => {
    const r = live();
    r.stationery.pct = 150;
    r.nonbrand.bands = [[1000, 200], [null, 100]];
    expect(p({ supplierName: "AL HASSAN TRADERS", cost: 100 }, r)).toMatchObject({ pct: 150, price: 250 });
    expect(p({ cost: 999 }, r)).toMatchObject({ pct: 200, price: 3000 });
    expect(p({ cost: 1000 }, r)).toMatchObject({ pct: 100, price: 2000 });
  });
  it("the big-item cost where the lower % starts can change", () => {
    const r = live();
    r.big.high_from_cost = 5000;
    r.big.high_pct = 60;
    expect(p({ supplierName: "BABY LAND LAHORE", name: "SWING", cost: 5000 }, r)).toMatchObject({ key: "big", pct: 60, price: 8000 });
  });
  it("an added word counts; a removed word doesn't", () => {
    const r = live();
    r.big.groups[0].words = [...r.big.groups[0].words, "baby cot"];
    expect(p({ supplierName: "BABY LAND LAHORE", name: "WOODEN BABY COT" }, r).key).toBe("big");
    r.big.groups[0].words = r.big.groups[0].words.filter((w) => w !== "swing");
    expect(p({ supplierName: "BABY LAND LAHORE", name: "ELECTRIC SWING" }, r).key).toBe("nonbrand");
  });
  it("rounding to 50 / 100", () => {
    expect(p({ cost: 1000 }, live({ rounding: 50 })).price).toBe(2650);
    expect(p({ cost: 1010 }, live({ rounding: 50 })).price).toBe(2700); // 2,676.5
    expect(p({ cost: 1010 }, live({ rounding: 100 })).price).toBe(2700);
  });
  it("no supplier chosen: only the brand / non-brand bands", () => {
    expect(priceRule({ cost: 100, supplierId: null, name: "TRICYCLE", isBrand: false }, RULES).key).toBe("nonbrand");
  });
});

describe("the shop chooses another rule", () => {
  it("a chosen rule replaces the one found", () => {
    expect(p({ supplierName: "BABY LAND LAHORE", name: "TRICYCLE", rule: "nonbrand", cost: 1000 })).toMatchObject({ key: "nonbrand", pct: 165 });
    expect(p({ rule: "stationery" }).pct).toBe(140);
  });
  it("every rule has a label for the picker, with the shop's own %", () => {
    expect(rulesList(RULES).map((r) => r.key)).toEqual(["big", "bbtt", "stationery", "brand", "nonbrand"]);
    expect(rulesList(RULES).map((r) => r.label)).toEqual([
      "Big item 80 % / 65 %", "B.B Land & T&T list 110 %", "Stuff & stationery 140 %", "Brand, by cost", "Non-brand, by cost",
    ]);
    const r = live();
    r.stationery.pct = 150;
    expect(rulesList(r)[2].label).toBe("Stuff & stationery 150 %");
  });
  it("no cost → no price", () => {
    expect(p({ cost: 0 }).price).toBe(0);
  });
});

describe("wordsMatch", () => {
  it("whole words; a space may be left out; an s / es on the end still counts", () => {
    expect(wordsMatch(["high chair"], "HIGHCHAIR BABY")).toBe(true);
    expect(wordsMatch(["high chair"], "HIGH CHAIRS")).toBe(true);
    expect(wordsMatch(["slide"], "SLIDER PUZZLE")).toBe(false);
    expect(wordsMatch(["r/o"], "MOTOR BIKE R/O")).toBe(true);
    expect(wordsMatch([], "ANYTHING")).toBe(false);
    expect(wordsMatch(["a.b(c"], "A.B(C TOY")).toBe(true); // typed characters are plain text, not a pattern
  });
});

describe("validateRules (F10 decision 4)", () => {
  it("the starting rules are fine", () => {
    expect(validateRules(RULES)).toEqual([]);
  });
  it("every % between 30 and 300", () => {
    const r = live();
    r.stationery.pct = 25;
    r.big.high_pct = 301;
    r.brand.bands[2][1] = "";
    const e = validateRules(r);
    expect(e).toContain("Stuff & stationery: the % must be between 30 and 300.");
    expect(e).toContain("Big item: the % from the higher cost must be between 30 and 300.");
    expect(e).toContain("Brand, by cost: row 3's % must be between 30 and 300.");
  });
  it("bands must rise and not overlap; the last row has no top", () => {
    const r = live();
    r.nonbrand.bands = [[1000, 185], [800, 175], [null, 135]];
    expect(validateRules(r)).toContain("Non-brand, by cost: row 2's cost must be higher than row 1's.");
    r.nonbrand.bands = [[1000, 185], [1000, 175], [null, 135]];
    expect(validateRules(r)).toContain("Non-brand, by cost: row 2's cost must be higher than row 1's.");
    r.nonbrand.bands = [[1000, 185], [2000, 175]];
    expect(validateRules(r)).toContain("Non-brand, by cost: the last row must be \"and above\".");
    r.nonbrand.bands = [];
    expect(validateRules(r)).toContain("Non-brand, by cost: needs at least one row.");
  });
  it("rounding is 10, 50 or 100", () => {
    expect(validateRules(live({ rounding: 25 }))).toContain("Rounding must be to the nearest 10, 50 or 100.");
  });
  it("the big-item cost where the lower % starts must be above 0", () => {
    const r = live();
    r.big.high_from_cost = 0;
    expect(validateRules(r)).toContain("Big item: the cost where the lower % starts must be above 0.");
  });
});

describe("previewRows (F10 decision 4)", () => {
  it("sample costs 200, 800, 2,500, 12,000: old vs new price per rule", () => {
    expect(SAMPLE_COSTS).toEqual([200, 800, 2500, 12000]);
    const next = live();
    next.stationery.pct = 150;
    const rows = previewRows(RULES, next);
    expect(rows.map((r) => r.key)).toEqual(["big", "bbtt", "stationery", "brand", "nonbrand"]);
    const st = rows.find((r) => r.key === "stationery");
    expect(st.label).toBe("Stuff & stationery 150 %");
    expect(st.cells).toEqual([
      { cost: 200, old: 480, new: 500, changed: true },
      { cost: 800, old: 1920, new: 2000, changed: true },
      { cost: 2500, old: 6000, new: 6250, changed: true },
      { cost: 12000, old: 28800, new: 30000, changed: true },
    ]);
    expect(rows.find((r) => r.key === "big").cells.map((c) => [c.old, c.changed])).toEqual([[360, false], [1440, false], [4500, false], [19800, false]]);
  });
});

describe("brandChoices", () => {
  it("is Catalog → Brands (F10 decision 5: one brand list), sorted", () => {
    expect(brandChoices([{ id: 7, name: "Fisher-Price" }, { id: 3, name: "Burago" }, { id: 99, name: "Generic" }]))
      .toEqual(["Burago", "Fisher-Price", "Generic"]);
    expect(brandChoices([])).toEqual([]);
  });
});
