/**
 * Shopify CSV mappers.
 *
 * Shopify has shipped 3 subtly different product CSV formats over the years.
 * These mappers are intentionally thin: they only read columns they know.
 * Unknown columns are ignored; missing columns become empty.
 *
 * Input:  rows of raw parsed xlsx/csv data (before normaliseRow() is applied)
 * Output: rows shaped for the existing entity handler in routes/import.js
 */

function pick(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null && row[k] !== "") return row[k];
  }
  return "";
}

function parseNumber(v) {
  if (v === "" || v == null) return "";
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : "";
}

function mapShopifyProducts(rows) {
  return rows
    .map((r) => {
      const name = pick(r, "Title", "title");
      const variantTitle = pick(r, "Option1 Value", "option1_value");
      const displayName = variantTitle && variantTitle !== "Default Title"
        ? `${name} - ${variantTitle}`
        : name;
      return {
        name: displayName,
        sku: pick(r, "Variant SKU", "Handle"),
        barcode: pick(r, "Variant Barcode"),
        selling_price: parseNumber(pick(r, "Variant Price", "Price")),
        cost_price: parseNumber(pick(r, "Cost per item", "Variant Cost")),
        category: pick(r, "Type", "Product Category"),
        brand: pick(r, "Vendor"),
        tax: pick(r, "Tax Code", "Variant Tax Code"),
        unit: "pcs",
        stock_quantity: parseNumber(pick(r, "Variant Inventory Qty", "Inventory Qty")) || 0,
        status: String(pick(r, "Status")).toLowerCase() === "draft" ? "inactive" : "active",
      };
    })
    .filter((r) => r.name);
}

function mapShopifyCustomers(rows) {
  return rows
    .map((r) => {
      const first = pick(r, "First Name", "first_name");
      const last = pick(r, "Last Name", "last_name");
      const fullName = [first, last].filter(Boolean).join(" ").trim();
      const addr1 = pick(r, "Default Address Address1", "Address1");
      const city = pick(r, "Default Address City", "City");
      const country = pick(r, "Default Address Country", "Country");
      const address = [addr1, city, country].filter(Boolean).join(", ");
      return {
        name: fullName,
        mobile: pick(r, "Default Address Phone", "Phone"),
        email: pick(r, "Email"),
        address,
        cnic: "",
        occupation: pick(r, "Tags"),
      };
    })
    .filter((r) => r.name);
}

const TEMPLATES = {
  products: [
    "Handle", "Title", "Vendor", "Type", "Tags", "Variant SKU",
    "Variant Barcode", "Variant Price", "Cost per item",
    "Variant Inventory Qty", "Tax Code", "Status",
  ],
  customers: [
    "First Name", "Last Name", "Email", "Phone",
    "Default Address Address1", "Default Address City",
    "Default Address Country", "Tags",
  ],
};

const EXAMPLES = {
  products: [
    ["widget-a", "Widget A", "Acme", "Electronics", "featured", "WDG-001",
      "1234567890123", 29.99, 15.00, 100, "standard", "active"],
    ["widget-b", "Widget B", "Acme", "Accessories", "", "WDG-002",
      "1234567890124", 49.99, 25.00, 50, "standard", "active"],
  ],
  customers: [
    ["John", "Doe", "john@example.com", "03001234567",
      "123 Main St", "Karachi", "Pakistan", "vip"],
    ["Jane", "Smith", "jane@example.com", "03009876543",
      "456 Oak Ave", "Lahore", "Pakistan", ""],
  ],
};

module.exports = {
  products: mapShopifyProducts,
  customers: mapShopifyCustomers,
  mapShopifyProducts,
  mapShopifyCustomers,
  TEMPLATES,
  EXAMPLES,
};
