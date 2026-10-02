// One Toy Store F9 (d): the shop's price rules for a toy from a supplier bill
// (PHASE-F-PLAN F9, margin sheets confirmed by the owner 2026-10-03 00:15).
// % added on cost; round to the nearest 10; first match wins:
//   1 Baby Land big items & T&T (only scooty): 80 %, 65 % from cost 10,000
//   2 non-brand B.B Land & T&T list (skate board, air animals, net ball…): 110 %
//   3 stuff & stationery suppliers, and the Yalong / Deli / Pelikan brands: 140 %
//   4 brand cost bands   5 non-brand cost bands
import { describe, it, expect } from "vitest";
import { priceRule, roundTo10, brandChoices, RULES } from "../../src/pages/redesign/supplierBill/priceRules";

const p = (over) => priceRule({ cost: 1000, supplierName: "SMART TOYS", name: "ROBOT", isBrand: false, brandName: null, ...over });

describe("roundTo10", () => {
  it("rounds to the nearest 10 (owner: 1,000 ÷ 6 = 166.67 → 170)", () => {
    expect(roundTo10(166.67)).toBe(170);
    expect(roundTo10(1384)).toBe(1380);
    expect(roundTo10(1385)).toBe(1390);
  });
});

describe("non-brand cost bands", () => {
  it.each([
    [80, 185], [100, 185], [499, 185], [500, 175], [999, 175], [1000, 165], [1499, 165],
    [1500, 155], [1999, 155], [2000, 145], [2999, 145], [3000, 135], [20000, 135],
  ])("cost %d → +%d %%", (cost, pct) => {
    const r = p({ cost });
    expect(r).toMatchObject({ key: "nonbrand", pct });
    expect(r.price).toBe(roundTo10(cost * (1 + pct / 100)));
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
  it.each(["AL HASSAN TRADERS", "AMIR STATIONER", "SAAD STATIONER", "TOOBA STUFF TOYS LAHORE", "REHMAN STUFF TOYS", "AMIR BIRTHDAY",
    "AKBAR & CO STATIONERS", "AQEEL STUFF TOYS", "AZMAT STATIONERY RWP", "JAHANGIR BOOKS LAHORE", "RABIA BOOKS LAHORE"])(
    "supplier %s", (supplierName) => {
      expect(p({ supplierName, cost: 1000 })).toMatchObject({ key: "stationery", pct: 140, price: 2400 });
    });
  it("REHMAT TOYS RWP is not Rehman Stuff Toys", () => {
    expect(p({ supplierName: "REHMAT TOYS RWP" }).key).toBe("nonbrand");
  });
  it.each(["Yalong", "Deli", "Pelikan"])("brand %s counts as stationery", (brandName) => {
    expect(p({ isBrand: true, brandName }).key).toBe("stationery");
  });
});

describe("the shop chooses another rule", () => {
  it("a chosen rule replaces the one found", () => {
    expect(p({ supplierName: "BABY LAND LAHORE", name: "TRICYCLE", rule: "nonbrand", cost: 1000 })).toMatchObject({ key: "nonbrand", pct: 165 });
    expect(p({ rule: "stationery" }).pct).toBe(140);
  });
  it("every rule has a label for the picker", () => {
    expect(RULES.map((r) => r.key)).toEqual(["big", "bbtt", "stationery", "brand", "nonbrand"]);
    expect(RULES.every((r) => r.label)).toBe(true);
  });
  it("no cost → no price", () => {
    expect(p({ cost: 0 }).price).toBe(0);
  });
});

describe("brandChoices", () => {
  it("is the website's Brands menu + Graco + Bestway, with SanoPOS's own spelling where it already has the brand", () => {
    const list = brandChoices([{ id: 7, name: "Fisher-Price" }, { id: 3, name: "Burago" }, { id: 99, name: "Generic" }]);
    expect(list).toContain("Fisher-Price");
    expect(list).not.toContain("Fisher Price");
    expect(list).toContain("Burago");
    expect(list).not.toContain("Bburago");
    expect(list).toEqual(expect.arrayContaining(["LEGO", "Graco", "Bestway", "WinFun", "Generic"]));
    expect(list).toEqual([...list].sort((a, b) => a.localeCompare(b)));
  });
});
