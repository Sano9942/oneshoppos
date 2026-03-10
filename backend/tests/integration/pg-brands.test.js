const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("brands API (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    // Register converted brands route
    require("../../routes/brands")(app, deps);
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("GET /api/brands returns seeded brands", async () => {
    const res = await request(app)
      .get("/api/brands")
      .set("x-employee-id", "1");
    expect(res.status).toBe(200);
    expect(res.body.brands.length).toBeGreaterThanOrEqual(1);
  });

  it("POST /api/brands creates a brand", async () => {
    const res = await request(app)
      .post("/api/brands")
      .set("x-employee-id", "1")
      .send({ name: "Nike", description: "Sportswear" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.name).toBe("Nike");
  });

  it("PUT /api/brands/:id updates a brand", async () => {
    // Get the Nike brand id first
    const { rows } = await db.query("SELECT id FROM brands WHERE name = $1", ["Nike"]);
    const nikeId = rows[0].id;

    const res = await request(app)
      .put(`/api/brands/${nikeId}`)
      .set("x-employee-id", "1")
      .send({ name: "Nike Updated" });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Brand updated successfully");
  });

  it("PUT /api/brands/:id returns 404 for missing brand", async () => {
    const res = await request(app)
      .put("/api/brands/9999")
      .set("x-employee-id", "1")
      .send({ name: "Ghost" });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/brands/:id deletes a brand", async () => {
    const { rows } = await db.query("SELECT id FROM brands WHERE name = $1", ["Nike Updated"]);
    const nikeId = rows[0].id;

    const res = await request(app)
      .delete(`/api/brands/${nikeId}`)
      .set("x-employee-id", "1");
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Brand deleted");
  });

  it("DELETE /api/brands/:id returns 404 for missing brand", async () => {
    const res = await request(app)
      .delete("/api/brands/9999")
      .set("x-employee-id", "1");
    expect(res.status).toBe(404);
  });

  it("POST /api/brands blocked for cashier (no manage_inventory)", async () => {
    const res = await request(app)
      .post("/api/brands")
      .set("x-employee-id", "3")
      .send({ name: "Blocked Brand" });
    expect(res.status).toBe(403);
  });
});
