import { describe, it, expect } from "vitest";
import { TEMPLATES, wrapEmailHtml } from "../../services/email-templates.js";

// ── wrapEmailHtml ─────────────────────────────────────────────────────────────

describe("email-templates — wrapEmailHtml", () => {
  it("returns a complete HTML document", () => {
    const html = wrapEmailHtml("Test Title", "<p>Body</p>");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("SanoPOS");
    expect(html).toContain("Test Title");
    expect(html).toContain("<p>Body</p>");
  });

  it("omits the subtitle element when title is falsy", () => {
    const html = wrapEmailHtml("", "<p>Body</p>");
    expect(html).not.toContain('<p style="margin:4px 0 0');
  });
});

// ── TEMPLATES registry ────────────────────────────────────────────────────────

describe("email-templates — TEMPLATES.trial_warning", () => {
  it("returns subject and html", () => {
    const result = TEMPLATES.trial_warning({ storeName: "Acme Store", daysLeft: 5 });
    expect(result).toHaveProperty("subject");
    expect(result).toHaveProperty("html");
  });

  it("includes days remaining in subject", () => {
    const { subject } = TEMPLATES.trial_warning({ storeName: "Acme Store", daysLeft: 5 });
    expect(subject).toContain("5");
  });

  it("includes store name in HTML body", () => {
    const { html } = TEMPLATES.trial_warning({ storeName: "Acme Store", daysLeft: 5 });
    expect(html).toContain("Acme Store");
  });
});

describe("email-templates — TEMPLATES.account_locked", () => {
  it("returns subject and html with store name", () => {
    const result = TEMPLATES.account_locked({ storeName: "Lock Test Store" });
    expect(result.subject).toBeTruthy();
    expect(result.html).toContain("Lock Test Store");
  });
});

describe("email-templates — TEMPLATES.billing_payment_recorded", () => {
  it("includes amount and plan in output", () => {
    const result = TEMPLATES.billing_payment_recorded({
      storeName: "Test Store",
      amount: 8000,
      plan: "Pro",
      cycle: "monthly",
      periodEnd: "2026-05-01",
    });
    expect(result.html).toContain("8000");
    expect(result.html).toContain("Pro");
  });
});

describe("email-templates — TEMPLATES.drip_getting_started", () => {
  it("includes store name and slug in output", () => {
    const result = TEMPLATES.drip_getting_started({
      storeName: "Quick Start Store",
      slug: "quickstart",
      frontendUrl: "https://sanopos.com",
    });
    expect(result.html).toContain("Quick Start Store");
    expect(result.html).toContain("quickstart");
  });
});

describe("email-templates — TEMPLATES registry completeness", () => {
  const EXPECTED_KEYS = [
    "drip_getting_started",
    "drip_features",
    "billing_payment_recorded",
    "billing_plan_changed",
    "billing_expiry_warning",
    "billing_overdue",
    "support_received",
    "support_resolved",
    "trial_warning",
    "trial_ended",
    "account_locked",
    "renewal_due",
    "renewal_overdue",
    "downtime",
    "announcement",
  ];

  it("exports all expected template keys", () => {
    for (const key of EXPECTED_KEYS) {
      expect(TEMPLATES).toHaveProperty(key);
      expect(typeof TEMPLATES[key]).toBe("function");
    }
  });
});

// ── receiptEmail ──────────────────────────────────────────────────────────────

import { buildReceiptEmailHtml } from "../../utils/receiptEmail.js";

describe("receiptEmail — buildReceiptEmailHtml", () => {
  const minimalSale = {
    invoice_number: "INV-001",
    timestamp: "2026-03-06 10:00:00",
    payment_method: "cash",
    total_amount: 500,
    discount_amount: 0,
  };
  const minimalItems = [
    { product_name: "Widget", quantity: 2, price_at_sale: 250 },
  ];
  const minimalPayments = [{ payment_method: "cash", amount: 500 }];
  const minimalTemplate = { header_text: "Test Store", footer_text: "Thank you!" };

  it("returns an HTML string", () => {
    const html = buildReceiptEmailHtml(minimalSale, minimalItems, minimalPayments, minimalTemplate, "PKR");
    expect(typeof html).toBe("string");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("includes invoice number in output", () => {
    const html = buildReceiptEmailHtml(minimalSale, minimalItems, minimalPayments, minimalTemplate, "PKR");
    expect(html).toContain("INV-001");
  });

  it("includes item name in output", () => {
    const html = buildReceiptEmailHtml(minimalSale, minimalItems, minimalPayments, minimalTemplate, "PKR");
    expect(html).toContain("Widget");
  });

  it("includes currency symbol in output", () => {
    const html = buildReceiptEmailHtml(minimalSale, minimalItems, minimalPayments, minimalTemplate, "PKR");
    expect(html).toContain("PKR");
  });
});

// ── digestEmail ───────────────────────────────────────────────────────────────

import { buildDigestEmailHtml } from "../../utils/digestEmail.js";

describe("digestEmail — buildDigestEmailHtml", () => {
  const minimalData = {
    totalRevenueToday: 15000,
    saleCount: 10,
    averageBill: 1500,
    topSelling: [{ name: "Widget", total_sold: 5 }],
    zReport: [{ payment_method: "cash", total: 15000, contribution_pct: 100 }],
  };

  it("returns an HTML string", () => {
    const html = buildDigestEmailHtml(minimalData, "Test Store", "2026-03-06");
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(100);
  });

  it("includes company name in output", () => {
    const html = buildDigestEmailHtml(minimalData, "Test Store", "2026-03-06");
    expect(html).toContain("Test Store");
  });

  it("includes revenue figure in output", () => {
    const html = buildDigestEmailHtml(minimalData, "Test Store", "2026-03-06");
    expect(html).toContain("15,000");
  });
});
