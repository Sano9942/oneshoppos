/**
 * Square "Item Library Export" CSV mappers.
 *
 * Square exports include a "Current Quantity [Location]" column with the
 * location name in the header (e.g. "Current Quantity Main Street"). We pick
 * the first column whose key starts with "Current Quantity " as the stock
 * source.
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

function findFirstByPrefix(row, prefix) {
  for (const k of Object.keys(row)) {
    if (k.startsWith(prefix) && row[k] !== "" && row[k] != null) return row[k];
  }
  return "";
}

function mapSquareProducts(rows) {
  return rows
    .map((r) => ({
      name: pick(r, "Item Name", "Name"),
      sku: pick(r, "SKU"),
      barcode: pick(r, "GTIN", "UPC"),
      selling_price: parseNumber(pick(r, "Price")),
      cost_price: parseNumber(pick(r, "Default Unit Cost", "Unit Cost")),
      category: pick(r, "Category"),
      brand: pick(r, "Reporting Category"),
      tax: pick(r, "Tax"),
      unit: "pcs",
      stock_quantity: parseNumber(findFirstByPrefix(r, "Current Quantity")) || 0,
      status: "active",
    }))
    .filter((r) => r.name);
}

function mapSquareCustomers(rows) {
  return rows
    .map((r) => {
      const first = pick(r, "First Name", "Given Name");
      const last = pick(r, "Surname", "Last Name", "Family Name");
      const fullName = [first, last].filter(Boolean).join(" ").trim()
        || pick(r, "Company Name");
      return {
        name: fullName,
        mobile: pick(r, "Phone Number", "Phone"),
        email: pick(r, "Email Address", "Email"),
        address: pick(r, "Postal Address", "Address"),
        cnic: pick(r, "Reference ID"),
        occupation: pick(r, "Group Names", "Groups"),
      };
    })
    .filter((r) => r.name);
}

const TEMPLATES = {
  products: [
    "Item Name", "SKU", "GTIN", "Category", "Reporting Category",
    "Price", "Default Unit Cost", "Tax", "Current Quantity Main Street",
  ],
  customers: [
    "First Name", "Surname", "Email Address", "Phone Number",
    "Postal Address", "Reference ID", "Group Names",
  ],
};

const EXAMPLES = {
  products: [
    ["Widget A", "WDG-001", "1234567890123", "Electronics",
      "Retail", 29.99, 15.00, "GST 17%", 100],
    ["Widget B", "WDG-002", "1234567890124", "Accessories",
      "Retail", 49.99, 25.00, "GST 17%", 50],
  ],
  customers: [
    ["John", "Doe", "john@example.com", "03001234567",
      "123 Main St, Karachi", "REF-001", "vip"],
    ["Jane", "Smith", "jane@example.com", "03009876543",
      "456 Oak Ave, Lahore", "", ""],
  ],
};

module.exports = {
  products: mapSquareProducts,
  customers: mapSquareCustomers,
  mapSquareProducts,
  mapSquareCustomers,
  TEMPLATES,
  EXAMPLES,
};
