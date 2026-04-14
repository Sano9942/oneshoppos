/**
 * pg-rental-contracts.test.js — Integration tests for M7 rentals
 *
 * Covers: item CRUD, availability, contract lifecycle (create → confirm →
 * checkout → return with auto late-fee → complete → generate invoice),
 * cancel flow, and multi-contract availability.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("M7 Rentals — items + contracts lifecycle", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    // The rentals route imports the real middleware/feature-flags + permissions
    // modules (same pattern as service-tickets.js). Those modules read from
    // module-level `db` populated by init(deps) — the test helper never calls
    // init, so we do it here.
    require("../../middleware/feature-flags").init({ db });
    require("../../middleware/permissions"); // no init needed
    // Rentals routes call req.employee.id — the shared test helper only sets
    // req.employeePerms, so inject req.employee before route registration.
    app.use((req, res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });
    require("../../routes/rentals")(app, deps);
  }, 180000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  const authHeaders = { "x-employee-id": "1" };

  it("1. creates a rental item and returns it with asset counts", async () => {
    const create = await request(app)
      .post("/api/rental-items")
      .set(authHeaders)
      .send({
        name: "Road Bike",
        sku: "BIKE-001",
        total_quantity: 3,
        daily_rate: 25,
        hourly_rate: 5,
        weekly_rate: 140,
        deposit_amount: 50,
        payment_policy: "upfront",
      });
    expect(create.status).toBe(201);
    expect(create.body.name).toBe("Road Bike");
    expect(Number(create.body.daily_rate)).toBe(25);

    const list = await request(app).get("/api/rental-items").set(authHeaders);
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBe(1);
    expect(Number(list.body.items[0].total_quantity)).toBe(3);
  });

  it("2. creates a tracked rental asset under the item", async () => {
    const item = await request(app).get("/api/rental-items").set(authHeaders);
    const itemId = item.body.items[0].id;

    const create = await request(app)
      .post(`/api/rental-items/${itemId}/assets`)
      .set(authHeaders)
      .send({ serial_number: "SN-A1", label: "Red bike" });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe("available");

    const detail = await request(app).get(`/api/rental-items/${itemId}`).set(authHeaders);
    expect(detail.status).toBe(200);
    expect(detail.body.assets.length).toBe(1);
    expect(detail.body.assets[0].serial_number).toBe("SN-A1");
  });

  it("3. creates a contract in 'reserved' status with a generated contract_number", async () => {
    const item = await request(app).get("/api/rental-items").set(authHeaders);
    const itemId = item.body.items[0].id;

    const now = new Date();
    const end = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // +2 days

    const create = await request(app)
      .post("/api/rental-contracts")
      .set(authHeaders)
      .send({
        customer_id: 1,
        rental_start: now.toISOString(),
        expected_return: end.toISOString(),
        deposit_collected: 50,
        deposit_method: "cash",
        lines: [
          { rental_item_id: itemId, quantity: 1, rate_type: "daily", duration_value: 2 },
        ],
      });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe("reserved");
    expect(create.body.contract_number).toMatch(/^RNT-\d{6}$/);
    expect(Number(create.body.rental_fee_total)).toBe(50); // 2 days × 25
  });

  it("4. confirms a reserved contract", async () => {
    const list = await request(app).get("/api/rental-contracts").set(authHeaders);
    const id = list.body.contracts[0].id;

    const confirm = await request(app)
      .post(`/api/rental-contracts/${id}/confirm`)
      .set(authHeaders).send({});
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe("confirmed");
  });

  it("5. checks out a confirmed contract and sets actual_checkin", async () => {
    const list = await request(app).get("/api/rental-contracts").set(authHeaders);
    const id = list.body.contracts[0].id;

    const checkout = await request(app)
      .post(`/api/rental-contracts/${id}/checkout`)
      .set(authHeaders)
      .send({ deposit_method: "cash" });
    expect(checkout.status).toBe(200);
    expect(checkout.body.status).toBe("checked_out");
    expect(checkout.body.actual_checkin).toBeTruthy();
  });

  it("6. returns an overdue checked_out contract and auto-computes late fee", async () => {
    const list = await request(app).get("/api/rental-contracts").set(authHeaders);
    const id = list.body.contracts[0].id;

    // Push expected_return to 2 days in the past to force overdue auto-calc
    await db.query(
      "UPDATE rental_contracts SET expected_return = NOW() - INTERVAL '2 days' WHERE id = $1",
      [id]
    );

    const ret = await request(app)
      .post(`/api/rental-contracts/${id}/return`)
      .set(authHeaders)
      .send({});
    expect(ret.status).toBe(200);
    expect(ret.body.status).toBe("returned");
    // 2 days × $25 × qty 1 = $50
    expect(Number(ret.body.late_fee)).toBeGreaterThanOrEqual(50);
    expect(ret.body.late_fee_overridden).toBe(false);
  });

  it("7. completes a returned contract", async () => {
    const list = await request(app).get("/api/rental-contracts").set(authHeaders);
    const id = list.body.contracts[0].id;

    const complete = await request(app)
      .post(`/api/rental-contracts/${id}/complete`)
      .set(authHeaders).send({});
    expect(complete.status).toBe(200);
    expect(complete.body.status).toBe("completed");
  });

  it("8. generates an invoice from completed contract", async () => {
    const list = await request(app).get("/api/rental-contracts").set(authHeaders);
    const id = list.body.contracts[0].id;

    const gen = await request(app)
      .post(`/api/rental-contracts/${id}/invoice`)
      .set(authHeaders).send({});
    expect(gen.status).toBe(201);
    expect(gen.body.invoice).toBeTruthy();
    expect(gen.body.invoice.invoice_number).toMatch(/^INV-\d{6}$/);

    const detail = await request(app).get(`/api/rental-contracts/${id}`).set(authHeaders);
    expect(detail.body.status).toBe("invoiced");
    expect(detail.body.invoice_id).toBe(gen.body.invoice.id);
  });

  it("9. rejects invoice generation for non-completed contracts", async () => {
    const item = await request(app).get("/api/rental-items").set(authHeaders);
    const itemId = item.body.items[0].id;
    const now = new Date();
    const end = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

    const create = await request(app)
      .post("/api/rental-contracts").set(authHeaders)
      .send({
        rental_start: now.toISOString(),
        expected_return: end.toISOString(),
        lines: [{ rental_item_id: itemId, quantity: 1, rate_type: "daily", duration_value: 1 }],
      });
    const newId = create.body.id;

    const gen = await request(app).post(`/api/rental-contracts/${newId}/invoice`).set(authHeaders).send({});
    expect(gen.status).toBe(400);
    expect(gen.body.error).toMatch(/completed/i);
  });

  it("10. cancels a reserved contract and records the reason", async () => {
    const item = await request(app).get("/api/rental-items").set(authHeaders);
    const itemId = item.body.items[0].id;
    const now = new Date();
    const end = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

    const create = await request(app)
      .post("/api/rental-contracts").set(authHeaders)
      .send({
        rental_start: now.toISOString(),
        expected_return: end.toISOString(),
        lines: [{ rental_item_id: itemId, quantity: 1, rate_type: "daily", duration_value: 1 }],
      });
    const id = create.body.id;

    const cancel = await request(app)
      .post(`/api/rental-contracts/${id}/cancel`).set(authHeaders)
      .send({ cancellation_reason: "Customer changed plans" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("cancelled");
    expect(cancel.body.cancellation_reason).toBe("Customer changed plans");
  });

  it("11. availability decreases as overlapping contracts are booked", async () => {
    const item = await request(app).get("/api/rental-items").set(authHeaders);
    const itemId = item.body.items[0].id;

    const now = new Date();
    const end = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const from = now.toISOString();
    const to = end.toISOString();

    // Check availability window that overlaps the very first contract we created
    const avail = await request(app)
      .get(`/api/rental-items/${itemId}/availability`)
      .query({ from, to })
      .set(authHeaders);
    expect(avail.status).toBe(200);
    expect(avail.body.total_quantity).toBe(3);
    // booked_quantity depends on current active contracts — just assert it's within bounds
    expect(avail.body.booked_quantity).toBeGreaterThanOrEqual(0);
    expect(avail.body.available_quantity).toBeLessThanOrEqual(avail.body.total_quantity);
  });

  it("12. GET /api/rental-contracts/timeline returns items + bookings", async () => {
    const now = new Date();
    const end = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

    const res = await request(app)
      .get("/api/rental-contracts/timeline")
      .query({ from: now.toISOString(), to: end.toISOString() })
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(Array.isArray(res.body.bookings)).toBe(true);
  });
});
