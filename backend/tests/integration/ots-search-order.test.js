/**
 * ots-search-order.test.js — One Toy Store pilot D60.
 *
 * 2026-10-02: typing `2516` (SKU of POP TUBES) in the till search listed every
 * item with "2516" anywhere (name, barcode, price, description) sorted A to Z
 * by name and capped at 50, so the wanted item was buried or missing.
 * Order now: exact SKU / barcode / PLU first, then a code that starts with the
 * text, then a name that contains it, then the rest (price, description);
 * name A to Z inside each group. The exact item is never cut off by the cap.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const admin = () => makeRequest(app, ADMIN_ID);

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  await db.query(`
    INSERT INTO products (name, price, sku, barcode, plu_code, description_html) VALUES
      ('ZZZ POP TUBES-POP-02', 250, '2516', NULL, NULL, NULL),
      ('YYY Ball',             300, '25160', NULL, NULL, NULL),
      ('XXX Kite',             400, 'K-1', '2516777', NULL, NULL),
      ('MMM Car 2516',         500, 'C-9', NULL, NULL, NULL),
      ('BBB Doll',             2516, 'D-1', NULL, NULL, NULL),
      ('AAA Puzzle',           600, 'P-1', NULL, NULL, 'box code 2516'),
      ('WWW Melon',            120, 'M-1', NULL, '4011', NULL)
  `);
  // 60 more name matches that sort before everything else: today they fill
  // the 50-row cap and push the exact item out.
  const values = [];
  for (let i = 0; i < 60; i++) values.push(`('AA filler 2516 ${String(i).padStart(2, "0")}', 10, 'F-${i}')`);
  await db.query(`INSERT INTO products (name, price, sku) VALUES ${values.join(",")}`);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const search = async (query, extra = {}) => {
  const res = await admin().get("/api/products/search").query({ query, ...extra });
  expect(res.status).toBe(200);
  return res.body.products.map((p) => p.name);
};

describe("D60 till search order", () => {
  it("puts the exact SKU first, then codes starting with the text", async () => {
    const names = await search("2516");
    expect(names[0]).toBe("ZZZ POP TUBES-POP-02");
    expect(names.slice(1, 3)).toEqual(["XXX Kite", "YYY Ball"]);
  });

  it("lists name matches next (A to Z), and price / description matches last", async () => {
    const names = await search("2516");
    expect(names.length).toBe(50);
    expect(names[3]).toBe("AA filler 2516 00");
    expect(names[49]).toBe("AA filler 2516 46");
    expect(names).not.toContain("BBB Doll"); // price-only match, beyond the cap
  });

  it("puts price / description matches after name matches when few", async () => {
    await db.query("UPDATE products SET deleted_at = NOW() WHERE name LIKE 'AA filler%'");
    try {
      const names = await search("2516");
      expect(names).toEqual([
        "ZZZ POP TUBES-POP-02", "XXX Kite", "YYY Ball", "MMM Car 2516", "AAA Puzzle", "BBB Doll",
      ]);
    } finally {
      await db.query("UPDATE products SET deleted_at = NULL WHERE name LIKE 'AA filler%'");
    }
  });

  it("finds an exact PLU code and puts it first", async () => {
    const names = await search("4011");
    expect(names[0]).toBe("WWW Melon");
  });

  it("matches the exact code whatever the case", async () => {
    const names = await search("k-1");
    expect(names[0]).toBe("XXX Kite");
  });
});
