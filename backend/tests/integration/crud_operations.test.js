import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestApp,
  closeDb,
  dbRun,
  dbGet,
  dbAll,
} from "../helpers/createTestApp";
import { makeRequest, ADMIN_ID } from "../helpers/request";

describe("Operations CRUD Integration Tests", () => {
  let app;
  let db;

  beforeAll(async () => {
    const setup = await createTestApp();
    app = setup.app;
    db = setup.db;
  });

  afterAll(async () => {
    await closeDb(db);
  });

  describe("Parked Sales CRUD", () => {
    let parkedId;

    it("should park a sale", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/parked-sales")
        .send({
          outlet_id: 1,
          employee_id: ADMIN_ID,
          items: [
            { product_id: 1, name: "Product 1", price: 100, quantity: 2 },
          ],
          notes: "Waiting for customer to return",
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      parkedId = res.body.id;
    });

    it("should list parked sales", async () => {
      const res = await makeRequest(app, ADMIN_ID).get("/api/parked-sales");
      expect(res.status).toBe(200);
      expect(res.body.parkedSales.some((s) => s.id === parkedId)).toBe(true);
    });

    it("should delete a parked sale", async () => {
      const res = await makeRequest(app, ADMIN_ID).delete(
        `/api/parked-sales/${parkedId}`,
      );
      expect(res.status).toBe(200);
    });
  });

  describe("Supplier Returns (RMA) CRUD", () => {
    let rmaId;

    it("should create an RMA request", async () => {
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/supplier-returns")
        .send({
          supplier_id: 1,
          outlet_id: 1,
          items: [
            { product_id: 1, quantity: 5, reason: "Damaged", unit_price: 50 },
          ],
        });
      expect(res.status).toBe(200);
      rmaId = res.body.id;
    });

    it("should list RMA requests", async () => {
      const res = await makeRequest(app, ADMIN_ID).get("/api/supplier-returns");
      expect(res.status).toBe(200);
      expect(res.body.returns.some((r) => r.id === rmaId)).toBe(true);
    });

    it("should get a single RMA request", async () => {
      const res = await makeRequest(app, ADMIN_ID).get(
        `/api/supplier-returns/${rmaId}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.returnData.id).toBe(rmaId);
    });
  });

  describe("Expenses CRUD", () => {
    let expenseId;
    let categoryId;

    it("should record a new expense", async () => {
      // 1. Create a category first
      const catRes = await makeRequest(app, ADMIN_ID)
        .post("/api/expense-categories")
        .send({
          name: "Utilities",
        });
      categoryId = catRes.body.id;

      const res = await makeRequest(app, ADMIN_ID).post("/api/expenses").send({
        outlet_id: 1,
        category_id: categoryId,
        amount: 5000,
        description: "Electricity Bill",
        expense_date: "2026-03-01",
      });
      expect(res.status).toBe(200);
      expenseId = res.body.id;
    });

    it("should list expenses", async () => {
      const res = await makeRequest(app, ADMIN_ID).get("/api/expenses");
      expect(res.status).toBe(200);
      expect(res.body.expenses.some((e) => e.id === expenseId)).toBe(true);
    });

    it("should delete an expense", async () => {
      const res = await makeRequest(app, ADMIN_ID).delete(
        `/api/expenses/${expenseId}`,
      );
      expect(res.status).toBe(200);
    });
  });
});
