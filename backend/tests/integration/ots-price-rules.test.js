/**
 * ots-price-rules.test.js — One Toy Store F10: the price rules move out of the
 * program into the database, edited on Settings → Price rules
 * (docs/onetoystore-pilot/PHASE-F-PLAN.md F10, owner 2026-10-20):
 *
 *   1 a rule change only changes future suggestions on supplier bills (no repricing)
 *   2 only Administrators (all_access) change them; bill receivers read them
 *   3 edit inside the 5 rules, order fixed
 *   4 every % 30–300; bands rising, not overlapping; history of every save with
 *     "Go back to this version"
 *   5 one brand list = Catalog → Brands (the website's brands added once)
 *   6 suppliers by tick box; start from what today's name patterns match
 *   7 rounding: nearest 10 / 50 / 100
 *
 *   GET  /api/price-rules                         → { rules, version }
 *   PUT  /api/price-rules { rules }               → 201 a new version
 *   GET  /api/price-rules/history                 → every save, newest first
 *   POST /api/price-rules/history/:id/restore     → 201 a new version = that one
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, MANAGER_ID, CASHIER_ID } = require("../helpers/request");
const { addWebsiteBrands, WEBSITE_BRANDS } = require("../../services/price-rules");

let app, db, cleanup;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const S = Date.now().toString(36).toUpperCase();
const sup = {};
const brand = {};

const get = (as = admin()) => as.get("/api/price-rules");
const put = (rules, as = admin()) => as.put("/api/price-rules").send({ rules });

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  for (const [k, name] of Object.entries({
    bl: `BABY LAND LAHORE ${S}`, tt: `TOYS AND TOYS LAHORE ${S}`, ah: `AL HASSAN TRADERS ${S}`, rs: `REHMAN STUFF TOYS ${S}`,
    rt: `REHMAT TOYS RWP ${S}`, az: `A TO Z CONSUMERS ${S}`, jb: `JAHANGIR BOOKS ${S}`,
  })) sup[k] = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [name])).id;
  for (const name of ["Yalong", "Deli", "Pelikan", "LEGO"]) {
    brand[name] = (await one(
      "INSERT INTO brands (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id", [name])).id;
  }
  // A role that receives bills but is not an Administrator.
  await db.query("INSERT INTO role_permissions (role_id, permission) SELECT role_id, 'receive_supplier_bills' FROM employees WHERE id = $1 ON CONFLICT DO NOTHING", [MANAGER_ID]);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("before any save: the rules the program had, suppliers ticked from today's name patterns (decision 6)", () => {
  let rules;
  beforeAll(async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(null);
    rules = r.body.rules;
  });

  it("the owner's % and bands, nearest 10", () => {
    expect(rules.rounding).toBe(10);
    expect(rules.big).toMatchObject({ pct: 80, high_from_cost: 10000, high_pct: 65 });
    expect(rules.bbtt.pct).toBe(110);
    expect(rules.stationery.pct).toBe(140);
    expect(rules.brand.bands).toEqual([[500, 130], [1000, 120], [2000, 110], [3000, 100], [5000, 95], [null, 85]]);
    expect(rules.nonbrand.bands).toEqual([[500, 185], [1000, 175], [1500, 165], [2000, 155], [3000, 145], [null, 135]]);
    expect(rules.big.groups[0].words).toEqual(expect.arrayContaining(["tricycle", "stroller", "r/o", "ride on", "high chair"]));
    expect(rules.big.groups[1].words).toEqual(["scooter", "scooty", "scooties"]);
    expect(rules.bbtt.words).toEqual(expect.arrayContaining(["skate board", "net ball", "jumping air ball"]));
  });

  it("Baby Land: big items + the B.B Land & T&T list; Toys and Toys: the scooty + the list", () => {
    expect(rules.big.groups[0].supplier_ids).toContain(sup.bl);
    expect(rules.big.groups[0].supplier_ids).not.toContain(sup.tt);
    expect(rules.big.groups[1].supplier_ids).toContain(sup.tt);
    expect(rules.big.groups[1].supplier_ids).not.toContain(sup.bl);
    expect(rules.bbtt.supplier_ids).toEqual(expect.arrayContaining([sup.bl, sup.tt]));
  });

  it("stuff & stationery: the stationery suppliers (Rehmat is not Rehman) and the Yalong / Deli / Pelikan brands", () => {
    expect(rules.stationery.supplier_ids).toEqual(expect.arrayContaining([sup.ah, sup.rs, sup.jb]));
    expect(rules.stationery.supplier_ids).not.toContain(sup.rt);
    expect(rules.stationery.supplier_ids).not.toContain(sup.az);
    expect(rules.stationery.brand_ids.sort()).toEqual([brand.Deli, brand.Pelikan, brand.Yalong].sort());
    expect(rules.stationery.brand_names).toEqual(["Deli", "Pelikan", "Yalong"]);
  });
});

describe("who (decision 2)", () => {
  it("a bill receiver reads the rules but can't change them", async () => {
    expect((await get(makeRequest(app, MANAGER_ID))).status).toBe(200);
    const rules = (await get()).body.rules;
    expect((await put(rules, makeRequest(app, MANAGER_ID))).status).toBe(403);
    expect((await makeRequest(app, MANAGER_ID).get("/api/price-rules/history")).status).toBe(403);
  });
  it("without 'Receive supplier bills' not even read", async () => {
    expect((await get(makeRequest(app, CASHIER_ID))).status).toBe(403);
  });
});

describe("safety (decision 4)", () => {
  it("a bad save is refused with every problem in plain words, and nothing is saved", async () => {
    const rules = (await get()).body.rules;
    rules.stationery.pct = 25;
    rules.big.high_pct = 301;
    rules.rounding = 25;
    rules.nonbrand.bands = [[1000, 185], [800, 175], [null, 135]];
    rules.brand.bands = [[1000, 120], [2000, 110]];
    rules.bbtt.supplier_ids = [sup.bl, 99999999];
    const r = await put(rules);
    expect(r.status).toBe(400);
    expect(r.body.errors).toEqual(expect.arrayContaining([
      "Stuff & stationery: the % must be between 30 and 300.",
      "Big item: the % from the higher cost must be between 30 and 300.",
      "Rounding must be to the nearest 10, 50 or 100.",
      "Non-brand, by cost: row 2's cost must be higher than row 1's.",
      "Brand, by cost: the last row must be \"and above\".",
      "B.B Land & T&T list: a ticked supplier doesn't exist any more.",
    ]));
    expect(Number((await one("SELECT COUNT(*) AS n FROM price_rule_versions")).n)).toBe(0);
  });

  it("a rule can't be added or taken away (decision 3)", async () => {
    const rules = (await get()).body.rules;
    delete rules.bbtt;
    expect((await put(rules)).status).toBe(400);
  });
});

describe("saving, history and going back", () => {
  let firstId;

  it("a save becomes the rules, with who and when; words tidied", async () => {
    const rules = (await get()).body.rules;
    rules.stationery.pct = 150;
    rules.stationery.supplier_ids = [...rules.stationery.supplier_ids, sup.az];
    rules.stationery.brand_names = ["ignored"]; // worked out from the ids, never saved
    rules.rounding = 50;
    rules.big.groups[0].words = [...rules.big.groups[0].words, "  Baby COT ", "baby cot", ""];
    const r = await put(rules);
    expect(r.status).toBe(201);
    firstId = r.body.version.id;
    expect(r.body.version).toMatchObject({ id: expect.any(Number), saved_by_name: expect.any(String) });

    const now = await get();
    expect(now.body.version.id).toBe(firstId);
    expect(now.body.rules.stationery.pct).toBe(150);
    expect(now.body.rules.rounding).toBe(50);
    expect(now.body.rules.stationery.supplier_ids).toContain(sup.az);
    expect(now.body.rules.stationery.brand_names).toEqual(["Deli", "Pelikan", "Yalong"]);
    expect(now.body.rules.big.groups[0].words.filter((w) => w === "baby cot")).toHaveLength(1);
    expect(now.body.rules.big.groups[0].words).not.toContain("");
    const row = await one("SELECT saved_by, config FROM price_rule_versions WHERE id = $1", [firstId]);
    expect(row.saved_by).toBe(ADMIN_ID);
    expect(row.config.stationery.brand_names).toBeUndefined();
  });

  it("history lists every save newest first; Go back saves that version again as the newest", async () => {
    const rules = (await get()).body.rules;
    rules.stationery.pct = 160;
    const second = (await put(rules)).body.version.id;

    const h = await admin().get("/api/price-rules/history");
    expect(h.status).toBe(200);
    expect(h.body.versions.map((v) => v.id)).toEqual([second, firstId]);
    expect(h.body.versions[0]).toMatchObject({ saved_by_name: expect.any(String), restored_from: null });
    expect(h.body.versions[1].rules.stationery.pct).toBe(150);

    const back = await admin().post(`/api/price-rules/history/${firstId}/restore`);
    expect(back.status).toBe(201);
    const now = await get();
    expect(now.body.rules.stationery.pct).toBe(150);
    expect(now.body.version.id).toBe(back.body.version.id);
    const h2 = (await admin().get("/api/price-rules/history")).body.versions;
    expect(h2).toHaveLength(3);
    expect(h2[0]).toMatchObject({ id: back.body.version.id, restored_from: firstId });
  });

  it("going back to a version that doesn't exist", async () => {
    expect((await admin().post("/api/price-rules/history/99999999/restore")).status).toBe(404);
    expect((await makeRequest(app, MANAGER_ID).post(`/api/price-rules/history/${firstId}/restore`)).status).toBe(403);
  });

  it("no toy's price changed (decision 1)", async () => {
    const p = await one("INSERT INTO products (name, sku, price, cost_price) VALUES ($1, $2, 300, 100) RETURNING id, price", [`Pen ${S}`, `PN-${S}`]);
    const rules = (await get()).body.rules;
    rules.nonbrand.bands = [[null, 300]];
    expect((await put(rules)).status).toBe(201);
    expect(Number((await one("SELECT price FROM products WHERE id = $1", [p.id])).price)).toBe(300);
  });
});

describe("the website's brands into Catalog → Brands, once (decision 5)", () => {
  it("adds the missing ones, keeps the shop's own spelling, and a second run adds nothing", async () => {
    await db.query("INSERT INTO brands (name) VALUES ('Fisher-Price'), ('Burago') ON CONFLICT (name) DO NOTHING");
    expect(WEBSITE_BRANDS).toHaveLength(71);
    const added = await addWebsiteBrands(db);
    expect(added).toEqual(expect.arrayContaining(["Avengers", "Paw Patrol", "Weeler", "Mega Blocks"]));
    expect(added).not.toContain("Fisher Price");
    expect(added).not.toContain("Bburago");
    expect(added).not.toContain("LEGO");
    const names = (await db.query("SELECT name FROM brands")).rows.map((r) => r.name);
    expect(names).not.toContain("Fisher Price");
    expect(names).not.toContain("Bburago");
    expect(await addWebsiteBrands(db)).toEqual([]);
  });
});
