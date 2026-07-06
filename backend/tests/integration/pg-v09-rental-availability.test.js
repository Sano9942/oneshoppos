/**
 * pg-v09-rental-availability.test.js — V09 harden: availability enforcement
 *
 * Proves the availability re-check now runs INSIDE the FOR UPDATE lock at
 * contract creation (rental-service.js createContract), closing the
 * double-book race the depth plan flagged P0. The true parallel-reserve race
 * is closed structurally by the row lock; this file proves the guard logic
 * deterministically (the scripted parallel run belongs to the verifier against
 * a pooled DB, per the plan's verification bar).
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("V09 Rentals — availability enforced at contract creation", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    require("../../middleware/feature-flags").init({ db });
    require("../../middleware/permissions");
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
  let itemId;
  let firstContractId;

  const day = 24 * 60 * 60 * 1000;
  const mkWindow = (startOffsetDays, lenDays) => {
    const start = new Date(Date.now() + startOffsetDays * day);
    const end = new Date(start.getTime() + lenDays * day);
    return { rental_start: start.toISOString(), expected_return: end.toISOString() };
  };
  const book = (win, qty = 1) =>
    request(app).post("/api/rental-contracts").set(authHeaders).send({
      customer_id: 1,
      ...win,
      lines: [{ rental_item_id: itemId, quantity: qty, rate_type: "daily", duration_value: 1 }],
    });

  it("seeds a single-unit rental item (total_quantity = 1)", async () => {
    const create = await request(app).post("/api/rental-items").set(authHeaders).send({
      name: "Only Excavator",
      sku: "EXC-1",
      total_quantity: 1,
      daily_rate: 100,
      deposit_amount: 200,
    });
    expect(create.status).toBe(201);
    itemId = create.body.id;
  });

  it("allows the first booking of the only unit", async () => {
    const win = mkWindow(1, 3); // days 1..4
    const res = await book(win);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("reserved");
    firstContractId = res.body.id;
  });

  it("REJECTS a second overlapping booking of the last unit with 409", async () => {
    const win = mkWindow(2, 3); // days 2..5 — overlaps 1..4
    const res = await book(win);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/availability/i);
  });

  it("allows a non-overlapping booking of the same unit", async () => {
    const win = mkWindow(10, 3); // days 10..13 — no overlap
    const res = await book(win);
    expect(res.status).toBe(201);
  });

  it("REJECTS an over-quantity booking that exceeds total in one request", async () => {
    const win = mkWindow(30, 2);
    const res = await book(win, 2); // requesting 2 of a 1-unit item
    expect(res.status).toBe(409);
  });

  it("does not count cancelled/returned contracts against availability", async () => {
    // Cancel the day-1..4 booking specifically, then that window frees up.
    const cancel = await request(app)
      .post(`/api/rental-contracts/${firstContractId}/cancel`)
      .set(authHeaders)
      .send({ cancellation_reason: "freed for test" });
    expect(cancel.status).toBe(200);

    const win = mkWindow(1, 3); // same window as the now-cancelled booking
    const res = await book(win);
    expect(res.status).toBe(201);
  });
});
