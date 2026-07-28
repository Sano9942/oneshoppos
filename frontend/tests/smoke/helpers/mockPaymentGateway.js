/**
 * Playwright route-interception helpers for Phase 5 external services.
 *
 * Each helper takes the current `page` and an optional capture bag. The capture
 * bag is a plain array that the helper pushes request payloads into so the test
 * can assert on the exact shape we're sending out.
 *
 * All helpers return the capture bag so specs can do:
 *   const payments = await mockXPay(page);
 *   // ... do the flow ...
 *   expect(payments.at(-1)).toMatchObject({ ... });
 */
import { STORE_CODE } from "../../helpers/auth.js";

async function stubJson(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function captureBody(route) {
  const req = route.request();
  const postData = req.postData();
  if (!postData) return null;
  try {
    return JSON.parse(postData);
  } catch {
    return { _raw: postData };
  }
}

export async function mockXPay(page) {
  const bag = [];
  await page.route(/xpay|x-pay/i, async (route) => {
    bag.push(captureBody(route));
    return stubJson(route, {
      intent_id: "xpay_mock_intent_" + Date.now(),
      redirect_url: `https://sanopos.com/store/${STORE_CODE}/order/mock?status=success`,
      status: "pending",
    });
  });
  // Also intercept our own payment intent endpoint so server-side gateway
  // invocations are caught even when the browser never calls xPay directly.
  await page.route("**/api/storefront/orders/*/pay", async (route) => {
    bag.push(captureBody(route));
    return stubJson(route, {
      intent_id: "xpay_mock_intent_" + Date.now(),
      redirect_url: `https://sanopos.com/store/${STORE_CODE}/order/mock?status=success`,
      payment_enabled: true,
    });
  });
  return bag;
}

export async function mockJazzCash(page) {
  const bag = [];
  await page.route(/jazzcash/i, async (route) => {
    bag.push(captureBody(route));
    return stubJson(route, {
      pp_ResponseCode: "000",
      pp_TxnRefNo: "JC_" + Date.now(),
      pp_RedirectURL: `https://sanopos.com/store/${STORE_CODE}/order/mock?status=success`,
    });
  });
  return bag;
}

export async function mockEasypaisa(page) {
  const bag = [];
  await page.route(/easypaisa/i, async (route) => {
    bag.push(captureBody(route));
    return stubJson(route, {
      orderId: "EP_" + Date.now(),
      redirectUrl: `https://sanopos.com/store/${STORE_CODE}/order/mock?status=success`,
    });
  });
  return bag;
}

/**
 * Stubs every registered Pakistani courier adapter endpoint. Any GET/POST to
 * hostnames containing the courier name returns a canned booking response.
 */
export async function mockCourierAPI(page) {
  const bag = [];
  const couriers = [
    "leopards",
    "tcs",
    "blueex",
    "trax",
    "callcourier",
    "mnp",
    "postex",
    "rider",
    "swyft",
    "bykea",
    "pakpost",
    "dhl",
    "fedex",
  ];
  const pattern = new RegExp(couriers.join("|"), "i");
  await page.route(pattern, async (route) => {
    bag.push({
      url: route.request().url(),
      method: route.request().method(),
      body: captureBody(route),
    });
    return stubJson(route, {
      tracking_number: "SMOKE_TRACK_" + Date.now(),
      status: "booked",
      label_url: "https://example.com/label.pdf",
    });
  });
  return bag;
}

/**
 * Stubs SMS provider endpoints. Captures outbound payloads so specs can assert
 * the exact shape (to, text, template_id, etc.) our code sends.
 */
export async function mockSMSProvider(page) {
  const bag = [];
  const pattern = /(zong|jazz|ufone|telenor|twilio|sms-provider)/i;
  await page.route(pattern, async (route) => {
    bag.push({
      url: route.request().url(),
      method: route.request().method(),
      body: captureBody(route),
    });
    return stubJson(route, {
      message_id: "sms_mock_" + Date.now(),
      status: "delivered",
    });
  });
  return bag;
}
