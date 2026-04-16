const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Attendance PIN endpoints Zod validation (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    require("../../routes/attendance")(app, deps);
  }, 60000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  describe("POST /api/attendance/pin-status", () => {
    it("rejects missing pin_code with 400 + field detail", async () => {
      const res = await request(app)
        .post("/api/attendance/pin-status")
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.details).toBeDefined();
      expect(res.body.details.some((d) => d.field === "pin_code")).toBe(true);
    });

    it("accepts pin_code without outlet_id", async () => {
      const res = await request(app)
        .post("/api/attendance/pin-status")
        .send({ pin_code: "9999" });
      // Status may be 401/404/500 depending on handler behavior, but NOT 400 (valid body)
      expect(res.status).not.toBe(400);
    });
  });

  describe("POST /api/attendance/pin-checkin", () => {
    it("rejects missing outlet_id with 400", async () => {
      const res = await request(app)
        .post("/api/attendance/pin-checkin")
        .send({ pin_code: "1234" });
      expect(res.status).toBe(400);
      expect(res.body.details.some((d) => d.field === "outlet_id")).toBe(true);
    });

    it("rejects non-numeric outlet_id with 400", async () => {
      const res = await request(app)
        .post("/api/attendance/pin-checkin")
        .send({ pin_code: "1234", outlet_id: "abc" });
      expect(res.status).toBe(400);
    });

    it("rejects missing pin_code with 400", async () => {
      const res = await request(app)
        .post("/api/attendance/pin-checkin")
        .send({ outlet_id: 1 });
      expect(res.status).toBe(400);
      expect(res.body.details.some((d) => d.field === "pin_code")).toBe(true);
    });
  });

  describe("POST /api/attendance/pin-checkout", () => {
    it("rejects missing pin_code with 400", async () => {
      const res = await request(app)
        .post("/api/attendance/pin-checkout")
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.details.some((d) => d.field === "pin_code")).toBe(true);
    });

    it("accepts valid body with break_reason", async () => {
      const res = await request(app)
        .post("/api/attendance/pin-checkout")
        .send({ pin_code: "9999", break_reason: "lunch" });
      // Status may be 404/500 depending on no active session, but NOT 400
      expect(res.status).not.toBe(400);
    });
  });
});
