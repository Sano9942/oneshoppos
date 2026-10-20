// F8 (D45 leftover): the emailed receipt's header/footer match the printed
// slip, every shop-typed text is escaped, and the date reads in shop time.
import { describe, it, expect } from "vitest";
import { buildReceiptEmailHtml } from "../../utils/receiptEmail.js";

const template = {
  header_text: "ONE SHOP\nShop # G-017, Ground Floor, Packages Mall,\nLahore, Pakistan\r\nPh: +92 42 32184836",
  footer_text: "No Refund  No Warranty\nExchange within 3 days\n\nThank you for your kind visit!",
};
const sale = {
  id: 7,
  invoice_number: "INV-261019-001",
  timestamp: new Date("2026-10-19T09:33:00Z"),
  outlet_name: "Packages Mall",
  total_amount: 500,
  discount_amount: 0,
};
const items = [{ product_name: "Widget", quantity: 2, price_at_sale: 250 }];
const payments = [{ payment_method: "Cash", amount: 500 }];

const build = (over = {}) => buildReceiptEmailHtml(
  { ...sale, ...over.sale }, over.items || items, payments,
  over.template === undefined ? template : over.template, "Rs", null,
  over.tz === undefined ? "Asia/Karachi" : over.tz,
);

describe("F8 emailed receipt", () => {
  it("prints the first header line big and each other line on its own line", () => {
    const html = build();
    expect(html).toMatch(/font-size:20px;font-weight:bold;[^"]*">ONE SHOP<\/div>/);
    for (const line of ["Shop # G-017, Ground Floor, Packages Mall,", "Lahore, Pakistan", "Ph: +92 42 32184836"]) {
      expect(html).toMatch(new RegExp(`font-size:12px;[^"]*">${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</div>`));
    }
    expect(html).not.toContain("ONE SHOP\nShop");
  });

  it("does not add the branch name under the header (the slip doesn't)", () => {
    const html = build();
    expect(html).not.toContain("Packages Mall</div>\n");
    expect(html.match(/Packages Mall/g)).toHaveLength(1); // only inside the address line
  });

  it("falls back to the branch name as the big line when there is no header", () => {
    const html = build({ template: null });
    expect(html).toMatch(/font-size:20px;font-weight:bold;[^"]*">Packages Mall<\/div>/);
  });

  it("prints one footer line per typed line, skipping blank ones", () => {
    const html = build();
    for (const line of ["No Refund  No Warranty", "Exchange within 3 days", "Thank you for your kind visit!"]) {
      expect(html).toContain(`<div>${line}</div>`);
    }
    expect(html).not.toContain("<div></div>");
  });

  it("escapes shop-typed text everywhere", () => {
    const html = build({
      template: { header_text: "A&B <Toys>\n<script>x</script>", footer_text: "\"Bye\" & <b>" },
      items: [{ product_name: "Car <RC> & \"Pro\"", quantity: 1, price_at_sale: 500 }],
      sale: { customer_name: "<img src=x>", employee_name: "O'Neil & Co", invoice_number: "INV<1>" },
    });
    expect(html).toContain("A&amp;B &lt;Toys&gt;");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("&quot;Bye&quot; &amp; &lt;b&gt;");
    expect(html).toContain("Car &lt;RC&gt; &amp; &quot;Pro&quot;");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).toContain("O&#39;Neil &amp; Co");
    expect(html).toContain("INV&lt;1&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x>");
  });

  it("shows the date short, in the shop's time zone", () => {
    expect(build()).toContain("19 Oct 2026, 2:33 PM");
    expect(build({ tz: "UTC" })).toContain("19 Oct 2026, 9:33 AM");
    expect(build()).not.toContain("GMT");
  });

  it("accepts a timestamp string and leaves a bad one blank", () => {
    expect(build({ sale: { timestamp: "2026-10-19T09:33:00.000Z" } })).toContain("19 Oct 2026, 2:33 PM");
    expect(build({ sale: { timestamp: "nonsense" } })).not.toContain("nonsense");
  });
});
