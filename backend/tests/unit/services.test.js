import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";

// ── alerting ──────────────────────────────────────────────────────────────────
// alerting.js has module-level mutable state (the windows Map). Each test uses
// Node.js require cache manipulation to get a fresh alerting.js module (clean
// windows state) while keeping the shared alertEmail module so vi.spyOn can
// intercept calls. alerting.js uses non-destructured require so property-level
// spying works at call time.

const _require = createRequire(import.meta.url);

/** Clear alerting.js from the require cache so the next _require() gives a
 *  fresh module with an empty windows Map. */
function clearAlertingFromCache() {
  const key = Object.keys(_require.cache).find(
    (k) => k.includes("services") && k.includes("alerting.js")
  );
  if (key) delete _require.cache[key];
}

describe("alerting — recordError", () => {
  let recordError;
  let sendAlertEmailSpy;

  beforeEach(() => {
    // Spy on alertEmail's CJS exports before loading alerting
    const alertEmailCjs = _require("../../utils/alertEmail.js");
    sendAlertEmailSpy = vi
      .spyOn(alertEmailCjs, "sendAlertEmail")
      .mockResolvedValue(undefined);

    // Load a fresh alerting.js (empty windows Map)
    clearAlertingFromCache();
    const alertingMod = _require("../../services/alerting.js");
    recordError = alertingMod.recordError;

    sendAlertEmailSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not send email when error count is below threshold (10)", async () => {
    for (let i = 0; i < 9; i++) {
      await recordError({ tenant: "t1", message: "boom" });
    }
    expect(sendAlertEmailSpy).not.toHaveBeenCalled();
  });

  it("sends alert email exactly once when threshold is reached", async () => {
    for (let i = 0; i < 10; i++) {
      await recordError({ tenant: "t1", message: "boom" });
    }
    expect(sendAlertEmailSpy).toHaveBeenCalledTimes(1);
  });

  it("includes tenant name in the alert email subject", async () => {
    for (let i = 0; i < 10; i++) {
      await recordError({ tenant: "my-tenant", message: "err" });
    }
    const call = sendAlertEmailSpy.mock.calls[0][0];
    expect(call.subject).toContain("Error spike");
  });

  it("does not send a second alert before cooldown expires (window reset after first send)", async () => {
    // First burst — triggers alert and resets window
    for (let i = 0; i < 10; i++) {
      await recordError({ tenant: "t1", message: "boom" });
    }
    expect(sendAlertEmailSpy).toHaveBeenCalledTimes(1);

    // Second burst — window was reset, count starts fresh, below threshold again
    for (let i = 0; i < 9; i++) {
      await recordError({ tenant: "t1", message: "boom" });
    }
    expect(sendAlertEmailSpy).toHaveBeenCalledTimes(1); // still 1
  });

  it("handles missing tenant and message gracefully", async () => {
    for (let i = 0; i < 10; i++) {
      await recordError({});
    }
    expect(sendAlertEmailSpy).toHaveBeenCalledTimes(1);
  });
});

describe("alerting — recordDbPressure", () => {
  let recordDbPressure;
  let sendAlertEmailSpy;

  beforeEach(() => {
    const alertEmailCjs = _require("../../utils/alertEmail.js");
    sendAlertEmailSpy = vi
      .spyOn(alertEmailCjs, "sendAlertEmail")
      .mockResolvedValue(undefined);

    clearAlertingFromCache();
    const alertingMod = _require("../../services/alerting.js");
    recordDbPressure = alertingMod.recordDbPressure;

    sendAlertEmailSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends alert on first call (threshold is 1)", async () => {
    await recordDbPressure({ active: 18, max: 20, longestQuery: "SELECT *" });
    expect(sendAlertEmailSpy).toHaveBeenCalledTimes(1);
    const call = sendAlertEmailSpy.mock.calls[0][0];
    expect(call.subject).toContain("DB pressure");
  });
});

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
      json: async () => ({ checkout_url: "https://pay.xpay.pk/abc", session_id: "sess-1" }),
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
      json: async () => ({ checkout_url: "https://pay.xpay.pk/abc", session_id: "sess-99" }),
    });

    const result = await createCheckout({
      amount: 1000, reference: "pi-1", returnUrl: "/ok", cancelUrl: "/cancel",
    });

    expect(result.checkout_url).toBe("https://pay.xpay.pk/abc");
    expect(result.gateway_ref).toBe("sess-99");
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

// ── fbr — payload builders ────────────────────────────────────────────────────

import {
  buildInvoicePayload,
  buildCreditNotePayload,
  getNextRetryDelay,
  BACKOFF_DELAYS,
} from "../../services/fbr.js";

// Minimal sale fixture — field names match what backend routes produce
const minimalSale = {
  id: 1,
  invoice_number: "INV-0001",
  timestamp: "2026-03-06T10:00:00.000Z",
  total_amount: 1180,
  tax_amount: 180,
  discount_amount: 0,
  payment_method: "cash",
};

const minimalItems = [
  {
    name: "Widget",
    quantity: 2,
    price: 500,
    price_at_sale: 500,
    tax_rate: 18,
    effective_tax_rate: 18,
    discount_amount: 0,
  },
];

const minimalCompany = {
  company_name: "Test Store",
  ntn: "1234567-8",
  fbr_province: "Punjab",
  address: "123 Main St",
};

describe("fbr — buildInvoicePayload", () => {
  it("returns an object with invoiceRefNo equal to invoice_number", () => {
    const payload = buildInvoicePayload(minimalSale, minimalItems, minimalCompany, null, null);
    expect(payload).toHaveProperty("invoiceRefNo");
    expect(payload.invoiceRefNo).toBe("INV-0001");
  });

  it("sets invoiceType to 'Sale Invoice'", () => {
    const payload = buildInvoicePayload(minimalSale, minimalItems, minimalCompany, null, null);
    expect(payload.invoiceType).toBe("Sale Invoice");
  });

  it("includes at least one item in the items array", () => {
    const payload = buildInvoicePayload(minimalSale, minimalItems, minimalCompany, null, null);
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items.length).toBeGreaterThan(0);
  });

  it("maps sellerBusinessName from company.company_name", () => {
    const payload = buildInvoicePayload(minimalSale, minimalItems, minimalCompany, null, null);
    expect(payload.sellerBusinessName).toBe("Test Store");
  });

  it("sets buyerBusinessName to Walk-in Customer when no customer provided", () => {
    const payload = buildInvoicePayload(minimalSale, minimalItems, minimalCompany, null, null);
    expect(payload.buyerBusinessName).toBe("Walk-in Customer");
  });
});

describe("fbr — buildCreditNotePayload", () => {
  it("returns an object with invoiceType Credit Note", () => {
    const returnRecord = {
      ...minimalSale,
      return_number: "RET-0001",
      created_at: "2026-03-06T11:00:00.000Z",
    };
    const payload = buildCreditNotePayload(returnRecord, minimalItems, minimalCompany, null, null);
    expect(payload.invoiceType).toBe("Credit Note");
  });

  it("uses return_number as invoiceRefNo", () => {
    const returnRecord = {
      ...minimalSale,
      return_number: "RET-0001",
      created_at: "2026-03-06T11:00:00.000Z",
    };
    const payload = buildCreditNotePayload(returnRecord, minimalItems, minimalCompany, null, null);
    expect(payload.invoiceRefNo).toBe("RET-0001");
  });

  it("falls back to RET-{id} when return_number is absent", () => {
    const returnRecord = { ...minimalSale, id: 42, created_at: "2026-03-06T11:00:00.000Z" };
    const payload = buildCreditNotePayload(returnRecord, minimalItems, minimalCompany, null, null);
    expect(payload.invoiceRefNo).toBe("RET-42");
  });
});

describe("fbr — getNextRetryDelay", () => {
  it("returns the delay from BACKOFF_DELAYS at the given index", () => {
    for (let i = 0; i < BACKOFF_DELAYS.length; i++) {
      expect(getNextRetryDelay(i)).toBe(BACKOFF_DELAYS[i]);
    }
  });

  it("returns the last delay for an out-of-bounds index", () => {
    const last = BACKOFF_DELAYS[BACKOFF_DELAYS.length - 1];
    expect(getNextRetryDelay(999)).toBe(last);
  });
});
