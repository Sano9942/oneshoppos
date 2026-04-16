const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Shifts Zod validation (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    require("../../routes/shifts")(app, deps);
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  describe("POST /api/shifts/open", () => {
    it("rejects missing outlet_id with 400 + field detail", async () => {
      const res = await request(app)
        .post("/api/shifts/open")
        .set("x-employee-id", "1")
        .send({ opening_float: 500 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.details).toBeDefined();
      expect(res.body.details.some((d) => d.field === "outlet_id")).toBe(true);
    });

    it("rejects negative opening_float with 400", async () => {
      const res = await request(app)
        .post("/api/shifts/open")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, opening_float: -5 });
      expect(res.status).toBe(400);
    });

    it("rejects missing opening_float with 400", async () => {
      const res = await request(app)
        .post("/api/shifts/open")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1 });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/shifts/:id/close", () => {
    it("rejects missing closing_cash with 400", async () => {
      const res = await request(app)
        .post("/api/shifts/999/close")
        .set("x-employee-id", "1")
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.details.some((d) => d.field === "closing_cash")).toBe(true);
    });

    it("rejects negative closing_cash with 400", async () => {
      const res = await request(app)
        .post("/api/shifts/999/close")
        .set("x-employee-id", "1")
        .send({ closing_cash: -10 });
      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/shifts/:id/variance-approve", () => {
    it("rejects missing approved_by with 400", async () => {
      const res = await request(app)
        .put("/api/shifts/999/variance-approve")
        .set("x-employee-id", "1")
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.details.some((d) => d.field === "approved_by")).toBe(true);
    });

    it("rejects empty approved_by with 400", async () => {
      const res = await request(app)
        .put("/api/shifts/999/variance-approve")
        .set("x-employee-id", "1")
        .send({ approved_by: "" });
      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent shift with valid body", async () => {
      const res = await request(app)
        .put("/api/shifts/99999/variance-approve")
        .set("x-employee-id", "1")
        .send({ approved_by: "manager", approval_note: "test" });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it("approves variance on a closed shift with non-null variance", async () => {
      // Seed a closed shift with variance
      const { rows } = await db.query(
        `INSERT INTO cash_shifts
         (outlet_id, employee_id, opening_float, closing_cash, expected_cash, variance, status, closed_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'closed', NOW())
         RETURNING id`,
        [1, 1, 500, 1000, 950, 50]
      );
      const shiftId = rows[0].id;

      const res = await request(app)
        .put(`/api/shifts/${shiftId}/variance-approve`)
        .set("x-employee-id", "1")
        .send({ approved_by: "manager", approval_note: "counted twice, confirmed" });
      expect(res.status).toBe(200);
      expect(res.body.shift).toBeDefined();
      expect(res.body.shift.variance_approved_by).toBe("manager");
    });
  });
});
