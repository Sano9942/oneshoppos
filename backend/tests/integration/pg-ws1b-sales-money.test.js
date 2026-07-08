/**
 * pg-ws1b-sales-money.test.js — WS1b sales money-path hardening
 *
 * Covers the five fixes in routes/sales.js:
 *   H1 — POS total is re-priced server-side via resolvePriceForContext; a
 *        crafted undercharge (client price below catalog) is rejected.
 *   H2 — tax_mode='exclusive' adds the snapshot tax onto total_amount.
 *   H3 — loyalty redemption is valued at loyalty_redeem_rate (not 1:1),
 *        clamped so the total never goes below 0, and over-redemption past
 *        the customer's balance is rejected (balance never goes negative).
 *   H4 — a Wallet tender can never overspend the wallet; balance stays >= 0.
 *   L5 — cash/card/split tenders must cover the sale total.
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("WS1b — sales money-path hardening (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // Real loadCompanyProfile so req.company.tax_mode + loyalty_redeem_rate
    // come from the DB (the default stub returns { timezone: "UTC" } only).
    app.use("/api/", async (req, res, next) => {
      try {
        const { rows: [row] } = await db.query(
          "SELECT * FROM company_profile WHERE id = 1"
        );
        req.company = row || { timezone: "UTC" };
        next();
      } catch (err) {
        next(err);
      }
    });

    require("../../routes/customers")(app, deps);
    require("../../routes/shifts")(app, deps);
    require("../../routes/attendance")(app, deps);
    require("../../routes/products")(app, deps);
    require("../../routes/sales")(app, deps);

    // Deterministic catalog: product 1 = 100 @ gst 17, product 3 = 500 @ gst 0.
    await db.query("UPDATE products SET price = 100, tax_id = 1, gst = 17, category_id = NULL WHERE id = 1");
    await db.query("UPDATE products SET price = 500, tax_id = NULL, gst = 0, category_id = NULL WHERE id = 3");

    await request(app)
      .post("/api/shifts/open")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1, opening_float: 500, denominations: [] });
    await request(app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: "2580", outlet_id: 1 });
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  }, 30000);

  const post = (body) =>
    request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({ outlet_id: 1, employee_id: 1, ...body });

  // ── H1 ────────────────────────────────────────────────────────────────
  describe("H1 — server-side price authority", () => {
    beforeAll(async () => {
      await db.query("UPDATE company_profile SET tax_mode = 'none' WHERE id = 1");
    });

    it("rejects a crafted low total (client price below catalog)", async () => {
      const res = await post({
        cartItems: [{ id: 3, name: "Gadget", price: 10, quantity: 1 }], // catalog 500
        payments: [{ method: "cash", amount: 10 }],
        idempotency_key: "ws1b-h1-low-" + Date.now(),
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("PRICE_MISMATCH");
    });

    it("accepts a sale priced at catalog", async () => {
      const res = await post({
        cartItems: [{ id: 3, name: "Gadget", price: 500, quantity: 1 }],
        payments: [{ method: "cash", amount: 500 }],
        idempotency_key: "ws1b-h1-ok-" + Date.now(),
      });
      expect(res.status).toBe(200);
    });

    it("allows overcharge (open-price / above-catalog lines)", async () => {
      const res = await post({
        cartItems: [{ id: 3, name: "Gadget", price: 600, quantity: 1 }],
        payments: [{ method: "cash", amount: 600 }],
        idempotency_key: "ws1b-h1-over-" + Date.now(),
      });
      expect(res.status).toBe(200);
    });
  });

  // ── H2 ────────────────────────────────────────────────────────────────
  describe("H2 — exclusive tax added to total", () => {
    it("total_amount = subtotal + tax in exclusive mode", async () => {
      await db.query("UPDATE company_profile SET tax_mode = 'exclusive' WHERE id = 1");
      const res = await post({
        cartItems: [{ id: 1, name: "Widget", price: 100, quantity: 1 }],
        tax_inclusive: false,
        payments: [{ method: "cash", amount: 117 }], // 100 + 17 GST
        idempotency_key: "ws1b-h2-" + Date.now(),
      });
      expect(res.status).toBe(200);
      const { rows: [sale] } = await db.query(
        "SELECT subtotal, tax_total, total_amount FROM sales WHERE id = $1",
        [res.body.saleId]
      );
      expect(Number(sale.subtotal)).toBeCloseTo(100, 2);
      expect(Number(sale.tax_total)).toBeCloseTo(17, 2);
      expect(Number(sale.total_amount)).toBeCloseTo(117, 2); // tax now on top
    });

    it("inclusive mode leaves total unchanged (tax already in price)", async () => {
      await db.query("UPDATE company_profile SET tax_mode = 'inclusive' WHERE id = 1");
      const res = await post({
        cartItems: [{ id: 1, name: "Widget", price: 100, quantity: 1 }],
        tax_inclusive: true,
        payments: [{ method: "cash", amount: 100 }],
        idempotency_key: "ws1b-h2-incl-" + Date.now(),
      });
      expect(res.status).toBe(200);
      const { rows: [sale] } = await db.query(
        "SELECT total_amount FROM sales WHERE id = $1",
        [res.body.saleId]
      );
      expect(Number(sale.total_amount)).toBeCloseTo(100, 2);
    });
  });

  // ── H3 ────────────────────────────────────────────────────────────────
  describe("H3 — loyalty redemption guarded + valued by redeem_rate", () => {
    beforeAll(async () => {
      await db.query("UPDATE company_profile SET tax_mode = 'none', loyalty_redeem_rate = 10 WHERE id = 1");
    });

    it("rejects redeeming more points than the customer holds; balance stays intact", async () => {
      await db.query("UPDATE customers SET loyalty_points = 100 WHERE id = 1");
      const res = await post({
        cartItems: [{ id: 1, name: "Widget", price: 100, quantity: 1 }],
        customer_id: 1,
        points_redeemed: 150, // customer only has 100
        payments: [{ method: "cash", amount: 85 }], // 100 - 150*0.1 = 85
        idempotency_key: "ws1b-h3-over-" + Date.now(),
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INSUFFICIENT_LOYALTY_POINTS");
      const { rows: [c] } = await db.query(
        "SELECT loyalty_points FROM customers WHERE id = 1"
      );
      expect(Number(c.loyalty_points)).toBe(100); // untouched, never negative
    });

    it("values redemption at redeem_rate (10 pts = PKR 1 off), not 1:1", async () => {
      await db.query("UPDATE customers SET loyalty_points = 100 WHERE id = 1");
      const res = await post({
        cartItems: [{ id: 1, name: "Widget", price: 100, quantity: 1 }],
        customer_id: 1,
        points_redeemed: 100, // valued 100*10/100 = 10 off → total 90
        payments: [{ method: "cash", amount: 90 }],
        idempotency_key: "ws1b-h3-value-" + Date.now(),
      });
      expect(res.status).toBe(200);
      const { rows: [sale] } = await db.query(
        "SELECT total_amount FROM sales WHERE id = $1",
        [res.body.saleId]
      );
      expect(Number(sale.total_amount)).toBeCloseTo(90, 2);
      const { rows: [c] } = await db.query(
        "SELECT loyalty_points FROM customers WHERE id = 1"
      );
      expect(Number(c.loyalty_points)).toBe(0); // 100 - 100, never below 0
    });

    it("clamps the total to >= 0 when redemption value exceeds the cart", async () => {
      await db.query("UPDATE customers SET loyalty_points = 2000 WHERE id = 1");
      const res = await post({
        cartItems: [{ id: 1, name: "Widget", price: 100, quantity: 1 }],
        customer_id: 1,
        points_redeemed: 2000, // valued 200 > 100 subtotal → total clamps to 0
        payments: [{ method: "cash", amount: 0 }],
        idempotency_key: "ws1b-h3-clamp-" + Date.now(),
      });
      expect(res.status).toBe(200);
      const { rows: [sale] } = await db.query(
        "SELECT total_amount FROM sales WHERE id = $1",
        [res.body.saleId]
      );
      expect(Number(sale.total_amount)).toBe(0); // never negative
    });
  });

  // ── H4 ────────────────────────────────────────────────────────────────
  describe("H4 — wallet tender cannot overspend", () => {
    beforeAll(async () => {
      await db.query("UPDATE company_profile SET tax_mode = 'none' WHERE id = 1");
    });

    it("debits within balance, then rejects a tender that would overdraw; balance never negative", async () => {
      await db.query("UPDATE customers SET balance = 500 WHERE id = 1");

      // First wallet sale of 500 succeeds → balance 0.
      const ok = await post({
        cartItems: [{ id: 3, name: "Gadget", price: 500, quantity: 1 }],
        customer_id: 1,
        payments: [{ method: "Wallet", amount: 500 }],
        idempotency_key: "ws1b-h4-ok-" + Date.now(),
      });
      expect(ok.status).toBe(200);

      // Second wallet sale of 500 must fail — balance is now 0.
      const bad = await post({
        cartItems: [{ id: 3, name: "Gadget", price: 500, quantity: 1 }],
        customer_id: 1,
        payments: [{ method: "Wallet", amount: 500 }],
        idempotency_key: "ws1b-h4-bad-" + Date.now(),
      });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe("insufficient_wallet");

      const { rows: [c] } = await db.query(
        "SELECT balance FROM customers WHERE id = 1"
      );
      expect(Number(c.balance)).toBe(0); // exactly one debit, never negative

      // The rejected sale left no ghost debit ledger row.
      const { rows: ledger } = await db.query(
        "SELECT COUNT(*)::int AS n FROM customer_wallet_ledger WHERE customer_id = 1 AND type = 'debit'"
      );
      expect(ledger[0].n).toBe(1);
    });
  });

  // ── L5 ────────────────────────────────────────────────────────────────
  describe("L5 — payment coverage for cash/card/split", () => {
    beforeAll(async () => {
      await db.query("UPDATE company_profile SET tax_mode = 'none' WHERE id = 1");
    });

    it("rejects a cash sale whose payments fall short of the total", async () => {
      const res = await post({
        cartItems: [{ id: 3, name: "Gadget", price: 500, quantity: 1 }],
        payments: [{ method: "cash", amount: 300 }], // short of 500
        idempotency_key: "ws1b-l5-short-" + Date.now(),
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INSUFFICIENT_PAYMENT");
    });

    it("accepts a split that fully covers the total", async () => {
      const res = await post({
        cartItems: [{ id: 3, name: "Gadget", price: 500, quantity: 1 }],
        payments: [
          { method: "cash", amount: 200 },
          { method: "card", amount: 300 },
        ],
        idempotency_key: "ws1b-l5-split-" + Date.now(),
      });
      expect(res.status).toBe(200);
    });
  });
});
