/**
 * Unit tests for competitor import mappers (2-G.14).
 * Pure functions — no DB, no network.
 */

import { describe, test, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const shopify = require("../../services/import/mappers/shopify");
const square = require("../../services/import/mappers/square");
const { getMapper, getTemplate, listSources } = require("../../services/import/mappers");

describe("Shopify mappers", () => {
  test("maps a basic product row", () => {
    const rows = [{
      "Handle": "widget-a",
      "Title": "Widget A",
      "Vendor": "Acme",
      "Type": "Electronics",
      "Variant SKU": "WDG-001",
      "Variant Barcode": "1234567890123",
      "Variant Price": "29.99",
      "Cost per item": "15.00",
      "Variant Inventory Qty": "100",
      "Tax Code": "standard",
      "Status": "active",
    }];
    const mapped = shopify.products(rows);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      name: "Widget A",
      sku: "WDG-001",
      barcode: "1234567890123",
      selling_price: 29.99,
      cost_price: 15.00,
      category: "Electronics",
      brand: "Acme",
      tax: "standard",
      unit: "pcs",
      stock_quantity: 100,
      status: "active",
    });
  });

  test("appends variant title when variant is non-default", () => {
    const rows = [{
      "Title": "Shirt",
      "Option1 Value": "Large",
      "Variant SKU": "SH-L",
      "Variant Price": "12",
    }];
    const mapped = shopify.products(rows);
    expect(mapped[0].name).toBe("Shirt - Large");
  });

  test("strips 'Default Title' variant", () => {
    const rows = [{
      "Title": "Thing",
      "Option1 Value": "Default Title",
      "Variant Price": "5",
    }];
    expect(shopify.products(rows)[0].name).toBe("Thing");
  });

  test("Draft status maps to inactive", () => {
    const rows = [{ "Title": "X", "Variant Price": "1", "Status": "draft" }];
    expect(shopify.products(rows)[0].status).toBe("inactive");
  });

  test("handles missing price gracefully", () => {
    const rows = [{ "Title": "Free Sample", "Variant SKU": "FS-1" }];
    const mapped = shopify.products(rows);
    expect(mapped[0].name).toBe("Free Sample");
    expect(mapped[0].selling_price).toBe("");
  });

  test("strips currency symbols from price", () => {
    const rows = [{ "Title": "X", "Variant Price": "$29.99" }];
    expect(shopify.products(rows)[0].selling_price).toBe(29.99);
  });

  test("skips rows with no Title", () => {
    const rows = [
      { "Title": "Real Product", "Variant Price": "1" },
      { "Handle": "orphan-variant", "Variant Price": "2" },
    ];
    expect(shopify.products(rows)).toHaveLength(1);
  });

  test("maps customers with full name + joined address", () => {
    const rows = [{
      "First Name": "John",
      "Last Name": "Doe",
      "Email": "john@example.com",
      "Phone": "03001234567",
      "Default Address Address1": "123 Main St",
      "Default Address City": "Karachi",
      "Default Address Country": "Pakistan",
      "Tags": "vip, wholesale",
    }];
    const mapped = shopify.customers(rows);
    expect(mapped[0]).toMatchObject({
      name: "John Doe",
      email: "john@example.com",
      mobile: "03001234567",
      address: "123 Main St, Karachi, Pakistan",
      occupation: "vip, wholesale",
    });
  });

  test("customer with empty address fields still maps", () => {
    const rows = [{ "First Name": "Jane", "Last Name": "", "Email": "j@x.com" }];
    const mapped = shopify.customers(rows);
    expect(mapped[0].name).toBe("Jane");
    expect(mapped[0].address).toBe("");
  });
});

describe("Square mappers", () => {
  test("maps a product with location-specific stock column", () => {
    const rows = [{
      "Item Name": "Widget A",
      "SKU": "WDG-001",
      "GTIN": "1234567890123",
      "Category": "Electronics",
      "Reporting Category": "Retail",
      "Price": "29.99",
      "Default Unit Cost": "15.00",
      "Tax": "GST 17%",
      "Current Quantity Main Street": "100",
    }];
    const mapped = square.products(rows);
    expect(mapped[0]).toMatchObject({
      name: "Widget A",
      sku: "WDG-001",
      barcode: "1234567890123",
      selling_price: 29.99,
      cost_price: 15,
      category: "Electronics",
      brand: "Retail",
      tax: "GST 17%",
      stock_quantity: 100,
    });
  });

  test("picks first non-empty Current Quantity column", () => {
    const rows = [{
      "Item Name": "Widget",
      "Price": "5",
      "Current Quantity Loc A": "",
      "Current Quantity Loc B": "42",
    }];
    expect(square.products(rows)[0].stock_quantity).toBe(42);
  });

  test("customer company name fallback when no first/last", () => {
    const rows = [{ "Company Name": "Acme Corp", "Email Address": "sales@acme.com" }];
    expect(square.customers(rows)[0].name).toBe("Acme Corp");
  });

  test("customer with Surname field", () => {
    const rows = [{
      "First Name": "John",
      "Surname": "Doe",
      "Email Address": "j@x.com",
      "Phone Number": "0300",
      "Postal Address": "1 St",
      "Reference ID": "REF-1",
      "Group Names": "VIP",
    }];
    const mapped = square.customers(rows);
    expect(mapped[0]).toMatchObject({
      name: "John Doe",
      email: "j@x.com",
      mobile: "0300",
      address: "1 St",
      cnic: "REF-1",
      occupation: "VIP",
    });
  });

  test("skips product rows with no Item Name", () => {
    const rows = [
      { "Item Name": "Real", "Price": "1" },
      { "SKU": "orphan" },
    ];
    expect(square.products(rows)).toHaveLength(1);
  });
});

describe("Mapper registry", () => {
  test("getMapper returns function for valid source+entity", () => {
    expect(typeof getMapper("shopify", "products")).toBe("function");
    expect(typeof getMapper("square", "customers")).toBe("function");
  });

  test("getMapper returns null for unknown source", () => {
    expect(getMapper("lightspeed", "products")).toBeNull();
    expect(getMapper("", "products")).toBeNull();
  });

  test("getMapper returns null for unknown entity", () => {
    expect(getMapper("shopify", "invoices")).toBeNull();
  });

  test("getTemplate returns headers + examples for valid pair", () => {
    const tpl = getTemplate("shopify", "products");
    expect(tpl.headers).toContain("Title");
    expect(tpl.headers).toContain("Variant SKU");
    expect(tpl.examples.length).toBeGreaterThan(0);
  });

  test("getTemplate returns null for unsupported pair", () => {
    expect(getTemplate("shopify", "suppliers")).toBeNull();
    expect(getTemplate("lightspeed", "products")).toBeNull();
  });

  test("listSources includes shopify and square", () => {
    const sources = listSources();
    expect(sources).toContain("shopify");
    expect(sources).toContain("square");
  });
});
