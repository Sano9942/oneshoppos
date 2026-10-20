// One Toy Store F10: the starting price rules are written twice: the server's
// (services/price-rules.js, served until the owner's first save) and the bill
// screen's (frontend supplierBill/priceRules.js, used only if the rules don't
// load). They must be the same sheet.
import { describe, it, expect } from "vitest";
import path from "path";
import { pathToFileURL } from "url";

const { DEFAULT_RULES } = require("../../services/price-rules");

describe("price rules: server and screen start from the same sheet", () => {
  it("same %, bands, words and rounding", async () => {
    const file = path.resolve(__dirname, "../../../frontend/src/pages/redesign/supplierBill/priceRules.js");
    const screen = (await import(pathToFileURL(file).href)).DEFAULT_RULES;
    const { brand_names, ...stationery } = screen.stationery;
    expect(brand_names).toEqual([]);
    expect({ ...screen, stationery }).toEqual(DEFAULT_RULES);
  });
});
