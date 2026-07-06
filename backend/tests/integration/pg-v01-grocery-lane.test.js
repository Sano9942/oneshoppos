/**
 * V01 retail depth — grocery lane end-to-end (the plan's verification bar).
 *
 * Exercises the REAL scan endpoint against a fresh schema for the flows a
 * supermarket lane depends on:
 *   - price-embedded scale label → decoded FINAL price, price_locked + tare_locked
 *   - weight-embedded scale label → decoded net weight, tare_locked
 *   - PLU rapid entry → resolves by products.plu_code
 *   - age-restricted product → flag surfaced for the POS attest gate
 *   - UNMAPPED scale item → 404 { code:"unmapped_scale_item" }, never a silent
 *     zero-price line (the plan's explicit empty/error case)
 *   - a 13-digit code under a disabled scheme falls through to normal lookup
 *
 * Plus the fresh-grocery + fresh-textile signup seeding (batch/kit engines).
 *
 * The harness stubs loadCompanyProfile, so the tenant barcode scheme is injected
 * into req.company via a middleware registered before the products route (which
 * is exactly where the authoritative decode reads it).
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");
const {
  seedRetailFlags,
  seedRetailSubtypeFlags,
} = require("../../services/retail-flag-preset");

let app, db, deps, cleanup, req;
let activeScheme = null; // read per-request by the injected middleware

const PRICE_SCHEME = {
  enabled: true,
  prefixes: ["21"],
  embed: "price",
  item_code_length: 5,
  value_length: 5,
  value_decimals: 2,
  item_code_field: "sku",
  verify_check_digit: true,
};
const WEIGHT_SCHEME = {
  ...PRICE_SCHEME,
  prefixes: ["27"],
  embed: "weight",
  value_decimals: 3,
};

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  // Inject the tenant barcode scheme into req.company (loadCompanyProfile is
  // stubbed by the harness). Registered before the products route.
  app.use((r, _res, next) => {
    r.company = { ...(r.company || {}), barcode_scheme: activeScheme };
    next();
  });
  require("../../routes/products")(app, deps);
  req = makeRequest(app, ADMIN_ID);

  // Product #1: item code 12345 (matched by the price/weight schemes' sku field).
  await db.query("UPDATE products SET sku = '12345', barcode = 'BC-1', price = 100 WHERE id = 1");
  // Product #2: PLU produce code.
  await db.query("UPDATE products SET plu_code = '4011', price = 50 WHERE id = 2");
  // Product #3: age-restricted.
  await db.query("UPDATE products SET age_restricted = true, sku = 'TOBACCO1', price = 500 WHERE id = 3");
}, 60000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

describe("V01 grocery lane — scan endpoint decode", () => {
  test("price-embedded label → decoded final price, price_locked + tare_locked", async () => {
    activeScheme = PRICE_SCHEME;
    // "21" + "12345" + "01299" + check(5) = final price Rs 12.99
    const res = await req.get("/api/products/scan/2112345012995");
    expect(res.status).toBe(200);
    expect(res.body.product.sku).toBe("12345");
    expect(res.body.product.embedded).toEqual({
      embed: "price",
      price: 12.99,
      price_locked: true,
      tare_locked: true,
    });
  });

  test("weight-embedded label → decoded weight (kg), tare_locked, no price lock", async () => {
    activeScheme = WEIGHT_SCHEME;
    // "27" + "12345" + "01234" + check(8) = 1.234 kg
    const res = await req.get("/api/products/scan/2712345012348");
    expect(res.status).toBe(200);
    expect(res.body.product.sku).toBe("12345");
    expect(res.body.product.embedded).toEqual({
      embed: "weight",
      weight: 1.234,
      tare_locked: true,
    });
  });

  test("UNMAPPED scale item → 404 unmapped_scale_item (never a silent zero-price line)", async () => {
    activeScheme = PRICE_SCHEME;
    // item code 54321 has no product
    const res = await req.get("/api/products/scan/2154321010007");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("unmapped_scale_item");
    expect(res.body.item_code).toBe("54321");
    expect(res.body.item_code_field).toBe("sku");
  });

  test("PLU rapid entry → resolves by plu_code, no embedded block", async () => {
    activeScheme = PRICE_SCHEME; // 4-digit code is not 13 digits → not embedded
    const res = await req.get("/api/products/scan/4011");
    expect(res.status).toBe(200);
    expect(res.body.product.plu_code).toBe("4011");
    expect(res.body.product.embedded).toBeUndefined();
  });

  test("age-restricted product surfaces the flag for the POS attest gate", async () => {
    activeScheme = null;
    const res = await req.get("/api/products/scan/TOBACCO1");
    expect(res.status).toBe(200);
    expect(res.body.product.age_restricted).toBe(true);
  });

  test("13-digit code under a DISABLED scheme falls through to normal lookup (404, not unmapped)", async () => {
    activeScheme = { ...PRICE_SCHEME, enabled: false };
    const res = await req.get("/api/products/scan/2112345012995");
    expect(res.status).toBe(404);
    // decode was 'disabled' → normal lookup, code should NOT be the scale error
    expect(res.body.code).toBeUndefined();
  });
});

describe("V01 signup seeding — fresh grocery + fresh textile", () => {
  async function flagEnabled(key) {
    const { rows } = await db.query("SELECT enabled FROM feature_flags WHERE key = $1", [key]);
    return rows[0]?.enabled === true;
  }

  test("fresh grocery gets batch tracking but NOT the kit engine", async () => {
    await seedRetailFlags(db);
    await seedRetailSubtypeFlags(db, "grocery");
    expect(await flagEnabled("batch_expiry_tracking")).toBe(true);
    expect(await flagEnabled("kit_bom_engine")).toBe(false);
    // shares the retail bundle
    expect(await flagEnabled("phase2g_omni_input")).toBe(true);
  });

  test("fresh textile gets batch tracking (roll/lot) and NOT the kit engine", async () => {
    // reset the two engine flags to isolate this preset's effect
    await db.query("UPDATE feature_flags SET enabled = false WHERE key IN ('batch_expiry_tracking','kit_bom_engine')");
    await seedRetailSubtypeFlags(db, "textile");
    expect(await flagEnabled("batch_expiry_tracking")).toBe(true);
    expect(await flagEnabled("kit_bom_engine")).toBe(false);
  });

  test("fresh butcher gets BOTH batch + kit engines (disassembly)", async () => {
    await db.query("UPDATE feature_flags SET enabled = false WHERE key IN ('batch_expiry_tracking','kit_bom_engine')");
    await seedRetailSubtypeFlags(db, "butcher");
    expect(await flagEnabled("batch_expiry_tracking")).toBe(true);
    expect(await flagEnabled("kit_bom_engine")).toBe(true);
  });
});
