// One Toy Store pilot, blocker 3a: every way into the cart asks the server first
// and falls back to the counter's catalogue copy when the server can't be reached.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/api", () => ({ api: { raw: vi.fn(), get: vi.fn() } }));

import { api } from "../../src/api";
import { refreshCatalogue, resetCatalogueForTests } from "../../src/utils/offlineCatalogue";
import { scanProduct, searchProducts, loadVariants, OFFLINE_TIMEOUT_MS } from "../../src/pages/redesign/pos/offlineLookup";

const CATALOGUE = {
  products: [
    { id: 1, name: "LEGO City Fire Truck", barcode: "5702017161", sku: "LEGO-60374", price: "8500.00" },
    { id: 2, name: "Hot Wheels Assortment", barcode: "0887961000", sku: "HW-ASSORT", price: "450.00", has_variants: true },
  ],
  variants: [
    { id: 70, product_id: 2, sku: "HW-TWINMILL", barcode: "8901234567897", price: "450.00", options: [{ attribute_name: "Model", option_value: "Twin Mill" }] },
  ],
};
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
const setOnline = (v) => Object.defineProperty(window.navigator, "onLine", { value: v, configurable: true });

beforeEach(async () => {
  vi.clearAllMocks();
  setOnline(true);
  await resetCatalogueForTests();
  api.raw.mockResolvedValueOnce(json(200, CATALOGUE));
  await refreshCatalogue("default");
  vi.clearAllMocks();
});
afterEach(() => { setOnline(true); vi.useRealTimers(); });

describe("scanProduct", () => {
  it("online: uses the server's answer (it has live stock)", async () => {
    api.raw.mockResolvedValueOnce(json(200, { product: { id: 1, name: "LEGO City Fire Truck", local_stock: 4 } }));
    const r = await scanProduct("5702017161");
    expect(r).toMatchObject({ found: true, offline: false, product: { local_stock: 4 } });
  });

  it("online: a code the server doesn't know is not found (no fallback)", async () => {
    api.raw.mockResolvedValueOnce(json(404, { error: "Product not found" }));
    const r = await scanProduct("5702017161");
    expect(r).toMatchObject({ found: false, offline: false, status: 404, error: "Product not found" });
  });

  it("browser offline: answers from the copy without calling the server", async () => {
    setOnline(false);
    const r = await scanProduct("8901234567897");
    expect(api.raw).not.toHaveBeenCalled();
    expect(r).toMatchObject({ found: true, offline: true, product: { id: 2 }, variant: { id: 70 } });
  });

  it("internet down but the shop Wi-Fi up (fetch fails): answers from the copy", async () => {
    api.raw.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await scanProduct("LEGO-60374")).toMatchObject({ found: true, offline: true, product: { id: 1 } });
  });

  it("server down (502/503): answers from the copy", async () => {
    api.raw.mockResolvedValueOnce(json(502, {}));
    expect(await scanProduct("LEGO-60374")).toMatchObject({ found: true, offline: true });
  });

  it("a server that doesn't answer in time: answers from the copy", async () => {
    vi.useFakeTimers();
    api.raw.mockReturnValueOnce(new Promise(() => {}));
    const p = scanProduct("LEGO-60374");
    await vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS + 10);
    expect(await p).toMatchObject({ found: true, offline: true });
  });

  it("offline and not in the copy: says so plainly", async () => {
    setOnline(false);
    const r = await scanProduct("999");
    expect(r.found).toBe(false);
    expect(r.error).toMatch(/offline/i);
  });

  it("offline with no copy on this counter yet: says so", async () => {
    await resetCatalogueForTests();
    setOnline(false);
    const r = await scanProduct("LEGO-60374");
    expect(r.found).toBe(false);
    expect(r.error).toMatch(/no offline copy/i);
  });
});

describe("searchProducts", () => {
  it("online: the server's results", async () => {
    api.get.mockResolvedValueOnce({ products: [{ id: 1, name: "LEGO City Fire Truck" }] });
    const r = await searchProducts("lego", { outletId: 1 });
    expect(api.get).toHaveBeenCalledWith("/api/products/search", { query: "lego", outlet_id: 1 });
    expect(r).toEqual({ products: [{ id: 1, name: "LEGO City Fire Truck" }], offline: false });
  });

  it("offline: searches the copy", async () => {
    api.get.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const r = await searchProducts("wheels");
    expect(r.offline).toBe(true);
    expect(r.products.map((p) => p.id)).toEqual([2]);
  });

  it("a server error that isn't an outage is passed on", async () => {
    api.get.mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));
    await expect(searchProducts("wheels")).rejects.toThrow("Forbidden");
  });
});

describe("loadVariants", () => {
  it("offline: the product and its variants from the copy", async () => {
    setOnline(false);
    const r = await loadVariants(2);
    expect(r.offline).toBe(true);
    expect(r.product.name).toBe("Hot Wheels Assortment");
    expect(r.variants.map((v) => v.id)).toEqual([70]);
  });

  it("online: product and variants from the server", async () => {
    api.get.mockResolvedValueOnce({ id: 2, name: "HW" }).mockResolvedValueOnce({ variants: [{ id: 70 }] });
    const r = await loadVariants(2, { outletId: 1 });
    expect(api.get).toHaveBeenCalledWith("/api/products/2/variants?outlet_id=1");
    expect(r).toEqual({ product: { id: 2, name: "HW" }, variants: [{ id: 70 }], offline: false });
  });
});
