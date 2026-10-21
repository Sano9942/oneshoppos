// One Toy Store pilot (owner 2026-10-21): the product page showed every
// section SanoPOS has (wholesale rules, PLU, recipes, catalog visibility,
// reviews, 8 sales-channel switches that do nothing for a shop without the
// built-in web store...) whatever the shop uses. Now each extra section shows
// only when its feature is on, or when this product already has something in
// it (so nothing typed in is ever hidden).
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { productFormSections } from "../../src/pages/redesign/productFormSections";

const { apiState, flagState, presetState } = vi.hoisted(() => ({
  apiState: { get: vi.fn(), put: vi.fn(), post: vi.fn(), del: vi.fn() },
  flagState: { flags: {} },
  presetState: { pos_search_config: { show_barcode: true, show_sku: true } },
}));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ authHeaders: {}, company: { tax_mode: "none" }, hasPerm: () => true }) }));
vi.mock("../../src/hooks/useFeatureFlags", () => ({ default: () => ({ flags: flagState.flags, loading: false }) }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${n}`, symbol: "Rs" }) }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), toast: vi.fn() }) }));
vi.mock("../../src/contexts/PresetContext", async (importOriginal) => ({
  ...(await importOriginal()),
  usePreset: () => ({ labels: {}, hasMode: () => false, unit_vocabulary: null, enabled_modes: [], ...presetState }),
}));

// The live One Toy Store switches that matter here (GET /api/feature-flags,
// 2026-10-21): marketplace_integrations + phase2_smart_collections are ON by
// default even though nothing is connected / no collection exists.
const OTS_FLAGS = {
  phase2g_inventory_intelligence: true, phase2g_variant_picker: true, ai_insights: true,
  marketplace_integrations: true, phase2_smart_collections: true,
};
const NOT_IN_USE = { marketplace_connected: false, published_products: 0, in_use: false };
const CHANNELS = ["pos", "storefront", "shopify", "woocommerce", "daraz", "facebook", "instagram", "whatsapp"]
  .map((code, i) => ({ id: i + 1, code, name: code, type: "online_store", is_published: false }));

let product, channels, reviews, usage;
beforeEach(() => {
  usage = NOT_IN_USE;
  vi.clearAllMocks();
  flagState.flags = OTS_FLAGS;
  presetState.pos_search_config = { show_barcode: true, show_sku: true };
  product = {
    id: 9, name: "BABY CART MOBILE-HE0303", sku: "1947", price: 6590, cost_price: 2695, gst: 0,
    compare_at_price: 0, has_variants: false, bom_type: "standard", status: "active", unit: "pcs",
    safety_stock_days: 3, visibility: "all", supplier_id: 24,
  };
  channels = CHANNELS;
  reviews = [];
  apiState.get.mockImplementation(async (url) => {
    if (url === "/api/products/9") return { product };
    if (url === "/api/products/9/stock") return { stock: [{ outlet_id: 1, outlet_name: "Packages Mall", quantity: "1.000" }] };
    if (url === "/api/products/9/channels") return { channels };
    if (url === "/api/products/9/reviews") return reviews;
    if (url === "/api/sales-channels/usage") return usage;
    return {};
  });
});

async function renderEdit() {
  const { default: ProductFormPage } = await import("../../src/pages/redesign/ProductFormPage");
  render(
    <MemoryRouter initialEntries={["/products/9"]}>
      <Routes><Route path="/products/:id" element={<ProductFormPage />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByDisplayValue("BABY CART MOBILE-HE0303");
}

describe("product page: only the sections the shop uses", () => {
  it("a One Toy Store toy shows the toy-shop sections and none of the extras", async () => {
    await renderEdit();
    for (const keep of ["Selling Price *", "Cost Price", "Category", "Brand", "Supplier", "Identifiers", "Status"]) {
      expect(screen.getByText(keep)).toBeTruthy();
    }
    expect(screen.getByTestId("product-history")).toBeTruthy();
    // Inventory Intelligence is switched on for the shop (Reorder Alerts), so it stays;
    // so do Product Type / Vendor / Tags while Catalog Automation (smart collections) is on.
    expect(screen.getByText("Inventory Intelligence")).toBeTruthy();
    expect(screen.getByText("Vendor")).toBeTruthy();
    for (const gone of [
      "Compare-at Price", "GST %", "Product Type & Recipe", "Variants",
      "Wholesale order rules", "Counter & lane", "Catalog visibility", "Sales Channels", "Reviews", "Write a Review",
    ]) {
      expect(screen.queryByText(gone), gone).toBeNull();
    }
  });

  it("Sales Channels and Compare-at come back once a marketplace is connected or a toy is published", async () => {
    usage = { marketplace_connected: true, published_products: 0, in_use: true };
    await renderEdit();
    expect(await screen.findByText("Sales Channels")).toBeTruthy();
    expect(screen.getByText("Compare-at Price")).toBeTruthy();
  });

  it("stock shows whole pieces, not 1.000", async () => {
    await renderEdit();
    expect(screen.getByText("1 pcs")).toBeTruthy();
    expect(screen.queryByText("1.000 pcs")).toBeNull();
  });

  it("does not ask for per-branch visibility / prices when those features are off", async () => {
    await renderEdit();
    const asked = apiState.get.mock.calls.map(([u]) => u);
    expect(asked).not.toContain("/api/products/9/outlet-visibility");
    expect(asked).not.toContain("/api/products/9/outlet-prices");
  });

  it("never hides something already filled in", async () => {
    flagState.flags = {};
    product = {
      ...product, compare_at_price: 7000, gst: 5, vendor: "LEGO", plu_code: "4011",
      min_order_qty: 12, visibility: "restricted", lead_time_days_override: 9,
    };
    channels = CHANNELS.map((c) => (c.code === "storefront" ? { ...c, is_published: true } : c));
    await renderEdit();
    for (const shown of [
      "Compare-at Price", "GST %", "Vendor", "Counter & lane", "Wholesale order rules",
      "Catalog visibility", "Inventory Intelligence", "Sales Channels", "Reviews",
    ]) {
      expect(screen.getByText(shown), shown).toBeTruthy();
    }
  });
});

describe("productFormSections rules", () => {
  const base = {
    flags: {}, preset: {}, isEdit: true, taxMode: "none", attributeSets: [], channels: [], reviews: [], usage: null,
    form: { bom_type: "standard", has_variants: false, compare_at_price: "", gst: "", product_type: "", vendor: "", tags: "",
      lead_time_days_override: "", min_order_qty: "", order_increment: "", visibility: "all", plu_code: "", age_restricted: false },
  };
  const s = (over = {}, form = {}) => productFormSections({ ...base, ...over, form: { ...base.form, ...form } });

  it("each extra section follows its own switch", () => {
    expect(s().recipe).toBe(false);
    expect(s({ flags: { kit_bom_engine: true } }).recipe).toBe(true);
    expect(s({ flags: { wholesale_field_sales: true } }).wholesale).toBe(true);
    expect(s({ flags: { wholesale_field_sales: true } }).catalogVisibility).toBe(true);
    expect(s({ preset: { pos_search_config: { show_plu: true } } }).counterLane).toBe(true);
    expect(s({ taxMode: "exclusive" }).gst).toBe(true);
    expect(s({ flags: { phase2_smart_collections: true } }).productTypeVendorTags).toBe(true);
  });

  it("sales channels / compare-at follow real use, not the default-on marketplace switch", () => {
    const on = { flags: { marketplace_integrations: true }, channels: [{ code: "pos" }] };
    expect(s(on).salesChannels).toBe(false);
    expect(s(on).compareAt).toBe(false);
    expect(s({ ...on, usage: { in_use: true, marketplace_connected: true } }).salesChannels).toBe(true);
    expect(s({ ...on, usage: { in_use: true, marketplace_connected: false } }).compareAt).toBe(true);
    expect(s({ usage: { in_use: true } }).salesChannels).toBe(false); // no channels loaded
    expect(s({ channels: [{ code: "storefront", is_published: true }] }).salesChannels).toBe(true); // this toy is published
    expect(s({ usage: { marketplace_connected: true } }).productTypeVendorTags).toBe(true);
    expect(s({ flags: { marketplace_integrations: true } }).productTypeVendorTags).toBe(false);
  });

  it("variants: only on a new product when the shop has an attribute set, or a product that has them", () => {
    expect(s({ isEdit: false, attributeSets: [] }).variants).toBe(false);
    expect(s({ isEdit: false, attributeSets: [{ id: 1 }] }).variants).toBe(true);
    expect(s({ isEdit: true, attributeSets: [{ id: 1 }] }).variants).toBe(false);
    expect(s({}, { has_variants: true }).variants).toBe(true);
  });

  it("the default safety stock (3 days) alone does not bring back Inventory Intelligence", () => {
    expect(s({}, { safety_stock_days: 3 }).inventoryIntelligence).toBe(false);
  });
});

describe("menu: View Storefront", () => {
  it("follows real sales-channel use, like the Sales Channels box", async () => {
    const mod = await import("../../src/ui/nav-config");
    const groups = Object.values(mod).find((v) => Array.isArray(v) && v.some((g) => g?.items));
    const item = groups.flatMap((g) => g.items).find((i) => i.path === "__STOREFRONT__");
    expect(item.requiredFlag).toBeUndefined();
    expect(item.requiredUsage).toBe("sales_channels");
  });

  it("the menu shows an item with requiredUsage only when that use is on", async () => {
    const { navItemVisible } = await import("../../src/ui/nav-config");
    const item = { name: "View Storefront", requiredUsage: "sales_channels" };
    const ctx = { hasPerm: () => true, flags: {}, hasMode: () => true };
    expect(navItemVisible(item, { ...ctx, usage: { sales_channels: false } })).toBe(false);
    expect(navItemVisible(item, { ...ctx, usage: { sales_channels: true } })).toBe(true);
    expect(navItemVisible({ name: "Products" }, { ...ctx, usage: {} })).toBe(true);
  });
});
