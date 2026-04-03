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
