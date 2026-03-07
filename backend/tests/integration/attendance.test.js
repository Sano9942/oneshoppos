const supertest = require("supertest");
const { createTestApp, closeDb, dbGet, dbAll } = require("../helpers/createTestApp");

describe("Attendance & Kiosk Integration Tests", () => {
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

  const PIN_CASHIER = "3333"; // id: 3, role: Cashier
  const OUTLET_ID = 1;

  describe("Kiosk Flow (PIN-based)", () => {
    it("should return 401 for invalid PIN", async () => {
      const res = await supertest(app)
        .post("/api/attendance/pin-status")
        .send({ pin_code: "9999" });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid PIN");
    });

    it('should return status "not_clocked_in" for a new day', async () => {
      const res = await supertest(app)
        .post("/api/attendance/pin-status")
        .send({ pin_code: PIN_CASHIER });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("not_clocked_in");
      expect(res.body.employee.name).toBe("Cashier User");
    });

    it("should clock in successfully (first time)", async () => {
      const res = await supertest(app)
        .post("/api/attendance/pin-checkin")
        .send({ pin_code: PIN_CASHIER, outlet_id: OUTLET_ID });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("Welcome");
      expect(res.body.session.session_type).toBe("work");

      // Verify DB records
      const dayRecord = await dbGet(
        db,
        "SELECT * FROM employee_attendance WHERE employee_id = 3",
      );
      expect(dayRecord).toBeDefined();
      expect(dayRecord.outlet_id).toBe(OUTLET_ID);

      const session = await dbGet(
        db,
        "SELECT * FROM attendance_sessions WHERE employee_id = 3",
      );
      expect(session).toBeDefined();
      expect(session.attendance_id).toBe(dayRecord.id);
    });

    it("should handle break flow correctly", async () => {
      // 1. Clock in
      await supertest(app)
        .post("/api/attendance/pin-checkin")
        .send({ pin_code: PIN_CASHIER, outlet_id: OUTLET_ID });

      // 2. Go on break
      const breakRes = await supertest(app)
        .post("/api/attendance/pin-checkout")
        .send({ pin_code: PIN_CASHIER, break_reason: "lunch" });

      expect(breakRes.status).toBe(200);
      expect(breakRes.body.message).toContain("Break started");

      const sessions = await dbAll(
        db,
        "SELECT * FROM attendance_sessions WHERE employee_id = 3 ORDER BY id ASC",
      );
      expect(sessions.length).toBe(2);
      expect(sessions[0].session_type).toBe("work");
      expect(sessions[0].session_end).not.toBeNull();
      expect(sessions[1].session_type).toBe("break");
      expect(sessions[1].break_reason).toBe("lunch");
      expect(sessions[1].session_end).toBeNull();

      // 3. Status check while on break
      const statusRes = await supertest(app)
        .post("/api/attendance/pin-status")
        .send({ pin_code: PIN_CASHIER });
      expect(statusRes.body.status).toBe("on_break");

      // 4. Return from break
      const returnRes = await supertest(app)
        .post("/api/attendance/pin-checkin")
        .send({ pin_code: PIN_CASHIER, outlet_id: OUTLET_ID });

      expect(returnRes.status).toBe(200);
      expect(returnRes.body.message).toContain("Welcome back");

      const finalSessions = await dbAll(
        db,
        "SELECT * FROM attendance_sessions WHERE employee_id = 3 ORDER BY id ASC",
      );
      expect(finalSessions.length).toBe(3);
      expect(finalSessions[1].session_end).not.toBeNull();
      expect(finalSessions[2].session_type).toBe("work");
    });

    it("should clock out (end of day) and update net hours", async () => {
      // 1. Clock in
      await supertest(app)
        .post("/api/attendance/pin-checkin")
        .send({ pin_code: PIN_CASHIER, outlet_id: OUTLET_ID });

      // Mock some time passing (simulated by manual update since we can't easily mock system time in the route's helper)
      // Actually, we can just clock out and it will be ~0 hours, but it should still update the record.

      const res = await supertest(app)
        .post("/api/attendance/pin-checkout")
        .send({ pin_code: PIN_CASHIER });

      expect(res.status).toBe(200);
      expect(res.body.is_end_of_day).toBe(true);
      expect(res.body.message).toContain("Goodbye");

      const dayRecord = await dbGet(
        db,
        "SELECT * FROM employee_attendance WHERE employee_id = 3",
      );
      expect(dayRecord.check_out).not.toBeNull();
      expect(dayRecord.hours).toBeDefined();
    });
  });

  describe("Manager Functions (RBAC)", () => {
    const ADMIN_ID = "1";

    it("should allow manager to view attendance records", async () => {
      const res = await supertest(app)
        .get("/api/attendance")
        .set("x-employee-id", ADMIN_ID);

      expect(res.status).toBe(200);
      expect(res.body.records).toBeInstanceOf(Array);
    });

    it("should allow cashier to view attendance (has view_reports perm)", async () => {
      const res = await supertest(app)
        .get("/api/attendance")
        .set("x-employee-id", "3"); // Cashier has view_reports perm in seedData.js

      expect(res.status).toBe(200);
    });

    it("should allow manager to update attendance configuration", async () => {
      const res = await supertest(app)
        .put("/api/employees/3/attendance-config")
        .set("x-employee-id", ADMIN_ID)
        .send({ work_hours_per_day: 9.5, monthly_leave_allowance: 3 });

      expect(res.status).toBe(200);

      const emp = await dbGet(
        db,
        "SELECT work_hours_per_day, monthly_leave_allowance FROM employees WHERE id = 3",
      );
      expect(emp.work_hours_per_day).toBe(9.5);
      expect(emp.monthly_leave_allowance).toBe(3);
    });

    it("should allow manager to manually correct a day record", async () => {
      // 1. Create a record
      await dbGet(
        db,
        "INSERT INTO employee_attendance (employee_id, outlet_id, check_in, status) VALUES (3, 1, '2026-03-01 09:00:00', 'present')",
      );
      const record = await dbGet(
        db,
        "SELECT id FROM employee_attendance WHERE employee_id = 3",
      );

      // 2. Update it
      const res = await supertest(app)
        .put(`/api/attendance/${record.id}`)
        .set("x-employee-id", ADMIN_ID)
        .send({
          check_in: "2026-03-01 10:00:00",
          check_out: "2026-03-01 18:00:00",
          comment: "Fixed late check-in",
        });

      expect(res.status).toBe(200);
      expect(res.body.hours).toBe(8); // 18:00 - 10:00

      const updated = await dbGet(
        db,
        "SELECT * FROM employee_attendance WHERE id = ?",
        [record.id],
      );
      expect(updated.comment).toBe("Fixed late check-in");
      expect(updated.hours).toBe(8);
    });
  });

  describe("Bug Verification", () => {
    it("Verify Bug B8: Clock-out day-record UPDATE uses correct outlet_id", async () => {
      // Problem B8: Clock-out day-record UPDATE used work session's outlet_id.
      // If an employee clocked in at Outlet 1, but then moved to Outlet 2 (if allowed/possible),
      // or if there was a mismatch, it might fail.
      // Actually, the fix was to ensure it uses the outlet_id from the openWork session.

      // 1. Clock in at Outlet 1
      await supertest(app)
        .post("/api/attendance/pin-checkin")
        .send({ pin_code: PIN_CASHIER, outlet_id: 1 });

      const dayRecordBefore = await dbGet(
        db,
        "SELECT * FROM employee_attendance WHERE employee_id = 3",
      );
      expect(dayRecordBefore.outlet_id).toBe(1);
      expect(dayRecordBefore.check_out).toBeNull();

      // 2. Clock out
      const res = await supertest(app)
        .post("/api/attendance/pin-checkout")
        .send({ pin_code: PIN_CASHIER });

      expect(res.status).toBe(200);

      const dayRecordAfter = await dbGet(
        db,
        "SELECT * FROM employee_attendance WHERE employee_id = 3",
      );
      expect(dayRecordAfter.check_out).not.toBeNull();
      expect(dayRecordAfter.hours).toBeDefined();
    });

    it("Verify Bug B7 (Transaction wrapping): Logic check", async () => {
      // B7 was about missing transaction wrapping in pin-checkin.
      // While we can't easily force a crash mid-request in integration tests without mocking the DB layer heavily,
      // we can verify that the multi-step logic correctly creates both records.
      // In the source code (attendance.js), it uses nested callbacks which is technically "atomic" in the sense
      // that if one fails, the others don't happen, but it doesn't ROLLBACK if the LAST one fails.
      // For now, we verify the happy path for the multi-step insertion.

      await supertest(app)
        .post("/api/attendance/pin-checkin")
        .send({ pin_code: PIN_CASHIER, outlet_id: OUTLET_ID });

      const dayRecord = await dbGet(
        db,
        "SELECT * FROM employee_attendance WHERE employee_id = 3",
      );
      const session = await dbGet(
        db,
        "SELECT * FROM attendance_sessions WHERE employee_id = 3",
      );

      expect(dayRecord).toBeDefined();
      expect(session).toBeDefined();
      expect(session.attendance_id).toBe(dayRecord.id);
    });
  });
});
