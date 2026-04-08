# Phase 20: Unit Test Coverage — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reach 30%+ unit test coverage across `backend/utils/`, `backend/services/`, `backend/middleware/`, and key frontend contexts — wave-by-wave, sequential.

**Architecture:** Four waves in order: utils → services → middleware → frontend contexts. Each wave builds on the mocking patterns established by the previous. Coverage reporter runs throughout to give live feedback.

**Tech Stack:** Vitest 4 (backend + frontend), `@vitest/coverage-v8`, `@testing-library/react` (already installed in frontend), Node.js `vi.mock` / `vi.doMock` for module boundary mocking.

---

## Task 0: Infrastructure — Install Coverage Reporter

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/vitest.config.js`

**Step 1: Install `@vitest/coverage-v8`**

```bash
cd backend && npm install --save-dev @vitest/coverage-v8
```

Expected: package installs without errors.

**Step 2: Update `vitest.config.js` to add coverage config**

Current file at `backend/vitest.config.js`. Replace the content with:

```js
const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000,
    hookTimeout: 10000,
    pool: "forks",
    isolate: true,
    globals: true,
    coverage: {
      provider: "v8",
      include: [
        "utils/**",
        "services/**",
        "middleware/**",
        "category-tree.js",
      ],
      exclude: [
        "routes/**",
        "workers/**",
        "jobs/**",
        "scripts/**",
        "index.js",
        "migrate-pg.js",
        "*.config.js",
      ],
    },
  },
});
```

**Step 3: Update `test:coverage` script in `backend/package.json`**

The current script is `"test:coverage": "vitest run --coverage"`. Update it to scope to unit tests only:

```json
"test:coverage": "vitest run tests/unit --coverage"
```

**Step 4: Run baseline coverage**

```bash
cd backend && npm run test:coverage
```

Expected: runs the existing `tz.test.js` (19 tests), prints a coverage table. Record the baseline % — it will be around 5–8% since only `tz.js` is covered.

**Step 5: Commit**

```bash
git add backend/vitest.config.js backend/package.json backend/package-lock.json
git commit -m "chore: add @vitest/coverage-v8, scope coverage to unit layer"
```

---

## Task 1: Wave 1 — `tz.js` — `getUtcOffsetMinutes`

**Files:**
- Modify: `backend/tests/unit/tz.test.js`

`getUtcOffsetMinutes` is exported from `tz.js` but has zero tests. It converts a local date + timezone to the UTC offset in minutes (positive = east of UTC).

**Step 1: Add the import**

Open `backend/tests/unit/tz.test.js`. The first line currently imports 4 functions. Add `getUtcOffsetMinutes`:

```js
import { toUtcStart, toUtcEnd, toLocalDateStr, getUtcOffsetMinutes, isValidTz } from "../../utils/tz.js";
```

**Step 2: Append the new describe block at the bottom of the file**

```js
describe("tz utility — getUtcOffsetMinutes", () => {
  it("UTC returns 0", () => {
    expect(getUtcOffsetMinutes("2026-03-06", "UTC")).toBe(0);
  });

  it("Asia/Karachi returns +300 (UTC+5)", () => {
    expect(getUtcOffsetMinutes("2026-03-06", "Asia/Karachi")).toBe(300);
  });

  it("America/New_York returns -300 in winter (EST = UTC-5)", () => {
    expect(getUtcOffsetMinutes("2026-01-15", "America/New_York")).toBe(-300);
  });

  it("America/New_York returns -240 in summer (EDT = UTC-4)", () => {
    expect(getUtcOffsetMinutes("2026-07-15", "America/New_York")).toBe(-240);
  });

  it("Pacific/Auckland returns +780 in southern hemisphere summer (NZDT = UTC+13)", () => {
    expect(getUtcOffsetMinutes("2026-01-15", "Pacific/Auckland")).toBe(780);
  });

  it("invalid timezone falls back to 0 (UTC)", () => {
    expect(getUtcOffsetMinutes("2026-03-06", "Bogus/Zone")).toBe(0);
  });

  it("null dateStr returns 0", () => {
    expect(getUtcOffsetMinutes(null, "UTC")).toBe(0);
  });
});
```

**Step 3: Run the tests**

```bash
cd backend && npm run test:unit -- tz.test.js
```

Expected: all 26 tests pass (19 existing + 7 new).

**Step 4: Commit**

```bash
git add backend/tests/unit/tz.test.js
git commit -m "test(unit): add getUtcOffsetMinutes tests to tz.test.js"
```

---

## Task 2: Wave 1 — `email-templates.js` — Template Builders

**Files:**
- Create: `backend/tests/unit/utils.test.js`

`email-templates.js` exports `{ TEMPLATES, wrapEmailHtml }`. `TEMPLATES` is a registry object where each key is a template name and each value is a builder function returning `{ subject, html }`.

**Step 1: Create the test file**

```js
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

  it("includes store name and days remaining in subject", () => {
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
  it("includes store name and login URL", () => {
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
```

**Step 2: Run the tests**

```bash
cd backend && npm run test:unit -- utils.test.js
```

Expected: all tests pass. If a template function throws on your minimal input (e.g. a missing required field), check what fields the function signature expects (read `backend/services/email-templates.js` starting at the relevant function) and add the missing fields.

**Step 3: Commit**

```bash
git add backend/tests/unit/utils.test.js
git commit -m "test(unit): add email-templates builder tests"
```

---

## Task 3: Wave 1 — `receiptEmail.js` + `digestEmail.js`

**Files:**
- Modify: `backend/tests/unit/utils.test.js`

Both files export pure HTML builder functions with no side effects.

**Step 1: Append receiptEmail tests to `utils.test.js`**

Add at the end of the file:

```js
// ── receiptEmail ──────────────────────────────────────────────────────────────

import { buildReceiptEmailHtml } from "../../utils/receiptEmail.js";

describe("receiptEmail — buildReceiptEmailHtml", () => {
  const minimalSale = {
    invoice_number: "INV-001",
    timestamp: "2026-03-06 10:00:00",
    payment_method: "cash",
    subtotal: 500,
    total_amount: 500,
    discount_amount: 0,
    tax_amount: 0,
  };
  const minimalItems = [
    { name: "Widget", quantity: 2, unit_price: 250, total_price: 500 },
  ];
  const minimalPayments = [{ method: "cash", amount: 500 }];
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
```

**Step 2: Append digestEmail tests**

```js
// ── digestEmail ───────────────────────────────────────────────────────────────

import { buildDigestEmailHtml } from "../../utils/digestEmail.js";

describe("digestEmail — buildDigestEmailHtml", () => {
  const minimalData = {
    totalRevenue: 15000,
    saleCount: 10,
    averageBill: 1500,
    topProducts: [{ name: "Widget", quantity: 5, revenue: 2500 }],
    paymentBreakdown: [{ method: "cash", total: 15000 }],
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
    expect(html).toContain("15000");
  });
});
```

**Step 3: Run the tests**

```bash
cd backend && npm run test:unit -- utils.test.js
```

Expected: all tests pass. If `buildReceiptEmailHtml` or `buildDigestEmailHtml` expects a different argument shape, read the source file to check the parameter structure and adjust the minimal fixtures.

**Step 4: Commit**

```bash
git add backend/tests/unit/utils.test.js
git commit -m "test(unit): add receiptEmail and digestEmail HTML builder tests"
```

---

## Task 4: Wave 2 — `alerting.js`

**Files:**
- Create: `backend/tests/unit/services.test.js`

`alerting.js` has module-level mutable state (the `windows` Map). Use `vi.resetModules()` + `vi.doMock()` + dynamic import in `beforeEach` to get a fresh module instance for each test.

**Step 1: Create `services.test.js`**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── alerting ──────────────────────────────────────────────────────────────────
// Uses vi.resetModules() per test because alerting.js has module-level mutable
// state (the windows Map). Each test must start with a clean slate.

describe("alerting — recordError", () => {
  let recordError;
  let mockSendAlertEmail;

  beforeEach(async () => {
    vi.resetModules();
    mockSendAlertEmail = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../../utils/alertEmail.js", () => ({
      sendAlertEmail: mockSendAlertEmail,
    }));
    const mod = await import("../../services/alerting.js");
    recordError = mod.recordError;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not send email when error count is below threshold (10)", async () => {
    for (let i = 0; i < 9; i++) {
      await recordError({ tenant: "t1", message: "boom" });
    }
    expect(mockSendAlertEmail).not.toHaveBeenCalled();
  });

  it("sends alert email exactly once when threshold is reached", async () => {
    for (let i = 0; i < 10; i++) {
      await recordError({ tenant: "t1", message: "boom" });
    }
    expect(mockSendAlertEmail).toHaveBeenCalledTimes(1);
  });

  it("includes tenant name in the alert email subject", async () => {
    for (let i = 0; i < 10; i++) {
      await recordError({ tenant: "my-tenant", message: "err" });
    }
    const call = mockSendAlertEmail.mock.calls[0][0];
    expect(call.subject).toContain("Error spike");
  });

  it("does not send a second alert before cooldown expires (window reset after first send)", async () => {
    // First burst — triggers alert and resets window
    for (let i = 0; i < 10; i++) {
      await recordError({ tenant: "t1", message: "boom" });
    }
    expect(mockSendAlertEmail).toHaveBeenCalledTimes(1);

    // Second burst — window was reset, count starts fresh, below threshold again
    for (let i = 0; i < 9; i++) {
      await recordError({ tenant: "t1", message: "boom" });
    }
    expect(mockSendAlertEmail).toHaveBeenCalledTimes(1); // still 1
  });

  it("handles missing tenant and message gracefully", async () => {
    for (let i = 0; i < 10; i++) {
      await recordError({});
    }
    expect(mockSendAlertEmail).toHaveBeenCalledTimes(1);
  });
});

describe("alerting — recordDbPressure", () => {
  let recordDbPressure;
  let mockSendAlertEmail;

  beforeEach(async () => {
    vi.resetModules();
    mockSendAlertEmail = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../../utils/alertEmail.js", () => ({
      sendAlertEmail: mockSendAlertEmail,
    }));
    const mod = await import("../../services/alerting.js");
    recordDbPressure = mod.recordDbPressure;
  });

  it("sends alert on first call (threshold is 1)", async () => {
    await recordDbPressure({ active: 18, max: 20, longestQuery: "SELECT *" });
    expect(mockSendAlertEmail).toHaveBeenCalledTimes(1);
    const call = mockSendAlertEmail.mock.calls[0][0];
    expect(call.subject).toContain("DB pressure");
  });
});
```

**Step 2: Run the tests**

```bash
cd backend && npm run test:unit -- services.test.js
```

Expected: all 6 tests pass.

**Step 3: Commit**

```bash
git add backend/tests/unit/services.test.js
git commit -m "test(unit): add alerting.js sliding window and threshold tests"
```

---

## Task 5: Wave 2 — `payment-gateway.js`

**Files:**
- Modify: `backend/tests/unit/services.test.js`

**Step 1: Append to `services.test.js`**

```js
// ── payment-gateway ───────────────────────────────────────────────────────────

import { isEnabled, createCheckout, verifyWebhook } from "../../services/payment-gateway.js";

describe("payment-gateway — isEnabled()", () => {
  afterEach(() => {
    delete process.env.PAYMENT_GATEWAY;
  });

  it("returns false when PAYMENT_GATEWAY is unset", () => {
    delete process.env.PAYMENT_GATEWAY;
    expect(isEnabled()).toBe(false);
  });

  it("returns false when PAYMENT_GATEWAY=manual", () => {
    process.env.PAYMENT_GATEWAY = "manual";
    expect(isEnabled()).toBe(false);
  });

  it("returns true when PAYMENT_GATEWAY=xpay", () => {
    process.env.PAYMENT_GATEWAY = "xpay";
    expect(isEnabled()).toBe(true);
  });
});

describe("payment-gateway — createCheckout() in manual mode", () => {
  beforeEach(() => { delete process.env.PAYMENT_GATEWAY; });
  afterEach(() => { delete process.env.PAYMENT_GATEWAY; });

  it("throws with 'not configured' message", async () => {
    await expect(
      createCheckout({ amount: 1000, reference: "ref-1", returnUrl: "/ok", cancelUrl: "/cancel" })
    ).rejects.toThrow("not configured");
  });
});

describe("payment-gateway — verifyWebhook()", () => {
  it("returns { valid: false } for unknown gateway", async () => {
    const result = await verifyWebhook("unknown_gw", {}, "{}");
    expect(result).toMatchObject({ valid: false });
  });
});

describe("payment-gateway — createCheckout() in xpay mode", () => {
  beforeEach(() => {
    process.env.PAYMENT_GATEWAY = "xpay";
    process.env.XPAY_API_KEY = "test-key-123";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    delete process.env.PAYMENT_GATEWAY;
    delete process.env.XPAY_API_KEY;
    vi.unstubAllGlobals();
  });

  it("calls the xPay checkout URL with correct headers", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ checkout_url: "https://pay.xpay.pk/abc", transaction_id: "txn-1" }),
    });

    await createCheckout({
      amount: 8000,
      currency: "PKR",
      reference: "pi-42",
      description: "Pro subscription",
      returnUrl: "https://sanopos.com/billing?success=1",
      cancelUrl: "https://sanopos.com/billing?cancel=1",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("xpay.pk");
    expect(opts.headers["Authorization"]).toBe("Bearer test-key-123");

    const body = JSON.parse(opts.body);
    expect(body.reference_id).toBe("pi-42");
    expect(body.amount).toBe(8000);
  });

  it("returns checkout_url and gateway_ref from xPay response", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ checkout_url: "https://pay.xpay.pk/abc", transaction_id: "txn-99" }),
    });

    const result = await createCheckout({
      amount: 1000, reference: "pi-1", returnUrl: "/ok", cancelUrl: "/cancel",
    });

    expect(result.checkout_url).toBe("https://pay.xpay.pk/abc");
    expect(result.gateway_ref).toBe("txn-99");
  });

  it("throws when xPay responds with non-ok status", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(
      createCheckout({ amount: 1000, reference: "pi-1", returnUrl: "/ok", cancelUrl: "/cancel" })
    ).rejects.toThrow();
  });
});
```

**Step 2: Run the tests**

```bash
cd backend && npm run test:unit -- services.test.js
```

Expected: all payment-gateway tests pass. If `createCheckout` maps the xPay response fields differently, read `backend/services/payment-gateway.js` lines 64–100 and adjust `gateway_ref` field name.

**Step 3: Commit**

```bash
git add backend/tests/unit/services.test.js
git commit -m "test(unit): add payment-gateway isEnabled, createCheckout, verifyWebhook tests"
```

---

## Task 6: Wave 2 — `fbr.js` — Payload Builders

**Files:**
- Modify: `backend/tests/unit/services.test.js`

Test `buildInvoicePayload`, `buildCreditNotePayload`, `getNextRetryDelay`, and `BACKOFF_DELAYS` — all pure functions with no side effects.

**Step 1: Append to `services.test.js`**

```js
// ── fbr — payload builders ────────────────────────────────────────────────────

import {
  buildInvoicePayload,
  buildCreditNotePayload,
  getNextRetryDelay,
  BACKOFF_DELAYS,
} from "../../services/fbr.js";

// Minimal sale fixture matching what backend routes produce
const minimalSale = {
  id: 1,
  invoice_number: "INV-0001",
  timestamp: "2026-03-06 10:00:00",
  total_amount: 1180,
  tax_amount: 180,
  discount_amount: 0,
  payment_method: "cash",
  customer_ntn: null,
  customer_cnic: null,
};

const minimalItems = [
  {
    name: "Widget",
    quantity: 2,
    unit_price: 500,
    total_price: 1000,
    tax_rate: 18,
    hs_code: "8471.30",
  },
];

const minimalCompany = {
  company_name: "Test Store",
  fbr_ntn: "1234567-8",
  fbr_pos_id: "POS-001",
};

describe("fbr — buildInvoicePayload", () => {
  it("returns an object with InvoiceNumber", () => {
    const payload = buildInvoicePayload(minimalSale, minimalItems, minimalCompany, null, []);
    expect(payload).toHaveProperty("InvoiceNumber");
    expect(payload.InvoiceNumber).toBe("INV-0001");
  });

  it("includes POSID from company profile", () => {
    const payload = buildInvoicePayload(minimalSale, minimalItems, minimalCompany, null, []);
    expect(payload.POSID).toBe("POS-001");
  });

  it("includes at least one item in InvoiceItems", () => {
    const payload = buildInvoicePayload(minimalSale, minimalItems, minimalCompany, null, []);
    expect(Array.isArray(payload.InvoiceItems)).toBe(true);
    expect(payload.InvoiceItems.length).toBeGreaterThan(0);
  });
});

describe("fbr — buildCreditNotePayload", () => {
  it("returns an object with InvoiceNumber", () => {
    const payload = buildCreditNotePayload(minimalSale, minimalItems, minimalCompany, null);
    expect(payload).toHaveProperty("InvoiceNumber");
  });
});

describe("fbr — getNextRetryDelay", () => {
  it("returns the delay from BACKOFF_DELAYS at the given index", () => {
    for (let i = 0; i < BACKOFF_DELAYS.length; i++) {
      expect(getNextRetryDelay(i)).toBe(BACKOFF_DELAYS[i]);
    }
  });

  it("returns the last delay for out-of-bounds index", () => {
    const last = BACKOFF_DELAYS[BACKOFF_DELAYS.length - 1];
    expect(getNextRetryDelay(999)).toBe(last);
  });
});
```

**Step 2: Run the tests**

```bash
cd backend && npm run test:unit -- services.test.js
```

Expected: all FBR tests pass. If the payload builder functions have different parameter signatures, read `backend/services/fbr.js` lines 12–85 and adjust the fixture shapes.

**Step 3: Commit**

```bash
git add backend/tests/unit/services.test.js
git commit -m "test(unit): add fbr payload builder and retry delay tests"
```

---

## Task 7: Wave 2 — `email.js` — Routing Logic

**Files:**
- Modify: `backend/tests/unit/services.test.js`

**Before writing tests:** Read `backend/services/email.js` to understand the exact function signature for `sendEmail()` and how it detects tenant vs platform email (likely via an `emailType` or `to` / `from` parameter, or a `context` object). The key behaviors to test are:
1. Platform emails (lifecycle, alerts) use Resend directly
2. Tenant emails (receipts, digest) try SMTP first, fall back to Resend on failure

**Step 1: Read the source first**

```bash
# Read the first 80 lines to understand sendEmail() signature
```

Open `backend/services/email.js` and note:
- What parameters `sendEmail()` accepts
- How it decides between SMTP and Resend (likely `context === "platform"` or `emailType` in a list)
- What it imports (`nodemailer`, `Resend`, etc.)

**Step 2: Append to `services.test.js` using the pattern below**

Adapt this template to the actual parameter names you find:

```js
// ── email.js — routing logic ──────────────────────────────────────────────────
// Pattern: mock nodemailer.createTransport at module level, mock Resend class.
// Test that platform emails bypass SMTP, tenant emails try SMTP first.

// NOTE: Fill in exact parameter names after reading services/email.js

describe("email — sendEmail routing (read email.js first to verify param names)", () => {
  let sendEmail;
  let mockSmtpSend;
  let mockResendSend;

  beforeEach(async () => {
    vi.resetModules();

    mockSmtpSend = vi.fn().mockResolvedValue({ messageId: "smtp-123" });
    mockResendSend = vi.fn().mockResolvedValue({ id: "resend-456" });

    vi.doMock("nodemailer", () => ({
      createTransport: vi.fn(() => ({
        sendMail: mockSmtpSend,
        verify: vi.fn().mockResolvedValue(true),
      })),
    }));

    vi.doMock("resend", () => ({
      Resend: vi.fn().mockImplementation(() => ({
        emails: { send: mockResendSend },
      })),
    }));

    const mod = await import("../../services/email.js");
    sendEmail = mod.sendEmail;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("platform email uses Resend, not SMTP", async () => {
    // Adapt parameters to match sendEmail() signature
    await sendEmail({
      type: "trial_warning",   // adjust if param name differs
      to: "admin@sanopos.com",
      data: { storeName: "Test Store", daysLeft: 5 },
    });
    expect(mockResendSend).toHaveBeenCalled();
    expect(mockSmtpSend).not.toHaveBeenCalled();
  });
});
```

**Step 3: Run the tests**

```bash
cd backend && npm run test:unit -- services.test.js
```

Fix any parameter mismatch based on the actual `sendEmail` signature.

**Step 4: Commit**

```bash
git add backend/tests/unit/services.test.js
git commit -m "test(unit): add email.js routing logic tests"
```

---

## Task 8: Wave 3 — `validate.js` Middleware

**Files:**
- Create: `backend/tests/unit/middleware.test.js`

`validate.js` exports `{ validate }` — a factory that wraps a Zod schema. No DB, no mocking.

**Step 1: Create `middleware.test.js`**

```js
import { describe, it, expect, vi } from "vitest";
import { validate } from "../../middleware/validate.js";
import { LoginSchema } from "../../schemas/auth.js";

// Helper: build a mock Express req/res/next triple
function mockHttp(body = {}) {
  const req = { body };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  return { req, res, next };
}

// ── validate middleware ───────────────────────────────────────────────────────

describe("validate — with LoginSchema", () => {
  it("calls next() for valid input", () => {
    const { req, res, next } = mockHttp({ username: "alice", password: "secret" });
    validate(LoginSchema)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() when pin is provided instead of password", () => {
    const { req, res, next } = mockHttp({ username: "alice", pin: "1234" });
    validate(LoginSchema)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when username is missing", () => {
    const { req, res, next } = mockHttp({ password: "secret" });
    validate(LoginSchema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when both password and pin are missing", () => {
    const { req, res, next } = mockHttp({ username: "alice" });
    validate(LoginSchema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 for empty body", () => {
    const { req, res, next } = mockHttp({});
    validate(LoginSchema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("parses and coerces valid input into req.body", () => {
    const { req, res, next } = mockHttp({ username: "alice", password: "pw", outlet_id: "3" });
    validate(LoginSchema)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.body.outlet_id).toBe(3); // coerced from string to number
  });
});
```

**Step 2: Run the tests**

```bash
cd backend && npm run test:unit -- middleware.test.js
```

Expected: all 6 tests pass.

**Step 3: Commit**

```bash
git add backend/tests/unit/middleware.test.js
git commit -m "test(unit): add validate.js middleware tests with LoginSchema"
```

---

## Task 9: Wave 3 — `permissions.js` Middleware

**Files:**
- Modify: `backend/tests/unit/middleware.test.js`

**Step 1: Append to `middleware.test.js`**

```js
// ── permissions middleware ────────────────────────────────────────────────────

import { requirePerm, requireAnyPerm } from "../../middleware/permissions.js";

describe("requirePerm", () => {
  it("calls next() when employee has the exact permission", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["view_reports", "manage_inventory"];
    requirePerm("manage_inventory")(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next() when employee has all_access (administrator)", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["all_access"];
    requirePerm("manage_inventory")(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when permission is missing", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["view_reports"];
    requirePerm("manage_inventory")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when employeePerms is empty", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = [];
    requirePerm("view_reports")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 403 when employeePerms is undefined", () => {
    const { req, res, next } = mockHttp();
    // req.employeePerms not set
    requirePerm("view_reports")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("requireAnyPerm", () => {
  it("calls next() when employee has any one of the required permissions", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["view_reports"];
    requireAnyPerm(["manage_inventory", "view_reports"])(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next() when employee has all_access", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["all_access"];
    requireAnyPerm(["manage_inventory", "view_reports"])(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when employee has none of the required permissions", () => {
    const { req, res, next } = mockHttp();
    req.employeePerms = ["pos_discount"];
    requireAnyPerm(["manage_inventory", "view_reports"])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run the tests**

```bash
cd backend && npm run test:unit -- middleware.test.js
```

Expected: all 13 tests pass (6 validate + 8 permissions).

**Step 3: Commit**

```bash
git add backend/tests/unit/middleware.test.js
git commit -m "test(unit): add requirePerm and requireAnyPerm middleware tests"
```

---

## Task 10: Wave 3 — `plan-limits.js` Middleware

**Files:**
- Modify: `backend/tests/unit/middleware.test.js`

`plan-limits.js` has two exports to test: `requirePlanLimit` and `requireActiveSubscription`. Both query `masterDb` — mock it via `vi.doMock` and `vi.resetModules`.

**Step 1: Append to `middleware.test.js`**

```js
// ── plan-limits middleware ────────────────────────────────────────────────────

describe("requirePlanLimit — employees", () => {
  let requirePlanLimit;
  let mockMasterQuery;
  let mockTenantQuery;

  beforeEach(async () => {
    vi.resetModules();

    mockMasterQuery = vi.fn();
    mockTenantQuery = vi.fn();

    vi.doMock("../../master-db-pg.js", () => ({
      query: mockMasterQuery,
    }));

    vi.doMock("../../tenant-db-manager-pg.js", () => ({
      getDb: vi.fn().mockResolvedValue({ query: mockTenantQuery }),
    }));

    const mod = await import("../../middleware/plan-limits.js");
    requirePlanLimit = mod.requirePlanLimit;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeReq(tenantId = 42) {
    return { tenantId };
  }

  it("skips check when MULTI_TENANT is not '1'", async () => {
    const old = process.env.MULTI_TENANT;
    delete process.env.MULTI_TENANT;
    const { req, res, next } = mockHttp();
    req.tenantId = 1;
    await requirePlanLimit("employees")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockMasterQuery).not.toHaveBeenCalled();
    process.env.MULTI_TENANT = old;
  });

  it("calls next() when plan limit is 0 (unlimited)", async () => {
    process.env.MULTI_TENANT = "1";
    mockMasterQuery.mockResolvedValue({ rows: [{ planLimit: 0 }] });

    const req = makeReq(1);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requirePlanLimit("employees")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockTenantQuery).not.toHaveBeenCalled();
    delete process.env.MULTI_TENANT;
  });

  it("calls next() when current count is below the limit", async () => {
    process.env.MULTI_TENANT = "1";
    mockMasterQuery.mockResolvedValue({ rows: [{ planLimit: 3 }] });
    mockTenantQuery.mockResolvedValue({ rows: [{ cnt: "2" }] });

    const req = makeReq(1);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requirePlanLimit("employees")(req, res, next);
    expect(next).toHaveBeenCalled();
    delete process.env.MULTI_TENANT;
  });

  it("returns 403 with PLAN_LIMIT_REACHED when count equals limit", async () => {
    process.env.MULTI_TENANT = "1";
    mockMasterQuery.mockResolvedValue({ rows: [{ planLimit: 3 }] });
    mockTenantQuery.mockResolvedValue({ rows: [{ cnt: "3" }] });

    const req = makeReq(1);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requirePlanLimit("employees")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "PLAN_LIMIT_REACHED" })
    );
    expect(next).not.toHaveBeenCalled();
    delete process.env.MULTI_TENANT;
  });

  it("throws on unknown resource name at factory time", () => {
    expect(() => requirePlanLimit("widgets")).toThrow("Unknown plan-limit resource");
  });
});

describe("requireActiveSubscription", () => {
  let requireActiveSubscription;
  let mockMasterQuery;

  beforeEach(async () => {
    vi.resetModules();
    mockMasterQuery = vi.fn();
    vi.doMock("../../master-db-pg.js", () => ({ query: mockMasterQuery }));
    const mod = await import("../../middleware/plan-limits.js");
    requireActiveSubscription = mod.requireActiveSubscription;
    process.env.MULTI_TENANT = "1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MULTI_TENANT;
  });

  it("skips check for GET requests", async () => {
    const req = { method: "GET", path: "/api/sales", tenantId: 1 };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireActiveSubscription(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockMasterQuery).not.toHaveBeenCalled();
  });

  it("skips check for /api/auth/ routes", async () => {
    const req = { method: "POST", path: "/api/auth/login", tenantId: 1 };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireActiveSubscription(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("returns 403 with SUBSCRIPTION_EXPIRED when status is 'expired'", async () => {
    mockMasterQuery.mockResolvedValue({ rows: [{ payment_status: "expired" }] });
    const req = { method: "POST", path: "/api/sales", tenantId: 1 };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireActiveSubscription(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SUBSCRIPTION_EXPIRED" })
    );
  });

  it("calls next() when subscription is active (trial)", async () => {
    mockMasterQuery.mockResolvedValue({ rows: [{ payment_status: "trial" }] });
    const req = { method: "POST", path: "/api/sales", tenantId: 1 };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireActiveSubscription(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
```

**Step 2: Run the tests**

```bash
cd backend && npm run test:unit -- middleware.test.js
```

Expected: all tests pass (previous + 10 new plan-limits tests).

**Step 3: Commit**

```bash
git add backend/tests/unit/middleware.test.js
git commit -m "test(unit): add requirePlanLimit and requireActiveSubscription tests"
```

---

## Task 11: Wave 3 — `feature-flags.js` + `upload-validation.js`

**Files:**
- Modify: `backend/tests/unit/middleware.test.js`

**Step 1: Append feature-flags tests**

`requireFeature` calls `getFeatureFlagsMap` which queries the DB. Use `init()` to inject a mock DB.

```js
// ── feature-flags middleware ──────────────────────────────────────────────────

import { init, requireFeature, invalidateFeatureFlagCache, DEFAULT_FEATURE_FLAGS } from "../../middleware/feature-flags.js";

describe("requireFeature", () => {
  let mockDbQuery;

  beforeEach(() => {
    invalidateFeatureFlagCache(); // clear the 60s in-memory cache
    mockDbQuery = vi.fn().mockResolvedValue({ rows: [] }); // return no DB overrides → use defaults
    init({ db: { query: mockDbQuery }, IS_MULTI_TENANT: false });
  });

  it("calls next() when flag is enabled by default", async () => {
    // accounting_core defaults to true in DEFAULT_FEATURE_FLAGS
    const req = { tenantId: null };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireFeature("accounting_core")(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("returns 503 when flag is disabled by default", async () => {
    // ui_redesign_pos defaults to false in DEFAULT_FEATURE_FLAGS
    const req = { tenantId: null };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    invalidateFeatureFlagCache(); // ensure cache miss
    await requireFeature("ui_redesign_pos")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ flag: "ui_redesign_pos" })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 503 for a completely unknown flag key", async () => {
    const req = { tenantId: null };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    invalidateFeatureFlagCache();
    await requireFeature("nonexistent_flag")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it("DEFAULT_FEATURE_FLAGS exports are booleans", () => {
    for (const val of Object.values(DEFAULT_FEATURE_FLAGS)) {
      expect(typeof val).toBe("boolean");
    }
  });
});
```

**Step 2: Append upload-validation tests**

```js
// ── upload-validation ─────────────────────────────────────────────────────────

import { imageFileFilter, safeExtension, ALLOWED_IMAGE_MIMES } from "../../middleware/upload-validation.js";

describe("imageFileFilter", () => {
  function makeFile(mimetype, originalname = "photo.jpg") {
    return { mimetype, originalname };
  }

  it("accepts image/jpeg", () => {
    const cb = vi.fn();
    imageFileFilter({}, makeFile("image/jpeg", "test.jpg"), cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it("accepts image/png", () => {
    const cb = vi.fn();
    imageFileFilter({}, makeFile("image/png", "test.png"), cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it("accepts image/webp", () => {
    const cb = vi.fn();
    imageFileFilter({}, makeFile("image/webp", "test.webp"), cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it("rejects application/pdf", () => {
    const cb = vi.fn();
    imageFileFilter({}, makeFile("application/pdf", "doc.pdf"), cb);
    expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(cb.mock.calls[0][0].message).toContain("image");
  });

  it("rejects a mismatched extension (.exe on image/jpeg)", () => {
    const cb = vi.fn();
    imageFileFilter({}, makeFile("image/jpeg", "virus.exe"), cb);
    expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("rejects null file", () => {
    const cb = vi.fn();
    imageFileFilter({}, null, cb);
    expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

describe("safeExtension", () => {
  it("returns original extension when it is in the allowlist", () => {
    expect(safeExtension("photo.jpg", "image/jpeg")).toBe(".jpg");
    expect(safeExtension("logo.png", "image/png")).toBe(".png");
  });

  it("falls back to MIME-derived extension when original extension is missing", () => {
    expect(safeExtension("filename", "image/jpeg")).toBe(".jpg");
    expect(safeExtension("", "image/webp")).toBe(".webp");
  });

  it("falls back to .png for unknown MIME type", () => {
    expect(safeExtension("file.bin", "application/octet-stream")).toBe(".png");
  });
});
```

**Step 3: Run the tests**

```bash
cd backend && npm run test:unit -- middleware.test.js
```

Expected: all tests pass. If `requireFeature` cache causes flakiness, ensure `invalidateFeatureFlagCache()` is called in each `beforeEach`.

**Step 4: Run coverage checkpoint**

```bash
cd backend && npm run test:coverage
```

Expected: ~25–30% coverage across `utils/`, `services/`, `middleware/`.

**Step 5: Commit**

```bash
git add backend/tests/unit/middleware.test.js
git commit -m "test(unit): add feature-flags and upload-validation middleware tests"
```

---

## Task 12: Wave 4 — Extract POSContext Cart Math

**Files:**
- Create: `frontend/src/pages/redesign/pos/cartMath.js`
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx`

The cart math is currently embedded in `useMemo` hooks in `POSContext.jsx`. Extract to a pure module so it can be unit tested without React.

**Step 1: Read the relevant section of POSContext.jsx**

Read lines 446–470 of `frontend/src/pages/redesign/pos/POSContext.jsx` to confirm the exact formulas. They should be:
- `grossTotal = cart.reduce((s, i) => s + Number(i.price || 0) * i.quantity, 0)`
- `discountValue`: percent → `(grossTotal * raw) / 100`, flat → `raw`
- `taxTotal` (inclusive only): per-item `itemTotal - itemTotal / (1 + rate / 100)`
- `total = Math.max(0, grossTotal - discountValue + (taxInclusive ? 0 : taxTotal))`

**Step 2: Create `cartMath.js`**

```js
/**
 * Pure cart calculation functions — extracted from POSContext for testability.
 * No React dependencies. All functions are deterministic given the same inputs.
 */

/**
 * Sum of all line totals (price × quantity) in the cart.
 * @param {Array<{price: number, quantity: number}>} cart
 * @returns {number}
 */
export function calcGrossTotal(cart) {
  return cart.reduce((s, i) => s + Number(i.price || 0) * i.quantity, 0);
}

/**
 * Order-level discount amount.
 * @param {number} grossTotal
 * @param {"percent"|"flat"} discountType
 * @param {string|number} discountInput - Raw user input
 * @returns {number}
 */
export function calcDiscountValue(grossTotal, discountType, discountInput) {
  const raw = Number(discountInput || 0);
  if (discountType === "percent") return (grossTotal * raw) / 100;
  return raw;
}

/**
 * Tax amount extracted from item prices (inclusive tax only).
 * Returns 0 when taxInclusive is false (tax-exclusive mode adds tax in total).
 * @param {Array<{price: number, quantity: number, effectiveTaxRate: number}>} cart
 * @param {boolean} taxInclusive
 * @returns {number}
 */
export function calcTaxTotal(cart, taxInclusive) {
  if (!taxInclusive) return 0;
  return cart.reduce((s, i) => {
    const rate = i.effectiveTaxRate || 0;
    const itemTotal = i.price * i.quantity;
    return s + (itemTotal - itemTotal / (1 + rate / 100));
  }, 0);
}

/**
 * Grand total: subtotal minus discount, plus exclusive tax (if applicable).
 * Always >= 0.
 * @param {number} grossTotal
 * @param {number} discountValue
 * @param {number} taxTotal
 * @param {boolean} taxInclusive
 * @returns {number}
 */
export function calcTotal(grossTotal, discountValue, taxTotal, taxInclusive) {
  return Math.max(0, grossTotal - discountValue + (taxInclusive ? 0 : taxTotal));
}
```

**Step 3: Update the four `useMemo` blocks in `POSContext.jsx`**

First import at the top of `POSContext.jsx` (add after existing imports):

```js
import { calcGrossTotal, calcDiscountValue, calcTaxTotal, calcTotal } from "./cartMath.js";
```

Then replace each useMemo:

**Replace `grossTotal` useMemo (around line 446):**
```js
const grossTotal = useMemo(() => calcGrossTotal(cart), [cart]);
```

**Replace `discountValue` useMemo (around line 451):**
```js
const discountValue = useMemo(
  () => calcDiscountValue(grossTotal, discountType, discountInput),
  [discountInput, discountType, grossTotal]
);
```

**Replace `taxTotal` useMemo (around line 457):**
```js
const taxTotal = useMemo(() => calcTaxTotal(cart, taxInclusive), [cart, taxInclusive]);
```

**Replace `total` computation (around line 466):**
```js
const total = calcTotal(grossTotal, discountValue, taxTotal, taxInclusive);
```

**Step 4: Verify the POS page still loads**

```bash
cd frontend && npm run dev
```

Open the POS page in a browser. Add a few items and verify totals display correctly. No unit test can catch a regression here — manual smoke check is required.

**Step 5: Commit**

```bash
git add frontend/src/pages/redesign/pos/cartMath.js frontend/src/pages/redesign/pos/POSContext.jsx
git commit -m "refactor(pos): extract cart math to cartMath.js for unit testability"
```

---

## Task 13: Wave 4 — Test `cartMath.js` + `CurrencyContext`

**Files:**
- Create: `frontend/tests/unit/contexts.test.jsx`

The frontend test setup (`jsdom` + `@testing-library/react`) is already configured in `vite.config.js`. No additional setup needed.

**Step 1: Create `contexts.test.jsx`**

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── cartMath ──────────────────────────────────────────────────────────────────

import {
  calcGrossTotal,
  calcDiscountValue,
  calcTaxTotal,
  calcTotal,
} from "../../src/pages/redesign/pos/cartMath.js";

describe("calcGrossTotal", () => {
  it("sums price × quantity for all items", () => {
    const cart = [
      { price: 100, quantity: 3 },
      { price: 250, quantity: 1 },
    ];
    expect(calcGrossTotal(cart)).toBe(550);
  });

  it("returns 0 for empty cart", () => {
    expect(calcGrossTotal([])).toBe(0);
  });

  it("treats missing price as 0", () => {
    expect(calcGrossTotal([{ quantity: 2 }])).toBe(0);
  });

  it("handles string price values (coerces to number)", () => {
    expect(calcGrossTotal([{ price: "200", quantity: 2 }])).toBe(400);
  });
});

describe("calcDiscountValue", () => {
  it("calculates percentage discount correctly", () => {
    expect(calcDiscountValue(1000, "percent", 10)).toBe(100);
    expect(calcDiscountValue(1000, "percent", 25)).toBe(250);
  });

  it("returns flat discount as-is", () => {
    expect(calcDiscountValue(1000, "flat", 150)).toBe(150);
  });

  it("returns 0 for empty discount input", () => {
    expect(calcDiscountValue(1000, "percent", "")).toBe(0);
    expect(calcDiscountValue(1000, "flat", "")).toBe(0);
  });

  it("100% discount equals the full gross total", () => {
    expect(calcDiscountValue(1000, "percent", 100)).toBe(1000);
  });
});

describe("calcTaxTotal", () => {
  it("returns 0 when taxInclusive is false", () => {
    const cart = [{ price: 118, quantity: 1, effectiveTaxRate: 18 }];
    expect(calcTaxTotal(cart, false)).toBe(0);
  });

  it("extracts inclusive tax correctly (18% GST)", () => {
    // PKR 118 inclusive of 18% tax → tax = 118 - 118/1.18 = 18
    const cart = [{ price: 118, quantity: 1, effectiveTaxRate: 18 }];
    const tax = calcTaxTotal(cart, true);
    expect(tax).toBeCloseTo(18, 1);
  });

  it("returns 0 for items with zero tax rate", () => {
    const cart = [{ price: 100, quantity: 2, effectiveTaxRate: 0 }];
    expect(calcTaxTotal(cart, true)).toBe(0);
  });

  it("sums tax across multiple items", () => {
    const cart = [
      { price: 118, quantity: 1, effectiveTaxRate: 18 },
      { price: 110, quantity: 1, effectiveTaxRate: 10 },
    ];
    const tax = calcTaxTotal(cart, true);
    expect(tax).toBeGreaterThan(0);
    expect(tax).toBeCloseTo(18 + 10, 0);
  });
});

describe("calcTotal", () => {
  it("subtracts discount from gross (no tax)", () => {
    expect(calcTotal(1000, 100, 0, false)).toBe(900);
  });

  it("adds exclusive tax to post-discount amount", () => {
    expect(calcTotal(1000, 0, 150, false)).toBe(1150);
  });

  it("does not add inclusive tax to total (already in price)", () => {
    expect(calcTotal(1000, 0, 150, true)).toBe(1000);
  });

  it("total cannot go below zero when discount exceeds subtotal", () => {
    expect(calcTotal(100, 200, 0, false)).toBe(0);
  });

  it("combines discount and exclusive tax correctly", () => {
    // gross 1000 - discount 100 + tax 90 = 990
    expect(calcTotal(1000, 100, 90, false)).toBe(990);
  });
});

// ── CurrencyContext ───────────────────────────────────────────────────────────
// Test the fmt() function by rendering the provider with a mocked fetch.

import { renderHook } from "@testing-library/react";
import React from "react";
import { CurrencyProvider, useCurrency } from "../../src/contexts/CurrencyContext.jsx";

describe("CurrencyContext — fmt()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ currency_symbol: "PKR", currency_code: "PKR", cash_denominations: null }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function wrapper({ children }) {
    return React.createElement(CurrencyProvider, null, children);
  }

  it("fmt() formats a whole number with symbol", async () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    // Allow the fetch to resolve
    await vi.waitFor(() => result.current.symbol !== undefined);
    const formatted = result.current.fmt(1000);
    expect(formatted).toContain("1,000");
  });

  it("fmt() formats zero", async () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await vi.waitFor(() => result.current.fmt !== undefined);
    const formatted = result.current.fmt(0);
    expect(formatted).toContain("0");
  });
});
```

**Step 2: Run the frontend unit tests**

```bash
cd frontend && npm run test:unit
```

Expected: all new tests pass. If `CurrencyContext` uses a different export name (e.g. named `CurrencyContext` not `CurrencyProvider`), read `frontend/src/contexts/CurrencyContext.jsx` to check the export and adjust the import.

**Step 3: Run the full backend coverage report**

```bash
cd backend && npm run test:coverage
```

Expected: 30%+ coverage across `utils/`, `services/`, `middleware/`.

**Step 4: Commit**

```bash
git add frontend/tests/unit/contexts.test.jsx
git commit -m "test(unit): add cartMath and CurrencyContext unit tests (wave 4)"
```

---

## Task 14: Final Coverage Checkpoint + Update Architecture Audit

**Step 1: Run full coverage report**

```bash
cd backend && npm run test:coverage
```

Check the coverage table. If any target file is below 50% and has untested pure logic, add tests to bring it up before considering the phase done.

**Step 2: Update Phase 20 status in architecture audit**

Open `docs/architecture-audit.md` and find the Phase 20 section (search for "Phase 20"). Update the status line to reflect completion, similar to how Phase 19 has a status note at the top of its section.

**Step 3: Final commit**

```bash
git add docs/architecture-audit.md
git commit -m "docs: mark Phase 20 unit test coverage as complete"
```

---

## Quick Reference: Test Commands

| Command | What it runs |
|---------|-------------|
| `cd backend && npm run test:unit` | All backend unit tests (no DB needed) |
| `cd backend && npm run test:coverage` | Unit tests + coverage report |
| `cd frontend && npm run test:unit` | All frontend unit tests |
| `cd backend && npx jest tests/integration/pg-batch1-crud.test.js` | Integration tests (requires DATABASE_URL) |
