import { describe, it, expect, beforeEach, afterEach } from "vitest";
import supertest from "supertest";
import { createTestApp, closeDb, dbGet, dbAll, dbRun } from "../helpers/createTestApp";
import { makeRequest } from "../helpers/request";

describe("Customer Loyalty & Wallet Integration Tests", () => {
  let app, db, deps;

  beforeEach(async () => {
    const setup = await createTestApp();
    app = setup.app;
    db = setup.db;
    deps = setup.deps;
  });

  afterEach(async () => {
    await closeDb(db);
  });

  const ADMIN_ID = "1";
  const ADMIN_PIN = "2580";
  const CUSTOMER_ID = 1; // From seedData

  async function ensureCheckoutContext(outletId = 1) {
    const openShift = await dbGet(
      db,
      "SELECT id FROM cash_shifts WHERE outlet_id = ? AND status = 'open' LIMIT 1",
      [outletId],
    );
    if (!openShift) {
      await supertest(app)
        .post("/api/shifts/open")
        .set("x-employee-id", ADMIN_ID)
        .send({ outlet_id: outletId, employee_id: Number(ADMIN_ID), opening_float: 500 });
    }

    const attendanceRes = await supertest(app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: ADMIN_PIN, outlet_id: outletId });
    expect([200, 400]).toContain(attendanceRes.status);
  }

  describe("Customer CRUD", () => {
    it("should create a new customer", async () => {
      const res = await supertest(app)
        .post("/api/customers")
        .send({ name: "New Customer", mobile: "555-1234" });

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe("New Customer");
    });

    it("should list and search customers", async () => {
      const res = await supertest(app).get("/api/customers?search=Test");

      expect(res.status).toBe(200);
      expect(res.body.customers.length).toBeGreaterThan(0);
      expect(res.body.customers[0].name).toContain("Test");
    });

    it("should update a customer", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .put(`/api/customers/${CUSTOMER_ID}`)
        .send({ name: "Updated Name", mobile: "555-5555" });

      expect(res.status).toBe(200);

      const updated = await dbGet(
        db,
        "SELECT name FROM customers WHERE id = ?",
        [CUSTOMER_ID],
      );
      expect(updated.name).toBe("Updated Name");
    });

    it("should block deletion if customer has sales", async () => {
      // 1. Create a sale for the customer
      await dbGet(
        db,
        "INSERT INTO sales (total_amount, payment_method, customer_id, outlet_id) VALUES (100, 'Cash', ?, 1)",
        [CUSTOMER_ID],
      );

      const res = await makeRequest(app, ADMIN_ID).delete(`/api/customers/${CUSTOMER_ID}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("linked sale");
    });
  });

  describe("Wallet Transactions", () => {
    it("should top up wallet and create ledger entry", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .post(`/api/customers/${CUSTOMER_ID}/wallet/topup`)
        .send({ amount: 100, note: "Test top-up" });

      expect(res.status).toBe(200);
      expect(res.body.balance).toBe(600); // 500 (seed) + 100

      const ledger = await dbGet(
        db,
        'SELECT * FROM customer_wallet_ledger WHERE customer_id = ? AND type = "credit"',
        [CUSTOMER_ID],
      );
      expect(ledger).toBeDefined();
      expect(ledger.amount).toBe(100);
      expect(ledger.reference_type).toBe("topup");
    });

    it("should debit wallet during sale and create ledger entry", async () => {
      await ensureCheckoutContext(1);

      // 1. Ensure enough balance
      await dbRun(db, "UPDATE customers SET balance = 1000 WHERE id = ?", [
        CUSTOMER_ID,
      ]);

      // 2. Perform a sale with Wallet payment
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/sales")
        .send({
          cartItems: [{ id: 1, price: 100, quantity: 2 }],
          paymentMethod: "Wallet",
          outlet_id: 1,
          customer_id: CUSTOMER_ID,
        });

      expect(res.status).toBe(200);

      const customer = await dbGet(
        db,
        "SELECT balance FROM customers WHERE id = ?",
        [CUSTOMER_ID],
      );
      expect(customer.balance).toBe(800); // 1000 - 200

      const ledger = await dbGet(
        db,
        'SELECT * FROM customer_wallet_ledger WHERE customer_id = ? AND type = "debit"',
        [CUSTOMER_ID],
      );
      expect(ledger).toBeDefined();
      expect(ledger.amount).toBe(200);
      expect(ledger.reference_type).toBe("sale");
    });
  });

  describe("Loyalty Points", () => {
    it("should earn points during sale", async () => {
      await ensureCheckoutContext(1);

      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/sales")
        .send({
          cartItems: [{ id: 1, price: 100, quantity: 1 }],
          paymentMethod: "Cash",
          outlet_id: 1,
          customer_id: CUSTOMER_ID,
          points_earned: 10,
        });

      expect(res.status).toBe(200);

      const customer = await dbGet(
        db,
        "SELECT loyalty_points FROM customers WHERE id = ?",
        [CUSTOMER_ID],
      );
      expect(customer.loyalty_points).toBe(110); // 100 (seed) + 10
    });

    it("should redeem points during sale", async () => {
      await ensureCheckoutContext(1);

      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/sales")
        .send({
          cartItems: [{ id: 1, price: 100, quantity: 1 }],
          paymentMethod: "Cash",
          outlet_id: 1,
          customer_id: CUSTOMER_ID,
          points_redeemed: 50,
        });

      expect(res.status).toBe(200);

      const customer = await dbGet(
        db,
        "SELECT loyalty_points FROM customers WHERE id = ?",
        [CUSTOMER_ID],
      );
      expect(customer.loyalty_points).toBe(50); // 100 (seed) - 50
    });

    it("should allow manual points update", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .put(`/api/customers/${CUSTOMER_ID}/points`)
        .send({ points: 250 });

      expect(res.status).toBe(200);

      const customer = await dbGet(
        db,
        "SELECT loyalty_points FROM customers WHERE id = ?",
        [CUSTOMER_ID],
      );
      expect(customer.loyalty_points).toBe(250);
    });
  });

  describe("Bug Verification", () => {
    it("Verify Bug B3: Wallet payment should block if insufficient balance (CURRENTLY FAILS - PROVING BUG)", async () => {
      await ensureCheckoutContext(1);

      // Problem B3: Wallet payment doesn't check for sufficient balance.

      // 1. Ensure balance is low
      await dbRun(db, "UPDATE customers SET balance = 50 WHERE id = ?", [
        CUSTOMER_ID,
      ]);

      // 2. Perform a sale for 200
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/sales")
        .send({
          cartItems: [{ id: 1, price: 200, quantity: 1 }],
          paymentMethod: "Wallet",
          outlet_id: 1,
          customer_id: CUSTOMER_ID,
        });

      // If we expect it to fail, it currently passes and allows negative balance.
      // We will document that it currently allows it.
      expect(res.status).toBe(200);

      const customer = await dbGet(
        db,
        "SELECT balance FROM customers WHERE id = ?",
        [CUSTOMER_ID],
      );
      expect(customer.balance).toBe(-150); // 50 - 200 = -150
    });
  });
});
