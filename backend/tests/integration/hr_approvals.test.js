import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp, closeDb, dbRun, dbGet } from "../helpers/createTestApp";
import { makeRequest } from "../helpers/request";

describe("HR Payroll & Approvals Integration Tests", () => {
  let app;
  let db;
  const ADMIN_ID = 1;
  const EMPLOYEE_ID = 2;

  beforeAll(async () => {
    const setup = await createTestApp();
    app = setup.app;
    db = setup.db;

    await dbRun(
      db,
      "INSERT OR REPLACE INTO feature_flags (key, enabled) VALUES ('advanced_hr', 1)",
    );
    await dbRun(
      db,
      "INSERT OR REPLACE INTO feature_flags (key, enabled) VALUES ('approvals', 1)",
    );
    await dbRun(
      db,
      "INSERT OR REPLACE INTO feature_flags (key, enabled) VALUES ('accounting_core', 1)",
    );
  });

  afterAll(async () => {
    await closeDb(db);
  });

  describe("Leave Management", () => {
    it("should submit and approve a leave request", async () => {
      const res = await makeRequest(app, ADMIN_ID).post("/api/hr/leave").send({
        employee_id: EMPLOYEE_ID,
        type: "annual",
        start_date: "2026-03-10",
        end_date: "2026-03-12",
        days: 3,
        reason: "Vacation",
      });
      expect(res.status).toBe(200);
      const leaveId = res.body.id;

      const approveRes = await makeRequest(app, ADMIN_ID)
        .put(`/api/hr/leave/${leaveId}/status`)
        .send({
          status: "approved",
        });
      expect(approveRes.status).toBe(200);
    });
  });

  describe("Payroll Generation (Bug B14 Fix)", () => {
    it("should generate payroll correctly without double-deducting leave for daily workers", async () => {
      await dbRun(
        db,
        "INSERT INTO employees (name, pin_code, role_id, salary_type, daily_rate) VALUES ('Daily Worker Fixed', '9991', 3, 'daily', 1000)",
      );
      const dailyEmp = await dbGet(
        db,
        "SELECT id FROM employees WHERE pin_code = '9991'",
      );
      const dailyEmpId = dailyEmp.id;

      // Present for 2 days
      await dbRun(
        db,
        `INSERT INTO employee_attendance (employee_id, outlet_id, check_in, check_out) VALUES 
        (?, 1, '2026-03-01 09:00:00', '2026-03-01 17:00:00'),
        (?, 1, '2026-03-02 09:00:00', '2026-03-02 17:00:00')`,
        [dailyEmpId, dailyEmpId],
      );

      // Approved leave: 1 day
      await dbRun(
        db,
        `INSERT INTO leave_requests (employee_id, type, start_date, end_date, days, status)
        VALUES (?, 'sick', '2026-03-03', '2026-03-03', 1, 'approved')`,
        [dailyEmpId],
      );

      const periodRes = await makeRequest(app, ADMIN_ID)
        .post("/api/hr/payroll/periods")
        .send({
          period_name: "B14 Fix Test",
          start_date: "2026-03-01",
          end_date: "2026-03-31",
        });
      const periodId = periodRes.body.id;

      await makeRequest(app, ADMIN_ID).post(
        `/api/hr/payroll/periods/${periodId}/generate`,
      );

      const linesRes = await makeRequest(app, ADMIN_ID).get(
        `/api/hr/payroll/periods/${periodId}/lines`,
      );
      const line = linesRes.body.lines.find(
        (l) => l.employee_id === dailyEmpId,
      );

      expect(line).toBeDefined();
      expect(line.total_days).toBe(2);

      // FIXED B14: Should be 2 days * 1000 = 2000
      expect(line.gross_pay).toBe(2000);
    });
  });

  describe("Approval Flow (Bug B17 Fix)", () => {
    it("should block receiving a Draft PO (B17 Fix)", async () => {
      const poRes = await makeRequest(app, ADMIN_ID)
        .post("/api/purchase-orders")
        .send({
          supplier_id: 1,
          total_cost: 5000,
          items: [{ product_id: 1, quantity: 10, cost_price: 500 }],
        });
      const poId = poRes.body.id;

      // Attempt to Receive Draft PO (Should FAIL now)
      const receiveRes = await makeRequest(app, ADMIN_ID)
        .post(`/api/purchase-orders/${poId}/receive`)
        .send({
          outlet_id: 1,
          received_by: ADMIN_ID,
        });

      expect(receiveRes.status).toBe(400);
      expect(receiveRes.body.error).toContain(
        "Only Approved POs can be received",
      );
    });

    it("should allow receiving an Approved PO", async () => {
      const poRes = await makeRequest(app, ADMIN_ID)
        .post("/api/purchase-orders")
        .send({
          supplier_id: 1,
          total_cost: 3000,
          items: [{ product_id: 1, quantity: 6, cost_price: 500 }],
        });
      const poId = poRes.body.id;

      // Submit
      await makeRequest(app, ADMIN_ID)
        .post(`/api/purchase-orders/${poId}/submit`)
        .send({ requested_by: "Test" });

      // Approve
      await makeRequest(app, ADMIN_ID)
        .post(`/api/purchase-orders/${poId}/approve`)
        .send({
          action: "approved",
          action_by: "Manager",
        });

      // Receive (Should SUCCEED now)
      const receiveRes = await makeRequest(app, ADMIN_ID)
        .post(`/api/purchase-orders/${poId}/receive`)
        .send({
          outlet_id: 1,
          received_by: ADMIN_ID,
        });

      expect(receiveRes.status).toBe(200);
      const poFinal = await makeRequest(app, ADMIN_ID).get(
        `/api/purchase-orders/${poId}`,
      );
      expect(poFinal.body.purchaseOrder.status).toBe("Received");
    });
  });
});
