// One Toy Store pilot, blocker 3a: the counter keeps a copy of the catalogue so
// scanning and searching work with the internet down.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/api", () => ({ api: { raw: vi.fn() } }));

import { api } from "../../src/api";
import {
  buildIndex,
  lookupCode,
  searchIndex,
  variantsFor,
  refreshCatalogue,
  loadCatalogue,
  getCatalogueIndex,
  resetCatalogueForTests,
} from "../../src/utils/offlineCatalogue";

const CATALOGUE = {
  products: [
    { id: 1, name: "LEGO City Fire Truck", barcode: "5702017161", sku: "LEGO-60374", plu_code: null, price: "8500.00", has_variants: false },
    { id: 2, name: "Hot Wheels Assortment", barcode: "0887961000", sku: "HW-ASSORT", plu_code: null, price: "450.00", has_variants: true },
    { id: 3, name: "Barbie Dreamhouse", barcode: null, sku: "BRB-DH", plu_code: "4321", price: "45000.00", has_variants: false },
  ],
  variants: [
    { id: 70, product_id: 2, sku: "HW-TWINMILL", barcode: "8901234567897", price: "450.00", options: [{ attribute_name: "Model", option_value: "Twin Mill" }] },
    { id: 71, product_id: 2, sku: "HW-BONESHAKER", barcode: "8901234567898", price: null, options: [{ attribute_name: "Model", option_value: "Bone Shaker" }] },
  ],
};

// The page can't read the ETag header cross-origin, so the version travels in the body.
function okResponse(body, version = "v1") {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ...body, version }) };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetCatalogueForTests();
});

describe("lookupCode — the offline scan", () => {
  const index = buildIndex(CATALOGUE);

  it("finds a product by barcode, SKU or PLU", () => {
    expect(lookupCode(index, "5702017161").product.id).toBe(1);
    expect(lookupCode(index, "LEGO-60374").product.id).toBe(1);
    expect(lookupCode(index, "4321").product.id).toBe(3);
  });

  it("a variant's own barcode or SKU gives that exact variant and its parent", () => {
    const hit = lookupCode(index, "8901234567898");
    expect(hit.product.id).toBe(2);
    expect(hit.variant).toMatchObject({ id: 71, sku: "HW-BONESHAKER" });
    expect(lookupCode(index, "HW-TWINMILL").variant.id).toBe(70);
  });

  it("an unknown code finds nothing", () => {
    expect(lookupCode(index, "0000000")).toBeNull();
    expect(lookupCode(index, "")).toBeNull();
  });

  it("offline items say their stock is unknown, so the till doesn't call them out of stock", () => {
    expect(lookupCode(index, "5702017161").product.stock_unknown).toBe(true);
  });
});

describe("searchIndex — the offline search box", () => {
  const index = buildIndex(CATALOGUE);

  it("matches part of a name, any case, sorted by name", () => {
    expect(searchIndex(index, "hot").map((p) => p.id)).toEqual([2]);
    expect(searchIndex(index, "E").map((p) => p.name)).toEqual([
      "Barbie Dreamhouse", "Hot Wheels Assortment", "LEGO City Fire Truck",
    ]);
  });

  it("searches barcode, SKU and price like the online search, and one field when asked", () => {
    expect(searchIndex(index, "brb").map((p) => p.id)).toEqual([3]);
    expect(searchIndex(index, "8500").map((p) => p.id)).toEqual([1]);
    expect(searchIndex(index, "LEGO", "sku").map((p) => p.id)).toEqual([1]);
    expect(searchIndex(index, "Barbie", "sku")).toEqual([]);
  });

  it("returns at most 50 results", () => {
    const many = buildIndex({
      products: Array.from({ length: 80 }, (_, i) => ({ id: i + 1, name: `Toy ${i}`, price: "1" })),
      variants: [],
    });
    expect(searchIndex(many, "toy")).toHaveLength(50);
  });

  // D60: same order as GET /api/products/search — exact code, code starts
  // with, name contains, then the rest; the cap never hides the exact item.
  it("puts the exact code first, then codes starting with it, then names, then prices", () => {
    const shop = buildIndex({
      products: [
        { id: 1, name: "ZZZ POP TUBES-POP-02", sku: "2516", price: "250" },
        { id: 2, name: "YYY Ball", sku: "25160", price: "300" },
        { id: 3, name: "XXX Kite", sku: "K-1", barcode: "2516777", price: "400" },
        { id: 4, name: "MMM Car 2516", sku: "C-9", price: "500" },
        { id: 5, name: "BBB Doll", sku: "D-1", price: "2516" },
        { id: 6, name: "WWW Melon", sku: "M-1", plu_code: "4011", price: "120" },
        ...Array.from({ length: 60 }, (_, i) => ({ id: 100 + i, name: `AA filler 2516 ${String(i).padStart(2, "0")}`, sku: `F-${i}`, price: "10" })),
      ],
      variants: [],
    });
    const names = searchIndex(shop, "2516").map((p) => p.name);
    expect(names).toHaveLength(50);
    expect(names.slice(0, 4)).toEqual(["ZZZ POP TUBES-POP-02", "XXX Kite", "YYY Ball", "AA filler 2516 00"]);
    expect(names[49]).toBe("AA filler 2516 46");

    const few = buildIndex({ products: shop.products.filter((p) => p.id < 100), variants: [] });
    expect(searchIndex(few, "2516").map((p) => p.id)).toEqual([1, 3, 2, 4, 5]);
    expect(searchIndex(few, "4011").map((p) => p.id)).toEqual([6]);
    expect(searchIndex(few, "k-1").map((p) => p.id)[0]).toBe(3);
  });
});

describe("variantsFor — the offline variant picker", () => {
  it("lists a product's variants with their options; a variant with no own price uses the product's", () => {
    const vs = variantsFor(buildIndex(CATALOGUE), 2);
    expect(vs.map((v) => v.id)).toEqual([70, 71]);
    expect(vs[0].options).toEqual([{ attribute_name: "Model", option_value: "Twin Mill" }]);
    expect(Number(vs[1].price)).toBe(450);
  });
});

describe("refreshCatalogue / loadCatalogue — keeping the copy", () => {
  it("downloads the catalogue, keeps it, and reloads it after a restart without the network", async () => {
    api.raw.mockResolvedValueOnce(okResponse(CATALOGUE));
    const res = await refreshCatalogue("otsshop");
    expect(res.status).toBe("updated");
    expect(api.raw.mock.calls[0][0]).toBe("/api/products/catalogue");
    expect(lookupCode(getCatalogueIndex(), "HW-TWINMILL").variant.id).toBe(70);

    // Browser restarted, internet down: the copy comes back from IndexedDB.
    await resetCatalogueForTests({ keepStorage: true });
    expect(getCatalogueIndex()).toBeNull();
    const loaded = await loadCatalogue("otsshop");
    expect(loaded.productCount).toBe(3);
    expect(lookupCode(getCatalogueIndex(), "5702017161").product.name).toBe("LEGO City Fire Truck");
  });

  it("sends the copy's version and keeps the copy when the server says it's current", async () => {
    api.raw.mockResolvedValueOnce(okResponse(CATALOGUE, "v1"));
    await refreshCatalogue("otsshop");
    expect(api.raw.mock.calls[0][0]).toBe("/api/products/catalogue");
    api.raw.mockResolvedValueOnce({ ok: false, status: 304, headers: { get: () => null }, json: async () => ({}) });
    const res = await refreshCatalogue("otsshop");
    expect(res.status).toBe("current");
    expect(api.raw.mock.calls[1][0]).toBe("/api/products/catalogue?version=v1");
    expect(getCatalogueIndex().products).toHaveLength(3);
  });

  it("a failed download (offline) keeps the copy it already has", async () => {
    api.raw.mockResolvedValueOnce(okResponse(CATALOGUE));
    await refreshCatalogue("otsshop");
    api.raw.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const res = await refreshCatalogue("otsshop");
    expect(res.status).toBe("offline");
    expect(getCatalogueIndex().products).toHaveLength(3);
  });

  it("each shop has its own copy on a shared browser", async () => {
    api.raw.mockResolvedValueOnce(okResponse(CATALOGUE));
    await refreshCatalogue("otsshop");
    await resetCatalogueForTests({ keepStorage: true });
    const other = await loadCatalogue("othershop");
    expect(other).toBeNull();
    expect(getCatalogueIndex()).toBeNull();
  });
});
